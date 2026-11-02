import { rmSync } from "node:fs";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { env } from "../config/env.js";
import { createSqliteRepos } from "../data/sqlite/index.js";
import { DATASETS, datasetDir, generateDataset } from "../seed/generate.js";
import { loadTruthAgreements } from "../seed/truth.js";
import { runCli, ui } from "./ui.js";

// npm run seed                      → generate PDFs + ground truth for every dataset
// npm run seed -- --load-truth      → also load the ground-truth agreements into the DB (offline demo, no API calls)
// npm run seed -- --reset           → delete the DB first

runCli(async () => {
  const { values } = parseArgs({
    options: {
      profile: { type: "string" },
      "load-truth": { type: "boolean", default: false },
      reset: { type: "boolean", default: false },
    },
  });
  const profiles = values.profile ? [values.profile] : Object.keys(DATASETS);

  ui.title("Seed", "synthetic, clearly fictional Romanian documents");
  if (values.reset) {
    rmSync(env.DB_PATH, { force: true });
    for (const suffix of ["-wal", "-shm"]) rmSync(`${env.DB_PATH}${suffix}`, { force: true });
    ui.ok(`deleted ${env.DB_PATH}`);
  }

  for (const profileId of profiles) {
    const spec = DATASETS[profileId];
    if (!spec) throw new Error(`no dataset for profile "${profileId}" (available: ${Object.keys(DATASETS).join(", ")})`);
    const spinner = ui.spinner(`generating ${profileId} documents…`);
    const files = await generateDataset(spec);
    spinner.succeed(`${profileId}: ${files.filter((f) => f.kind === "reference").length} reference documents, ${files.filter((f) => f.kind === "invoice").length} invoices`);
    ui.table(
      ["kind", "document", "file"],
      files.map((f) => [f.kind, f.label, relative(process.cwd(), f.path)]),
    );

    if (values["load-truth"]) {
      const repos = createSqliteRepos(env.DB_PATH);
      const agreements = loadTruthAgreements(repos, datasetDir(profileId));
      repos.close();
      ui.ok(`loaded ${agreements.length} ground-truth agreements into ${env.DB_PATH}`);
    }
  }
  if (!values["load-truth"]) ui.info("next: npm run ingest -- <reference.pdf>   or   npm run seed -- --load-truth");
});
