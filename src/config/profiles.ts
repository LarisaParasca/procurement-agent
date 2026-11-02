import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { ProfileSchema, type Profile } from "../domain/index.js";
import { ruleRegistry } from "../rules/registry.js";

export const PROFILES_DIR = resolve(import.meta.dirname, "../../profiles");

export class ProfileError extends Error {}

/**
 * Loads and validates a profile. Validation covers the shape (zod) *and* each rule's params
 * against that rule's own params schema, so a typo fails at startup, not mid-check.
 */
export function loadProfile(idOrPath: string): Profile {
  const path = idOrPath.endsWith(".yaml") || idOrPath.endsWith(".yml")
    ? resolve(idOrPath)
    : resolve(PROFILES_DIR, `${idOrPath}.yaml`);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ProfileError(`cannot read profile ${path}: ${(err as Error).message}`);
  }
  return parseProfile(raw, path);
}

export function parseProfile(raw: unknown, label = "profile"): Profile {
  const result = ProfileSchema.safeParse(raw);
  if (!result.success) {
    throw new ProfileError(`invalid ${label}:\n${z.prettifyError(result.error)}`);
  }
  const profile = result.data;
  for (const [code, config] of Object.entries(profile.rules)) {
    const rule = ruleRegistry[code as keyof typeof ruleRegistry];
    const params = rule.paramsSchema.safeParse(config?.params ?? {});
    if (!params.success) {
      throw new ProfileError(`invalid params for rule ${code} in ${label}:\n${z.prettifyError(params.error)}`);
    }
  }
  return profile;
}
