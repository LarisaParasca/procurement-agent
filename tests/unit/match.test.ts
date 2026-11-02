import { describe, expect, it } from "vitest";
import type { Term } from "../../src/domain/index.js";
import { decideDeterministic, queryFromInvoice, scoreCandidates } from "../../src/match/agreement-match.js";
import { matchLinesDeterministic } from "../../src/match/line-match.js";
import { normalizeReference, normalizeUnit, tokenSimilarity } from "../../src/match/normalize.js";
import { agreement, developerProfile, invoice, line, SUPPLIER } from "../factories.js";

describe("normalizeReference", () => {
  it.each([
    ["Contract nr. CA-2026-014", "CA-2026-14"],
    ["CA-2026-14", "CA-2026-14"],
    ["conform comenzii PO 2026/0031", "2026-31"],
    ["Comanda nr. PO-2026-0031", "2026-31"],
    ["Oferta OF 118 / 2026", "OF-118-2026"],
    ["Devizul nr. DV-07", "DV-7"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeReference(raw)).toBe(expected);
  });
});

describe("normalizeUnit", () => {
  it.each([["Buc.", "buc"], ["mc", "m3"], ["m³", "m3"], ["tone", "t"], ["SACI", "sac"], [undefined, undefined]])("%s → %s", (raw, expected) => {
    expect(normalizeUnit(raw)).toBe(expected);
  });
});

describe("tokenSimilarity", () => {
  it("ignores diacritics, case and punctuation", () => {
    expect(tokenSimilarity("Oțel beton PC52 Ø12", "otel beton pc52 ø12")).toBe(1);
  });
  it("is low for unrelated items", () => {
    expect(tokenSimilarity("Transport materiale", "Ciment Portland 42.5")).toBe(0);
  });
});

describe("agreement matching", () => {
  const ctr = agreement({ id: "ctr", references: [{ kind: "contract_no", raw: "CA-2026-014", normalized: "CA-2026-14" }] });
  const po = agreement({ id: "po", documentType: "purchase_order", references: [{ kind: "po_no", raw: "PO-2026-0031", normalized: "2026-31" }] });
  const other = agreement({ id: "other", parties: [{ name: "Alt Furnizor", cui: "11111111", vatPayer: true, role: "supplier" }], references: [] });

  it("reference + CUI + date → deterministic", () => {
    const inv = invoice({ references: [{ kind: "contract_no", raw: "Contract nr. CA-2026-014", normalized: "CA-2026-14" }] });
    const m = decideDeterministic(scoreCandidates(queryFromInvoice(inv), [ctr, po, other]), developerProfile);
    expect(m).toMatchObject({ agreementId: "ctr", method: "deterministic", confidence: 1 });
  });

  it("reference + CUI still matches when the date is outside validity (the date rule reports it)", () => {
    const inv = invoice({ issueDate: "2027-02-01", references: [{ kind: "po_no", raw: "PO-2026-0031", normalized: "2026-31" }] });
    expect(decideDeterministic(scoreCandidates(queryFromInvoice(inv), [ctr, po]), developerProfile)?.agreementId).toBe("po");
  });

  it("CUI only, two agreements → needs the LLM", () => {
    const inv = invoice({ references: [] });
    const scored = scoreCandidates(queryFromInvoice(inv), [ctr, po, other]);
    expect(scored.map((c) => c.agreement.id)).toEqual(["ctr", "po"]);
    expect(decideDeterministic(scored, developerProfile)).toBeNull();
  });

  it("unknown supplier and no reference → none", () => {
    const inv = invoice({ issuer: { ...SUPPLIER, cui: "99999999" } });
    expect(decideDeterministic(scoreCandidates(queryFromInvoice(inv), [ctr, po]), developerProfile)).toMatchObject({ method: "none", agreementId: null });
  });
});

describe("line matching", () => {
  const steel: Term = { id: "t2", kind: "unit_item", description: "Oțel beton PC52 Ø12", aliases: [], unit: "t", unitPrice: "4100" };
  const cement325: Term = { id: "t3", kind: "unit_item", description: "Ciment Portland CEM II 32.5R, sac 40 kg", aliases: [], unit: "sac", unitPrice: "26" };
  const agr = agreement({ terms: [agreement().terms[0]!, steel, cement325] });

  it("exact, alias-free token match, and fall-through to the LLM", () => {
    const inv = invoice({
      lines: [
        line({ description: "OTEL BETON PC52 Ø12", unit: "to" }),
        line({ lineNo: 2, description: "Ciment CEM II/A-LL 42.5R" }),
        line({ lineNo: 3, description: "Transport materiale", unit: "buc" }),
      ],
    });
    const m = matchLinesDeterministic(inv, agr);
    expect(m[0]).toMatchObject({ termId: "t2", method: "exact" });
    // two cement terms look alike → not decided deterministically
    expect(m[1]).toMatchObject({ termId: null, method: "none" });
    expect(m[2]).toMatchObject({ termId: null, method: "none" });
  });

  it("a unit mismatch blocks a text match", () => {
    const inv = invoice({ lines: [line({ description: "Oțel beton PC52 Ø12", unit: "kg" })] });
    expect(matchLinesDeterministic(inv, agr)[0]?.termId).toBeNull();
  });
});
