import { rmSync } from "node:fs";
import { join } from "node:path";
import { loadProfile } from "../config/profiles.js";
import { createSqliteRepos } from "../data/sqlite/index.js";
import type { Agreement, LlmCallUsage, Verdict } from "../domain/index.js";
import { AnthropicLlm } from "../llm/anthropic.js";
import type { Llm } from "../llm/types.js";
import { checkInvoice } from "../pipeline/check-invoice.js";
import { ingestReference } from "../pipeline/ingest-reference.js";
import { datasetDir } from "../seed/generate.js";
import { agreementFromTruth, readManifest } from "../seed/truth.js";
import {
  emptyConfusion,
  lineTermCorrect,
  percentile,
  scoreAgreementExtraction,
  scoreInvoiceExtraction,
  scoreIssues,
  type Confusion,
  type FieldTally,
  type IssueCounts,
} from "./scorers.js";
import { TruthLlm } from "./truth-llm.js";

export type EvalMode = "e2e" | "truth-agreements" | "offline";

export interface EvalOptions {
  profileId: string;
  mode: EvalMode;
  fresh?: boolean;
  models?: Partial<Record<"classify" | "extract" | "match" | "report", string>>;
  /** Report written by the LLM (adds cost) or by the deterministic template. */
  llmReport?: boolean;
  onProgress?: (msg: string) => void;
}

export interface InvoiceRow {
  id: string;
  scenario: string;
  expectedVerdict: Verdict;
  verdict: Verdict | "ERROR";
  expectedAgreement: string | null;
  agreement: string | null;
  matchMethod: string;
  missing: string[];
  extra: string[];
  costUsd: number;
  latencyMs: number;
  error?: string;
}

export interface EvalResult {
  profileId: string;
  mode: EvalMode;
  startedAt: string;
  models: Record<string, string>;
  agreementExtraction: FieldTally;
  invoiceExtraction: FieldTally;
  matching: { correct: number; total: number; byMethod: Record<string, { correct: number; total: number }> };
  lineMatching: { correct: number; total: number };
  issues: IssueCounts;
  confusion: Confusion;
  criticalErrors: string[];
  invoices: InvoiceRow[];
  ingest: Array<{ key: string; costUsd: number; latencyMs: number; needsReview: boolean; error?: string }>;
  usage: LlmCallUsage[];
  durationMs: number;
}

/**
 * Runs the whole agent over one profile's synthetic dataset in a fresh temporary DB:
 * agreements first (extracted or loaded from truth), then invoices in truth order
 * (order matters for cumulative rules), then scores everything against ground truth.
 */
