import { z } from "zod";
import { ExtractionMetaSchema, ReferenceSchema, SourceRefSchema } from "./common.js";
import { PartySchema } from "./party.js";
import { CurrencySchema, DecimalSchema, ISODateSchema, PeriodSchema } from "./primitives.js";

export const InvoiceLineSchema = z.object({
  lineNo: z.number().int().positive(),
  description: z.string().min(1),
  unit: z.string().optional(),
  quantity: DecimalSchema,
  unitPrice: DecimalSchema,
  net: DecimalSchema,
  /** Percent, e.g. "21". */
  vatRate: DecimalSchema,
  /** Rent and other recurring lines. */
  period: PeriodSchema.optional(),
  /** Commission lines: the amount the percentage applies to. */
  percentageBase: DecimalSchema.optional(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const VatLineSchema = z.object({
  rate: DecimalSchema,
  base: DecimalSchema,
  amount: DecimalSchema,
});
export type VatLine = z.infer<typeof VatLineSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  source: SourceRefSchema,
  series: z.string().optional(),
  number: z.string().min(1),
  issueDate: ISODateSchema,
  dueDate: ISODateSchema.optional(),
  servicePeriod: PeriodSchema.optional(),
  // issuer/recipient rather than supplier/buyer: an agency *issues* its commission invoices.
  issuer: PartySchema,
  recipient: PartySchema,
  /** Derived from profile.ownParty: incoming = we pay, outgoing = we issued it. */
  direction: z.enum(["incoming", "outgoing"]),
  currency: CurrencySchema,
  /** Phase 2: BNR rate when an EUR agreement is invoiced in RON. */
  exchangeRate: z
    .object({ rate: DecimalSchema, source: z.string(), date: ISODateSchema })
    .optional(),
  references: z.array(ReferenceSchema),
  lines: z.array(InvoiceLineSchema).min(1),
  vatLines: z.array(VatLineSchema),
  totals: z.object({ net: DecimalSchema, vat: DecimalSchema, gross: DecimalSchema }),
  extraction: ExtractionMetaSchema,
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** The counterparty from our point of view — the party an agreement must be with. */
export const counterpartyOf = (invoice: Invoice) =>
  invoice.direction === "incoming" ? invoice.issuer : invoice.recipient;
