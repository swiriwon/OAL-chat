/**
 * OpenAgentLink fork addition (Sprint 4 Layer 4).
 *
 * Read OPENCLAW_USER_MCP_SERVERS_JSON at gateway boot and merge its
 * `mcpServers` entries into the loaded OpenClaw config's
 * `mcp.servers`. Built on top of OpenClaw's existing
 * applyMergePatch() so the merge semantics match every other
 * config layer (default → bundle → user file → us).
 *
 * Why this lives in a dedicated file (not inside mcp-config.ts):
 *   - OAL-only logic; keeps upstream merge hygiene.
 *   - Single entry point so boot ordering is obvious.
 *   - Easy to unit-test in isolation.
 *
 * The env value is produced by OAL's companion at workspace spawn
 * time (see apps/web/src/server/auth/build-mcp-config.ts in the
 * companion repo). The shape is:
 *
 *   { "mcpServers": { "<id>": { "type": "http", "url": "...",
 *                                "headers": { ... } }, ... } }
 *
 * Reserved keys ("openclaw", "system") are dropped silently — the
 * loopback gateway and any future reserved namespaces stay
 * inviolate even if the user JSON tries to override them.
 */

import { applyMergePatch } from "./merge-patch.js";
import type { OpenClawConfig } from "./types.openclaw.js";

/**
 * Names that MUST NOT be overwritten by user-provided mcpServers
 * entries. The loopback `openclaw` server is set up by OpenClaw's
 * boot path and is required for runtime self-introspection;
 * `system` is reserved for future internal use.
 */
const RESERVED_USER_MCP_SERVER_NAMES: ReadonlySet<string> = new Set(["openclaw", "system"]);

const ENV_VAR_NAME = "OPENCLAW_USER_MCP_SERVERS_JSON";

/**
 * Logger surface — narrow on purpose so the function works with
 * OpenClaw's structured logger AND with a console fallback in tests.
 */
export interface UserMcpServersLogger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: UserMcpServersLogger = {
  debug: () => {},
  warn: () => {},
};

export interface ApplyUserMcpServersOptions {
  /** Override `process.env` lookup. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Optional structured logger. Defaults to a no-op logger. */
  logger?: UserMcpServersLogger;
}

/**
 * Returns a new config with OPENCLAW_USER_MCP_SERVERS_JSON merged
 * in. Pure: never mutates the input.
 *
 * Behaviour:
 *   - env unset / empty           → returns input unchanged, no log
 *   - env not valid JSON          → returns input unchanged, warn log
 *   - parsed object lacks valid
 *     mcpServers (object) field   → returns input unchanged, warn log
 *   - parsed mcpServers contains
 *     reserved keys               → drop those keys silently (warn log)
 *   - empty mcpServers after
 *     reserved-key drop           → returns input unchanged
 *   - otherwise                   → applyMergePatch into config.mcp.servers
 *
 * Validation of the merged result is the caller's responsibility —
 * gateway startup runs the full config validators downstream.
 */
export function applyUserMcpServersFromEnv(
  config: OpenClawConfig,
  options: ApplyUserMcpServersOptions = {},
): OpenClawConfig {
  const env = options.env ?? process.env;
  const logger = options.logger ?? noopLogger;

  const raw = env[ENV_VAR_NAME];
  if (raw === undefined || raw === null || raw.trim() === "") {
    return config;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(`${ENV_VAR_NAME} is not valid JSON; skipping user mcp servers merge`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return config;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("mcpServers" in parsed) ||
    typeof (parsed as { mcpServers: unknown }).mcpServers !== "object" ||
    (parsed as { mcpServers: unknown }).mcpServers === null ||
    Array.isArray((parsed as { mcpServers: unknown }).mcpServers)
  ) {
    logger.warn(
      `${ENV_VAR_NAME} parsed but missing or non-object 'mcpServers' field; skipping merge`,
    );
    return config;
  }

  const userServers = (parsed as { mcpServers: Record<string, unknown> }).mcpServers;

  // Drop reserved keys.
  const filteredServers: Record<string, unknown> = {};
  const droppedReserved: string[] = [];
  for (const [name, entry] of Object.entries(userServers)) {
    if (RESERVED_USER_MCP_SERVER_NAMES.has(name)) {
      droppedReserved.push(name);
      continue;
    }
    filteredServers[name] = entry;
  }
  if (droppedReserved.length > 0) {
    logger.warn(`${ENV_VAR_NAME} contained reserved mcp server name(s); dropped`, {
      droppedReserved,
    });
  }

  if (Object.keys(filteredServers).length === 0) {
    logger.debug(`${ENV_VAR_NAME} contained no user-mergeable mcp servers; skipping`);
    return config;
  }

  // Merge into config.mcp.servers via OpenClaw's standard helper so
  // semantics match every other merge layer (later overrides earlier
  // for the same key — but we ARE the latest layer for these names).
  const patch = { mcp: { servers: filteredServers } };
  const merged = applyMergePatch(config as unknown as Record<string, unknown>, patch);

  logger.debug(`${ENV_VAR_NAME} merged ${Object.keys(filteredServers).length} mcp server(s)`, {
    names: Object.keys(filteredServers),
  });

  return merged as OpenClawConfig;
}
