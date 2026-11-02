import { parseArgs } from "node:util";
import { checkInvoice } from "../pipeline/check-invoice.js";
import { printOutcome, saveReport } from "./print.js";
import { openRuntime } from "./runtime.js";
import { runCli, ui } from "./ui.js";

// npm run check -- <invoice.pdf> [--profile developer|agency] [--recheck] [--fresh] [--dry-run]

runCli(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      recheck: { type: "boolean", default: false },
      fresh: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const file = positionals[0];
  if (!file) throw new Error("usage: npm run check -- <invoice.pdf> [--profile developer|agency] [--recheck]");
  const rt = openRuntime({ profile: values.profile, fresh: values.fresh });
  ui.title("Invoice check", `profile: ${rt.profile.id}`);
  const spinner = ui.spinner(file);
  const outcome = await checkInvoice(rt, file, {
    recheck: values.recheck,
    dryRun: values["dry-run"],
    onStep: (s) => (spinner.text = `${file} — ${s}`),
  });
  spinner.stop();
  printOutcome(file, outcome);
  if (!values["dry-run"]) ui.dim(`report saved to ${saveReport(outcome)}`);
  rt.repos.close();
});
