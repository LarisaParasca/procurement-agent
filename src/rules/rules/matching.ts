import { z } from "zod";
import { dateInRange } from "../../domain/index.js";
import type { IssueDraft, Rule } from "../types.js";

// Rules about whether the invoice fits an agreement at all.

const NoParams = z.object({}).strict();

export const noMatchingAgreement: Rule = {
  code: "NO_MATCHING_AGREEMENT",
  description: "No agreement could be matched to the invoice.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    if (ctx.match.agreementId) return [];
    return [{ params: { candidatesConsidered: ctx.match.candidates.length } }];
  },
};

export const lowMatchConfidence: Rule = {
  code: "LOW_MATCH_CONFIDENCE",
  description: "Agreement or line-item match is below the profile's confidence threshold.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const issues: IssueDraft[] = [];
    if (ctx.match.agreementId && ctx.match.confidence < ctx.matching.llmMatchMin) {
      issues.push({
        params: { level: "agreement", confidence: ctx.match.confidence, threshold: ctx.matching.llmMatchMin },
      });
    }
    for (const m of ctx.lineMatches) {
      if (m.termId && m.confidence < ctx.matching.lineMatchMin) {
        issues.push({
          lineNo: m.lineNo,
          termId: m.termId,
          params: { level: "line", confidence: m.confidence, threshold: ctx.matching.lineMatchMin },
        });
      }
    }
    return issues;
  },
};

export const currencyMismatch: Rule = {
  code: "CURRENCY_MISMATCH",
  description: "Invoice currency differs from the agreement currency (Phase 2: convert at the BNR rate first).",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const { agreement, invoice } = ctx;
    if (!agreement || agreement.currency === invoice.currency) return [];
    return [{ expected: agreement.currency, actual: invoice.currency, params: {} }];
  },
};

export const dateOutsideValidity: Rule<{ graceDays: number }> = {
  code: "DATE_OUTSIDE_VALIDITY",
  description: "Invoice issue date falls outside the agreement validity period (optional grace days after the end).",
  paramsSchema: z.object({ graceDays: z.number().int().min(0).default(0) }).strict(),
  evaluate(ctx, { graceDays }) {
    const { agreement, invoice } = ctx;
    if (!agreement) return [];
    const { from, to } = agreement.validity;
    const toWithGrace = to ? addDays(to, graceDays) : undefined;
    if (dateInRange(invoice.issueDate, from, toWithGrace)) return [];
    return [
      {
        actual: invoice.issueDate,
        expected: `${from ?? "…"} – ${to ?? "…"}`,
        params: { side: from && invoice.issueDate < from ? "before_start" : "after_end" },
      },
    ];
  },
};

export const itemNotCovered: Rule = {
  code: "ITEM_NOT_COVERED",
  description: "Invoice line has no matching term in the agreement.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    if (!ctx.agreement) return [];
    return ctx.lineMatches
      .filter((m) => m.termId === null)
      .map((m) => {
        const line = ctx.invoice.lines.find((l) => l.lineNo === m.lineNo);
        return { lineNo: m.lineNo, actual: line?.description, params: { net: line?.net ?? "" } };
      });
  },
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
