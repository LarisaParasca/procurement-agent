import { z } from "zod";
import { DecimalSchema } from "./primitives.js";

export const ReferenceSchema = z.object({
  kind: z.enum(["contract_no", "po_no", "offer_no", "estimate_no", "annex_no", "other"]),
  /** As printed: "Contract nr. 14/12.03.2026". */
  raw: z.string(),
  /** Comparable key produced by match/normalize.normalizeReference. */
  normalized: z.string(),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const ToleranceSchema = z.object({
  unitPricePct: DecimalSchema,
  unitPriceAbs: DecimalSchema,
  quantityPct: DecimalSchema,
  /** Fixed, recurring and percentage amounts. */
  amountAbs: DecimalSchema,
  /** Arithmetic checks (qty × price, VAT, totals). */
  roundingAbs: DecimalSchema,
});
export type Tolerances = z.infer<typeof ToleranceSchema>;

export const ExtractionMetaSchema = z.object({
  /** 0..1, model-reported then lowered by code when validation finds problems. */
  confidence: z.number().min(0).max(1),
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1)),
  needsHumanReview: z.boolean(),
  reviewReasons: z.array(z.string()),
  /** "ground_truth" when loaded by the seed rather than extracted. */
  model: z.string(),
  promptVersion: z.string(),
  extractedAt: z.string(),
});
export type ExtractionMeta = z.infer<typeof ExtractionMetaSchema>;

export const SourceRefSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  format: z.enum(["pdf", "efactura_xml", "eml"]),
  pages: z.number().int().positive().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
