import { z } from "zod";
import { dec, fmt2, withinAbs, type Period, type RecurringTerm } from "../../domain/index.js";
import { countingEntries, matchedLines } from "../helpers.js";
import type { IssueDraft, Rule, RuleContext } from "../types.js";

// Recurring terms (rent, maintenance fees): right amount, right period, never the same period twice.

const NoParams = z.object({}).strict();
const MONTHS: Record<RecurringTerm["period"], number> = { monthly: 1, quarterly: 3, yearly: 12 };

export const recurringAmountMismatch: Rule = {
  code: "RECURRING_AMOUNT_MISMATCH",
  description: "Recurring line amount ≠ agreed amount × number of periods covered.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    return matchedLines(ctx, "recurring").flatMap(({ line, term }) => {
      const period = linePeriod(ctx, line.period);
      const count = period ? periodCount(term, period) ?? 1 : 1;
      const expected = dec(term.amount).times(count);
      if (withinAbs(expected, line.net, ctx.tolerances.amountAbs)) return [];
      return [
        {
          lineNo: line.lineNo,
          termId: term.id,
          expected: fmt2(expected),
          actual: fmt2(line.net),
          delta: fmt2(dec(line.net).minus(expected)),
          params: { periods: count, periodAmount: term.amount },
        },
      ];
    });
  },
};

export const recurringPeriodInvalid: Rule = {
  code: "RECURRING_PERIOD_INVALID",
  description: "Recurring line period missing, outside the term's start/end, or not aligned to whole periods.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const issues: IssueDraft[] = [];
    for (const { line, term } of matchedLines(ctx, "recurring")) {
      const period = linePeriod(ctx, line.period);
      const base = { lineNo: line.lineNo, termId: term.id };
      if (!period) {
        issues.push({ ...base, params: { reason: "missing" } });
        continue;
      }
      const actual = `${period.from} – ${period.to}`;
      if (period.from < term.start || (term.end && period.to > term.end)) {
        issues.push({ ...base, actual, expected: `${term.start} – ${term.end ?? "…"}`, params: { reason: "outside_term" } });
      } else if (periodCount(term, period) === undefined) {
        issues.push({ ...base, actual, params: { reason: "not_aligned", period: term.period } });
      }
    }
    return issues;
  },
};

export const recurringPeriodDuplicate: Rule = {
  code: "RECURRING_PERIOD_DUPLICATE",
  description: "The same period of a recurring term was already invoiced.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const prior = countingEntries(ctx);
    const issues: IssueDraft[] = [];
    for (const { line, term } of matchedLines(ctx, "recurring")) {
      const period = linePeriod(ctx, line.period);
      if (!period) continue;
      const clash = prior.find(
        (e) => e.termId === term.id && e.period && e.period.from <= period.to && period.from <= e.period.to,
      );
      if (clash) {
        issues.push({
          lineNo: line.lineNo,
          termId: term.id,
          actual: `${period.from} – ${period.to}`,
          params: { previousInvoice: clash.invoiceNumber, previousPeriod: `${clash.period!.from} – ${clash.period!.to}` },
        });
      }
    }
    return issues;
  },
};

const linePeriod = (ctx: RuleContext, period: Period | undefined) => period ?? ctx.invoice.servicePeriod;

/**
 * Whole periods covered, or undefined if not aligned. Periods are anchored on the term's start day:
 * a monthly term starting 2026-03-01 covers 2026-04-01..2026-04-30, 2026-04-01..2026-05-31, etc.
 */
export function periodCount(term: RecurringTerm, period: Period): number | undefined {
  const step = MONTHS[term.period];
  const startDay = Number(term.start.slice(8, 10));
  if (Number(period.from.slice(8, 10)) !== startDay) return undefined;
  for (let n = 1; n <= 36; n++) {
    const end = addMonths(period.from, step * n, -1);
    if (end === period.to) return n;
    if (end > period.to) return undefined;
  }
  return undefined;
}

function addMonths(date: string, months: number, plusDays = 0): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}
