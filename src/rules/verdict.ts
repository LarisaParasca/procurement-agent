import type { Agreement, Invoice, Issue, Verdict } from "../domain/index.js";

export interface VerdictInput {
  issues: Issue[];
  invoice: Invoice;
  agreement: Agreement | null;
}

/**
 * Verdict policy (code, never the LLM):
 *   REJECT  if any issue has severity "reject"
 *   REVIEW  if any issue has severity "review", or invoice/agreement extraction needs human review
 *   APPROVE otherwise — meaning "recommended for approval"; a human always makes the payment decision.
 */
export function decideVerdict({ issues, invoice, agreement }: VerdictInput): { verdict: Verdict; reasons: string[] } {
  const rejects = issues.filter((i) => i.severity === "reject");
  if (rejects.length > 0) return { verdict: "REJECT", reasons: rejects.map(describe) };

  const reasons = issues.filter((i) => i.severity === "review").map(describe);
  if (invoice.extraction.needsHumanReview) {
    reasons.push(`invoice extraction needs review: ${invoice.extraction.reviewReasons.join("; ")}`);
  }
  if (agreement?.extraction.needsHumanReview) {
    reasons.push(`agreement extraction needs review: ${agreement.extraction.reviewReasons.join("; ")}`);
  }
  if (reasons.length > 0) return { verdict: "REVIEW", reasons };
  return { verdict: "APPROVE", reasons: ["no blocking issues found"] };
}

const describe = (i: Issue) => (i.lineNo === undefined ? i.code : `${i.code} (line ${i.lineNo})`);
