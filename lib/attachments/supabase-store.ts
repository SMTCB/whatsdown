import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AcceptedUpload } from "./rules";
import type { Attachment, AttachmentStore, StoredAttachment } from "./store";

const BUCKET = "attachments";

interface Row {
  id: string;
  ticket_id: string;
  name: string;
  mime: string;
  size: number;
  storage_path: string;
  created_at: string;
}

const toMeta = (r: Row): Attachment => ({ id: r.id, ticketId: r.ticket_id, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at });

/** Documents in a private Supabase Storage bucket, with metadata in the attachments table. */
export class SupabaseAttachmentStore implements AttachmentStore {
  constructor(private readonly db: SupabaseClient) {}

  async add(ticketId: string, file: AcceptedUpload): Promise<Attachment> {
    const id = randomUUID();
    const path = `${ticketId}/${id}`;
    const up = await this.db.storage.from(BUCKET).upload(path, file.bytes, { contentType: file.mime });
    if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
    const { data, error } = await this.db
      .from("attachments")
      .insert({ id, ticket_id: ticketId, name: file.name, mime: file.mime, size: file.bytes.length, storage_path: path })
      .select("*")
      .single();
    if (error) {
      await this.db.storage.from(BUCKET).remove([path]);
      throw new Error(`Database error: ${error.message}`);
    }
    return toMeta(data as Row);
  }

  async list(ticketId: string): Promise<Attachment[]> {
    const { data, error } = await this.db.from("attachments").select("*").eq("ticket_id", ticketId).order("created_at");
    if (error) throw new Error(`Database error: ${error.message}`);
    return (data as Row[]).map(toMeta);
  }

  async get(id: string): Promise<StoredAttachment | null> {
    const { data, error } = await this.db.from("attachments").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Database error: ${error.message}`);
    if (!data) return null;
    const row = data as Row;
    const dl = await this.db.storage.from(BUCKET).download(row.storage_path);
    if (dl.error) throw new Error(`Download failed: ${dl.error.message}`);
    return { ...toMeta(row), bytes: new Uint8Array(await dl.data.arrayBuffer()) };
  }
}
