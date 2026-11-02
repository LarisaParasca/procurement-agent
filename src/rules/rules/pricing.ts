import Big from "big.js";
import { z } from "zod";
import { dec, fmt2, sumDecimals, type Term } from "../../domain/index.js";
import { countingEntries, matchedLines, pct, termForLine } from "../helpers.js";
import type { IssueDraft, Rule, RuleContext } from "../types.js";

// Rules comparing invoiced prices and quantities with the agreement.

const NoParams = z.object({}).strict();

export const unitPriceAboveAgreed: Rule = {
  code: "UNIT_PRICE_ABOVE_AGREED",
  description: "Unit price above the agreed price beyond tolerance (pct and/or absolute).",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const { unitPricePct, unitPriceAbs } = ctx.tolerances;
    return matchedLines(ctx, "unit_item").flatMap(({ line, term }) => {
      const limit = dec(term.unitPrice).times(dec(1).plus(dec(unitPricePct).div(100))).plus(unitPriceAbs);
      if (dec(line.unitPrice).lte(limit)) return [];
      const over = dec(line.unitPrice).minus(term.unitPrice);
      return [
        {
          lineNo: line.lineNo,
          termId: term.id,
          expected: term.unitPrice,
          actual: line.unitPrice,
          delta: over.toString(),
          params: {
            overPct: pct(over.div(term.unitPrice).toNumber()),
            // money impact for the report: how much more than agreed this line costs
            impact: fmt2(over.times(line.quantity)),
            unit: term.unit,
          },
        },
      ];
    });
  },
};

export const quantityAboveAgreed: Rule = {
  code: "QUANTITY_ABOVE_AGREED",
  description: "Quantity on this invoice exceeds the agreed maximum quantity for the term.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const byTerm = new Map<string, { term: Extract<Term, { kind: "unit_item" }>; qty: Big; lineNos: number[] }>();
    for (const { line, term } of matchedLines(ctx, "unit_item")) {
      if (!term.maxQuantity) continue;
      const entry = byTerm.get(term.id) ?? { term, qty: dec(0), lineNos: [] };
      entry.qty = entry.qty.plus(line.quantity);
      entry.lineNos.push(line.lineNo);
      byTerm.set(term.id, entry);
    }
    const issues: IssueDraft[] = [];
    for (const { term, qty, lineNos } of byTerm.values()) {
      const limit = dec(term.maxQuantity!).times(dec(1).plus(dec(ctx.tolerances.quantityPct).div(100)));
      if (qty.gt(limit)) {
        issues.push({
          lineNo: lineNos[0],
          termId: term.id,
          expected: term.maxQuantity,
          actual: qty.toString(),
          delta: qty.minus(term.maxQuantity!).toString(),
          params: { unit: term.unit },
        });
      }
    }
    return issues;
  },
};

/**
 * Cumulative usage = what the ledger already holds + this invoice, against each cap:
 * unit_item maxQuantity, fixed_amount amount, and the agreement's totalCap.
 * Crossing a lower alert level (e.g. 80%) is info; going over 100% gets the profile severity.
 */
export const cumulativeThreshold: Rule<{ levels?: number[] }> = {
  code: "CUMULATIVE_THRESHOLD",
  description: "Total invoiced across invoices reaches alert levels (e.g. 80%) or exceeds a term/agreement cap.",
  paramsSchema: z.object({ levels: z.array(z.number().positive()).optional() }).strict(),
  evaluate(ctx, params) {
    if (!ctx.agreement) return [];
    const levels = [...(params.levels ?? ctx.alerts.cumulative)].sort((a, b) => a - b);
    const prior = countingEntries(ctx);
    const issues: IssueDraft[] = [];

    const assess = (scope: string, termId: string | undefined, used: Big, thisInvoice: Big, cap: Big, unit: string, overTol: Big) => {
      if (cap.lte(0)) return;
      const before = used.div(cap).toNumber();
      const after = used.plus(thisInvoice).div(cap).toNumber();
      const crossed = levels.filter((l) => after >= l).at(-1);
      if (crossed === undefined) return;
      const over = after > 1 + overTol.toNumber();
      issues.push({
        termId,
        maxSeverity: over ? undefined : "info",
        expected: cap.toString(),
        actual: used.plus(thisInvoice).toString(),
        params: {
          scope,
          level: pct(crossed),
          usedBefore: pct(before),
          usedAfter: pct(after),
          previouslyInvoiced: used.toString(),
          thisInvoice: thisInvoice.toString(),
          unit,
          term: termId ? (ctx.agreement!.terms.find((t) => t.id === termId)?.description ?? termId) : "",
          status: over ? "over_cap" : "alert",
        },
      });
    };

    const linesByTerm = groupLinesByTerm(ctx);
    for (const term of ctx.agreement.terms) {
      const lines = linesByTerm.get(term.id) ?? [];
      const entries = prior.filter((e) => e.termId === term.id);
      if (term.kind === "unit_item" && term.maxQuantity) {
        if (lines.length === 0) continue;
        assess(
          "term_quantity",
          term.id,
          sumDecimals(entries.map((e) => e.quantity ?? "0")),
          sumDecimals(lines.map((l) => l.quantity)),
          dec(term.maxQuantity),
          term.unit,
          dec(ctx.tolerances.quantityPct).div(100),
        );
      } else if (term.kind === "fixed_amount") {
        if (lines.length === 0) continue;
        assess(
          "term_amount",
          term.id,
          sumDecimals(entries.map((e) => e.net)),
          sumDecimals(lines.map((l) => l.net)),
          dec(term.amount),
          ctx.agreement.currency,
          dec(ctx.tolerances.amountAbs).div(term.amount),
        );
      }
    }
    if (ctx.agreement.totalCap) {
      assess(
        "agreement_total",
        undefined,
        sumDecimals(prior.map((e) => e.net)),
        dec(ctx.invoice.totals.net),
        dec(ctx.agreement.totalCap),
        ctx.agreement.currency,
        dec(ctx.tolerances.amountAbs).div(ctx.agreement.totalCap),
      );
    }
    return issues;
  },
};

function groupLinesByTerm(ctx: RuleContext) {
  const map = new Map<string, RuleContext["invoice"]["lines"]>();
  for (const line of ctx.invoice.lines) {
    const term = termForLine(ctx, line.lineNo);
    if (!term) continue;
    map.set(term.id, [...(map.get(term.id) ?? []), line]);
  }
  return map;
}
