import type { Agreement, InvoiceLine, Term } from "../domain/index.js";
import type { RuleContext } from "./types.js";

/** Lines paired with the agreement term they were matched to (unmatched lines are skipped). */
export function matchedLines<K extends Term["kind"]>(
  ctx: RuleContext,
  kind: K,
): Array<{ line: InvoiceLine; term: Extract<Term, { kind: K }> }> {
  if (!ctx.agreement) return [];
  const out: Array<{ line: InvoiceLine; term: Extract<Term, { kind: K }> }> = [];
  for (const line of ctx.invoice.lines) {
    const term = termForLine(ctx, line.lineNo);
    if (term?.kind === kind) out.push({ line, term: term as Extract<Term, { kind: K }> });
  }
  return out;
}

export function termForLine(ctx: RuleContext, lineNo: number): Term | undefined {
  const termId = ctx.lineMatches.find((m) => m.lineNo === lineNo)?.termId;
  return termId ? findTerm(ctx.agreement, termId) : undefined;
}

export const findTerm = (agreement: Agreement | null, termId: string): Term | undefined =>
  agreement?.terms.find((t) => t.id === termId);

/** Ledger entries that still count towards limits (rejected invoices don't). */
export const countingEntries = (ctx: RuleContext) => ctx.ledger.filter((e) => e.status !== "rejected");

export const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
