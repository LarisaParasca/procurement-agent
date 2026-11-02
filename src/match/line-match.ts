import type { Agreement, Invoice, InvoiceLine, LineMatch, Term } from "../domain/index.js";
import { normalizeText, normalizeUnit, tokenSimilarity } from "./normalize.js";

/** Token similarity at or above this is accepted without the LLM. */
export const TOKEN_ACCEPT = 0.75;

/**
 * Deterministic line ↔ term matching: exact text, then aliases, then token similarity.
 * Lines it can't settle come back with termId null and method "none" — the pipeline
 * sends exactly those to the LLM in one batched call.
 */
export function matchLinesDeterministic(invoice: Invoice, agreement: Agreement): LineMatch[] {
  return invoice.lines.map((line) => matchLine(line, agreement.terms));
}

function matchLine(line: InvoiceLine, terms: Term[]): LineMatch {
  const text = normalizeText(line.description);
  const compatible = terms.filter((t) => unitsCompatible(line, t));

  const exact = compatible.find((t) => normalizeText(t.description) === text);
  if (exact) return { lineNo: line.lineNo, termId: exact.id, method: "exact", confidence: 1 };

  const alias = compatible.find((t) => t.aliases.some((a) => normalizeText(a) === text));
  if (alias) return { lineNo: line.lineNo, termId: alias.id, method: "alias", confidence: 0.98 };

  const ranked = compatible
    .map((t) => ({ t, sim: Math.max(tokenSimilarity(line.description, t.description), ...t.aliases.map((a) => tokenSimilarity(line.description, a))) }))
    .sort((a, b) => b.sim - a.sim);
  const [best, runnerUp] = ranked;
  // Accept only a clear winner; two similar terms ("ciment 32.5" vs "ciment 42.5") go to the LLM.
  if (best && best.sim >= TOKEN_ACCEPT && (!runnerUp || best.sim - runnerUp.sim >= 0.15)) {
    return { lineNo: line.lineNo, termId: best.t.id, method: "token", confidence: Math.round(best.sim * 100) / 100 };
  }
  return { lineNo: line.lineNo, termId: null, method: "none", confidence: 0 };
}

function unitsCompatible(line: InvoiceLine, term: Term): boolean {
  if (term.kind !== "unit_item") return true;
  const a = normalizeUnit(line.unit);
  const b = normalizeUnit(term.unit);
  return a === undefined || b === undefined || a === b;
}
