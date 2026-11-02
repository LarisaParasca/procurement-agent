import { ulid } from "ulid";
import { z } from "zod";
import {
  AgreementSchema,
  CurrencySchema,
  fmt2,
  InvoiceSchema,
  isValidCui,
  normalizeCui,
  toDecimal,
  type Agreement,
  type ExtractionMeta,
  type Invoice,
  type Party,
  type Profile,
  type Reference,
  type Term,
} from "../domain/index.js";
import type { SourceDocument } from "../ingest/document.js";
import { normalizeReference } from "../match/normalize.js";
import { AGREEMENT_PROMPT, CLASSIFY_PROMPT, INVOICE_PROMPT } from "../llm/prompts/extract.js";
import type { Llm } from "../llm/types.js";
import { AgreementOut, ClassificationOut, InvoiceOut } from "./api-schemas.js";

// LLM output → canonical model. The LLM transcribes; this file normalizes and validates.
// Anything doubtful lowers confidence and adds a reviewReason — it never silently "fixes" data.

export class ExtractionError extends Error {}

export async function classifyDocument(llm: Llm, doc: SourceDocument) {
  const { data, usage } = await llm.structured({
    task: "classify",
    promptVersion: CLASSIFY_PROMPT.version,
    system: CLASSIFY_PROMPT.system,
    documents: [doc],
    text: CLASSIFY_PROMPT.text,
    schema: ClassificationOut,
    effort: "low",
    maxTokens: 1024,
  });
  return { classification: data, usage };
}

export async function extractInvoice(llm: Llm, doc: SourceDocument, profile: Profile) {
  const { data, usage, model } = await llm.structured({
    task: "extract",
    promptVersion: INVOICE_PROMPT.version,
    system: INVOICE_PROMPT.system,
    documents: [doc],
    text: INVOICE_PROMPT.text,
    schema: InvoiceOut,
  });
  return { invoice: normalizeInvoice(data, doc, profile, model, INVOICE_PROMPT.version), usage, raw: data };
}

export async function extractAgreement(llm: Llm, doc: SourceDocument, profile: Profile) {
  const { data, usage, model } = await llm.structured({
    task: "extract",
    promptVersion: AGREEMENT_PROMPT.version,
    system: AGREEMENT_PROMPT.system,
    documents: [doc],
    text: AGREEMENT_PROMPT.text,
    schema: AgreementOut,
  });
  return { agreement: normalizeAgreement(data, doc, profile, model, AGREEMENT_PROMPT.version), usage, raw: data };
}

// ---------- normalization ----------

class Review {
  readonly reasons: string[] = [];
  add(reason: string) {
    this.reasons.push(reason);
  }
}

function party(p: z.infer<typeof InvoiceOut>["issuer"], label: string, review: Review): Party {
  const cui = normalizeCui(p.cui);
  if (!isValidCui(cui)) review.add(`${label} CUI ${p.cui} fails the checksum (possible misread)`);
  return {
    name: p.name.trim(),
    cui: /^\d{2,10}$/.test(cui) ? cui : "0",
    vatPayer: /^\s*RO/i.test(p.cui),
    regCom: p.regCom ?? undefined,
    address: p.address ?? undefined,
    iban: p.iban ?? undefined,
  };
}

/** Money as printed on an invoice: always two decimals. */
const money = (n: number) => fmt2(toDecimal(n));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function date(value: string | null, label: string, review: Review): string | undefined {
  if (value === null) return undefined;
  if (!ISO.test(value) || Number.isNaN(Date.parse(value))) {
    review.add(`${label} "${value}" is not a valid date`);
    return undefined;
  }
  return value;
}

function currency(value: string, review: Review) {
  const parsed = CurrencySchema.safeParse(value.toUpperCase().replace("LEI", "RON"));
  if (!parsed.success) review.add(`unsupported currency "${value}", assumed RON`);
  return parsed.success ? parsed.data : "RON";
}

const refs = (list: Array<{ kind: Reference["kind"]; raw: string }>): Reference[] =>
  list.map((r) => ({ kind: r.kind, raw: r.raw, normalized: normalizeReference(r.raw) })).filter((r) => r.normalized.length > 0);

function meta(confidence: Record<string, number>, unreadable: string[], review: Review, profile: Profile, model: string, promptVersion: string): ExtractionMeta {
  const values = Object.values(confidence).map((c) => Math.min(1, Math.max(0, c)));
  for (const [field, c] of Object.entries(confidence)) {
    if (c < profile.extraction.reviewBelow) review.add(`low confidence on ${field} (${c.toFixed(2)})`);
  }
  for (const u of unreadable) review.add(`unreadable: ${u}`);
  // Code lowers the model's own confidence when validation found problems.
  const penalty = Math.min(0.5, review.reasons.length * 0.1);
  return {
    confidence: Math.max(0, Math.min(...values) - penalty),
    fieldConfidence: Object.fromEntries(Object.entries(confidence).map(([k, v]) => [k, Math.min(1, Math.max(0, v))])),
    needsHumanReview: review.reasons.length > 0,
    reviewReasons: review.reasons,
    model,
    promptVersion,
    extractedAt: new Date().toISOString(),
  };
}

