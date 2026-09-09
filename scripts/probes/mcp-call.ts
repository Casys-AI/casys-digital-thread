/**
 * Agent-facing MCP tools/call client for the loopback Console MCP.
 *
 * Write-capable: a successful call can mutate project state. Fast-fails on
 * missing --name or invalid --args. `--args=-` reads the JSON object from
 * stdin so the task line does not echo a large payload. Fills issuedAt only
 * when the caller omitted it and the arguments already include commandId
 * (mutation shape). It does not change server clock rules. Prints
 * structuredContent when present.
 *
 * Usage:
 *   deno task mcp:call --name=project_start --args='{...}'
 *   deno task mcp:call --receipt --name=project_agent_run_execute --args='{...}'
 *   deno task mcp:call --technical-compilation-summary --name=project_technical_compilation_preview --args='{...}'
 *   deno task mcp:call --name=project_start --args=-
 */

import { parseArgs } from "../lib/cli.ts";

export const DEFAULT_MCP_URL = "http://127.0.0.1:3020/mcp";
export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const CLIENT_NAME = "casys-mcp-call";
export const TECHNICAL_COMPILATION_SUMMARY_ITEM_LIMIT = 12;
const TECHNICAL_COMPILATION_PREVIEW_TOOL = "project_technical_compilation_preview";

export interface McpCallRequest {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly url: string;
  /** Print the server's compact human receipt for a completed mutation. */
  readonly receipt?: boolean;
  /**
   * Render a bounded, terminal-oriented view of one technical compilation
   * preview. This is a local display projection; it never changes the MCP
   * request or the server result.
   */
  readonly technicalCompilationSummary?: boolean;
}

export interface McpCallIo {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  /** Injected only when `--args=-`. Inline `--args` must never call this. */
  readonly stdin?: () => string | Promise<string>;
}

export interface McpCallOutcome {
  readonly payload: unknown;
  readonly exitCode: 0 | 1;
}

export function utcIssuedAt(now: Date): string {
  return `${now.toISOString().slice(0, 19)}.000Z`;
}

export function applyIssuedAt(
  args: Record<string, unknown>,
  now: Date,
): Record<string, unknown> {
  if (Object.hasOwn(args, "issuedAt")) {
    return args;
  }
  // Reads such as project_snapshot reject unknown keys. Mutations carry
  // commandId together with issuedAt; only those get a clock stamp.
  if (!hasCommandId(args)) {
    return args;
  }
  return { ...args, issuedAt: utcIssuedAt(now) };
}

export function printableResult(
  result: unknown,
  receipt = false,
  technicalCompilationSummary = false,
): unknown {
  if (!isRecord(result)) {
    return result;
  }
  const text = firstContentText(result);
  if (
    receipt && result.resultType === "complete" && result.isError !== true &&
    text !== undefined && !isJsonObjectText(text)
  ) {
    return { receipt: text };
  }
  if (isRecord(result.structuredContent)) {
    if (technicalCompilationSummary) {
      return technicalCompilationPreviewSummary(result.structuredContent);
    }
    return result.structuredContent;
  }
  if (text !== undefined) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Keep the envelope when content[0].text is not a JSON object.
    }
  }
  return result;
}

export function parseMcpCallCli(argv: string[]): McpCallRequest {
  const flags = parseArgs(argv);
  const name = flags.name?.trim();
  if (!name) {
    throw new TypeError("mcp-call requires --name.");
  }
  const rawArgs = flags.args ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    throw new TypeError("mcp-call --args must be a JSON object.");
  }
  if (!isRecord(parsed)) {
    throw new TypeError("mcp-call --args must be a JSON object.");
  }
  const technicalCompilationSummary = flags["technical-compilation-summary"] ===
    "true";
  if (technicalCompilationSummary && name !== TECHNICAL_COMPILATION_PREVIEW_TOOL) {
    throw new TypeError(
      "mcp-call --technical-compilation-summary requires --name=project_technical_compilation_preview.",
    );
  }
  if (technicalCompilationSummary && flags.receipt === "true") {
    throw new TypeError(
      "mcp-call --technical-compilation-summary cannot be combined with --receipt.",
    );
  }
  return {
    name,
    args: parsed,
    url: flags.url ?? DEFAULT_MCP_URL,
    receipt: flags.receipt === "true",
    technicalCompilationSummary,
  };
}

