import { counterpartyOf, dateInRange, type Agreement, type AgreementMatch, type Invoice, type Profile } from "../domain/index.js";

export interface CandidateQuery {
  counterpartyCui?: string;
  /** Already normalized with normalizeReference. */
  references: string[];
  date?: string;
}

export interface ScoredCandidate {
  agreement: Agreement;
  score: number;
  reasons: string[];
}

// Weights for the deterministic score. A reference number is the strongest signal; CUI alone
// is not enough because one supplier often has several agreements (a contract and a PO).
const W_REFERENCE = 0.6;
const W_CUI = 0.3;
const W_DATE = 0.1;

export const queryFromInvoice = (invoice: Invoice): CandidateQuery => ({
  counterpartyCui: counterpartyOf(invoice).cui,
  references: invoice.references.map((r) => r.normalized),
  date: invoice.issueDate,
});

/** Scores every agreement that shares the counterparty CUI or a reference number with the query. */
export function scoreCandidates(query: CandidateQuery, agreements: Agreement[]): ScoredCandidate[] {
  const refs = new Set(query.references);
  const scored: ScoredCandidate[] = [];
  for (const agreement of agreements) {
    const reasons: string[] = [];
    let score = 0;
    const ref = agreement.references.find((r) => refs.has(r.normalized));
    if (ref) {
      score += W_REFERENCE;
      reasons.push(`reference ${ref.raw} found on invoice`);
    }
    if (query.counterpartyCui && agreement.parties.some((p) => p.cui === query.counterpartyCui)) {
      score += W_CUI;
      reasons.push(`CUI ${query.counterpartyCui} is a party`);
    }
    if (score === 0) continue;
    if (query.date && dateInRange(query.date, agreement.validity.from, agreement.validity.to)) {
      score += W_DATE;
      reasons.push("invoice date within validity");
    }
    scored.push({ agreement, score: Math.round(score * 100) / 100, reasons });
  }
  return scored.sort((a, b) => b.score - a.score || a.agreement.id.localeCompare(b.agreement.id));
}

/**
 * Deterministic decision: accept the top candidate if it clears autoMatchMin and is not tied.
 * Returns null when the decision needs the LLM (candidates exist but none is conclusive).
 */
export function decideDeterministic(candidates: ScoredCandidate[], profile: Profile): AgreementMatch | null {
  const summary = candidates.map((c) => ({ agreementId: c.agreement.id, score: c.score, reasons: c.reasons }));
  if (candidates.length === 0) {
    return { agreementId: null, method: "none", confidence: 0, evidence: ["no agreement shares the CUI or a reference"], candidates: [] };
  }
  const [top, second] = candidates;
  if (top!.score >= profile.matching.autoMatchMin && (!second || second.score < top!.score)) {
    return { agreementId: top!.agreement.id, method: "deterministic", confidence: top!.score, evidence: top!.reasons, candidates: summary };
  }
  return null;
}
