import type { Agreement, AgreementMatch, Invoice, Issue, Verdict } from "../domain/index.js";
import { qty, roDate, ron } from "../seed/format.js";

// The only input the report writer sees: structured facts, already computed by code,
// with numbers pre-formatted the Romanian way. The LLM explains — it never calculates.

export interface ReportFacts {
  verdict: Verdict;
  verdictReasons: string[];
  invoice: {
    number: string;
    issuer: string;
    issuerCui: string;
    issueDate: string;
    totalNet: string;
    totalGross: string;
    currency: string;
    lines: Array<{ lineNo: number; description: string; quantity: string; unit: string; unitPrice: string; net: string }>;
  };
  agreement: null | { type: string; reference: string; validity: string; matchedBy: string; matchConfidence: string };
  issues: Array<{ code: string; severity: string; lineNo?: number; expected?: string; actual?: string; delta?: string; details: Record<string, string | number> }>;
  extractionWarnings: string[];
}

const DOC_TYPE_RO: Record<string, string> = {
  purchase_order: "comandă",
  contract: "contract",
  offer: "ofertă acceptată",
  cost_estimate: "deviz",
  lease: "contract de închiriere",
  brokerage: "contract de intermediere",
  email_acceptance: "e-mail de acceptare",
  other: "document de referință",
};

const MATCH_RO: Record<AgreementMatch["method"], string> = {
  deterministic: "potrivire automată după CUI și număr de referință",
  llm: "potrivire asistată (fără număr de referință pe factură)",
  none: "nicio potrivire",
};

/** Decimals → "1.234,50"; ISO dates anywhere in the string → "20.03.2026". */
function fmtMoney(v: string | undefined): string | undefined {
  if (v === undefined) return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return ron(v);
  return v.replace(/\d{4}-\d{2}-\d{2}/g, roDate).replace(/(\d+)\.(\d+)%/g, "$1,$2%");
}

export function buildFacts(args: {
  invoice: Invoice;
  agreement: Agreement | null;
  match: AgreementMatch;
  issues: Issue[];
  verdict: Verdict;
  verdictReasons: string[];
}): ReportFacts {
  const { invoice, agreement, match, issues, verdict, verdictReasons } = args;
  return {
    verdict,
    verdictReasons,
    invoice: {
      number: `${invoice.series ? `${invoice.series} ` : ""}${invoice.number}`,
      issuer: invoice.issuer.name,
      issuerCui: invoice.issuer.cui,
      issueDate: roDate(invoice.issueDate),
      totalNet: ron(invoice.totals.net),
      totalGross: ron(invoice.totals.gross),
      currency: invoice.currency,
      lines: invoice.lines.map((l) => ({
        lineNo: l.lineNo,
        description: l.description,
        quantity: qty(l.quantity),
        unit: l.unit ?? "",
        unitPrice: ron(l.unitPrice),
        net: ron(l.net),
      })),
    },
    agreement: agreement
      ? {
          type: DOC_TYPE_RO[agreement.documentType] ?? agreement.documentType,
          reference: agreement.references.map((r) => r.raw).join(", ") || agreement.key || agreement.id,
          validity: `${agreement.validity.from ? roDate(agreement.validity.from) : "…"} – ${agreement.validity.to ? roDate(agreement.validity.to) : "…"}`,
          matchedBy: MATCH_RO[match.method],
          matchConfidence: `${Math.round(match.confidence * 100)}%`,
        }
      : null,
    issues: issues.map((i) => {
      // Quantities read "20 t", money reads "20,00 lei".
      const isQty = i.code === "QUANTITY_ABOVE_AGREED" || (i.code === "CUMULATIVE_THRESHOLD" && i.params.scope === "term_quantity");
      const fmt = (v: string | undefined) => (isQty && v !== undefined && /^-?\d+(\.\d+)?$/.test(v) ? qty(v) : fmtMoney(v));
      return {
        code: i.code,
        severity: i.severity,
        lineNo: i.lineNo,
        expected: fmt(i.expected),
        actual: fmt(i.actual),
        delta: fmt(i.delta),
        details: Object.fromEntries(Object.entries(i.params).map(([k, v]) => [k, typeof v === "string" ? (fmt(v) ?? v) : v])),
      };
    }),
    extractionWarnings: [...invoice.extraction.reviewReasons, ...(agreement?.extraction.reviewReasons ?? [])],
  };
}
