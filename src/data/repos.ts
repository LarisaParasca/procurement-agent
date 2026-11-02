import type { Agreement, CheckResult, Invoice, LedgerEntry, LlmCallUsage } from "../domain/index.js";
import type { DuplicateCandidates } from "../rules/types.js";

// Storage-agnostic interfaces. Services depend on these only; SQLite is one implementation.

export interface AgreementRepo {
  /** Inserts, or replaces the agreement extracted from the same file. Returns the stored id. */
  upsert(agreement: Agreement): string;
  get(id: string): Agreement | undefined;
  getByKey(key: string): Agreement | undefined;
  list(profileId: string, opts?: { status?: Agreement["status"] }): Agreement[];
  findByPartyCui(profileId: string, cui: string): Agreement[];
  findByReference(profileId: string, normalizedRefs: string[]): Agreement[];
}

export interface InvoiceRepo {
  insert(invoice: Invoice): void;
  get(id: string): Invoice | undefined;
  findBySourceSha(profileId: string, sha256: string): Invoice | undefined;
  /** Exact: same issuer + series + number. Suspected: same issuer + gross + date, different number. */
  findDuplicates(
    profileId: string,
    q: { issuerCui: string; number: string; series?: string; gross?: string; issueDate?: string; excludeInvoiceId?: string },
  ): DuplicateCandidates;
}

export interface LedgerRepo {
  insertMany(entries: LedgerEntry[]): void;
  /** Used when an invoice is re-checked: its previous entries are replaced. */
  deleteForInvoice(invoiceId: string): void;
  forAgreement(agreementId: string, opts?: { termId?: string; excludeInvoiceId?: string }): LedgerEntry[];
}

export interface CheckResultRepo {
  insert(result: CheckResult): void;
  get(id: string): CheckResult | undefined;
  latestForInvoice(invoiceId: string): CheckResult | undefined;
  findByInvoiceSha(profileId: string, sha256: string, pipelineVersion: string): CheckResult | undefined;
}

export interface UsageRepo {
  insert(call: LlmCallUsage & { documentSha256?: string }): void;
}

export interface Repos {
  agreements: AgreementRepo;
  invoices: InvoiceRepo;
  ledger: LedgerRepo;
  checkResults: CheckResultRepo;
  usage: UsageRepo;
  /** Runs fn atomically (used by record_check_result). */
  transaction<T>(fn: () => T): T;
  close(): void;
}
