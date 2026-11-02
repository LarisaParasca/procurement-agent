import { z } from "zod";
import { dec, fmt2, withinAbs } from "../../domain/index.js";
import { matchedLines } from "../helpers.js";
import type { IssueDraft, Rule } from "../types.js";

export const percentageMismatch: Rule = {
  code: "PERCENTAGE_MISMATCH",
  description: "Commission-type line: amount must equal rate × base (or the minimum fee), within tolerance.",
  paramsSchema: z.object({}).strict(),
  evaluate(ctx) {
    return matchedLines(ctx, "percentage").flatMap(({ line, term }): IssueDraft[] => {
      const base = line.percentageBase ?? term.base.amount;
      if (!base) {
        return [
          {
            lineNo: line.lineNo,
            termId: term.id,
            actual: line.net,
            params: { reason: "base_unknown", rate: `${dec(term.rate).times(100)}%`, baseDescription: term.base.description },
          },
        ];
      }
      let expected = dec(base).times(term.rate).round(2);
      if (term.minFee && expected.lt(term.minFee)) expected = dec(term.minFee);
      if (withinAbs(expected, line.net, ctx.tolerances.amountAbs)) return [];
      const impliedRate = dec(line.net).div(base).times(100);
      return [
        {
          lineNo: line.lineNo,
          termId: term.id,
          expected: fmt2(expected),
          actual: fmt2(line.net),
          delta: fmt2(dec(line.net).minus(expected)),
          params: {
            reason: "amount_mismatch",
            rate: `${dec(term.rate).times(100)}%`,
            impliedRate: `${impliedRate.toFixed(2)}%`,
            base: fmt2(base),
          },
        },
      ];
    });
  },
};
