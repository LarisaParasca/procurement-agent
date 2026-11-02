import { z } from "zod";
import { AgreementDocTypeSchema } from "../domain/index.js";

// Loose schemas sent to the API as the structured-output format.
// Structured outputs don't support numeric bounds, string patterns or optional-vs-required nuance,
// so here every field is required (null when absent) and numbers are plain numbers.
// The strict domain schemas (src/domain) validate the normalized result afterwards, in code.

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

const ReferenceOut = z.object({
  kind: z.enum(["contract_no", "po_no", "offer_no", "estimate_no", "annex_no", "other"]),
  raw: z.string().describe("Reference exactly as printed, e.g. 'Contract nr. CA-2026-014'"),
});

const PartyOut = z.object({
  name: z.string(),
  cui: z.string().describe("CUI/CIF exactly as printed, including an 'RO' prefix if present"),
  regCom: nullableString,
  address: nullableString,
  iban: nullableString,
});

export const ClassificationOut = z.object({
  kind: z.enum(["invoice", "reference", "other"]),
  documentType: AgreementDocTypeSchema.nullable().describe("For reference documents only; null for invoices"),
  confidence: z.number().describe("0 to 1"),
  reason: z.string().describe("One short sentence"),
});
export type ClassificationOut = z.infer<typeof ClassificationOut>;

export const InvoiceOut = z.object({
  series: nullableString,
  number: z.string(),
  issueDate: z.string().describe("YYYY-MM-DD"),
  dueDate: nullableString.describe("YYYY-MM-DD"),
  servicePeriodFrom: nullableString,
  servicePeriodTo: nullableString,
  issuer: PartyOut,
  recipient: PartyOut,
  currency: z.string().describe("ISO code, e.g. RON"),
  references: z.array(ReferenceOut).describe("Contract / order / offer / estimate numbers the invoice refers to"),
  lines: z.array(
    z.object({
      description: z.string(),
      unit: nullableString,
      quantity: z.number(),
      unitPrice: z.number().describe("Unit price without VAT, as printed"),
      net: z.number().describe("Line value without VAT, as printed — do not recompute"),
      vatRate: z.number().describe("Percent, e.g. 21"),
      periodFrom: nullableString,
      periodTo: nullableString,
      percentageBase: nullableNumber.describe("For commission lines: the amount the percentage applies to"),
    }),
  ),
  vatLines: z.array(z.object({ rate: z.number(), base: z.number(), amount: z.number() })),
  totals: z.object({ net: z.number(), vat: z.number(), gross: z.number() }),
  confidence: z.object({
    overall: z.number(),
    parties: z.number(),
    numberAndDates: z.number(),
    lines: z.number(),
    totals: z.number(),
  }),
  unreadable: z.array(z.string()).describe("Fields you could not read reliably; empty if none"),
});
export type InvoiceOut = z.infer<typeof InvoiceOut>;

const TermCommon = { description: z.string(), vatRate: nullableNumber };

export const AgreementOut = z.object({
  documentType: AgreementDocTypeSchema,
  parties: z.array(PartyOut.extend({ role: z.enum(["supplier", "buyer", "landlord", "tenant", "agency", "client"]) })),
  currency: z.string(),
  pricesIncludeVat: z.boolean(),
  validFrom: nullableString.describe("YYYY-MM-DD"),
  validTo: nullableString.describe("YYYY-MM-DD"),
  references: z.array(ReferenceOut).describe("The document's own number(s) that invoices would quote"),
  totalCap: nullableNumber.describe("Only an explicit ceiling ('nu poate depăși…'), not an estimated total"),
  terms: z.array(
    z.union([
      z.object({
        kind: z.literal("unit_item"),
        ...TermCommon,
        unit: z.string(),
        unitPrice: z.number(),
        maxQuantity: nullableNumber,
      }),
      z.object({ kind: z.literal("fixed_amount"), ...TermCommon, amount: z.number(), allowInstallments: z.boolean() }),
      z.object({
        kind: z.literal("percentage"),
        ...TermCommon,
        rate: z.number().describe("Fraction: 3% → 0.03"),
        baseKind: z.enum(["sale_price", "rent_monthly", "rent_annual", "other"]),
        baseDescription: z.string(),
        baseAmount: nullableNumber,
        minFee: nullableNumber,
      }),
      z.object({
        kind: z.literal("recurring"),
        ...TermCommon,
        amount: z.number(),
        period: z.enum(["monthly", "quarterly", "yearly"]),
        start: z.string(),
        end: nullableString,
        dueDay: nullableNumber,
      }),
    ]),
  ),
  confidence: z.object({ overall: z.number(), parties: z.number(), terms: z.number(), validity: z.number() }),
  unreadable: z.array(z.string()),
});
export type AgreementOut = z.infer<typeof AgreementOut>;
