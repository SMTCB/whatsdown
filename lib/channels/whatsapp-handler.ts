import type { TicketStore } from "@/lib/db/store";
import { reportInputSchema } from "@/lib/guard/input";
import { advance, type PipelineDeps } from "@/lib/pipeline/runner";
import { messageToReport, parseWebhook, type WhatsAppSender } from "./whatsapp";

export interface WhatsAppDeps {
  store: TicketStore;
  pipeline: PipelineDeps;
  sender: WhatsAppSender;
  projectId: string;
  /** Only allowlisted numbers can open tickets. */
  isAllowed: (phone: string) => boolean | Promise<boolean>;
  /** Message ids already handled; Meta retries deliveries. Pass a shared Set. */
  seen: Set<string>;
}

export interface HandleResult {
  created: string[];
  ignored: number;
}

/** Turns a webhook payload into tickets and acknowledgements. Never throws on bad input. */
export async function handleWhatsAppWebhook(deps: WhatsAppDeps, payload: unknown): Promise<HandleResult> {
  const result: HandleResult = { created: [], ignored: 0 };

  for (const msg of parseWebhook(payload)) {
    if (deps.seen.has(msg.messageId)) {
      result.ignored++;
      continue;
    }
    deps.seen.add(msg.messageId);

    if (!(await deps.isAllowed(msg.from))) {
      result.ignored++;
      continue;
    }

    if (msg.kind === "voice") {
      await deps.sender.send(msg.from, "Voice notes are not supported yet. Please type your message and we will take it from there.");
      continue;
    }
    if (msg.kind === "unsupported") {
      await deps.sender.send(msg.from, "Sorry, I can only read text messages for now.");
      continue;
    }

    const parsed = reportInputSchema.safeParse(messageToReport(msg.text));
    if (!parsed.success) {
      await deps.sender.send(msg.from, "Could you tell me a bit more about what went wrong? A sentence or two is enough.");
      continue;
    }

    const ticket = await deps.store.create({ projectId: deps.projectId, ...parsed.data, channel: "whatsapp", reporterPhone: msg.from });
    const settled = await advance(deps.pipeline, ticket.id);
    result.created.push(ticket.id);

    const reply = await replyFor(deps.store, settled.id, ticket.number);
    await deps.sender.send(msg.from, reply);
  }
  return result;
}

async function replyFor(store: TicketStore, ticketId: string, number: number): Promise<string> {
  const t = await store.get(ticketId);
  const events = await store.events(ticketId);
  switch (t?.status) {
    case "needs_info": {
      const q = [...events].reverse().find((e) => e.toStatus === "needs_info")?.payload.question;
      return `Thanks, I opened ticket #${number}. ${typeof q === "string" ? q : "Could you add a few more details?"}`;
    }
    case "duplicate":
      return `Thanks! This looks like a problem we are already working on, so I did not open a new ticket (#${number}).`;
    case "closed":
      return `I could not process that message (ticket #${number}). Please rewrite it in your own words and send it again.`;
    case "failed":
      return `Thanks, I opened ticket #${number}, but something went wrong on our side. The owner has been told.`;
    default:
      return `Thanks, I opened ticket #${number} and we are looking into it.`;
  }
}
