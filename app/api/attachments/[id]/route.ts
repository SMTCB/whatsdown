import { getAttachments } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Always served as a download with a fixed type, so an uploaded file can never run in the page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await getAttachments().get(id);
  if (!file) return new Response("Not found", { status: 404 });
  const encoded = encodeURIComponent(file.name);
  return new Response(file.bytes as BodyInit, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${file.name.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
