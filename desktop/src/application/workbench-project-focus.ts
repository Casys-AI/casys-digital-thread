import { ENGINEERING_WORKBENCH_SCHEMA } from "../../../src/presentation/workbench/engineering/schema.ts";
import { parseCasysProjectId } from "../../../src/presentation/desktop/chat/contracts.ts";
import type { DesktopChatProjectFocusAuthority } from "../chat/bindings.ts";
import {
  WORKBENCH_ACCESS_HEADER,
  type WorkbenchSession,
} from "../workbench/contracts.ts";

const DEFAULT_FOCUS_TIMEOUT_MS = 2_000;
const WORKBENCH_SNAPSHOT_PATH = "/api/thread/workbench";

export interface WorkbenchProjectFocusOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Reads the current durable Workbench focus through its private host session.
 * Transport, absence, non-200, and malformed projections all fail closed.
 */
export function createWorkbenchProjectFocusAuthority(
  session: WorkbenchSession,
  options: WorkbenchProjectFocusOptions = {},
): DesktopChatProjectFocusAuthority {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_FOCUS_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new TypeError("Workbench project focus timeout is invalid");
  }
  return Object.freeze({
    async currentProjectId(): Promise<string | undefined> {
      try {
        const response = await fetchImpl(
          new URL(WORKBENCH_SNAPSHOT_PATH, session.origin),
          {
            method: "GET",
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              Accept: "application/json",
              [WORKBENCH_ACCESS_HEADER]: session.accessToken,
            },
          },
        );
        if (!response.ok) return undefined;
        return parseFocusedProjectId(await response.json());
      } catch {
        return undefined;
      }
    },
  });
}

export function parseFocusedProjectId(value: unknown): string {
  const snapshot = record(value, "Workbench snapshot");
  if (
    snapshot.schemaVersion !== ENGINEERING_WORKBENCH_SCHEMA ||
    (snapshot.surface !== "planning" && snapshot.surface !== "documentary" &&
      snapshot.surface !== "evidence")
  ) {
    throw new TypeError("Workbench snapshot authority is invalid");
  }
  const projectSnapshot = record(snapshot.project, "Workbench project snapshot");
  const project = record(projectSnapshot.project, "Workbench focused project");
  return parseCasysProjectId(project.id);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}
