import { env } from "../config/env.js";
import { loadProfile } from "../config/profiles.js";
import { createSqliteRepos } from "../data/sqlite/index.js";
import type { Profile } from "../domain/index.js";
import { AnthropicLlm } from "../llm/anthropic.js";

/** Wires repos + LLM + profile for a CLI command. Every LLM call's usage is logged to llm_calls. */
export function openRuntime(opts: { profile?: string; fresh?: boolean } = {}) {
  const profile: Profile = loadProfile(opts.profile ?? env.DEFAULT_PROFILE);
  const repos = createSqliteRepos(env.DB_PATH);
  const llm = new AnthropicLlm({
    fresh: opts.fresh,
    onUsage: (usage, documentSha256) => repos.usage.insert({ ...usage, documentSha256 }),
  });
  return { profile, repos, llm };
}
