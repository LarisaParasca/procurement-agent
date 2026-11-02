import { describe, expect, it } from "vitest";
import type { InvoiceOut } from "../../src/extract/api-schemas.js";
import { normalizeInvoice } from "../../src/extract/extract.js";
import type { SourceDocument } from "../../src/ingest/document.js";
import { emptyConfusion, scoreIssues, type IssueCounts } from "../../src/eval/scorers.js";
import { checkNumbers, parseLooseNumber } from "../../src/report/number-guard.js";
import type { InvoiceTruth } from "../../src/seed/truth.js";
import { developerProfile } from "../factories.js";

describe("number guard", () => {
  const facts = { total: "13.560,00", expected: "31,50", overPct: "7,6%", date: "25.03.2026", line: 1 };

  it.each([
    ["1.234,50", 1234.5],
    ["1234.5", 1234.5],
    ["250.000", 250000],
    ["7,6", 7.6],
  ])("parses %s", (raw, n) => expect(parseLooseNumber(raw)).toBe(n));

  it("accepts a report that only uses fact numbers", () => {
    expect(checkNumbers("Total 13.560,00 lei, preț 31,50 lei (7,6% peste), din 25.03.2026, rândul 1.", facts).ok).toBe(true);
  });

  it("rejects an invented amount or date", () => {
    expect(checkNumbers("Diferența este de 960,00 lei.", facts)).toEqual({ ok: false, unknown: ["960"] });
    expect(checkNumbers("Factura din 26.03.2026.", facts).unknown).toEqual(["26.03.2026"]);
  });
});

describe("normalizeInvoice", () => {
  const doc: SourceDocument = { ref: { path: "x.pdf", sha256: "abc", format: "pdf" }, bytes: Buffer.from(""), mediaType: "application/pdf" };
  const base: InvoiceOut = {
    series: "OTD",
    number: "0145",
    issueDate: "2026-03-20",
    dueDate: null,
    servicePeriodFrom: null,
    servicePeriodTo: null,
    issuer: { name: "Oțel Demo", cui: "RO29145670", regCom: null, address: null, iban: null },
    recipient: { name: "Constructii Exemplu SRL", cui: "RO 40000000", regCom: null, address: null, iban: null },
    currency: "lei",
    references: [{ kind: "po_no", raw: "Comanda nr. PO-2026-0031" }],
    lines: [{ description: "Oțel", unit: "t", quantity: 8.5, unitPrice: 4180, net: 35530, vatRate: 21, periodFrom: null, periodTo: null, percentageBase: null }],
    vatLines: [{ rate: 21, base: 35530, amount: 7461.3 }],
    totals: { net: 35530, vat: 7461.3, gross: 42991.3 },
    confidence: { overall: 0.97, parties: 0.97, numberAndDates: 0.97, lines: 0.97, totals: 0.97 },
    unreadable: [],
  };

  it("normalizes CUIs, currency, references and money", () => {
    const inv = normalizeInvoice(base, doc, developerProfile, "m", "v");
    expect(inv.issuer).toMatchObject({ cui: "29145670", vatPayer: true });
    expect(inv.direction).toBe("incoming");
    expect(inv.currency).toBe("RON");
    expect(inv.references[0]!.normalized).toBe("2026-31");
    expect(inv.totals.gross).toBe("42991.30");
    expect(inv.extraction.needsHumanReview).toBe(false);
  });

  it("flags a CUI that fails the checksum and low confidence, without 'fixing' anything", () => {
    const inv = normalizeInvoice(
      { ...base, issuer: { ...base.issuer, cui: "RO29145671" }, confidence: { ...base.confidence, totals: 0.6 } },
      doc,
      developerProfile,
      "m",
      "v",
    );
    expect(inv.issuer.cui).toBe("29145671");
    expect(inv.extraction.needsHumanReview).toBe(true);
    expect(inv.extraction.reviewReasons.join(" ")).toMatch(/checksum.*low confidence on totals/s);
    expect(inv.extraction.confidence).toBeLessThan(0.6);
  });

  it("refuses an invoice without a readable issue date", () => {
    expect(() => normalizeInvoice({ ...base, issueDate: "20/03/2026" }, doc, developerProfile, "m", "v")).toThrow(/issue date/);
  });
});

describe("scoreIssues", () => {
  const truth = { expectedIssues: [{ code: "CUMULATIVE_THRESHOLD", severity: "review" }, { code: "ITEM_NOT_COVERED", severity: "review", lineNo: 2 }] } as InvoiceTruth;
  const result = (issues: Array<{ code: string; lineNo?: number }>) => ({ issues: issues.map((i) => ({ ...i, severity: "review", params: {} })) }) as never;

  it("counts TP / FP / FN, matching line numbers only where the truth names one", () => {
    const counts: IssueCounts = {};
    const diff = scoreIssues(truth, result([{ code: "CUMULATIVE_THRESHOLD" }, { code: "ITEM_NOT_COVERED", lineNo: 1 }, { code: "VAT_RATE_INVALID", lineNo: 1 }]), counts);
    expect(counts).toEqual({
      CUMULATIVE_THRESHOLD: { tp: 1, fp: 0, fn: 0 },
      ITEM_NOT_COVERED: { tp: 0, fp: 1, fn: 1 },
      VAT_RATE_INVALID: { tp: 0, fp: 1, fn: 0 },
    });
    expect(diff.missing).toEqual(["ITEM_NOT_COVERED|2"]);
  });

  it("confusion matrix starts empty", () => {
    expect(emptyConfusion().REJECT.APPROVE).toBe(0);
  });
});
