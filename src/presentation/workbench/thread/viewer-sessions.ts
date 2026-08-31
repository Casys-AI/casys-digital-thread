import type { ThreadAnalysisSemanticRef, ThreadGraphRef } from "./graph.ts";

export const THREAD_VIEWER_SESSIONS_SCHEMA = "thread-viewer-sessions/1.0" as const;

export interface ThreadViewerSessionsBasis {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly subjectId: string;
  readonly thread?: {
    readonly id: string;
    readonly revision: number;
  };
}

export type ThreadViewerSemanticSelection =
  | {
    readonly status: "available";
    readonly semanticRef: ThreadAnalysisSemanticRef;
  }
  | {
    readonly status: "unresolved";
    readonly reason: "correspondence-not-recorded";
  }
  | {
    readonly status: "unavailable";
    readonly reason: "viewer-selection-not-supported";
  };

/**
 * One exact, browser-safe viewer session projected from recorded Thread facts.
 *
 * V1 deliberately names only the native content-addressed GLB viewer. Provider
 * MCP Apps become additional kinds only after their resource, result contract
 * and Thread join are registered; a fleet entry or provider label is not one.
 */
export interface ThreadViewerSession {
  readonly id: string;
  readonly kind: "native-cad-glb";
  readonly anchor: ThreadGraphRef;
  readonly asset: {
    readonly id: string;
    readonly uri: string;
    readonly fingerprint: string;
  };
  readonly semanticSelection: ThreadViewerSemanticSelection;
}

/** Complete replacement projection; SSE never sends partial patches. */
export interface ThreadViewerSessionsProjection {
  readonly schemaVersion: typeof THREAD_VIEWER_SESSIONS_SCHEMA;
  readonly basis: ThreadViewerSessionsBasis;
  /** Monotonic within this exact basis; used by SSE consumers. */
  readonly sequence: number;
  readonly projectionFingerprint: string;
  readonly sessions: readonly ThreadViewerSession[];
}

export function isThreadViewerSessionsProjection(
  value: unknown,
): value is ThreadViewerSessionsProjection {
  if (
    !isExactRecord(value, [
      "schemaVersion",
      "basis",
      "sequence",
      "projectionFingerprint",
      "sessions",
    ])
  ) return false;
  if (value.schemaVersion !== THREAD_VIEWER_SESSIONS_SCHEMA) return false;
  if (!isThreadViewerSessionsBasis(value.basis)) return false;
  if (!isNonNegativeInteger(value.sequence)) return false;
  if (!isSha256Fingerprint(value.projectionFingerprint)) return false;
  if (!Array.isArray(value.sessions)) return false;

  const ids = new Set<string>();
  for (const session of value.sessions) {
    if (!isThreadViewerSession(session) || ids.has(session.id)) return false;
    ids.add(session.id);
  }
  return true;
}

function isThreadViewerSessionsBasis(
  value: unknown,
): value is ThreadViewerSessionsBasis {
  if (!isRecord(value)) return false;
  const keys = value.thread === undefined
    ? ["projectId", "projectRevision", "subjectId"]
    : ["projectId", "projectRevision", "subjectId", "thread"];
  if (!hasExactKeys(value, keys)) return false;
  if (
    !isNonEmptyString(value.projectId) ||
    !isNonNegativeInteger(value.projectRevision) ||
    !isNonEmptyString(value.subjectId)
  ) return false;
  return value.thread === undefined || (
    isExactRecord(value.thread, ["id", "revision"]) &&
    isNonEmptyString(value.thread.id) &&
    isNonNegativeInteger(value.thread.revision)
  );
}

function isThreadViewerSession(value: unknown): value is ThreadViewerSession {
  if (
    !isExactRecord(value, [
      "id",
      "kind",
      "anchor",
      "asset",
      "semanticSelection",
    ])
  ) return false;
  if (!isNonEmptyString(value.id) || value.kind !== "native-cad-glb") {
    return false;
  }
  if (!isThreadGraphRef(value.anchor)) return false;
  if (!isExactRecord(value.asset, ["id", "uri", "fingerprint"])) {
    return false;
  }
  if (
    !isNonEmptyString(value.asset.id) ||
    !isSha256Fingerprint(value.asset.fingerprint)
  ) return false;
  const digest = value.asset.fingerprint.slice("sha256:".length);
  if (value.asset.uri !== `/api/thread/assets/${digest}.glb`) return false;
  return isThreadViewerSemanticSelection(value.semanticSelection);
}

function isThreadViewerSemanticSelection(
  value: unknown,
): value is ThreadViewerSemanticSelection {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "available") {
    return hasExactKeys(value, ["status", "semanticRef"]) &&
      isThreadAnalysisSemanticRef(value.semanticRef);
  }
  if (value.status === "unresolved") {
    return hasExactKeys(value, ["status", "reason"]) &&
      value.reason === "correspondence-not-recorded";
  }
  return value.status === "unavailable" &&
    hasExactKeys(value, ["status", "reason"]) &&
    value.reason === "viewer-selection-not-supported";
}

const THREAD_GRAPH_REF_KINDS = new Set<ThreadGraphRef["kind"]>([
  "artifact",
  "consumption",
  "observation",
  "requirement",
  "evaluation",
  "violation",
  "change",
  "action",
  "analysis-node",
  "part-definition",
  "part-usage",
  "attribute-usage",
  "cad-lever",
  "cad-unnamed-literal",
  "source-file",
]);

function isThreadGraphRef(value: unknown): value is ThreadGraphRef {
  return isExactRecord(value, ["kind", "id"]) &&
    THREAD_GRAPH_REF_KINDS.has(value.kind as ThreadGraphRef["kind"]) &&
    isNonEmptyString(value.id);
}

const SEMANTIC_DOMAINS = new Set<ThreadAnalysisSemanticRef["domain"]>([
  "brief",
  "sysml",
  "cad",
  "modelica",
  "calculix",
  "thread",
]);

function isThreadAnalysisSemanticRef(
  value: unknown,
): value is ThreadAnalysisSemanticRef {
  if (!isRecord(value)) return false;
  const keys = value.basisFingerprint === undefined
    ? ["domain", "kind", "id"]
    : ["domain", "kind", "id", "basisFingerprint"];
  return hasExactKeys(value, keys) &&
    SEMANTIC_DOMAINS.has(
      value.domain as ThreadAnalysisSemanticRef["domain"],
    ) &&
    isNonEmptyString(value.kind) &&
    isNonEmptyString(value.id) &&
    (value.basisFingerprint === undefined ||
      isSha256Digest(value.basisFingerprint));
}

function isSha256Fingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).toSorted();
  return actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].toSorted()[index]);
}
