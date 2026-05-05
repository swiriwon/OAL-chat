/**
 * OpenAgentLink fork addition (Sprint 4 Layer 4).
 *
 * Unit tests for applyUserMcpServersFromEnv() — the env-driven merge
 * that injects OPENCLAW_USER_MCP_SERVERS_JSON entries into config.mcp.servers
 * at gateway boot.
 */

import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "./types.openclaw.js";
import { applyUserMcpServersFromEnv, type UserMcpServersLogger } from "./user-mcp-servers.js";

const ENV_VAR = "OPENCLAW_USER_MCP_SERVERS_JSON";

interface CapturedLog {
  level: "debug" | "warn";
  msg: string;
  meta?: Record<string, unknown>;
}

function makeCapturingLogger(): {
  logs: CapturedLog[];
  logger: UserMcpServersLogger;
} {
  const logs: CapturedLog[] = [];
  const logger: UserMcpServersLogger = {
    debug: (msg, meta) => {
      logs.push({ level: "debug", msg, meta });
    },
    warn: (msg, meta) => {
      logs.push({ level: "warn", msg, meta });
    },
  };
  return { logs, logger };
}

function baseConfig(): OpenClawConfig {
  // Minimal config — every field on OpenClawConfig is optional, so an
  // empty object satisfies the contract for these tests.
  return {};
}

function configWithExistingServer(): OpenClawConfig {
  return {
    mcp: {
      servers: {
        openclaw: {
          type: "http",
          url: "http://127.0.0.1:18789/mcp",
          // headers omitted intentionally — matches the loopback shape.
        },
      },
    },
  } as OpenClawConfig;
}

function readMcpServers(cfg: OpenClawConfig): Record<string, unknown> {
  const servers = cfg.mcp?.servers;
  return (servers ?? {}) as unknown as Record<string, unknown>;
}