export function normalizeInvoice(out: InvoiceOut, doc: SourceDocument, profile: Profile, model: string, promptVersion: string): Invoice {
  const review = new Review();
  const issuer = party(out.issuer, "issuer", review);
  const recipient = party(out.recipient, "recipient", review);
  const own = normalizeCui(profile.ownParty.cui);
  let direction: Invoice["direction"] = "incoming";
  if (issuer.cui === own) direction = "outgoing";
  else if (recipient.cui !== own) review.add(`our company (CUI ${own}) is neither issuer nor recipient`);

  const issueDate = date(out.issueDate, "issue date", review);
  if (!issueDate) throw new ExtractionError(`invoice issue date is missing or unreadable ("${out.issueDate}")`);
  if (out.lines.length === 0) throw new ExtractionError("no invoice lines could be extracted");

  const from = date(out.servicePeriodFrom, "service period start", review);
  const to = date(out.servicePeriodTo, "service period end", review);

  const candidate = {
    id: ulid(),
    profileId: profile.id,
    source: doc.ref,
    series: out.series?.trim() || undefined,
    number: out.number.trim(),
    issueDate,
    dueDate: date(out.dueDate, "due date", review),
    servicePeriod: from && to ? { from, to } : undefined,
    issuer,
    recipient,
    direction,
    currency: currency(out.currency, review),
    references: refs(out.references),
    lines: out.lines.map((l, i) => {
      const pf = date(l.periodFrom, `line ${i + 1} period start`, review);
      const pt = date(l.periodTo, `line ${i + 1} period end`, review);
      return {
        lineNo: i + 1,
        description: l.description.trim(),
        unit: l.unit?.trim() || undefined,
        quantity: toDecimal(l.quantity),
        unitPrice: toDecimal(l.unitPrice),
        net: money(l.net),
        vatRate: toDecimal(l.vatRate),
        period: pf && pt ? { from: pf, to: pt } : undefined,
        percentageBase: l.percentageBase === null ? undefined : toDecimal(l.percentageBase),
      };
    }),
    vatLines: out.vatLines.map((v) => ({ rate: toDecimal(v.rate), base: money(v.base), amount: money(v.amount) })),
    totals: { net: money(out.totals.net), vat: money(out.totals.vat), gross: money(out.totals.gross) },
    extraction: meta(out.confidence, out.unreadable, review, profile, model, promptVersion),
  };
  const parsed = InvoiceSchema.safeParse(candidate);
  if (!parsed.success) throw new ExtractionError(`extracted invoice failed validation:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function normalizeAgreement(out: AgreementOut, doc: SourceDocument, profile: Profile, model: string, promptVersion: string): Agreement {
  const review = new Review();
  if (!profile.acceptedReferenceTypes.includes(out.documentType)) {
    review.add(`document type "${out.documentType}" is not accepted by profile ${profile.id}`);
  }
  const parties = out.parties.map((p) => ({ ...party(p, p.role, review), role: p.role }));
  const own = normalizeCui(profile.ownParty.cui);
  if (!parties.some((p) => p.cui === own)) review.add(`our company (CUI ${own}) is not a party`);

  const terms: Term[] = out.terms.map((t, i): Term => {
    const base = { id: `t${i + 1}`, description: t.description.trim(), aliases: [], vatRate: t.vatRate === null ? undefined : toDecimal(t.vatRate) };
    switch (t.kind) {
      case "unit_item":
        return { ...base, kind: "unit_item", unit: t.unit, unitPrice: toDecimal(t.unitPrice), maxQuantity: t.maxQuantity === null ? undefined : toDecimal(t.maxQuantity) };
      case "fixed_amount":
        return { ...base, kind: "fixed_amount", amount: toDecimal(t.amount), allowInstallments: t.allowInstallments };
      case "percentage":
        if (t.rate > 1) review.add(`term ${i + 1}: rate ${t.rate} looks like a percent, not a fraction`);
        return {
          ...base,
          kind: "percentage",
          rate: toDecimal(t.rate > 1 ? t.rate / 100 : t.rate),
          base: { kind: t.baseKind, description: t.baseDescription, amount: t.baseAmount === null ? undefined : toDecimal(t.baseAmount) },
          minFee: t.minFee === null ? undefined : toDecimal(t.minFee),
        };
      case "recurring": {
        const start = date(t.start, `term ${i + 1} start`, review) ?? "1970-01-01";
        return {
          ...base,
          kind: "recurring",
          amount: toDecimal(t.amount),
          period: t.period,
          start,
          end: date(t.end, `term ${i + 1} end`, review),
          dueDay: t.dueDay ?? undefined,
        };
      }
    }
  });
  if (terms.length === 0) review.add("no terms could be extracted");

  const candidate = {
    id: ulid(),
    profileId: profile.id,
    documentType: out.documentType,
    source: doc.ref,
    parties,
    currency: currency(out.currency, review),
    pricesIncludeVat: out.pricesIncludeVat,
    validity: { from: date(out.validFrom, "valid from", review), to: date(out.validTo, "valid to", review) },
    references: refs(out.references),
    totalCap: out.totalCap === null ? undefined : toDecimal(out.totalCap),
    terms,
    extraction: meta(out.confidence, out.unreadable, review, profile, model, promptVersion),
    status: "active" as const,
  };
  const parsed = AgreementSchema.safeParse(candidate);
  if (!parsed.success) throw new ExtractionError(`extracted agreement failed validation:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
