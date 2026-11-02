import type { RuleCode } from "../domain/index.js";
import { arithmeticLine, arithmeticTotals, duplicateInvoice, vatRateInvalid } from "./rules/document.js";
import {
  currencyMismatch,
  dateOutsideValidity,
  itemNotCovered,
  lowMatchConfidence,
  noMatchingAgreement,
} from "./rules/matching.js";
import { percentageMismatch } from "./rules/percentage.js";
import { cumulativeThreshold, quantityAboveAgreed, unitPriceAboveAgreed } from "./rules/pricing.js";
import { recurringAmountMismatch, recurringPeriodDuplicate, recurringPeriodInvalid } from "./rules/recurring.js";
import type { Rule } from "./types.js";

// Every rule the engine knows. Profiles choose which ones run and with what severity.
// RULE_ERROR is produced by the engine itself, so it has no entry here.
// The cast widens each rule's specific params type; the engine validates params with the rule's own schema.
export const ruleRegistry: Record<Exclude<RuleCode, "RULE_ERROR">, Rule<any>> = {
  DUPLICATE_INVOICE: duplicateInvoice,
  NO_MATCHING_AGREEMENT: noMatchingAgreement,
  LOW_MATCH_CONFIDENCE: lowMatchConfidence,
  CURRENCY_MISMATCH: currencyMismatch,
  DATE_OUTSIDE_VALIDITY: dateOutsideValidity,
  ITEM_NOT_COVERED: itemNotCovered,
  UNIT_PRICE_ABOVE_AGREED: unitPriceAboveAgreed,
  QUANTITY_ABOVE_AGREED: quantityAboveAgreed,
  CUMULATIVE_THRESHOLD: cumulativeThreshold,
  PERCENTAGE_MISMATCH: percentageMismatch,
  RECURRING_AMOUNT_MISMATCH: recurringAmountMismatch,
  RECURRING_PERIOD_INVALID: recurringPeriodInvalid,
  RECURRING_PERIOD_DUPLICATE: recurringPeriodDuplicate,
  ARITHMETIC_LINE: arithmeticLine,
  ARITHMETIC_TOTALS: arithmeticTotals,
  VAT_RATE_INVALID: vatRateInvalid,
};
