import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { evalMarkdown } from "../eval/report-md.js";
import { runEval, summarize, type EvalMode, type EvalResult } from "../eval/runner.js";
import { DATASETS } from "../seed/generate.js";
import { ms, runCli, ui, usd } from "./ui.js";

// npm run eval                                   → e2e on every dataset (cached responses are reused)
// npm run eval -- --mode truth-agreements        → only the invoice path (agreements from ground truth)
// npm run eval -- --offline                      → $0 code-path check with a ground-truth LLM stand-in
// npm run eval -- --fresh                        → ignore the response cache (real cost)
// npm run eval -- --models extract=claude-sonnet-5-5,match=claude-haiku-5-5
// npm run eval -- --llm-report                   → also have Claude write each report (adds cost)

const pct = (v: number | null) => (v === null ? pc.dim("n/a") : (v >= 0.999 ? pc.green : v >= 0.85 ? pc.yellow : pc.red)(`${(v * 100).toFixed(1)}%`));

runCli(async () => {
  const { values } = parseArgs({
    options: {
      profile: { type: "string" },
      mode: { type: "string", default: "e2e" },
      offline: { type: "boolean", default: false },
      fresh: { type: "boolean", default: false },
      models: { type: "string" },
      "llm-report": { type: "boolean", default: false },
    },
  });
  const mode = (values.offline ? "offline" : values.mode) as EvalMode;
  if (!["e2e", "truth-agreements", "offline"].includes(mode)) throw new Error(`unknown mode ${mode}`);
  const models = Object.fromEntries((values.models ?? "").split(",").filter(Boolean).map((kv) => kv.split("=") as [string, string]));
  const profiles = values.profile ? [values.profile] : Object.keys(DATASETS);

  ui.title("Eval", `mode: ${mode}${values.fresh ? " · fresh (no cache)" : ""}`);
  const results: EvalResult[] = [];
  for (const profileId of profiles) {
    const spinner = ui.spinner(`${profileId}…`);
    const r = await runEval({ profileId, mode, fresh: values.fresh, models, llmReport: values["llm-report"], onProgress: (m) => (spinner.text = `${profileId} — ${m}`) });
    spinner.succeed(`${profileId}: ${r.invoices.length} invoices in ${ms(r.durationMs)}`);
    results.push(r);

    const s = summarize(r);
    ui.table(
      ["metric", "value"],
      [
        ["verdict accuracy", `${pct(s.verdictAcc)} ${pc.dim(`(${s.verdictCorrect}/${s.invoices})`)}`],
        ["critical errors (flag → APPROVE)", r.criticalErrors.length ? pc.red(String(r.criticalErrors.length)) : pc.green("0")],
        ["agreement matching", pct(s.matchingAcc)],
        ["line ↔ term matching", pct(s.lineMatchingAcc)],
        ["issue precision / recall", `${pct(s.issuePrecision)} / ${pct(s.issueRecall)} ${pc.dim(`(TP ${s.issueTotals.tp}, FP ${s.issueTotals.fp}, FN ${s.issueTotals.fn})`)}`],
        ["invoice extraction (per field)", pct(s.invoiceExtractionAcc)],
        ["agreement extraction (per field)", pct(s.agreementExtractionAcc)],
        ["cost per invoice / per reference", `${usd(s.avgCostPerInvoice)} / ${mode === "e2e" ? usd(s.avgCostPerReference) : pc.dim("—")}`],
        ["model time p50 / p95 per invoice", `${ms(s.p50LatencyMs)} / ${ms(s.p95LatencyMs)}`],
        ["total cost", `${usd(s.totalCostUsd)} ${pc.dim(`(${s.cachedCalls}/${s.calls} calls cached)`)}`],
      ],
    );
    const failures = r.invoices.filter((i) => i.verdict !== i.expectedVerdict || i.missing.length || i.extra.length || i.agreement !== i.expectedAgreement);
    if (failures.length) {
      ui.section("Differences from ground truth");
      ui.table(
        ["id", "scenario", "expected → got", "agreement", "missing", "extra"],
        failures.map((i) => [
          i.id,
          i.scenario,
          `${i.expectedVerdict} → ${i.verdict === i.expectedVerdict ? i.verdict : pc.red(i.verdict)}`,
          i.agreement === i.expectedAgreement ? (i.agreement ?? "—") : pc.red(`${i.agreement ?? "none"} (want ${i.expectedAgreement ?? "none"})`),
          i.error ? pc.red(i.error.slice(0, 50)) : i.missing.join("\n") || "—",
          i.extra.join("\n") || "—",
        ]),
      );
    }
  }

  mkdirSync("reports", { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const suffix = mode === "e2e" ? "" : `-${mode}`;
  const path = `reports/eval-${date}${suffix}.md`;
  writeFileSync(path, `${evalMarkdown(results)}\n`);
  writeFileSync(path.replace(/\.md$/, ".json"), JSON.stringify(results, null, 2));
  console.log();
  ui.ok(`report written to ${path}`);
});
