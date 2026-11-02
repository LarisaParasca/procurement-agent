import { describe, expect, it } from "vitest";
import { parseProfile } from "../../src/config/profiles.js";
import { runRules } from "../../src/rules/engine.js";
import { decideVerdict } from "../../src/rules/verdict.js";
import { ctx, developerProfile, invoice, ledgerEntry, line, meta } from "../factories.js";

describe("runRules", () => {
  it("clean invoice → no issues", () => {
    expect(runRules(ctx(), developerProfile)).toEqual([]);
  });

  it("severity comes from the profile and issues are sorted reject-first", () => {
    const c = ctx({ invoice: invoice({ lines: [line({ unitPrice: "34.50", net: "3500.00" })] }) });
    const issues = runRules(c, developerProfile);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ["ARITHMETIC_LINE", "reject"],
      ["UNIT_PRICE_ABOVE_AGREED", "review"],
    ]);
  });

  it("a rule can lower but never raise the profile severity", () => {
    const c = ctx({ ledger: [ledgerEntry({ quantity: "750" })] }); // 750 + 100 = 85%
    const [issue] = runRules(c, developerProfile);
    expect(issue).toMatchObject({ code: "CUMULATIVE_THRESHOLD", severity: "info" });
  });

  it("disabled rules do not run", () => {
    const profile = { ...developerProfile, rules: { ...developerProfile.rules, ARITHMETIC_LINE: { enabled: false, severity: "reject" as const, params: {} } } };
    const c = ctx({ invoice: invoice({ lines: [line({ net: "3500.00" })] }) });
    expect(runRules(c, profile).map((i) => i.code)).not.toContain("ARITHMETIC_LINE");
  });

  it("a crashing rule becomes RULE_ERROR instead of crashing the check", () => {
    const c = ctx();
    (c as { invoice: unknown }).invoice = { ...c.invoice, lines: null };
    const issues = runRules(c, developerProfile);
    expect(issues.some((i) => i.code === "RULE_ERROR" && i.severity === "review")).toBe(true);
  });
});

describe("decideVerdict", () => {
  const base = { invoice: invoice(), agreement: null };

  it("APPROVE with no issues", () => {
    expect(decideVerdict({ ...base, issues: [] }).verdict).toBe("APPROVE");
  });

  it("info issues alone still APPROVE", () => {
    expect(decideVerdict({ ...base, issues: [{ code: "CUMULATIVE_THRESHOLD", severity: "info", params: {} }] }).verdict).toBe("APPROVE");
  });

  it("REVIEW when extraction needs review even without issues", () => {
    const inv = invoice({ extraction: meta({ needsHumanReview: true, reviewReasons: ["low confidence: totals"] }) });
    const v = decideVerdict({ invoice: inv, agreement: null, issues: [] });
    expect(v.verdict).toBe("REVIEW");
    expect(v.reasons[0]).toContain("low confidence: totals");
  });

  it("REJECT wins over REVIEW and lists only rejecting reasons", () => {
    const v = decideVerdict({
      ...base,
      issues: [
        { code: "ARITHMETIC_LINE", severity: "reject", lineNo: 2, params: {} },
        { code: "UNIT_PRICE_ABOVE_AGREED", severity: "review", params: {} },
      ],
    });
    expect(v).toEqual({ verdict: "REJECT", reasons: ["ARITHMETIC_LINE (line 2)"] });
  });
});

describe("profile validation", () => {
  it("both shipped profiles load", () => {
    expect(developerProfile.id).toBe("developer");
  });

  it("rejects unknown rule params at load time", () => {
    const raw = structuredClone(developerProfile) as Record<string, unknown>;
    (raw.rules as Record<string, unknown>).DATE_OUTSIDE_VALIDITY = { params: { graceDayz: 5 } };
    expect(() => parseProfile(raw)).toThrow(/DATE_OUTSIDE_VALIDITY/);
  });

  it("rejects an unknown rule code", () => {
    const raw = structuredClone(developerProfile) as Record<string, unknown>;
    (raw.rules as Record<string, unknown>).MADE_UP_RULE = {};
    expect(() => parseProfile(raw)).toThrow();
  });
});
