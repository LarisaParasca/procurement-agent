import { z } from "zod";
import { CurrencySchema, DecimalSchema, PeriodSchema } from "./primitives.js";

export const RuleCodeSchema = z.enum([
  "DUPLICATE_INVOICE",
  "NO_MATCHING_AGREEMENT",
  "LOW_MATCH_CONFIDENCE",
  "CURRENCY_MISMATCH",
  "DATE_OUTSIDE_VALIDITY",
  "ITEM_NOT_COVERED",
  "UNIT_PRICE_ABOVE_AGREED",
  "QUANTITY_ABOVE_AGREED",
  "CUMULATIVE_THRESHOLD",
  "PERCENTAGE_MISMATCH",
  "RECURRING_AMOUNT_MISMATCH",
  "RECURRING_PERIOD_INVALID",
  "RECURRING_PERIOD_DUPLICATE",
  "ARITHMETIC_LINE",
  "ARITHMETIC_TOTALS",
  "VAT_RATE_INVALID",
  "RULE_ERROR",
]);
export type RuleCode = z.infer<typeof RuleCodeSchema>;

export const SeveritySchema = z.enum(["info", "review", "reject"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const IssueSchema = z.object({
  code: RuleCodeSchema,
  severity: SeveritySchema,
  lineNo: z.number().int().optional(),
  termId: z.string().optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  delta: z.string().optional(),
  /** Machine values the report turns into Romanian sentences. */
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type Issue = z.infer<typeof IssueSchema>;

export const AgreementMatchSchema = z.object({
  agreementId: z.string().nullable(),
  method: z.enum(["deterministic", "llm", "none"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  candidates: z.array(
    z.object({ agreementId: z.string(), score: z.number(), reasons: z.array(z.string()) }),
  ),
});
export type AgreementMatch = z.infer<typeof AgreementMatchSchema>;

export const LineMatchSchema = z.object({
  lineNo: z.number().int(),
  termId: z.string().nullable(),
  method: z.enum(["exact", "alias", "token", "llm", "none"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
});
export type LineMatch = z.infer<typeof LineMatchSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string(),
  agreementId: z.string(),
  termId: z.string().nullable(),
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  issuerCui: z.string(),
  quantity: DecimalSchema.optional(),
  net: DecimalSchema,
  currency: CurrencySchema,
  period: PeriodSchema.optional(),
  /** The agent never approves; humans move entries out of pending_review. Cumulative counts pending + approved. */
  status: z.enum(["pending_review", "approved", "rejected"]),
  recordedAt: z.string(),
  checkResultId: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LlmCallUsageSchema = z.object({
  task: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  costUsd: z.number(),
  latencyMs: z.number(),
  cached: z.boolean(),
});
export type LlmCallUsage = z.infer<typeof LlmCallUsageSchema>;

export const UsageSummarySchema = z.object({
  calls: z.array(LlmCallUsageSchema),
  totalCostUsd: z.number(),
  totalLatencyMs: z.number(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const VerdictSchema = z.enum(["APPROVE", "REVIEW", "REJECT"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const CheckResultSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  profileId: z.string(),
  pipelineVersion: z.string(),
  match: AgreementMatchSchema,
  lineMatches: z.array(LineMatchSchema),
  issues: z.array(IssueSchema),
  verdict: VerdictSchema,
  verdictReasons: z.array(z.string()),
  reportMarkdown: z.string(),
  emailDraft: z.object({ to: z.string(), subject: z.string(), body: z.string() }).optional(),
  usage: UsageSummarySchema,
  createdAt: z.string(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;
