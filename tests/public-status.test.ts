import { describe, expect, it } from "vitest";
import { TICKET_STATUSES } from "@/lib/domain/status";
import { PUBLIC_STEPS, publicStatus } from "@/lib/domain/public-status";

describe("publicStatus", () => {
  it("has a plain message for every status and stays within the progress steps", () => {
    for (const s of TICKET_STATUSES) {
      const p = publicStatus(s);
      expect(p.message.length).toBeGreaterThan(10);
      expect(p.step).toBeGreaterThanOrEqual(1);
      expect(p.step).toBeLessThanOrEqual(PUBLIC_STEPS.length);
    }
  });

  it("tells a closed ticket apart by whether a fix was merged", () => {
    expect(publicStatus("closed", true).label).toBe("Fixed");
    expect(publicStatus("closed", false).label).toBe("Closed");
  });
});
