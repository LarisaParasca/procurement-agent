import Table from "cli-table3";
import ora from "ora";
import pc from "picocolors";
import type { Issue, Severity, Verdict } from "../domain/index.js";

// Everything the terminal shows goes through here, so the live demo looks consistent.

export const ui = {
  title(text: string, subtitle?: string) {
    console.log();
    console.log(pc.bold(pc.cyan(`▌ ${text}`)) + (subtitle ? pc.dim(`  ${subtitle}`) : ""));
    console.log();
  },
  section(text: string) {
    console.log();
    console.log(pc.bold(text));
  },
  ok: (text: string) => console.log(`${pc.green("✔")} ${text}`),
  warn: (text: string) => console.log(`${pc.yellow("▲")} ${text}`),
  fail: (text: string) => console.log(`${pc.red("✖")} ${text}`),
  info: (text: string) => console.log(`${pc.dim("·")} ${text}`),
  dim: (text: string) => console.log(pc.dim(text)),
  kv(pairs: Array<[string, string]>) {
    const width = Math.max(...pairs.map(([k]) => k.length));
    for (const [k, v] of pairs) console.log(`  ${pc.dim(k.padEnd(width))}  ${v}`);
  },
  table(head: string[], rows: string[][], colAligns?: Array<"left" | "right" | "center">) {
    const t = new Table({
      head: head.map((h) => pc.bold(h)),
      style: { head: [], border: ["grey"] },
      ...(colAligns ? { colAligns } : {}),
      wordWrap: true,
    });
    t.push(...rows);
    console.log(t.toString());
  },
  spinner: (text: string) => ora({ text, color: "cyan" }).start(),
};

export function verdictBadge(v: Verdict): string {
  const label = ` ${v} `;
  if (v === "APPROVE") return pc.bgGreen(pc.black(pc.bold(label)));
  if (v === "REVIEW") return pc.bgYellow(pc.black(pc.bold(label)));
  return pc.bgRed(pc.white(pc.bold(label)));
}

export function severityTag(s: Severity): string {
  if (s === "reject") return pc.red("reject");
  if (s === "review") return pc.yellow("review");
  return pc.blue("info");
}

export function issueRow(i: Issue): string[] {
  return [
    severityTag(i.severity),
    i.code,
    i.lineNo === undefined ? pc.dim("—") : String(i.lineNo),
    i.expected ?? pc.dim("—"),
    i.actual ?? pc.dim("—"),
  ];
}

export const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 3)}`;
export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

/** Runs a CLI main and prints errors cleanly instead of a stack trace (set DEBUG=1 for the stack). */
export function runCli(main: () => Promise<void>) {
  main().catch((err: unknown) => {
    console.error();
    ui.fail(pc.red((err as Error).message));
    if (process.env.DEBUG) console.error(err);
    process.exitCode = 1;
  });
}
