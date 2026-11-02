import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { checkInvoice, type CheckOutcome } from "../pipeline/check-invoice.js";
import { ron } from "../seed/format.js";
import { saveReport } from "./print.js";
import { openRuntime } from "./runtime.js";
import { ms, runCli, ui, usd, verdictBadge } from "./ui.js";

// npm run check:all -- <folder> [--profile developer] [--recheck] [--fresh]
// Files are processed in name order — partial deliveries must be checked in sequence for cumulative totals.

runCli(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { profile: { type: "string" }, recheck: { type: "boolean", default: false }, fresh: { type: "boolean", default: false } },
  });
  const folder = positionals[0];
  if (!folder || !statSync(folder).isDirectory()) throw new Error("usage: npm run check:all -- <folder-with-invoices>");
  const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".pdf")).sort().map((f) => join(folder, f));
  const rt = openRuntime({ profile: values.profile, fresh: values.fresh });
  ui.title("Batch invoice check", `${files.length} invoices · profile: ${rt.profile.id}`);

  const rows: string[][] = [];
  const counts = { APPROVE: 0, REVIEW: 0, REJECT: 0 };
  let cost = 0;
  for (const file of files) {
    const spinner = ui.spinner(basename(file));
    let o: CheckOutcome;
    try {
      o = await checkInvoice(rt, file, { recheck: values.recheck, onStep: (s) => (spinner.text = `${basename(file)} — ${s}`) });
    } catch (err) {
      spinner.fail(`${basename(file)} — ${(err as Error).message}`);
      continue;
    }
    spinner.stop();
    saveReport(o);
    counts[o.result.verdict]++;
    cost += o.alreadyChecked ? 0 : o.result.usage.totalCostUsd;
    rows.push([
      verdictBadge(o.result.verdict),
      basename(file),
      o.invoice.issuer.name,
      ron(o.invoice.totals.gross),
      o.agreement?.key ?? pc.red("—"),
      o.result.issues.filter((i) => i.severity !== "info").map((i) => i.code).join("\n") || pc.dim("—"),
      o.alreadyChecked ? pc.dim("stored") : `${usd(o.result.usage.totalCostUsd)} ${pc.dim(ms(o.result.usage.totalLatencyMs))}`,
    ]);
  }
  ui.table(["verdict", "file", "issuer", "gross (RON)", "agreement", "issues", "cost"], rows);
  console.log();
  ui.kv([
    ["approve", String(counts.APPROVE)],
    ["review", String(counts.REVIEW)],
    ["reject", String(counts.REJECT)],
    ["total cost", usd(cost)],
  ]);
  ui.dim("Reports saved in reports/checks/. The agent never approves payments.");
  rt.repos.close();
});
