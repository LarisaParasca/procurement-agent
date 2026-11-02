import { z } from "zod";
import type { Agreement, AgreementMatch, Invoice, LineMatch, LlmCallUsage, Term } from "../domain/index.js";
import { AGREEMENT_MATCH_PROMPT, LINE_MATCH_PROMPT } from "../llm/prompts/match.js";
import type { Llm } from "../llm/types.js";
import type { ScoredCandidate } from "./agreement-match.js";

// LLM-assisted matching, used only where deterministic matching couldn't decide.
// The answer is constrained to the candidate ids (enum), so the model can't invent an agreement or term.

const describeTerm = (t: Term) => {
  switch (t.kind) {
    case "unit_item":
      return { id: t.id, kind: t.kind, description: t.description, unit: t.unit };
    case "fixed_amount":
      return { id: t.id, kind: t.kind, description: t.description, installments: t.allowInstallments };
    case "percentage":
      return { id: t.id, kind: t.kind, description: t.description, base: t.base.description };
    case "recurring":
      return { id: t.id, kind: t.kind, description: t.description, period: t.period };
  }
};

const describeLine = (l: Invoice["lines"][number]) => ({ lineNo: l.lineNo, description: l.description, unit: l.unit ?? null });

export async function chooseAgreementWithLlm(
  llm: Llm,
  invoice: Invoice,
  candidates: ScoredCandidate[],
): Promise<{ match: AgreementMatch; usage: LlmCallUsage }> {
  const ids = candidates.map((c) => c.agreement.id) as [string, ...string[]];
  const schema = z.object({
    agreementId: z.enum(ids).nullable(),
    confidence: z.number(),
    rationale: z.string(),
  });
  const input = {
    invoice: {
      issuer: invoice.issuer.name,
      issueDate: invoice.issueDate,
      references: invoice.references.map((r) => r.raw),
      lines: invoice.lines.map(describeLine),
    },
    candidates: candidates.map(({ agreement: a }) => ({
      id: a.id,
      documentType: a.documentType,
      number: a.references.map((r) => r.raw).join(", "),
      validity: a.validity,
      terms: a.terms.map(describeTerm),
    })),
  };
  const { data, usage } = await llm.structured({
    task: "match",
    promptVersion: AGREEMENT_MATCH_PROMPT.version,
    system: AGREEMENT_MATCH_PROMPT.system,
    text: `Which agreement does this invoice belong to?\n\n${JSON.stringify(input, null, 2)}`,
    schema,
    maxTokens: 2048,
  });
  const confidence = Math.min(1, Math.max(0, data.confidence));
  return {
    usage,
    match: {
      agreementId: data.agreementId,
      method: data.agreementId ? "llm" : "none",
      confidence: data.agreementId ? confidence : 0,
      evidence: [`LLM: ${data.rationale}`],
      candidates: candidates.map((c) => ({ agreementId: c.agreement.id, score: c.score, reasons: c.reasons })),
    },
  };
}

/** One batched call for all lines the deterministic matcher left open. */
export async function matchLinesWithLlm(
  llm: Llm,
  invoice: Invoice,
  agreement: Agreement,
  openLineNos: number[],
): Promise<{ matches: LineMatch[]; usage: LlmCallUsage }> {
  const termIds = agreement.terms.map((t) => t.id) as [string, ...string[]];
  const schema = z.object({
    lines: z.array(
      z.object({ lineNo: z.number().int(), termId: z.enum(termIds).nullable(), confidence: z.number(), rationale: z.string() }),
    ),
  });
  const lines = invoice.lines.filter((l) => openLineNos.includes(l.lineNo)).map(describeLine);
  const { data, usage } = await llm.structured({
    task: "match",
    promptVersion: LINE_MATCH_PROMPT.version,
    system: LINE_MATCH_PROMPT.system,
    text: `Agreement terms:\n${JSON.stringify(agreement.terms.map(describeTerm), null, 2)}\n\nInvoice lines to match:\n${JSON.stringify(lines, null, 2)}`,
    schema,
    maxTokens: 4096,
  });
  const byLine = new Map(data.lines.map((l) => [l.lineNo, l]));
  return {
    usage,
    matches: openLineNos.map((lineNo): LineMatch => {
      const m = byLine.get(lineNo);
      if (!m || m.termId === null) {
        return { lineNo, termId: null, method: "none", confidence: m ? Math.min(1, Math.max(0, m.confidence)) : 0, rationale: m?.rationale };
      }
      return { lineNo, termId: m.termId, method: "llm", confidence: Math.min(1, Math.max(0, m.confidence)), rationale: m.rationale };
    }),
  };
}