export async function callMcpTool(
  request: McpCallRequest,
  io: McpCallIo = {},
): Promise<McpCallOutcome> {
  const fetchImpl = io.fetch ?? fetch;
  const now = io.now ?? (() => new Date());
  const args = applyIssuedAt(request.args, now());
  const method = "tools/call";
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      name: request.name,
      arguments: args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {
          name: CLIENT_NAME,
          version: "1",
        },
      },
    },
  };

  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        "mcp-method": method,
        "mcp-name": request.name,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return transportFailure(error);
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(await response.text());
  } catch {
    return transportFailure("MCP endpoint returned invalid JSON.");
  }
  if (!isRecord(envelope)) {
    return transportFailure(
      "MCP endpoint returned a non-object JSON-RPC envelope.",
    );
  }
  if (Object.hasOwn(envelope, "error")) {
    return { payload: envelope.error, exitCode: 1 };
  }
  if (!Object.hasOwn(envelope, "result")) {
    return transportFailure("MCP endpoint returned no JSON-RPC result or error.");
  }
  const result = envelope.result;
  const failed = isRecord(result) && result.isError === true;
  return {
    payload: printableResult(
      result,
      request.receipt === true,
      request.technicalCompilationSummary === true,
    ),
    exitCode: failed ? 1 : 0,
  };
}

export async function runMcpCall(
  argv: string[],
  io: McpCallIo = {},
): Promise<number> {
  const writeOut = io.stdout ?? ((text) => console.log(text));
  const writeErr = io.stderr ?? ((text) => console.error(text));
  let request: McpCallRequest;
  try {
    request = parseMcpCallCli(await resolveStdinArgs(argv, io));
  } catch (error) {
    writeErr(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const outcome = await callMcpTool(request, io);
  writeOut(JSON.stringify(outcome.payload, null, 2));
  return outcome.exitCode;
}

async function resolveStdinArgs(
  argv: string[],
  io: McpCallIo,
): Promise<string[]> {
  const stdinIndex = argv.indexOf("--args=-");
  if (stdinIndex < 0) return argv;
  const read = io.stdin ?? (() => new Response(Deno.stdin.readable).text());
  const resolved = [...argv];
  resolved[stdinIndex] = `--args=${await read()}`;
  return resolved;
}

function transportFailure(error: unknown): McpCallOutcome {
  return {
    payload: {
      code: "transport_failure",
      message: error instanceof Error ? error.message : String(error),
    },
    exitCode: 1,
  };
}

function hasCommandId(args: Record<string, unknown>): boolean {
  return typeof args.commandId === "string" && args.commandId.trim() !== "";
}

function firstContentText(result: Record<string, unknown>): string | undefined {
  if (!Array.isArray(result.content) || result.content.length === 0) {
    return undefined;
  }
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") {
    return undefined;
  }
  return first.text;
}

function isJsonObjectText(value: string): boolean {
  try {
    return isRecord(JSON.parse(value));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derive a bounded display-only summary from the already returned preview.
 * Unknown result shapes stay lossless: a malformed or future server response
 * must not be hidden behind a partial local interpretation.
 */
export function technicalCompilationPreviewSummary(
  structuredContent: Record<string, unknown>,
): unknown {
  const status = structuredContent.status;
  const document = structuredContent.document;
  const gaps = structuredContent.gaps;
  if (
    (status !== "unresolved" && status !== "rejected" &&
      status !== "ready-for-review") ||
    !isRecord(document) || !Array.isArray(document.diagnostics) ||
    !Array.isArray(gaps) ||
    (status === "ready-for-review" && !isRecord(structuredContent.operation))
  ) {
    return structuredContent;
  }

  return {
    schemaVersion: "technical-compilation-preview-cli-summary/1.0",
    status,
    diagnostics: summarizeDiagnostics(document.diagnostics),
    gaps: summarizeItems(gaps),
    ...(status === "ready-for-review"
      ? { nextOperation: structuredContent.operation }
      : {}),
  };
}

function summarizeDiagnostics(diagnostics: readonly unknown[]): {
  readonly total: number;
  readonly byCode: readonly { readonly code: string; readonly count: number }[];
  readonly items: readonly {
    readonly code: string;
    readonly subjectRef: string;
  }[];
  readonly omitted: number;
} {
  const byCode = new Map<string, number>();
  const items: { code: string; subjectRef: string }[] = [];
  for (const diagnostic of diagnostics) {
    if (!isRecord(diagnostic)) continue;
    const code = diagnostic.code;
    const subjectRef = diagnostic.subjectRef;
    if (typeof code !== "string" || typeof subjectRef !== "string") continue;
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
    if (items.length < TECHNICAL_COMPILATION_SUMMARY_ITEM_LIMIT) {
      items.push({ code, subjectRef });
    }
  }
  return {
    total: diagnostics.length,
    byCode: [...byCode.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => ({ code, count })),
    items,
    omitted: Math.max(0, diagnostics.length - items.length),
  };
}

function summarizeItems(items: readonly unknown[]): {
  readonly total: number;
  readonly items: readonly unknown[];
  readonly omitted: number;
} {
  const bounded = items.slice(0, TECHNICAL_COMPILATION_SUMMARY_ITEM_LIMIT);
  return {
    total: items.length,
    items: bounded,
    omitted: items.length - bounded.length,
  };
}

if (import.meta.main) {
  const exitCode = await runMcpCall(Deno.args);
  if (exitCode !== 0) {
    Deno.exit(exitCode);
  }
}
