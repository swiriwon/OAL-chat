// Defaults for agent metadata when upstream does not supply them.
// Keep this aligned with the product-level latest-model baseline.
//
// OAL fork (Sprint 4 Q1 follow-up #2): switched from upstream's openai
// gpt-5.x default to Anthropic's claude-sonnet-4-6 because the OAL
// paperclip plugin only injects ANTHROPIC_API_KEY into spawned
// per-company machines (packages/core-plugin/src/provisioning/flyio.ts).
// Upstream's openai default would 401 at lane start because no openai
// key is provisioned. Re-evaluate when upstream bumps to a newer
// gpt-5.x or we start provisioning OpenAI creds.
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-sonnet-4-6";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
