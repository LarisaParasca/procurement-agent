import { z } from "zod";
import { AgreementDocTypeSchema } from "./agreement.js";
import { RuleCodeSchema, SeveritySchema } from "./check.js";
import { ToleranceSchema } from "./common.js";
import { CurrencySchema, DecimalSchema, ISODateSchema } from "./primitives.js";

// A company profile is configuration, not code: adding a company means adding a YAML file.

export const VatRateSchema = z.object({
  /** Percent, e.g. "21". */
  rate: DecimalSchema,
  validFrom: ISODateSchema.optional(),
  validTo: ISODateSchema.optional(),
});
export type VatRate = z.infer<typeof VatRateSchema>;

export const VatConfigSchema = z.object({ rates: z.array(VatRateSchema).min(1) });
export type VatConfig = z.infer<typeof VatConfigSchema>;

export const RuleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  severity: SeveritySchema.default("review"),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type RuleConfig = z.infer<typeof RuleConfigSchema>;

export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string(),
  /** Our own company — decides invoice direction and which party is the counterparty. */
  ownParty: z.object({ name: z.string(), cui: z.string() }),
  acceptedReferenceTypes: z.array(AgreementDocTypeSchema).min(1),
  currency: z.object({ default: CurrencySchema }),
  vat: VatConfigSchema,
  tolerances: ToleranceSchema,
  matching: z.object({
    /** Deterministic score needed to accept a match without the LLM. */
    autoMatchMin: z.number().min(0).max(1),
    /** Below this, an LLM-chosen agreement is reported as low confidence. */
    llmMatchMin: z.number().min(0).max(1),
    /** Below this, a line ↔ term match is reported as low confidence. */
    lineMatchMin: z.number().min(0).max(1),
    maxLlmCandidates: z.number().int().positive(),
  }),
  extraction: z.object({ reviewBelow: z.number().min(0).max(1) }),
  alerts: z.object({ cumulative: z.array(z.number().positive()).min(1) }),
  rules: z.partialRecord(RuleCodeSchema, RuleConfigSchema),
  report: z.object({
    language: z.enum(["ro", "en"]),
    audience: z.string(),
    emailTone: z.string(),
  }),
});
export type Profile = z.infer<typeof ProfileSchema>;
