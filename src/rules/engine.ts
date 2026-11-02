import { RuleCodeSchema, type Issue, type Profile, type Severity } from "../domain/index.js";
import { ruleRegistry } from "./registry.js";
import type { RuleContext } from "./types.js";

const SEVERITY_RANK: Record<Severity, number> = { info: 0, review: 1, reject: 2 };
const CODE_ORDER = RuleCodeSchema.options;

const minSeverity = (a: Severity, b: Severity | undefined): Severity =>
  b !== undefined && SEVERITY_RANK[b] < SEVERITY_RANK[a] ? b : a;

/**
 * Runs every rule the profile enables. Deterministic: same context + profile → same issues, same order.
 * Severity is the profile's; a rule can only lower it. A crashing rule never crashes the check —
 * it becomes a RULE_ERROR issue so a human looks at the invoice.
 */
export function runRules(ctx: RuleContext, profile: Profile): Issue[] {
  const issues: Issue[] = [];
  for (const [code, config] of Object.entries(profile.rules)) {
    if (!config || !config.enabled) continue;
    const rule = ruleRegistry[code as keyof typeof ruleRegistry];
    try {
      const params = rule.paramsSchema.parse(config.params);
      for (const { maxSeverity, ...draft } of rule.evaluate(ctx, params)) {
        issues.push({ ...draft, code: rule.code, severity: minSeverity(config.severity, maxSeverity) });
      }
    } catch (err) {
      issues.push({ code: "RULE_ERROR", severity: "review", params: { rule: code, error: (err as Error).message } });
    }
  }
  return issues.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code) ||
      (a.lineNo ?? 0) - (b.lineNo ?? 0),
  );
}
