import { z } from "zod";
import { ExtractionMetaSchema, ReferenceSchema, SourceRefSchema, ToleranceSchema } from "./common.js";
import { PartySchema } from "./party.js";
import { CurrencySchema, DecimalSchema, ISODateSchema } from "./primitives.js";

// An Agreement is "what was agreed", whatever document it came from.
// PO, contract, offer, deviz, lease, brokerage contract or an acceptance email all map here.

export const AgreementDocTypeSchema = z.enum([
  "purchase_order",
  "contract",
  "offer",
  "cost_estimate",
  "lease",
  "brokerage",
  "email_acceptance",
  "other",
]);
export type AgreementDocType = z.infer<typeof AgreementDocTypeSchema>;

const TermBase = {
  /** Stable within the agreement: "t1", "t2"… */
  id: z.string().min(1),
  description: z.string().min(1),
  /** Synonyms for line matching (e.g. supplier's catalogue names). */
  aliases: z.array(z.string()).default([]),
  vatRate: DecimalSchema.optional(),
};

export const UnitItemTermSchema = z.object({
  ...TermBase,
  kind: z.literal("unit_item"),
  unit: z.string().min(1),
  unitPrice: DecimalSchema,
  maxQuantity: DecimalSchema.optional(),
});

export const FixedAmountTermSchema = z.object({
  ...TermBase,
  kind: z.literal("fixed_amount"),
  amount: DecimalSchema,
  /** Whether the amount may be invoiced in several parts (cumulative rule tracks the total). */
  allowInstallments: z.boolean().default(false),
});

export const PercentageTermSchema = z.object({
  ...TermBase,
  kind: z.literal("percentage"),
  /** Fraction, e.g. "0.03" for 3%. */
  rate: DecimalSchema,
  base: z.object({
    kind: z.enum(["sale_price", "rent_monthly", "rent_annual", "other"]),
    description: z.string(),
    /** Usually unknown at signing; the invoice states the base ("3% din 120.000 EUR"). */
    amount: DecimalSchema.optional(),
  }),
  minFee: DecimalSchema.optional(),
});

export const RecurringTermSchema = z.object({
  ...TermBase,
  kind: z.literal("recurring"),
  amount: DecimalSchema,
  period: z.enum(["monthly", "quarterly", "yearly"]),
  start: ISODateSchema,
  end: ISODateSchema.optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
});

export const TermSchema = z.discriminatedUnion("kind", [
  UnitItemTermSchema,
  FixedAmountTermSchema,
  PercentageTermSchema,
  RecurringTermSchema,
]);
export type Term = z.infer<typeof TermSchema>;
export type TermKind = Term["kind"];
export type UnitItemTerm = z.infer<typeof UnitItemTermSchema>;
export type FixedAmountTerm = z.infer<typeof FixedAmountTermSchema>;
export type PercentageTerm = z.infer<typeof PercentageTermSchema>;
export type RecurringTerm = z.infer<typeof RecurringTermSchema>;

export const AgreementPartySchema = PartySchema.extend({
  role: z.enum(["supplier", "buyer", "landlord", "tenant", "agency", "client"]),
});
export type AgreementParty = z.infer<typeof AgreementPartySchema>;

export const AgreementSchema = z.object({
  id: z.string(),
  /** Stable external key ("DEV-CTR-01"): seed/eval truth, or an ERP id later. */
  key: z.string().optional(),
  profileId: z.string(),
  documentType: AgreementDocTypeSchema,
  source: SourceRefSchema,
  parties: z.array(AgreementPartySchema).min(1),
  currency: CurrencySchema,
  pricesIncludeVat: z.boolean().default(false),
  validity: z.object({ from: ISODateSchema.optional(), to: ISODateSchema.optional() }),
  references: z.array(ReferenceSchema),
  /** Overall ceiling (e.g. contract value) for the cumulative rule. */
  totalCap: DecimalSchema.optional(),
  /** Per-agreement overrides of the profile tolerances. */
  tolerances: ToleranceSchema.partial().optional(),
  terms: z.array(TermSchema),
  extraction: ExtractionMetaSchema,
  status: z.enum(["active", "expired", "superseded"]).default("active"),
});
export type Agreement = z.infer<typeof AgreementSchema>;
