import type { Agreement, CheckResult, Invoice, Verdict } from "../domain/index.js";
import { normalizeReference, normalizeText, normalizeUnit, tokenSimilarity } from "../match/normalize.js";
import type { AgreementTruth, InvoiceTruth } from "../seed/truth.js";

// Pure scoring functions: (truth, prediction) → counts. No I/O, so they're unit-testable.

export interface FieldTally {
  [field: string]: { correct: number; total: number };
}

const tally = (t: FieldTally, field: string, ok: boolean) => {
  const row = (t[field] ??= { correct: 0, total: 0 });
  row.total++;
  if (ok) row.correct++;
};

const num = (a: string | number | undefined | null, b: string | number | undefined | null) =>
  a !== undefined && a !== null && b !== undefined && b !== null && Math.abs(Number(a) - Number(b)) < 0.005;
const text = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && (normalizeText(a) === normalizeText(b) || tokenSimilarity(a, b) >= 0.9);
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export function scoreInvoiceExtraction(t: InvoiceTruth, inv: Invoice, out: FieldTally) {
  const e = t.expectedExtraction;
  // Series and number are often split differently ("OTD 0145" vs series OTD + number 0145): compare joined.
  const joined = (s: string | undefined, n: string) => `${s ?? ""}${n}`.replace(/[\s\-/]/g, "").toUpperCase();
  tally(out, "series+number", joined(inv.series, inv.number) === joined(e.series, e.number));
  tally(out, "issueDate", inv.issueDate === e.issueDate);
  tally(out, "dueDate", inv.dueDate === e.dueDate);
  tally(out, "issuerCui", inv.issuer.cui === e.issuerCui);
  tally(out, "recipientCui", inv.recipient.cui === e.recipientCui);
  tally(out, "currency", inv.currency === e.currency);
  tally(out, "references", sameSet(inv.references.map((r) => r.normalized), e.references.map(normalizeReference)));
  tally(out, "lineCount", inv.lines.length === e.lines.length);
  e.lines.forEach((el, i) => {
    const l = inv.lines[i];
    tally(out, "line.description", text(l?.description, el.description));
    tally(out, "line.unit", normalizeUnit(l?.unit) === normalizeUnit(el.unit));
    tally(out, "line.quantity", num(l?.quantity, el.quantity));
    tally(out, "line.unitPrice", num(l?.unitPrice, el.unitPrice));
    tally(out, "line.net", num(l?.net, el.net));
    tally(out, "line.vatRate", num(l?.vatRate, el.vatRate));
  });
  tally(out, "totals.net", num(inv.totals.net, e.totals.net));
  tally(out, "totals.vat", num(inv.totals.vat, e.totals.vat));
  tally(out, "totals.gross", num(inv.totals.gross, e.totals.gross));
}

export function scoreAgreementExtraction(t: AgreementTruth, a: Agreement, out: FieldTally) {
  tally(out, "documentType", a.documentType === t.documentType);
  tally(out, "reference", a.references.some((r) => r.normalized === normalizeReference(t.number)));
  tally(out, "partyCuis", sameSet(a.parties.map((p) => p.cui), t.parties.map((p) => p.cui)));
  tally(out, "validFrom", a.validity.from === t.validity.from);
  tally(out, "validTo", a.validity.to === t.validity.to);
  tally(out, "totalCap", t.totalCap === undefined ? a.totalCap === undefined : num(a.totalCap, t.totalCap));
  tally(out, "termCount", a.terms.length === t.terms.length);
  for (const tt of t.terms) {
    // Align by description, not position — extraction may order terms differently.
    const best = a.terms.map((x) => ({ x, s: tokenSimilarity(x.description, tt.description) })).sort((p, q) => q.s - p.s)[0];
    const at = best && best.s >= 0.6 ? best.x : undefined;
    tally(out, "term.found", at !== undefined);
    tally(out, "term.kind", at?.kind === tt.kind);
    if (tt.kind === "unit_item") {
      tally(out, "term.unit", at?.kind === "unit_item" && normalizeUnit(at.unit) === normalizeUnit(tt.unit));
      tally(out, "term.unitPrice", at?.kind === "unit_item" && num(at.unitPrice, tt.unitPrice));
      tally(out, "term.maxQuantity", at?.kind === "unit_item" && (tt.maxQuantity === undefined ? at.maxQuantity === undefined : num(at.maxQuantity, tt.maxQuantity)));
    } else if (tt.kind === "fixed_amount") {
      tally(out, "term.amount", at?.kind === "fixed_amount" && num(at.amount, tt.amount));
    }
  }
}

export interface IssueCounts {
  [code: string]: { tp: number; fp: number; fn: number };
}

/** Issues are compared as multisets keyed by rule code + line number (when the truth names a line). */
export function scoreIssues(t: InvoiceTruth, result: CheckResult, out: IssueCounts) {
  const key = (code: string, lineNo?: number) => `${code}|${lineNo ?? ""}`;
  const expected = t.expectedIssues.map((i) => key(i.code, i.lineNo));
  const got = result.issues.map((i) => {
    const wantsLine = t.expectedIssues.some((e) => e.code === i.code && e.lineNo !== undefined);
    return key(i.code, wantsLine ? i.lineNo : undefined);
  });
  const remaining = [...got];
  const missing: string[] = [];
  for (const e of expected) {
    const idx = remaining.indexOf(e);
    const code = e.split("|")[0]!;
    const row = (out[code] ??= { tp: 0, fp: 0, fn: 0 });
    if (idx >= 0) {
      row.tp++;
      remaining.splice(idx, 1);
    } else {
      row.fn++;
      missing.push(e);
    }
  }
  for (const extra of remaining) (out[extra.split("|")[0]!] ??= { tp: 0, fp: 0, fn: 0 }).fp++;
  return { missing, extra: remaining };
}

export type Confusion = Record<Verdict, Record<Verdict, number>>;
export const emptyConfusion = (): Confusion => ({
  APPROVE: { APPROVE: 0, REVIEW: 0, REJECT: 0 },
  REVIEW: { APPROVE: 0, REVIEW: 0, REJECT: 0 },
  REJECT: { APPROVE: 0, REVIEW: 0, REJECT: 0 },
});

/** Line → term accuracy. Term ids differ between truth and extracted agreements, so compare term descriptions. */
export function lineTermCorrect(expectedTermId: string | null, gotTermId: string | null, truthAgreement: AgreementTruth | undefined, agreement: Agreement | null): boolean {
  if (expectedTermId === null || gotTermId === null) return expectedTermId === gotTermId;
  const want = truthAgreement?.terms.find((x) => x.id === expectedTermId)?.description;
  const got = agreement?.terms.find((x) => x.id === gotTermId)?.description;
  return want !== undefined && got !== undefined && (normalizeText(want) === normalizeText(got) || tokenSimilarity(want, got) >= 0.8);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
