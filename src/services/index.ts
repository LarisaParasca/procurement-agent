import Big from "big.js";
import { ulid } from "ulid";
import {
  dec,
  type Agreement,
  type CheckResult,
  type Invoice,
  type LedgerEntry,
  type Profile,
} from "../domain/index.js";
import type { Repos } from "../data/repos.js";
import { scoreCandidates } from "../match/agreement-match.js";
import { normalizeReference } from "../match/normalize.js";
import type { DuplicateCandidates } from "../rules/types.js";

// The tool layer. The CLI pipeline and the MCP server both call these functions — one
// implementation, two front doors. All are read-only except recordCheckResult.

export interface ServiceContext {
  repos: Repos;
  profile: (id: string) => Profile;
}

// ---------- find_candidate_agreements ----------

export interface FindCandidatesInput {
  profileId: string;
  counterpartyCui?: string;
  counterpartyName?: string;
  /** Raw or normalized reference numbers; normalized here. */
  references?: string[];
  invoiceDate?: string;
}

export function findCandidateAgreements({ repos }: ServiceContext, input: FindCandidatesInput) {
  const refs = (input.references ?? []).map(normalizeReference).filter(Boolean);
  const pool = new Map<string, Agreement>();
  if (input.counterpartyCui) for (const a of repos.agreements.findByPartyCui(input.profileId, input.counterpartyCui)) pool.set(a.id, a);
  for (const a of repos.agreements.findByReference(input.profileId, refs)) pool.set(a.id, a);
  if (input.counterpartyName && pool.size === 0) {
    const needle = input.counterpartyName.toLowerCase();
    for (const a of repos.agreements.list(input.profileId)) {
      if (a.parties.some((p) => p.name.toLowerCase().includes(needle))) pool.set(a.id, a);
    }
  }
  const scored = scoreCandidates({ counterpartyCui: input.counterpartyCui, references: refs, date: input.invoiceDate }, [...pool.values()]);
  return {
    candidates: scored.map(({ agreement: a, score, reasons }) => ({
      agreementId: a.id,
      key: a.key ?? null,
      documentType: a.documentType,
      counterparty: a.parties.find((p) => p.role !== "buyer" && p.role !== "tenant" && p.role !== "client")?.name ?? a.parties[0]!.name,
      references: a.references.map((r) => r.raw),
      validity: a.validity,
      score,
      reasons,
    })),
    // The full agreements, for in-process callers (the MCP adapter drops this).
    agreements: scored,
  };
}

// ---------- get_agreement ----------

export function getAgreement({ repos }: ServiceContext, input: { agreementId: string }): Agreement {
  const a = repos.agreements.get(input.agreementId) ?? repos.agreements.getByKey(input.agreementId);
  if (!a) throw new Error(`agreement ${input.agreementId} not found`);
  return a;
}

// ---------- get_invoiced_to_date ----------

export type AlertLevel = "none" | "80" | "100";

export interface InvoicedToDate {
  agreementId: string;
  key: string | null;
  currency: string;
  totalCap: string | null;
  invoicedNet: string;
  pctOfCap: number | null;
  alert: string;
  terms: Array<{
    termId: string;
    description: string;
    invoicedQty: string | null;
    maxQty: string | null;
    invoicedAmount: string;
    cap: string | null;
    pct: number | null;
    alert: string;
  }>;
  invoices: Array<{ invoiceNumber: string; net: string; status: LedgerEntry["status"] }>;
}

/** What has been invoiced so far against an agreement, per term, with alert levels from the profile. */
export function getInvoicedToDate(ctx: ServiceContext, input: { agreementId: string; termId?: string }): InvoicedToDate {
  const agreement = getAgreement(ctx, input);
  const levels = [...ctx.profile(agreement.profileId).alerts.cumulative].sort((a, b) => a - b);
  const alertFor = (pct: number | null) => {
    if (pct === null) return "none";
    const crossed = levels.filter((l) => pct >= l).at(-1);
    return crossed === undefined ? "none" : `${Math.round(crossed * 100)}%`;
  };
  const entries = ctx.repos.ledger.forAgreement(agreement.id).filter((e) => e.status !== "rejected");
  const ratio = (used: Big, cap: string | undefined) => (cap && dec(cap).gt(0) ? Number(used.div(cap).toFixed(4)) : null);

  const terms = agreement.terms
    .filter((t) => !input.termId || t.id === input.termId)
    .map((t) => {
      const mine = entries.filter((e) => e.termId === t.id);
      const qty = mine.reduce((s, e) => s.plus(e.quantity ?? "0"), dec(0));
      const amount = mine.reduce((s, e) => s.plus(e.net), dec(0));
      const maxQty = t.kind === "unit_item" ? t.maxQuantity : undefined;
      const amountCap = t.kind === "fixed_amount" ? t.amount : undefined;
      const pct = maxQty ? ratio(qty, maxQty) : ratio(amount, amountCap);
      return {
        termId: t.id,
        description: t.description,
        invoicedQty: t.kind === "unit_item" ? qty.toString() : null,
        maxQty: maxQty ?? null,
        invoicedAmount: amount.toFixed(2),
        cap: amountCap ?? null,
        pct,
        alert: alertFor(pct),
      };
    });

  const invoicedNet = entries.reduce((s, e) => s.plus(e.net), dec(0));
  const pctOfCap = ratio(invoicedNet, agreement.totalCap);
  const byInvoice = new Map<string, { invoiceNumber: string; net: Big; status: LedgerEntry["status"] }>();
  for (const e of entries) {
    const row = byInvoice.get(e.invoiceId) ?? { invoiceNumber: e.invoiceNumber, net: dec(0), status: e.status };
    row.net = row.net.plus(e.net);
    byInvoice.set(e.invoiceId, row);
  }
  return {
    agreementId: agreement.id,
    key: agreement.key ?? null,
    currency: agreement.currency,
    totalCap: agreement.totalCap ?? null,
    invoicedNet: invoicedNet.toFixed(2),
    pctOfCap,
    alert: alertFor(Math.max(pctOfCap ?? 0, ...terms.map((t) => t.pct ?? 0))),
    terms,
    invoices: [...byInvoice.values()].map((r) => ({ invoiceNumber: r.invoiceNumber, net: r.net.toFixed(2), status: r.status })),
  };
}

