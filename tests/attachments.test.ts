import { describe, expect, it } from "vitest";
import { ATTACH_LIMITS, sanitizeFilename, validateUploads } from "@/lib/attachments/rules";
import { MemoryAttachmentStore } from "@/lib/attachments/store";

const bytes = (...n: number[]) => new Uint8Array(n);
const pdf = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1);
const jpg = bytes(0xff, 0xd8, 0xff, 0xe0);
const docx = bytes(0x50, 0x4b, 0x03, 0x04, 1);
const text = new TextEncoder().encode("error log line");

describe("validateUploads", () => {
  it("accepts each supported type when content matches", () => {
    const r = validateUploads([
      { name: "a.pdf", bytes: pdf },
      { name: "b.png", bytes: png },
      { name: "c.JPG", bytes: jpg },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.accepted.map((a) => a.kind)).toEqual(["pdf", "png", "jpeg"]);
    expect(validateUploads([{ name: "d.docx", bytes: docx }, { name: "e.txt", bytes: text }]).errors).toEqual([]);
  });

  it("rejects a file whose content does not match its extension", () => {
    const r = validateUploads([{ name: "evil.pdf", bytes: text }]);
    expect(r.accepted).toEqual([]);
    expect(r.errors[0]).toMatch(/not a supported file/);
  });

  it("rejects unsupported extensions and binary text", () => {
    expect(validateUploads([{ name: "run.exe", bytes: pdf }]).errors).toHaveLength(1);
    expect(validateUploads([{ name: "x.txt", bytes: bytes(1, 0, 2) }]).errors).toHaveLength(1);
  });

  it("enforces count and size limits", () => {
    const many = Array.from({ length: ATTACH_LIMITS.maxFiles + 1 }, (_, i) => ({ name: `f${i}.pdf`, bytes: pdf }));
    expect(validateUploads(many).errors[0]).toMatch(/up to 3/);
    const big = new Uint8Array(ATTACH_LIMITS.maxBytes + 1);
    big.set(pdf);
    expect(validateUploads([{ name: "big.pdf", bytes: big }]).errors[0]).toMatch(/larger than/);
  });

  it("ignores the empty entry browsers send when no file is chosen", () => {
    expect(validateUploads([{ name: "", bytes: new Uint8Array() }])).toEqual({ accepted: [], errors: [] });
  });
});

describe("sanitizeFilename", () => {
  it("drops paths and unsafe characters", () => {
    expect(sanitizeFilename("..\\..\\etc/passwd")).toBe("passwd");
    expect(sanitizeFilename('we"ird<name>.pdf')).toBe("we_ird_name_.pdf");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename(".hidden")).toBe("hidden");
  });
});

describe("MemoryAttachmentStore", () => {
  it("stores, lists per ticket and returns bytes", async () => {
    const s = new MemoryAttachmentStore();
    const a = await s.add("t1", { name: "a.pdf", kind: "pdf", mime: "application/pdf", bytes: pdf });
    await s.add("t2", { name: "b.pdf", kind: "pdf", mime: "application/pdf", bytes: pdf });
    expect((await s.list("t1")).map((x) => x.id)).toEqual([a.id]);
    expect((await s.get(a.id))?.bytes).toEqual(pdf);
    expect(await s.get("missing")).toBeNull();
  });
});
