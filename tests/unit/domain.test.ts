import { describe, expect, it } from "vitest";
import { isValidCui, normalizeCui, toDecimal, withCuiCheckDigit } from "../../src/domain/index.js";

describe("toDecimal", () => {
  it.each([
    [1234.5, "1234.5"],
    ["1.234,50", "1234.5"],
    ["1234.50", "1234.5"],
    [" 12 500,00 ", "12500"],
    [0.1 + 0.2, "0.30000000000000004"], // floats are exactly why we don't use them past the boundary
  ])("%s → %s", (input, expected) => {
    expect(toDecimal(input)).toBe(expected);
  });
});

describe("CUI", () => {
  it("normalizes RO prefix and spaces", () => {
    expect(normalizeCui("ro 1854 7290")).toBe("18547290");
  });

  it("generated check digits validate, and a single misread digit fails", () => {
    const cui = withCuiCheckDigit("4150123");
    expect(isValidCui(cui)).toBe(true);
    expect(isValidCui(`RO${cui}`)).toBe(true);
    const typo = cui.slice(0, 2) + ((Number(cui[2]) + 1) % 10) + cui.slice(3);
    expect(isValidCui(typo)).toBe(false);
  });
});
