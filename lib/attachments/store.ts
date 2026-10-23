import { randomUUID } from "node:crypto";
import type { AcceptedUpload } from "./rules";

export interface Attachment {
  id: string;
  ticketId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface StoredAttachment extends Attachment {
  bytes: Uint8Array;
}

/** Storage port for uploaded documents. Supabase Storage implements this later. */
export interface AttachmentStore {
  add(ticketId: string, file: AcceptedUpload): Promise<Attachment>;
  list(ticketId: string): Promise<Attachment[]>;
  get(id: string): Promise<StoredAttachment | null>;
}

export class MemoryAttachmentStore implements AttachmentStore {
  private items = new Map<string, StoredAttachment>();

  async add(ticketId: string, file: AcceptedUpload): Promise<Attachment> {
    const item: StoredAttachment = {
      id: randomUUID(),
      ticketId,
      name: file.name,
      mime: file.mime,
      size: file.bytes.length,
      createdAt: new Date().toISOString(),
      bytes: file.bytes,
    };
    this.items.set(item.id, item);
    return toMeta(item);
  }

  async list(ticketId: string): Promise<Attachment[]> {
    return [...this.items.values()].filter((a) => a.ticketId === ticketId).map(toMeta);
  }

  async get(id: string): Promise<StoredAttachment | null> {
    return this.items.get(id) ?? null;
  }
}

function toMeta(item: StoredAttachment): Attachment {
  const { id, ticketId, name, mime, size, createdAt } = item;
  return { id, ticketId, name, mime, size, createdAt };
}
