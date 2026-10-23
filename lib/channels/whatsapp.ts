import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Shape of Meta's WhatsApp Cloud API webhook, reduced to the fields we use. */
const webhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z.array(
          z.object({
            value: z.object({
              contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
              messages: z
                .array(
                  z.object({
                    id: z.string(),
                    from: z.string(),
                    type: z.string(),
                    text: z.object({ body: z.string() }).optional(),
                    audio: z.object({ id: z.string() }).optional(),
                  }),
                )
                .optional(),
            }),
          }),
        ),
      }),
    )
    .default([]),
});

export type InboundMessage =
  | { kind: "text"; messageId: string; from: string; name?: string; text: string }
  | { kind: "voice"; messageId: string; from: string; name?: string; mediaId: string }
  | { kind: "unsupported"; messageId: string; from: string; name?: string; messageType: string };

/** Verifies Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Answers Meta's one-off webhook verification handshake. Returns the challenge, or null to reject. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

/** Pulls every message out of a webhook payload. Malformed payloads give an empty list. */
export function parseWebhook(payload: unknown): InboundMessage[] {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) return [];
  const out: InboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const names = new Map((change.value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of change.value.messages ?? []) {
        const name = names.get(m.from);
        if (m.type === "text" && m.text) out.push({ kind: "text", messageId: m.id, from: m.from, name, text: m.text.body });
        else if (m.type === "audio" && m.audio) out.push({ kind: "voice", messageId: m.id, from: m.from, name, mediaId: m.audio.id });
        else out.push({ kind: "unsupported", messageId: m.id, from: m.from, name, messageType: m.type });
      }
    }
  }
  return out;
}

/** A WhatsApp message becomes a report: first line is the title, the whole text is the body. */
export function messageToReport(text: string): { title: string; body: string } {
  const body = text.trim();
  const firstLine = body.split("\n", 1)[0] ?? "";
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77).trimEnd()}...` : firstLine;
  return { title: title || "WhatsApp report", body };
}

/** Outbound text message request body for the Cloud API. */
export function textMessage(to: string, body: string) {
  return { messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4096) } };
}

/** Sends messages; the real implementation calls the Graph API once credentials exist. */
export interface WhatsAppSender {
  send(to: string, body: string): Promise<void>;
}

export class MemoryWhatsAppSender implements WhatsAppSender {
  readonly sent: { to: string; body: string }[] = [];
  async send(to: string, body: string) {
    this.sent.push({ to, body });
  }
}
