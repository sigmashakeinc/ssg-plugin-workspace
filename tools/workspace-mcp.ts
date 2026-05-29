#!/usr/bin/env bun
/**
 * sigmashake-workspace — stdio MCP server.
 *
 * A Model Context Protocol server (JSON-RPC 2.0 over newline-delimited stdio)
 * that exposes the monorepo workspace surface to AI agents: the project list,
 * per-project health, and the AI-native scorecard. Zero dependencies — Bun's
 * fetch + stdin only. It is a thin MCP front for the SSG daemon's
 * `/api/json/workspace/*` routes.
 *
 * Run:  bun tools/workspace-mcp.ts
 * Register (.mcp.json):
 *   { "mcpServers": { "sigmashake-workspace":
 *       { "command": "bun", "args": ["tools/workspace-mcp.ts"] } } }
 *
 * Tools (read-only):
 *   list_projects     — every monorepo project the workspace discovers
 *   workspace_health  — per-project git / deploy / test health
 *   ai_native_report  — the AI-native readiness scorecard
 *
 * Env: WORKSPACE_BASE_URL (default http://127.0.0.1:7901), WORKSPACE_TOKEN
 */

const BASE_URL = (process.env.WORKSPACE_BASE_URL ?? "http://127.0.0.1:7901").replace(/\/+$/, "");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "sigmashake-workspace", version: "0.1.0" };

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "list_projects",
    description:
      "List every project the monorepo workspace discovers — slug, type, description, scripts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "workspace_health",
    description: "Per-project health: git status, deploy gate, and build/test freshness.",
    inputSchema: {
      type: "object",
      properties: {
        projects: { type: "string", description: "optional comma-separated slug filter" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ai_native_report",
    description:
      "The AI-native readiness scorecard (capability signals + latency gauge) for one or all services.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "optional single-service slug" },
      },
      additionalProperties: false,
    },
  },
];

async function apiGet(path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  const tok = process.env.WORKSPACE_TOKEN;
  if (tok) headers["X-SigmaShake-Token"] = tok;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.text();
    let data: unknown = body;
    try {
      data = JSON.parse(body);
    } catch {
      /* keep raw text */
    }
    return { ok: res.ok, status: res.status, path, data };
  } catch (err) {
    return {
      ok: false,
      path,
      error: `${err instanceof Error ? err.message : String(err)} — is the SSG daemon running on ${BASE_URL}?`,
    };
  }
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: RpcRequest["id"], value: unknown): void {
  send({ jsonrpc: "2.0", id, result: value });
}

function rpcError(id: RpcRequest["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolText(value: unknown): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "list_projects") {
    return apiGet("/api/json/workspace/projects");
  }
  if (name === "workspace_health") {
    const p = typeof args.projects === "string" ? args.projects : "";
    return apiGet(`/api/json/workspace/health${p ? `?projects=${encodeURIComponent(p)}` : ""}`);
  }
  if (name === "ai_native_report") {
    const slug = typeof args.slug === "string" ? args.slug : "";
    return apiGet(
      `/api/json/workspace/ai-native${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`,
    );
  }
  return null;
}

async function handle(req: RpcRequest): Promise<void> {
  switch (req.method) {
    case "initialize":
      result(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case "notifications/initialized":
      return;
    case "tools/list":
      result(req.id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = (req.params?.name as string) ?? "";
      const args = (req.params?.arguments as Record<string, unknown>) ?? {};
      if (!TOOLS.some((t) => t.name === name)) {
        rpcError(req.id, -32602, `unknown tool: ${name}`);
        return;
      }
      result(req.id, toolText(await callTool(name, args)));
      return;
    }
    default:
      if (req.id !== undefined && req.id !== null) {
        rpcError(req.id, -32601, `unknown method: ${req.method}`);
      }
  }
}

async function main(): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line) continue;
      let req: RpcRequest;
      try {
        req = JSON.parse(line) as RpcRequest;
      } catch {
        continue;
      }
      await handle(req);
    }
  }
}

main().catch((err) => {
  process.stderr.write(
    `workspace-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
