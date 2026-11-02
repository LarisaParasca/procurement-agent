import type { z } from "zod";
import type {
  Agreement,
  AgreementMatch,
  Decimal,
  ISODate,
  Invoice,
  Issue,
  LedgerEntry,
  LineMatch,
  Profile,
  RuleCode,
  Severity,
  Tolerances,
  VatConfig,
} from "../domain/index.js";

export interface DuplicateHit {
  invoiceId: string;
  series?: string;
  number: string;
  issueDate: ISODate;
  gross: Decimal;
}

export interface DuplicateCandidates {
  /** Same issuer CUI + series + number. */
  exact: DuplicateHit[];
  /** Same issuer CUI + gross + issue date, different number. */
  suspected: DuplicateHit[];
}

/**
 * Everything a rule may look at, gathered by the pipeline *before* rules run.
 * Rules never touch the DB or the network — that keeps them pure and fast to test.
 */
export interface RuleContext {
  invoice: Invoice;
  agreement: Agreement | null;
  match: AgreementMatch;
  lineMatches: LineMatch[];
  /** Prior ledger entries for the matched agreement, excluding this invoice. */
  ledger: LedgerEntry[];
  duplicates: DuplicateCandidates;
  /** Agreement overrides ▸ profile defaults, already merged. */
  tolerances: Tolerances;
  vat: VatConfig;
  matching: Profile["matching"];
  alerts: Profile["alerts"];
}

/** What a rule returns. Severity comes from the profile; a rule may only lower it (e.g. an 80% alert is info). */
export type IssueDraft = Omit<Issue, "code" | "severity"> & { maxSeverity?: Severity };

export interface Rule<P = Record<string, never>> {
  code: RuleCode;
  description: string;
  paramsSchema: z.ZodType<P>;
  evaluate(ctx: RuleContext, params: P): IssueDraft[];
}
