import { loadPricing } from "../config/pricing.js";
import type { Verdict } from "../domain/index.js";
import { summarize, type EvalResult } from "./runner.js";

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const usd = (v: number) => `$${v.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const MODE_LABEL = {
  e2e: "end-to-end (Claude extracts agreements and invoices)",
  "truth-agreements": "truth agreements (agreements from ground truth; Claude extracts invoices)",
  offline: "offline (ground-truth LLM stand-in — tests the code path only, $0)",
};

/** Markdown eval report: summary tables first, details after. */
export function evalMarkdown(results: EvalResult[]): string {
  const out: string[] = [];
  const date = new Date().toISOString().slice(0, 10);
  out.push(`# Eval report — ${date}`, "");
  out.push(`Prices from \`config/pricing.json\` (updated ${loadPricing().updated}) — **verify against current Anthropic pricing** before quoting costs.`, "");

  out.push("## Summary", "");
  out.push("| profile | mode | invoices | verdict acc. | matching acc. | line match acc. | issue precision | issue recall | invoice extraction | agreement extraction | cost / invoice | cost / reference | p50 / p95 latency | total cost |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const s = summarize(r);
    out.push(
      `| ${r.profileId} | ${r.mode} | ${s.invoices} | ${pct(s.verdictAcc)} (${s.verdictCorrect}/${s.invoices}) | ${pct(s.matchingAcc)} | ${pct(s.lineMatchingAcc)} | ${pct(s.issuePrecision)} | ${pct(s.issueRecall)} | ${pct(s.invoiceExtractionAcc)} | ${pct(s.agreementExtractionAcc)} | ${usd(s.avgCostPerInvoice)} | ${r.mode === "e2e" ? usd(s.avgCostPerReference) : "—"} | ${secs(s.p50LatencyMs)} / ${secs(s.p95LatencyMs)} | ${usd(s.totalCostUsd)} |`,
    );
  }
  out.push("");

  for (const r of results) {
    const s = summarize(r);
    out.push(`## ${r.profileId} — ${MODE_LABEL[r.mode]}`, "");
    if (Object.keys(r.models).length) {
      out.push(`Models: ${Object.entries(r.models).map(([task, m]) => `${task} → \`${m}\``).join(", ")}. ${s.cachedCalls}/${s.calls} calls served from cache (cost shown is the original cost).`, "");
    }
    if (r.criticalErrors.length) {
      out.push("> ⛔ **Critical errors** (should have been flagged, were approved):", ...r.criticalErrors.map((e) => `> - ${e}`), "");
    } else {
      out.push("✅ No critical errors (no invoice that should be flagged was approved).", "");
    }

    out.push("### Verdict confusion matrix (rows = expected, columns = predicted)", "");
    out.push("| expected \\ predicted | APPROVE | REVIEW | REJECT |", "|---|---|---|---|");
    for (const e of ["APPROVE", "REVIEW", "REJECT"] as Verdict[]) {
      const row = r.confusion[e];
      out.push(`| **${e}** | ${row.APPROVE} | ${row.REVIEW} | ${row.REJECT} |`);
    }
    out.push("");

    out.push("### Issue detection per rule", "", "| rule | TP | FP | FN |", "|---|---|---|---|");
    for (const [code, c] of Object.entries(r.issues).sort()) out.push(`| ${code} | ${c.tp} | ${c.fp} | ${c.fn} |`);
    out.push(`| **total** | ${s.issueTotals.tp} | ${s.issueTotals.fp} | ${s.issueTotals.fn} |`, "");

    out.push("### Matching", "");
    out.push(`Agreement matching: ${r.matching.correct}/${r.matching.total}. ` + Object.entries(r.matching.byMethod).map(([m, x]) => `${m}: ${x.correct}/${x.total}`).join(", ") + ".");
    out.push(`Line ↔ term matching: ${r.lineMatching.correct}/${r.lineMatching.total}.`, "");

    for (const [title, tally] of [["Invoice extraction accuracy per field", r.invoiceExtraction], ["Agreement extraction accuracy per field", r.agreementExtraction]] as const) {
      if (Object.keys(tally).length === 0) continue;
      out.push(`### ${title}`, "", "| field | correct | accuracy |", "|---|---|---|");
      for (const [field, t] of Object.entries(tally)) out.push(`| ${field} | ${t.correct}/${t.total} | ${pct(t.correct / t.total)} |`);
      out.push("");
    }

    out.push("### Per invoice", "", "| id | scenario | expected | got | agreement | match | missing issues | extra issues | cost | model time |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const i of r.invoices) {
      const ok = i.verdict === i.expectedVerdict ? "✅" : "❌";
      out.push(
        `| ${i.id} | ${i.scenario} | ${i.expectedVerdict} | ${ok} ${i.verdict}${i.error ? ` (${i.error.slice(0, 60)})` : ""} | ${i.agreement ?? "—"}${i.agreement !== i.expectedAgreement ? ` ❌ (want ${i.expectedAgreement ?? "none"})` : ""} | ${i.matchMethod} | ${i.missing.join(", ") || "—"} | ${i.extra.join(", ") || "—"} | ${usd(i.costUsd)} | ${secs(i.latencyMs)} |`,
      );
    }
    out.push("");

    if (r.usage.length) {
      out.push("### Cost by task and model", "", "| task | model | calls | input tok | output tok | cost |", "|---|---|---|---|---|---|");
      const groups = new Map<string, { calls: number; inTok: number; outTok: number; cost: number }>();
      for (const u of r.usage) {
        const g = groups.get(`${u.task}|${u.model}`) ?? { calls: 0, inTok: 0, outTok: 0, cost: 0 };
        g.calls++;
        g.inTok += u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
        g.outTok += u.outputTokens;
        g.cost += u.costUsd;
        groups.set(`${u.task}|${u.model}`, g);
      }
      for (const [k, g] of groups) {
        const [task, model] = k.split("|");
        out.push(`| ${task} | \`${model}\` | ${g.calls} | ${g.inTok.toLocaleString("en")} | ${g.outTok.toLocaleString("en")} | ${usd(g.cost)} |`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}