// ---------- list_agreement_usage ----------

/** Every agreement with its highest usage ratio — answers "which contracts are over 80% invoiced?". */
export function listAgreementUsage(ctx: ServiceContext, input: { profileId: string; minPct?: number }) {
  const rows = ctx.repos.agreements.list(input.profileId).map((a) => {
    const usage = getInvoicedToDate(ctx, { agreementId: a.id });
    const maxPct = Math.max(usage.pctOfCap ?? 0, ...usage.terms.map((t) => t.pct ?? 0));
    const top = usage.terms.reduce<(typeof usage.terms)[number] | undefined>((best, t) => ((t.pct ?? 0) > (best?.pct ?? 0) ? t : best), undefined);
    return {
      agreementId: a.id,
      key: a.key ?? null,
      documentType: a.documentType,
      counterparty: a.parties.find((p) => p.role === "supplier" || p.role === "landlord" || p.role === "agency" || p.role === "client")?.name ?? a.parties[0]!.name,
      reference: a.references[0]?.raw ?? null,
      invoicedNet: usage.invoicedNet,
      totalCap: usage.totalCap,
      pctOfCap: usage.pctOfCap,
      maxPct,
      mostUsedTerm: top && (top.pct ?? 0) > 0 ? { description: top.description, pct: top.pct } : null,
      alert: usage.alert,
    };
  });
  return { agreements: rows.filter((r) => r.maxPct >= (input.minPct ?? 0)).sort((a, b) => b.maxPct - a.maxPct) };
}

// ---------- check_duplicate_invoice ----------

export function checkDuplicateInvoice(
  { repos }: ServiceContext,
  input: { profileId: string; issuerCui: string; number: string; series?: string; gross?: string; issueDate?: string; excludeInvoiceId?: string },
): DuplicateCandidates & { isDuplicate: boolean } {
  const found = repos.invoices.findDuplicates(input.profileId, input);
  return { ...found, isDuplicate: found.exact.length > 0 };
}

// ---------- record_check_result (the only write) ----------

export interface RecordInput {
  invoice: Invoice;
  checkResult: CheckResult;
  /** Re-check: replace this invoice's previous ledger entries instead of returning the stored result. */
  replace?: boolean;
}

/**
 * Persists invoice + result + issues and appends ledger entries (status pending_review — the agent never
 * approves). Idempotent on (invoice file hash, pipeline version): recording the same check twice is a no-op.
 * Exact duplicates get no ledger entries, so they can't inflate cumulative totals.
 */
export function recordCheckResult({ repos }: ServiceContext, input: RecordInput) {
  const { invoice, checkResult } = input;
  return repos.transaction(() => {
    const previous = repos.checkResults.findByInvoiceSha(invoice.profileId, invoice.source.sha256, checkResult.pipelineVersion);
    if (previous && !input.replace) {
      return { checkResultId: previous.id, ledgerEntriesCreated: 0, idempotent: true };
    }
    const existingInvoice = repos.invoices.get(invoice.id);
    if (!existingInvoice) repos.invoices.insert(invoice);
    else repos.ledger.deleteForInvoice(invoice.id);
    repos.checkResults.insert(checkResult);

    const isDuplicate = checkResult.issues.some((i) => i.code === "DUPLICATE_INVOICE" && i.params.kind === "exact");
    const agreementId = checkResult.match.agreementId;
    const entries: LedgerEntry[] =
      agreementId && !isDuplicate
        ? invoice.lines.map((line) => ({
            id: ulid(),
            agreementId,
            termId: checkResult.lineMatches.find((m) => m.lineNo === line.lineNo)?.termId ?? null,
            invoiceId: invoice.id,
            invoiceNumber: `${invoice.series ?? ""}${invoice.number}`,
            issuerCui: invoice.issuer.cui,
            quantity: line.quantity,
            net: line.net,
            currency: invoice.currency,
            period: line.period ?? invoice.servicePeriod,
            status: "pending_review",
            recordedAt: checkResult.createdAt,
            checkResultId: checkResult.id,
          }))
        : [];
    repos.ledger.insertMany(entries);
    return { checkResultId: checkResult.id, ledgerEntriesCreated: entries.length, idempotent: false };
  });
}
