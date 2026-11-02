import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import pc from "picocolors";
import type { CheckOutcome } from "../pipeline/check-invoice.js";
import { ron } from "../seed/format.js";
import { issueRow, ms, ui, usd, verdictBadge } from "./ui.js";

// Terminal rendering of a check result, shared by `check` and `check:all`.

export function printOutcome(file: string, o: CheckOutcome) {
  const { invoice: inv, agreement, result } = o;
  console.log();
  console.log(`${verdictBadge(result.verdict)}  ${pc.bold(`${inv.series ?? ""} ${inv.number}`.trim())}  ${pc.dim(basename(file))}`);
  console.log();
  ui.kv([
    ["issuer", `${inv.issuer.name} ${pc.dim(`CUI ${inv.issuer.cui}`)}`],
    ["date", inv.issueDate],
    ["total", `${ron(inv.totals.gross)} ${inv.currency} ${pc.dim(`(${ron(inv.totals.net)} + TVA ${ron(inv.totals.vat)})`)}`],
    [
      "agreement",
      agreement
        ? `${agreement.key ?? agreement.id} · ${agreement.documentType} ${agreement.references[0]?.raw ?? ""} ${pc.dim(`(${result.match.method}, ${Math.round(result.match.confidence * 100)}%)`)}`
        : pc.red("none found"),
    ],
  ]);

  if (agreement) {
    ui.section("Lines");
    ui.table(
      ["#", "description", "qty", "unit price", "matched term", "how"],
      inv.lines.map((l) => {
        const m = result.lineMatches.find((x) => x.lineNo === l.lineNo);
        const term = m?.termId ? agreement.terms.find((t) => t.id === m.termId) : undefined;
        return [
          String(l.lineNo),
          l.description,
          `${l.quantity} ${l.unit ?? ""}`.trim(),
          ron(l.unitPrice),
          term ? term.description : pc.red("— not covered"),
          m ? `${m.method} ${pc.dim(`${Math.round(m.confidence * 100)}%`)}` : "",
        ];
      }),
    );
  }

  ui.section(result.issues.length ? "Issues" : "Issues: none");
  if (result.issues.length) {
    ui.table(["severity", "rule", "line", "expected", "actual"], result.issues.map(issueRow));
  }

  ui.section("Report (RO)");
  for (const line of result.reportMarkdown.split("\n")) {
    console.log(
      `  ${line.replace(/^## (.*)/, (_, t) => pc.bold(t)).replace(/^### (.*)/, (_, t) => pc.underline(t)).replace(/\*\*(.+?)\*\*/g, (_, t) => pc.bold(t))}`,
    );
  }
  if (o.report.fallbackReason && !o.alreadyChecked) ui.dim(`  (template report — ${o.report.fallbackReason})`);

  console.log();
  const u = result.usage;
  const cached = u.calls.length > 0 && u.calls.every((c) => c.cached);
  ui.dim(
    o.alreadyChecked
      ? `already checked on ${result.createdAt.slice(0, 16).replace("T", " ")} — showing the stored result (use --recheck to run again)`
      : `${u.calls.length} LLM calls · ${usd(u.totalCostUsd)} · ${ms(u.totalLatencyMs)} model time${cached ? " · all cached" : ""} · ${u.calls.map((c) => `${c.task}:${c.model.replace("claude-", "")}`).join(" ")}`,
  );
  ui.dim("The agent never approves payments: APPROVE means “recommended for approval”.");
}

export function saveReport(o: CheckOutcome): string {
  const dir = join("reports", "checks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${o.invoice.issueDate}_${o.invoice.issuer.cui}_${`${o.invoice.series ?? ""}${o.invoice.number}`.replace(/[^\w-]/g, "")}.md`);
  writeFileSync(path, `${o.result.reportMarkdown}\n`);
  return path;
}