describe("applyUserMcpServersFromEnv", () => {
  it("returns input unchanged and silent when env var is unset", () => {
    const input = baseConfig();
    const { logs, logger } = makeCapturingLogger();
    const out = applyUserMcpServersFromEnv(input, { env: {}, logger });
    expect(out).toBe(input);
    expect(logs).toEqual([]);
  });

  it("returns input unchanged and silent when env var is an empty string", () => {
    const input = baseConfig();
    const { logs, logger } = makeCapturingLogger();
    const out = applyUserMcpServersFromEnv(input, { env: { [ENV_VAR]: "   " }, logger });
    expect(out).toBe(input);
    expect(logs).toEqual([]);
  });

  it("warns and skips when env var is malformed JSON", () => {
    const input = baseConfig();
    const { logs, logger } = makeCapturingLogger();
    const out = applyUserMcpServersFromEnv(input, {
      env: { [ENV_VAR]: "{not-json" },
      logger,
    });
    expect(out).toBe(input);
    expect(logs.some((l) => l.level === "warn" && /not valid JSON/.test(l.msg))).toBe(true);
  });

  it("warns and skips when parsed JSON has no mcpServers field", () => {
    const input = baseConfig();
    const { logs, logger } = makeCapturingLogger();
    const out = applyUserMcpServersFromEnv(input, {
      env: { [ENV_VAR]: JSON.stringify({ wrongShape: {} }) },
      logger,
    });
    expect(out).toBe(input);
    expect(logs.some((l) => l.level === "warn" && /missing or non-object/.test(l.msg))).toBe(true);
  });

  it("warns and skips when mcpServers is not an object (e.g. array)", () => {
    const input = baseConfig();
    const { logger } = makeCapturingLogger();
    const out = applyUserMcpServersFromEnv(input, {
      env: { [ENV_VAR]: JSON.stringify({ mcpServers: ["bad"] }) },
      logger,
    });
    // Arrays are objects in JS — but we still expect the merge path to
    // reject them, since downstream code treats mcp.servers as a record.
    // Not strictly required by the spec; this test pins behavior.
    expect(out).toBe(input);
  });

  it("merges a single user mcp server entry into config.mcp.servers (happy path)", () => {
    const input = baseConfig();
    const { logger } = makeCapturingLogger();
    const userJson = JSON.stringify({
      mcpServers: {
        hallelujah: {
          type: "http",
          url: "https://hallelujah.mcp.openagentlink.ai/mcp",
          headers: { Authorization: "Bearer test-token" },
        },
      },
    });
    const out = applyUserMcpServersFromEnv(input, {
      env: { [ENV_VAR]: userJson },
      logger,
    });

    const servers = readMcpServers(out);
    expect(Object.keys(servers)).toEqual(["hallelujah"]);
    expect(servers.hallelujah).toEqual({
      type: "http",
      url: "https://hallelujah.mcp.openagentlink.ai/mcp",
      headers: { Authorization: "Bearer test-token" },
    });
    // Input must be untouched (purity).
    expect(input.mcp).toBeUndefined();
  });

  it("drops reserved 'openclaw' key, merges only the non-reserved entries", () => {
    const input = configWithExistingServer();
    const { logs, logger } = makeCapturingLogger();
    const userJson = JSON.stringify({
      mcpServers: {
        openclaw: {
          type: "http",
          url: "https://attacker.example/mcp",
          headers: { Authorization: "Bearer evil" },
        },
        hallelujah: {
          type: "http",
          url: "https://hallelujah.mcp.openagentlink.ai/mcp",
          headers: { Authorization: "Bearer good" },
        },
      },
    });
    const out = applyUserMcpServersFromEnv(input, {
      env: { [ENV_VAR]: userJson },
      logger,
    });

    const servers = readMcpServers(out);
    // Loopback openclaw entry must be unchanged (not overwritten).
    expect(servers.openclaw).toEqual({
      type: "http",
      url: "http://127.0.0.1:18789/mcp",
    });
    // hallelujah merged in.
    expect(servers.hallelujah).toEqual({
      type: "http",
      url: "https://hallelujah.mcp.openagentlink.ai/mcp",
      headers: { Authorization: "Bearer good" },
    });
    // A warn log fired for the dropped reserved key.
    expect(
      logs.some(
        (l) =>
          l.level === "warn" &&
          /reserved mcp server name/.test(l.msg) &&
          Array.isArray(l.meta?.droppedReserved) &&
          (l.meta?.droppedReserved as string[]).includes("openclaw"),
      ),
    ).toBe(true);
  });

  it("returns input unchanged when env contains only reserved keys", () => {
    const input = configWithExistingServer();
    const { logs, logger } = makeCapturingLogger();
    const userJson = JSON.stringify({
      mcpServers: {
        openclaw: { type: "http", url: "https://attacker.example/mcp" },
        system: { type: "http", url: "https://attacker.example/sys" },
      },
    });
    const out = applyUserMcpServersFromEnv(input, {
      env: { [ENV_VAR]: userJson },
      logger,
    });

    expect(out).toBe(input);
    // Warned about the reserved drop.
    expect(logs.some((l) => l.level === "warn" && /reserved mcp server name/.test(l.msg))).toBe(
      true,
    );
    // Then debug-noted that nothing remained.
    expect(
      logs.some((l) => l.level === "debug" && /no user-mergeable mcp servers/.test(l.msg)),
    ).toBe(true);
  });

  it("merges multiple user mcp server entries", () => {
    const input = baseConfig();
    const { logger } = makeCapturingLogger();
    const userJson = JSON.stringify({
      mcpServers: {
        alpha: { type: "http", url: "https://alpha.example/mcp", headers: {} },
        beta: { type: "http", url: "https://beta.example/mcp", headers: {} },
        gamma: { type: "http", url: "https://gamma.example/mcp", headers: {} },
      },
    });
    const out = applyUserMcpServersFromEnv(input, {
      env: { [ENV_VAR]: userJson },
      logger,
    });

    const servers = readMcpServers(out);
    expect(Object.keys(servers).toSorted()).toEqual(["alpha", "beta", "gamma"]);
  });
});
