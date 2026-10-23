import { DEMO_PROJECT_ID, getPipeline, getStore } from "@/lib/db";
import { verifyHandshake, verifySignature, type WhatsAppSender } from "@/lib/channels/whatsapp";
import { handleWhatsAppWebhook } from "@/lib/channels/whatsapp-handler";

export const dynamic = "force-dynamic";

const globalForSeen = globalThis as unknown as { __whatsdownSeen?: Set<string> };

/** Logs instead of sending until WHATSAPP_TOKEN and a Graph API sender exist. */
const consoleSender: WhatsAppSender = {
  async send(to, body) {
    console.log(`[whatsapp:stub] to ${to}: ${body}`);
  },
};

/** Meta's one-off verification handshake. */
export async function GET(req: Request) {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return new Response("WhatsApp is not configured", { status: 503 });
  const challenge = verifyHandshake(new URL(req.url).searchParams, token);
  return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge);
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return new Response("WhatsApp is not configured", { status: 503 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) return new Response("Bad signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const allow = new Set((process.env.WHATSAPP_ALLOWLIST ?? "").split(",").map((s) => s.trim().replace(/^\+/, "")).filter(Boolean));
  globalForSeen.__whatsdownSeen ??= new Set();
  const result = await handleWhatsAppWebhook(
    {
      store: getStore(),
      pipeline: getPipeline(),
      sender: consoleSender,
      projectId: DEMO_PROJECT_ID,
      isAllowed: (phone) => allow.has(phone.replace(/^\+/, "")),
      seen: globalForSeen.__whatsdownSeen,
    },
    payload,
  );
  // Meta only needs a 200 quickly; the body is for our own debugging.
  return Response.json(result);
}
