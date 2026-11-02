import type { AgreementDocType, Party, RuleCode, Severity, Term, Verdict } from "../domain/index.js";

// A dataset is written once as data; the PDFs *and* the ground truth are both generated from it.
// Expected issues and verdicts are written by hand — never computed by the code under test.

export interface CompanySpec extends Party {
  address: string;
  regCom: string;
  iban: string;
  bank: string;
}

export interface ReferenceDocSpec {
  key: string;
  file: string;
  documentType: AgreementDocType;
  /** The reference number as printed, e.g. "CA-2026-014". */
  number: string;
  date: string;
  supplier: CompanySpec;
  /** "supplier" for purchases; agency profiles use other roles in Phase 2. */
  supplierRole?: "supplier" | "landlord" | "agency";
  buyerRole?: "buyer" | "tenant" | "client";
  validity: { from?: string; to?: string };
  totalCap?: string;
  terms: Term[];
  /** Object of the agreement, one sentence. */
  subject: string;
}

export interface InvoiceLineSpec {
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  /** Printed net when it deliberately differs from quantity × price (arithmetic-error scenario). */
  netOverride?: string;
  vatRate?: string;
  /** Ground truth: which agreement term this line is (null = not covered). */
  termId: string | null;
}

export interface ExpectedIssue {
  code: RuleCode;
  severity: Severity;
  lineNo?: number;
}

export interface InvoiceSpec {
  id: string;
  file: string;
  order: number;
  scenario: string;
  supplier: CompanySpec;
  series: string;
  number: string;
  issueDate: string;
  dueDate: string;
  /** References printed on the invoice, as printed. */
  references: string[];
  lines: InvoiceLineSpec[];
  scanned?: boolean;
  /** Extra line in the footer (e.g. "Copie retransmisă"). */
  note?: string;
  expectedAgreementKey: string | null;
  expectedIssues: ExpectedIssue[];
  expectedVerdict: Verdict;
}

export interface DatasetSpec {
  profileId: string;
  buyer: CompanySpec;
  references: ReferenceDocSpec[];
  invoices: InvoiceSpec[];
}
