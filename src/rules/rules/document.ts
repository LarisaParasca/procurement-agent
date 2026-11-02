import Big from "big.js";
import { z } from "zod";
import { dateInRange, dec, fmt2, sumDecimals, withinAbs } from "../../domain/index.js";
import type { IssueDraft, Rule } from "../types.js";

// Rules about the invoice document itself — they need no agreement.

const NoParams = z.object({}).strict();

export const duplicateInvoice: Rule = {
  code: "DUPLICATE_INVOICE",
  description: "Same issuer + series + number already checked (exact), or same issuer + gross + date (suspected).",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const issues: IssueDraft[] = ctx.duplicates.exact.map((d) => ({
      params: { kind: "exact", previousNumber: `${d.series ?? ""}${d.number}`, previousDate: d.issueDate },
    }));
    if (issues.length === 0) {
      for (const d of ctx.duplicates.suspected) {
        issues.push({
          maxSeverity: "review",
          params: { kind: "suspected", previousNumber: `${d.series ?? ""}${d.number}`, previousDate: d.issueDate, gross: d.gross },
        });
      }
    }
    return issues;
  },
};

export const arithmeticLine: Rule = {
  code: "ARITHMETIC_LINE",
  description: "Line net must equal quantity × unit price (within rounding tolerance).",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const issues: IssueDraft[] = [];
    for (const line of ctx.invoice.lines) {
      const expected = dec(line.quantity).times(line.unitPrice).round(2);
      if (!withinAbs(expected, line.net, ctx.tolerances.roundingAbs)) {
        issues.push({
          lineNo: line.lineNo,
          expected: fmt2(expected),
          actual: fmt2(line.net),
          delta: fmt2(dec(line.net).minus(expected)),
          params: { quantity: line.quantity, unitPrice: line.unitPrice },
        });
      }
    }
    return issues;
  },
};

export const arithmeticTotals: Rule = {
  code: "ARITHMETIC_TOTALS",
  description: "Σ lines = net total; each VAT line = base × rate; net + VAT = gross.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const { invoice, tolerances } = ctx;
    const tol = tolerances.roundingAbs;
    const issues: IssueDraft[] = [];
    const check = (name: string, expected: Big, actual: string, extra: Record<string, string> = {}) => {
      if (!withinAbs(expected, actual, tol)) {
        issues.push({
          expected: fmt2(expected),
          actual: fmt2(actual),
          delta: fmt2(dec(actual).minus(expected)),
          params: { check: name, ...extra },
        });
      }
    };

    check("lines_vs_net", sumDecimals(invoice.lines.map((l) => l.net)), invoice.totals.net);
    for (const v of invoice.vatLines) {
      check("vat_line", dec(v.base).times(v.rate).div(100).round(2), v.amount, { rate: v.rate });
    }
    if (invoice.vatLines.length > 0) {
      check("vat_lines_vs_vat", sumDecimals(invoice.vatLines.map((v) => v.amount)), invoice.totals.vat);
    }
    check("net_plus_vat_vs_gross", dec(invoice.totals.net).plus(invoice.totals.vat), invoice.totals.gross);
    return issues;
  },
};

export const vatRateInvalid: Rule = {
  code: "VAT_RATE_INVALID",
  description: "Each line's VAT rate must be valid on the issue date per the profile's dated VAT config.",
  paramsSchema: NoParams,
  evaluate(ctx) {
    const { invoice, vat } = ctx;
    const valid = vat.rates
      .filter((r) => dateInRange(invoice.issueDate, r.validFrom, r.validTo))
      .map((r) => dec(r.rate));
    return invoice.lines
      .filter((line) => !valid.some((r) => r.eq(line.vatRate)))
      .map((line) => ({
        lineNo: line.lineNo,
        actual: line.vatRate,
        expected: valid.map((r) => r.toString()).join(" / "),
        params: { issueDate: invoice.issueDate },
      }));
  },
};
