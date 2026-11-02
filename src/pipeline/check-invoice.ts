import { ulid } from "ulid";
import type { Agreement, AgreementMatch, CheckResult, Invoice, LineMatch, LlmCallUsage, Profile } from "../domain/index.js";
import type { Repos } from "../data/repos.js";
import { classifyDocument, extractInvoice } from "../extract/extract.js";
import { loadDocument, type SourceDocument } from "../ingest/document.js";
import type { Llm } from "../llm/types.js";
import { decideDeterministic, queryFromInvoice, scoreCandidates } from "../match/agreement-match.js";
import { matchLinesDeterministic } from "../match/line-match.js";
import { chooseAgreementWithLlm, matchLinesWithLlm } from "../match/llm-match.js";
import { buildFacts } from "../report/facts.js";
import { writeReport, type ReportOutcome } from "../report/report.js";
import { runRules } from "../rules/engine.js";
import type { RuleContext } from "../rules/types.js";
import { decideVerdict } from "../rules/verdict.js";
import { checkDuplicateInvoice, findCandidateAgreements, getAgreement, recordCheckResult, type ServiceContext } from "../services/index.js";

/** Bump when matching/rules/report logic changes: part of the idempotency key for recorded results. */
export const PIPELINE_VERSION = "1.0.0";

export interface CheckDeps {
  repos: Repos;
  llm: Llm;
  profile: Profile;
  /** Writes the report with the LLM; false = deterministic template (cheaper, used by some evals). */
  llmReport?: boolean;
}

export interface CheckOptions {
  /** Re-run even if this exact file was already checked with this pipeline version. */
  recheck?: boolean;
  /** Skip the classification call (the caller already knows it's an invoice). */
  skipClassify?: boolean;
  /** Don't persist anything (dry run). */
  dryRun?: boolean;
  /** Progress callback for the CLI spinner. */
  onStep?: (step: string) => void;
}

export interface CheckOutcome {
  invoice: Invoice;
  agreement: Agreement | null;
  result: CheckResult;
  report: ReportOutcome;
  alreadyChecked: boolean;
}

export class NotAnInvoiceError extends Error {}

/**
 * The check, as a fixed sequence. The LLM is used for exactly three things — reading the PDF,
 * fuzzy matching when references are missing, and writing the report. Rules and verdict are code.
 */
export async function checkInvoice(deps: CheckDeps, file: string, opts: CheckOptions = {}): Promise<CheckOutcome> {
  const { repos, llm, profile } = deps;
  const svc: ServiceContext = { repos, profile: () => profile };
  const step = opts.onStep ?? (() => {});
  const usage: LlmCallUsage[] = [];
  const doc: SourceDocument = loadDocument(file);

  // Idempotency: the same file checked by the same pipeline version returns the stored result for free.
  const previous = repos.checkResults.findByInvoiceSha(profile.id, doc.ref.sha256, PIPELINE_VERSION);
  if (previous && !opts.recheck) {
    const invoice = repos.invoices.get(previous.invoiceId)!;
    const agreement = previous.match.agreementId ? (repos.agreements.get(previous.match.agreementId) ?? null) : null;
    return { invoice, agreement, result: previous, report: { markdown: previous.reportMarkdown, source: "llm" }, alreadyChecked: true };
  }

  // 1. Classify + extract
  if (!opts.skipClassify) {
    step("classifying document");
    const { classification, usage: u } = await classifyDocument(llm, doc);
    usage.push(u);
    if (classification.kind !== "invoice") {
      throw new NotAnInvoiceError(
        `this looks like ${classification.kind === "reference" ? `a reference document (${classification.documentType})` : "something other than an invoice"} — ${classification.reason}. Use \`npm run ingest\` for reference documents.`,
      );
    }
  }
  step("reading the invoice");
  const extracted = await extractInvoice(llm, doc, profile);
  usage.push(extracted.usage);
  let invoice = extracted.invoice;
  // A re-check keeps the original invoice id, so its own ledger entries and duplicate record are excluded.
  const known = repos.invoices.findBySourceSha(profile.id, doc.ref.sha256);
  if (known) invoice = { ...invoice, id: known.id };

  // 2. Match the agreement: deterministic first, LLM only if inconclusive
  step("matching the agreement");
  const q = queryFromInvoice(invoice);
  const { agreements: scored } = findCandidateAgreements(svc, {
    profileId: profile.id,
    counterpartyCui: q.counterpartyCui,
    references: invoice.references.map((r) => r.raw),
    invoiceDate: q.date,
  });
  const candidates = scored.filter((c) => c.agreement.status === "active");
  let match: AgreementMatch | null = decideDeterministic(candidates, profile);
  if (!match) {
    const shortlist = candidates.slice(0, profile.matching.maxLlmCandidates);
    const res = await chooseAgreementWithLlm(llm, invoice, shortlist);
    usage.push(res.usage);
    match = res.match;
  }
  const agreement = match.agreementId ? getAgreement(svc, { agreementId: match.agreementId }) : null;

  // 3. Match lines to terms: deterministic first, one batched LLM call for the rest
  let lineMatches: LineMatch[] = [];
  if (agreement) {
    step("matching invoice lines");
    lineMatches = matchLinesDeterministic(invoice, agreement);
    const open = lineMatches.filter((m) => m.method === "none").map((m) => m.lineNo);
    if (open.length > 0) {
      const res = await matchLinesWithLlm(llm, invoice, agreement, open);
      usage.push(res.usage);
      const byLine = new Map(res.matches.map((m) => [m.lineNo, m]));
      lineMatches = lineMatches.map((m) => byLine.get(m.lineNo) ?? m);
    }
  }

  // 4. Rules + verdict — pure code
  step("running rules");
  const ctx: RuleContext = {
    invoice,
    agreement,
    match,
    lineMatches,
    ledger: agreement ? repos.ledger.forAgreement(agreement.id, { excludeInvoiceId: invoice.id }) : [],
    duplicates: checkDuplicateInvoice(svc, {
      profileId: profile.id,
      issuerCui: invoice.issuer.cui,
      number: invoice.number,
      series: invoice.series,
      gross: invoice.totals.gross,
      issueDate: invoice.issueDate,
      excludeInvoiceId: invoice.id,
    }),
    tolerances: { ...profile.tolerances, ...agreement?.tolerances },
    vat: profile.vat,
    matching: profile.matching,
    alerts: profile.alerts,
  };
  const issues = runRules(ctx, profile);
  const { verdict, reasons } = decideVerdict({ issues, invoice, agreement });

  // 5. Report (LLM writes, number guard checks, template as fallback)
  step("writing the report");
  const facts = buildFacts({ invoice, agreement, match, issues, verdict, verdictReasons: reasons });
  const report = await writeReport(deps.llmReport === false ? null : llm, facts, profile);
  if (report.usage) usage.push(report.usage);

  const result: CheckResult = {
    id: ulid(),
    invoiceId: invoice.id,
    profileId: profile.id,
    pipelineVersion: PIPELINE_VERSION,
    match,
    lineMatches,
    issues,
    verdict,
    verdictReasons: reasons,
    reportMarkdown: report.markdown,
    usage: {
      calls: usage,
      totalCostUsd: usage.reduce((s, u) => s + u.costUsd, 0),
      totalLatencyMs: usage.reduce((s, u) => s + u.latencyMs, 0),
    },
    createdAt: new Date().toISOString(),
  };

  // 6. Persist through the single write tool
  if (!opts.dryRun) recordCheckResult(svc, { invoice, checkResult: result, replace: opts.recheck });
  return { invoice, agreement, result, report, alreadyChecked: false };
}
