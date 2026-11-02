import type {
  Agreement,
  ExtractionMeta,
  Invoice,
  InvoiceLine,
  LedgerEntry,
  LineMatch,
  Term,
} from "../src/domain/index.js";
import { loadProfile } from "../src/config/profiles.js";
import type { RuleContext } from "../src/rules/types.js";

// Small builders so each test states only what it is about.

export const meta = (over: Partial<ExtractionMeta> = {}): ExtractionMeta => ({
  confidence: 0.98,
  fieldConfidence: {},
  needsHumanReview: false,
  reviewReasons: [],
  model: "test",
  promptVersion: "test",
  extractedAt: "2026-01-01T00:00:00Z",
  ...over,
});

export const SUPPLIER = { name: "Furnizor Test SRL", cui: "18547290", vatPayer: true };
export const US = { name: "Constructii Exemplu SRL", cui: "40000000", vatPayer: true };

export const cement: Term = {
  id: "t1",
  kind: "unit_item",
  description: "Ciment Portland CEM II 42.5R, sac 40 kg",
  aliases: [],
  unit: "sac",
  unitPrice: "30.00",
  maxQuantity: "1000",
};

export function agreement(over: Partial<Agreement> = {}): Agreement {
  return {
    id: "agr1",
    key: "TEST-CTR-01",
    profileId: "developer",
    documentType: "contract",
    source: { path: "test.pdf", sha256: "x", format: "pdf" },
    parties: [
      { ...SUPPLIER, role: "supplier" },
      { ...US, role: "buyer" },
    ],
    currency: "RON",
    pricesIncludeVat: false,
    validity: { from: "2026-01-01", to: "2026-12-31" },
    references: [{ kind: "contract_no", raw: "Contract nr. 14/2026", normalized: "14/2026" }],
    terms: [cement],
    extraction: meta(),
    status: "active",
    ...over,
  };
}

export function line(over: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    lineNo: 1,
    description: "Ciment CEM II/A-LL 42.5R",
    unit: "sac",
    quantity: "100",
    unitPrice: "30.00",
    net: "3000.00",
    vatRate: "21",
    ...over,
  };
}

/** Builds an invoice whose VAT lines and totals are consistent with its lines (unless overridden). */
export function invoice(over: Partial<Invoice> = {}): Invoice {
  const lines = over.lines ?? [line()];
  const byRate = new Map<string, number>();
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + Number(l.net));
  const vatLines = [...byRate].map(([rate, base]) => ({
    rate,
    base: base.toFixed(2),
    amount: ((base * Number(rate)) / 100).toFixed(2),
  }));
  const net = vatLines.reduce((s, v) => s + Number(v.base), 0);
  const vat = vatLines.reduce((s, v) => s + Number(v.amount), 0);
  return {
    id: "inv1",
    profileId: "developer",
    source: { path: "inv.pdf", sha256: "y", format: "pdf" },
    series: "FT",
    number: "1001",
    issueDate: "2026-03-15",
    issuer: SUPPLIER,
    recipient: US,
    direction: "incoming",
    currency: "RON",
    references: [],
    lines,
    vatLines,
    totals: { net: net.toFixed(2), vat: vat.toFixed(2), gross: (net + vat).toFixed(2) },
    extraction: meta(),
    ...over,
  };
}

export function ledgerEntry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "le1",
    agreementId: "agr1",
    termId: "t1",
    invoiceId: "inv0",
    invoiceNumber: "FT1000",
    issuerCui: SUPPLIER.cui,
    quantity: "0",
    net: "0",
    currency: "RON",
    status: "pending_review",
    recordedAt: "2026-02-01T00:00:00Z",
    checkResultId: "cr0",
    ...over,
  };
}

export const developerProfile = loadProfile("developer");
export const agencyProfile = loadProfile("agency");

/** A context where everything matches; override the parts a test is about. */
export function ctx(over: Partial<RuleContext> = {}): RuleContext {
  const inv = over.invoice ?? invoice();
  const agr = over.agreement === undefined ? agreement() : over.agreement;
  const lineMatches: LineMatch[] =
    over.lineMatches ??
    inv.lines.map((l) => ({ lineNo: l.lineNo, termId: agr?.terms[0]?.id ?? null, method: "exact", confidence: 1 }));
  return {
    invoice: inv,
    agreement: agr,
    match: { agreementId: agr?.id ?? null, method: agr ? "deterministic" : "none", confidence: agr ? 1 : 0, evidence: [], candidates: [] },
    lineMatches,
    ledger: [],
    duplicates: { exact: [], suspected: [] },
    tolerances: developerProfile.tolerances,
    vat: developerProfile.vat,
    matching: developerProfile.matching,
    alerts: developerProfile.alerts,
    ...over,
  };
}