export async function runEval(opts: EvalOptions): Promise<EvalResult> {
  const started = performance.now();
  const progress = opts.onProgress ?? (() => {});
  const dir = datasetDir(opts.profileId);
  const manifest = readManifest(dir);
  const profile = loadProfile(opts.profileId);
  const dbPath = join(dir, `.eval-${process.pid}.db`);
  rmSync(dbPath, { force: true });
  const repos = createSqliteRepos(dbPath);

  const usage: LlmCallUsage[] = [];
  const models: Record<string, string> = {};
  const llm: Llm =
    opts.mode === "offline"
      ? new TruthLlm(manifest, dir, repos)
      : new AnthropicLlm({
          fresh: opts.fresh,
          models: opts.models,
          onUsage: (u) => {
            usage.push(u);
            models[u.task] = u.model;
          },
        });

  const result: EvalResult = {
    profileId: opts.profileId,
    mode: opts.mode,
    startedAt: new Date().toISOString(),
    models,
    agreementExtraction: {},
    invoiceExtraction: {},
    matching: { correct: 0, total: 0, byMethod: {} },
    lineMatching: { correct: 0, total: 0 },
    issues: {},
    confusion: emptyConfusion(),
    criticalErrors: [],
    invoices: [],
    ingest: [],
    usage,
    durationMs: 0,
  };

  try {
    // 1. Agreements
    const byKey = new Map<string, Agreement>();
    for (const t of manifest.references) {
      if (opts.mode === "e2e") {
        progress(`ingesting ${t.key}`);
        try {
          const { agreement, usage: u } = await ingestReference({ repos, llm, profile }, join(dir, t.file), { key: t.key });
          byKey.set(t.key, agreement);
          scoreAgreementExtraction(t, agreement, result.agreementExtraction);
          result.ingest.push({
            key: t.key,
            costUsd: u.reduce((s, x) => s + x.costUsd, 0),
            latencyMs: u.reduce((s, x) => s + x.latencyMs, 0),
            needsReview: agreement.extraction.needsHumanReview,
          });
        } catch (err) {
          result.ingest.push({ key: t.key, costUsd: 0, latencyMs: 0, needsReview: true, error: (err as Error).message });
        }
      } else {
        const a = agreementFromTruth(t, profile.id, dir);
        const id = repos.agreements.upsert(a);
        byKey.set(t.key, { ...a, id });
      }
    }

    // 2. Invoices, in order
    for (const t of manifest.invoices) {
      progress(`checking ${t.id} (${t.scenario})`);
      const row: InvoiceRow = {
        id: t.id,
        scenario: t.scenario,
        expectedVerdict: t.expectedVerdict,
        verdict: "ERROR",
        expectedAgreement: t.expectedAgreementKey,
        agreement: null,
        matchMethod: "—",
        missing: [],
        extra: [],
        costUsd: 0,
        latencyMs: 0,
      };
      try {
        const o = await checkInvoice({ repos, llm, profile, llmReport: opts.llmReport ?? false }, join(dir, t.file));
        row.verdict = o.result.verdict;
        row.agreement = o.agreement?.key ?? null;
        row.matchMethod = o.result.match.method;
        row.costUsd = o.result.usage.totalCostUsd;
        row.latencyMs = o.result.usage.totalLatencyMs;

        scoreInvoiceExtraction(t, o.invoice, result.invoiceExtraction);
        const matchOk = row.agreement === t.expectedAgreementKey;
        result.matching.total++;
        if (matchOk) result.matching.correct++;
        const m = (result.matching.byMethod[row.matchMethod] ??= { correct: 0, total: 0 });
        m.total++;
        if (matchOk) m.correct++;

        if (matchOk && o.agreement) {
          const truthAgreement = manifest.references.find((r) => r.key === t.expectedAgreementKey);
          t.expectedLineTerms.forEach((termId, i) => {
            const got = o.result.lineMatches.find((x) => x.lineNo === i + 1)?.termId ?? null;
            result.lineMatching.total++;
            if (lineTermCorrect(termId, got, truthAgreement, o.agreement)) result.lineMatching.correct++;
          });
        }
        const { missing, extra } = scoreIssues(t, o.result, result.issues);
        row.missing = missing;
        row.extra = extra;
        result.confusion[t.expectedVerdict][o.result.verdict]++;
        if (o.result.verdict === "APPROVE" && t.expectedVerdict !== "APPROVE") {
          result.criticalErrors.push(`${t.id}: expected ${t.expectedVerdict}, got APPROVE`);
        }
      } catch (err) {
        row.error = (err as Error).message;
        for (const i of t.expectedIssues) (result.issues[i.code] ??= { tp: 0, fp: 0, fn: 0 }).fn++;
      }
      result.invoices.push(row);
    }
  } finally {
    repos.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  }
  result.durationMs = performance.now() - started;
  return result;
}

export function summarize(r: EvalResult) {
  const acc = (t: FieldTally) => {
    const rows = Object.values(t);
    const total = rows.reduce((s, x) => s + x.total, 0);
    return total ? rows.reduce((s, x) => s + x.correct, 0) / total : null;
  };
  const issueTotals = Object.values(r.issues).reduce((s, x) => ({ tp: s.tp + x.tp, fp: s.fp + x.fp, fn: s.fn + x.fn }), { tp: 0, fp: 0, fn: 0 });
  const verdictCorrect = r.invoices.filter((i) => i.verdict === i.expectedVerdict).length;
  const checkCosts = r.invoices.map((i) => i.costUsd);
  const checkLatencies = r.invoices.map((i) => i.latencyMs);
  const totalCost = r.usage.reduce((s, u) => s + u.costUsd, 0);
  return {
    agreementExtractionAcc: acc(r.agreementExtraction),
    invoiceExtractionAcc: acc(r.invoiceExtraction),
    matchingAcc: r.matching.total ? r.matching.correct / r.matching.total : null,
    lineMatchingAcc: r.lineMatching.total ? r.lineMatching.correct / r.lineMatching.total : null,
    issuePrecision: issueTotals.tp + issueTotals.fp ? issueTotals.tp / (issueTotals.tp + issueTotals.fp) : 1,
    issueRecall: issueTotals.tp + issueTotals.fn ? issueTotals.tp / (issueTotals.tp + issueTotals.fn) : 1,
    issueTotals,
    verdictAcc: r.invoices.length ? verdictCorrect / r.invoices.length : null,
    verdictCorrect,
    invoices: r.invoices.length,
    errors: r.invoices.filter((i) => i.error).length,
    totalCostUsd: totalCost,
    avgCostPerInvoice: checkCosts.length ? checkCosts.reduce((s, x) => s + x, 0) / checkCosts.length : 0,
    avgCostPerReference: r.ingest.length ? r.ingest.reduce((s, x) => s + x.costUsd, 0) / r.ingest.length : 0,
    p50LatencyMs: percentile(checkLatencies, 50),
    p95LatencyMs: percentile(checkLatencies, 95),
    cachedCalls: r.usage.filter((u) => u.cached).length,
    calls: r.usage.length,
  };
}
