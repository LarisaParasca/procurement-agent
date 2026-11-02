import { parseArgs } from "node:util";
import pc from "picocolors";
import { ingestReference } from "../pipeline/ingest-reference.js";
import { qty, ron } from "../seed/format.js";
import { openRuntime } from "./runtime.js";
import { ms, runCli, ui, usd } from "./ui.js";

// npm run ingest -- <reference.pdf> [--profile developer] [--key DEV-CTR-01] [--fresh]

runCli(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { profile: { type: "string" }, key: { type: "string" }, fresh: { type: "boolean", default: false } },
  });
  if (positionals.length === 0) throw new Error("usage: npm run ingest -- <reference.pdf> [--profile developer]");
  const rt = openRuntime({ profile: values.profile, fresh: values.fresh });
  ui.title("Ingest reference document", `profile: ${rt.profile.id}`);

  for (const file of positionals) {
    const spinner = ui.spinner(`${file}`);
    const { agreement: a, usage } = await ingestReference(rt, file, { key: values.key, onStep: (s) => (spinner.text = `${file} — ${s}`) });
    const cost = usage.reduce((s, u) => s + u.costUsd, 0);
    const cached = usage.every((u) => u.cached);
    spinner.succeed(`${file}  ${pc.dim(`${usd(cost)} · ${ms(usage.reduce((s, u) => s + u.latencyMs, 0))}${cached ? " · cached" : ""}`)}`);

    ui.kv([
      ["type", a.documentType],
      ["reference", a.references.map((r) => r.raw).join(", ") || pc.yellow("none found")],
      ["parties", a.parties.map((p) => `${p.name} (${p.role}, CUI ${p.cui})`).join("; ")],
      ["validity", `${a.validity.from ?? "…"} → ${a.validity.to ?? "…"}`],
      ["total cap", a.totalCap ? `${ron(a.totalCap)} ${a.currency}` : pc.dim("none")],
      ["confidence", `${Math.round(a.extraction.confidence * 100)}%`],
    ]);
    ui.table(
      ["id", "kind", "description", "price / amount", "max qty"],
      a.terms.map((t) => [
        t.id,
        t.kind,
        t.description,
        t.kind === "unit_item" ? `${ron(t.unitPrice)} / ${t.unit}` : t.kind === "percentage" ? `${Number(t.rate) * 100}% of ${t.base.description}` : ron(t.amount),
        t.kind === "unit_item" && t.maxQuantity ? qty(t.maxQuantity) : pc.dim("—"),
      ]),
    );
    if (a.extraction.needsHumanReview) {
      ui.warn("needs human review:");
      for (const r of a.extraction.reviewReasons) ui.info(r);
    } else {
      ui.ok(`stored as agreement ${pc.bold(a.key ?? a.id)}`);
    }
  }
  rt.repos.close();
});
