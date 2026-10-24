import type { TicketStatus } from "@/lib/domain/status";

export interface PublicStatus {
  /** Short label for the badge. */
  label: string;
  /** One plain sentence for the reporter. */
  message: string;
  /** Position in the four-step progress bar (1 to 4). */
  step: number;
  done: boolean;
}

export const PUBLIC_STEPS = ["Received", "Investigating", "Fix in progress", "Fixed"] as const;

const FIXED: PublicStatus = { label: "Fixed", message: "The fix is live. Thank you for reporting it.", step: 4, done: true };

/** What a reporter sees for each internal status. Never exposes plans, errors or internal notes. */
export function publicStatus(status: TicketStatus, wasMerged = false): PublicStatus {
  switch (status) {
    case "new":
    case "triaged":
      return { label: "Received", message: "We have your report and are looking at it.", step: 1, done: false };
    case "needs_info":
      return { label: "Needs your answer", message: "We need a bit more information before we can continue.", step: 1, done: false };
    case "diagnosing":
    case "awaiting_plan_approval":
      return { label: "Investigating", message: "We are working out the cause and a plan to fix it.", step: 2, done: false };
    case "patching":
    case "in_qa":
      return { label: "Fix in progress", message: "A fix is being prepared and tested.", step: 3, done: false };
    case "awaiting_merge":
      return { label: "Fix ready", message: "A tested fix is ready and waiting for the maintainer's final approval.", step: 3, done: false };
    case "merged":
    case "notified":
      return FIXED;
    case "duplicate":
      return { label: "Already known", message: "Someone reported this already and it is being handled.", step: 2, done: true };
    case "failed":
      return { label: "Delayed", message: "We hit a problem on our side. The maintainer will look at it.", step: 2, done: false };
    case "closed":
      return wasMerged ? FIXED : { label: "Closed", message: "This report was closed without a change. The maintainer may follow up.", step: 4, done: true };
  }
}
