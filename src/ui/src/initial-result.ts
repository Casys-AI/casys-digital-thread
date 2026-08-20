import type { ConsoleSnapshot } from "../../application/control-plane/read-model/console-snapshot.ts";

/** Minimal shape of the MCP Apps result notification delivered by a host. */
export interface InitialToolResult {
  readonly isError?: boolean;
  readonly content?: readonly unknown[];
  readonly structuredContent?: unknown;
}

function isConsoleSnapshot(value: unknown): value is ConsoleSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConsoleSnapshot>;
  return candidate.schemaVersion === "2.0" &&
    typeof candidate.generatedAt === "string" &&
    !!candidate.fleet &&
    Array.isArray(candidate.fleet.servers) &&
    !!candidate.runs &&
    Array.isArray(candidate.runs.items);
}

export function toolResultErrorMessage(
  result: InitialToolResult,
): string | undefined {
  if (!Array.isArray(result.content)) return undefined;
  const messages = result.content.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const block = entry as { type?: unknown; text?: unknown };
    return block.type === "text" && typeof block.text === "string"
      ? [block.text]
      : [];
  });
  return messages.length > 0 ? messages.join(" ") : undefined;
}

/**
 * Narrow the host's initiating `console_snapshot` result. The viewer trusts
 * only structured content: text is retained exclusively for a tool error.
 */
export function initialSnapshotFromResult(
  result: InitialToolResult,
): ConsoleSnapshot {
  if (result.isError) {
    throw new Error(
      toolResultErrorMessage(result) ??
        "The control-plane tool returned an error.",
    );
  }
  if (!isConsoleSnapshot(result.structuredContent)) {
    throw new Error(
      "console_snapshot returned an unsupported structuredContent contract.",
    );
  }
  return result.structuredContent;
}
