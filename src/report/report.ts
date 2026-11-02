import { z } from "zod";
import type { LlmCallUsage, Profile } from "../domain/index.js";
import type { Llm } from "../llm/types.js";
import type { ReportFacts } from "./facts.js";
import { checkNumbers } from "./number-guard.js";
import { templateReport } from "./template.js";

export const REPORT_PROMPT_VERSION = "report-v1";

const ReportOut = z.object({
  headline: z.string().describe("One sentence: the recommendation and the main reason"),
  findings: z.array(z.string()).describe("One plain-language sentence per issue, most important first; empty if none"),
  notes: z.array(z.string()).describe("Informational points (e.g. 80% alerts); empty if none"),
  nextStep: z.string().describe("What the finance employee should do now"),
});

const VERDICT_RO = { APPROVE: "✅ APROBARE", REVIEW: "⚠️ VERIFICARE MANUALĂ", REJECT: "⛔ RESPINGERE" } as const;

export interface ReportOutcome {
  markdown: string;
  source: "llm" | "template";
  fallbackReason?: string;
  usage?: LlmCallUsage;
}

/**
 * The LLM turns computed facts into plain Romanian for a non-technical reader.
 * Safety net: if it fails, or mentions a number that is not in the facts, the deterministic template is used.
 */
export async function writeReport(llm: Llm | null, facts: ReportFacts, profile: Profile): Promise<ReportOutcome> {
  if (!llm) return { markdown: templateReport(facts), source: "template", fallbackReason: "LLM disabled" };
  const system = `You write invoice-check reports for a ${profile.report.language === "ro" ? "Romanian" : "English"}-speaking finance team.
Reader: ${profile.report.audience}.
Write in ${profile.report.language === "ro" ? "Romanian, with correct diacritics (ă, â, î, ș, ț)" : "English"}. Plain words, no jargon, no rule codes, no English terms.

Rules:
- Use ONLY the facts provided. Do not calculate anything new; every number you write must appear in the facts, formatted as given (e.g. "13.560,00 lei").
- The verdict is decided by code. Explain it; never change or soften it. The agent never approves payments — a person does.
- One finding per issue with severity "reject" or "review"; "info" issues go in notes.
- Mention line numbers ("rândul 2") and the money impact when the facts give one.
- If there are extraction warnings, say which data must be checked on the original document.`;
  let res;
  try {
    res = await llm.structured({
      task: "report",
      promptVersion: REPORT_PROMPT_VERSION,
      system,
      text: `Facts:\n${JSON.stringify(facts, null, 2)}`,
      schema: ReportOut,
      maxTokens: 4096,
    });
  } catch (err) {
    return { markdown: templateReport(facts), source: "template", fallbackReason: (err as Error).message };
  }
  const r = res.data;
  const md = [
    `## ${VERDICT_RO[facts.verdict]}`,
    "",
    r.headline,
    ...(r.findings.length ? ["", "### Ce am găsit", ...r.findings.map((f) => `- ${f}`)] : []),
    ...(r.notes.length ? ["", "### De reținut", ...r.notes.map((n) => `- ${n}`)] : []),
    "",
    "### Pasul următor",
    r.nextStep,
  ].join("\n");
  const guard = checkNumbers(md, facts);
  if (!guard.ok) {
    return { markdown: templateReport(facts), source: "template", fallbackReason: `number guard: ${guard.unknown.join(", ")} not in facts`, usage: res.usage };
  }
  return { markdown: md, source: "llm", usage: res.usage };
}
