import { parseArgs } from "node:util";
import pc from "picocolors";
import { env } from "../config/env.js";
import { loadProfile } from "../config/profiles.js";
import { createSqliteRepos } from "../data/sqlite/index.js";
import { ron } from "../seed/format.js";
import { listAgreementUsage } from "../services/index.js";
import { runCli, ui } from "./ui.js";

// npm run ledger [-- --profile developer] [--min 0.8]
// Usage per agreement: how much of each contract / term has been invoiced, with 80% / 100% alerts.

const bar = (pct: number) => {
  const width = 20;
  const filled = Math.min(width, Math.round(pct * width));
  const color = pct > 1 ? pc.red : pct >= 0.8 ? pc.yellow : pc.green;
  return color("█".repeat(filled)) + pc.dim("░".repeat(width - filled)) + ` ${(pct * 100).toFixed(1)}%`;
};

runCli(async () => {
  const { values } = parseArgs({ options: { profile: { type: "string" }, min: { type: "string" } } });
  const profile = loadProfile(values.profile ?? env.DEFAULT_PROFILE);
  const repos = createSqliteRepos(env.DB_PATH);
  const { agreements } = listAgreementUsage({ repos, profile: () => profile }, { profileId: profile.id, minPct: values.min ? Number(values.min) : 0 });
  ui.title("Ledger — invoiced vs agreed", `profile: ${profile.id}`);
  if (agreements.length === 0) {
    ui.info("no agreements yet — run `npm run seed -- --load-truth` or `npm run ingest`");
    return;
  }
  ui.table(
    ["agreement", "counterparty", "invoiced (net)", "highest usage", "alert"],
    agreements.map((a) => [
      `${a.key ?? a.agreementId}\n${pc.dim(`${a.documentType} ${a.reference ?? ""}`)}`,
      a.counterparty,
      `${ron(a.invoicedNet)}${a.totalCap ? pc.dim(` / ${ron(a.totalCap)}`) : ""}`,
      `${bar(a.maxPct)}${a.mostUsedTerm ? `\n${pc.dim(a.mostUsedTerm.description)}` : ""}`,
      a.alert === "none" ? pc.dim("—") : a.maxPct > 1 ? pc.red(`over ${a.alert}`) : pc.yellow(a.alert),
    ]),
  );
  repos.close();
});
