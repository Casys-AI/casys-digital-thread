import type { ThreadGraphRef } from "./graph.ts";

export const THREAD_VIEWER_SESSIONS_SCHEMA = "thread-viewer-sessions/2.0" as const;
export const THREAD_VIEWER_SESSION_ACTION = "viewer.session.apply" as const;
export const MCP_APP_HOST_MAX_RESOURCE_BYTES = 32 * 1024 * 1024;

export type ThreadViewerSessionJson =
  | null
  | boolean
  | number
  | string
  | readonly ThreadViewerSessionJson[]
  | { readonly [key: string]: ThreadViewerSessionJson };

export interface ThreadViewerSessionsBasis {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly subjectId: string;
  readonly thread?: {
    readonly id: string;
    readonly revision: number;
  };
}

export interface ThreadViewerAppIdentity {
  /** Exact App-owned identifier from its versioned manifest. */
  readonly id: string;
  /** Exact SemVer. Tags and aliases such as `latest` are refused. */
  readonly version: string;
}

export interface ThreadViewerAppResourceIdentity {
  /** Exact App-owned `ui://` identity, never a provider endpoint. */
  readonly uri: string;
  /** Fingerprint of the exact manifest or HTML resource bytes. */
  readonly fingerprint: string;
}

export interface ThreadViewerWholeAppResourceIdentity
  extends ThreadViewerAppResourceIdentity {
  /** Only whole-App resources may replace a domain viewer in the whiteboard. */
  readonly ownership: "whole-view";
  /** Exact media type of the admitted single-file App document. */
  readonly mimeType: "text/html;profile=mcp-app";
  /** Exact admitted byte count, checked again by the browser before parsing. */
  readonly bytes: number;
}

export interface ThreadViewerAppSessionAction {
  readonly action: typeof THREAD_VIEWER_SESSION_ACTION;
  /** Exact App-owned session schema accepted by this resource. */
  readonly schema: string;
  /** App-owned, browser-safe read projection delivered unchanged by the host. */
  readonly payload: Readonly<Record<string, ThreadViewerSessionJson>>;
  /** SHA-256 of the canonical payload JSON. */
  readonly fingerprint: string;
}

/**
 * One exact same-origin byte resource admitted to the generic App host.
 *
 * The sandboxed App selects only the fingerprint. URI, media type and byte
 * ceiling stay host-owned and are reverified before any bytes cross the
 * opaque-origin iframe boundary.
 */
export interface ThreadViewerReadResource {
  readonly uri: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly fingerprint: string;
}

/**
 * Exact pending Project review before MRTR. It is documentary/provisional and
 * deliberately has no Thread identity: no canonical result exists yet.
 */
export interface ThreadViewerProjectReviewAnchor {
  readonly kind: "project-review";
  readonly id: string;
  readonly revision: number;
  readonly fingerprint: string;
}

export type ThreadViewerAnchor =
  | ThreadGraphRef
  | ThreadViewerProjectReviewAnchor;

/**
 * One whole, exact MCP App descriptor projected for the spatial whiteboard.
 *
 * Digital Thread does not implement the App, interpret its payload, select an
 * MCP server, or call a provider. `launchUri` is admitted only from an
 * out-of-band generic resolver that has verified the exact `ui://` identities
 * and fingerprints. The browser shell then owns only the bounded read-only
 * Apps lifecycle and registered session delivery.
 */
export interface ThreadViewerSession {
  readonly id: string;
  readonly kind: "mcp-app";
  readonly anchor: ThreadViewerAnchor;
  readonly app: ThreadViewerAppIdentity;
  readonly manifest: ThreadViewerAppResourceIdentity;
  readonly resource: ThreadViewerWholeAppResourceIdentity;
  /** Fetch-only root-relative URI; it is re-attested before Blob framing. */
  readonly launchUri: string;
  /** Exact host-readable resources; never provider endpoints or caller input. */
  readonly readResources: readonly ThreadViewerReadResource[];
  readonly session: ThreadViewerAppSessionAction;
}

/**
 * Explicit registration input. Its basis and graph anchor must match exactly;
 * the projector never discovers an App from a label, artifact kind, provider,
 * graph edge, or proximity.
 */
export interface ThreadViewerAppBinding
  extends Omit<ThreadViewerSession, "id" | "kind" | "launchUri"> {
  readonly basis: ThreadViewerSessionsBasis;
}

/**
 * Launch attestation returned only by a generic App-resource gateway.
 * The echoed identities prevent a resolver from substituting a lookalike App
 * or resource while selecting a browser route.
 */
export interface ThreadViewerVerifiedAppLaunch {
  readonly app: ThreadViewerAppIdentity;
  readonly manifest: ThreadViewerAppResourceIdentity;
  readonly resource: ThreadViewerWholeAppResourceIdentity;
  readonly readResources: readonly ThreadViewerReadResource[];
  readonly launchUri: string;
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
  if (!isDenseUnadornedArray(value.sessions)) return false;

  const ids = new Set<string>();
  for (const session of value.sessions) {
    if (!isThreadViewerSession(session) || ids.has(session.id)) return false;
    ids.add(session.id);
  }
  return true;
}

export function isThreadViewerAppBinding(
  value: unknown,
): value is ThreadViewerAppBinding {
  if (
    !isExactRecord(value, [
      "basis",
      "anchor",
      "app",
      "manifest",
      "resource",
      "readResources",
      "session",
    ]) ||
    !isThreadViewerSessionsBasis(value.basis)
  ) return false;
  return isThreadViewerSessionDescriptorCore(value);
}

export function isThreadViewerVerifiedAppLaunch(
  value: unknown,
): value is ThreadViewerVerifiedAppLaunch {
  return isExactRecord(value, [
    "app",
    "manifest",
    "resource",
    "readResources",
    "launchUri",
  ]) &&
    isExactRecord(value.app, ["id", "version"]) &&
    isIdentifier(value.app.id) &&
    isExactSemver(value.app.version) &&
    isThreadViewerResourceIdentity(value.manifest) &&
    isThreadViewerWholeAppResourceIdentity(value.resource) &&
    isThreadViewerReadResources(value.readResources) &&
    isSameOriginLaunchUri(value.launchUri);
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
      "app",
      "manifest",
      "resource",
      "launchUri",
      "readResources",
      "session",
    ]) ||
    !isNonEmptyString(value.id) ||
    !/^mcp-app:[a-f0-9]{64}$/.test(value.id) ||
    value.kind !== "mcp-app"
  ) return false;
  return isThreadViewerSessionDescriptor(value);
}

function isThreadViewerSessionDescriptor(
  value: Record<string, unknown>,
): boolean {
  return isThreadViewerSessionDescriptorCore(value) &&
    isSameOriginLaunchUri(value.launchUri);
}

function isThreadViewerSessionDescriptorCore(
  value: Record<string, unknown>,
): boolean {
  if (!isThreadViewerAnchor(value.anchor)) return false;
  if (
    !isExactRecord(value.app, ["id", "version"]) ||
    !isIdentifier(value.app.id) ||
    !isExactSemver(value.app.version)
  ) return false;
  if (
    !isThreadViewerResourceIdentity(value.manifest) ||
    !isThreadViewerWholeAppResourceIdentity(value.resource) ||
    !isThreadViewerReadResources(value.readResources)
  ) return false;
  if (
    !isExactRecord(value.session, [
      "action",
      "schema",
      "payload",
      "fingerprint",
    ]) ||
    value.session.action !== THREAD_VIEWER_SESSION_ACTION ||
    !isSchemaIdentity(value.session.schema) ||
    !isJsonRecord(value.session.payload) ||
    !isSha256Fingerprint(value.session.fingerprint)
  ) return false;
  return value.session.payload.schemaVersion === value.session.schema;
}

function isThreadViewerResourceIdentity(value: unknown): boolean {
  return isExactRecord(value, ["uri", "fingerprint"]) &&
    isExactUiUri(value.uri) &&
    isSha256Fingerprint(value.fingerprint);
}

function isThreadViewerWholeAppResourceIdentity(value: unknown): boolean {
  return isExactRecord(value, [
    "uri",
    "fingerprint",
    "ownership",
    "mimeType",
    "bytes",
  ]) &&
    value.ownership === "whole-view" &&
    value.mimeType === "text/html;profile=mcp-app" &&
    isNonNegativeInteger(value.bytes) &&
    value.bytes <= MCP_APP_HOST_MAX_RESOURCE_BYTES &&
    isExactUiUri(value.uri) &&
    isSha256Fingerprint(value.fingerprint);
}

function isThreadViewerReadResources(value: unknown): boolean {
  if (!isDenseUnadornedArray(value)) return false;
  const fingerprints = new Set<string>();
  for (const resource of value) {
    if (
      !isExactRecord(resource, ["uri", "mimeType", "bytes", "fingerprint"]) ||
      !isSameOriginReadResourceUri(resource.uri) ||
      !isMimeType(resource.mimeType) ||
      !isNonNegativeInteger(resource.bytes) ||
      resource.bytes > MCP_APP_HOST_MAX_RESOURCE_BYTES ||
      !isSha256Fingerprint(resource.fingerprint) ||
      fingerprints.has(resource.fingerprint)
    ) return false;
    fingerprints.add(resource.fingerprint);
  }
  return true;
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
]);

export function isThreadViewerProjectReviewAnchor(
  value: unknown,
): value is ThreadViewerProjectReviewAnchor {
  return isExactRecord(value, ["kind", "id", "revision", "fingerprint"]) &&
    value.kind === "project-review" &&
    isNonEmptyString(value.id) && value.id !== "latest" &&
    isNonNegativeInteger(value.revision) &&
    isSha256Fingerprint(value.fingerprint);
}

function isThreadViewerAnchor(value: unknown): value is ThreadViewerAnchor {
  return isThreadGraphRef(value) || isThreadViewerProjectReviewAnchor(value);
}

function isThreadGraphRef(value: unknown): value is ThreadGraphRef {
  return isExactRecord(value, ["kind", "id"]) &&
    THREAD_GRAPH_REF_KINDS.has(value.kind as ThreadGraphRef["kind"]) &&
    isNonEmptyString(value.id);
}

function isExactUiUri(value: unknown): value is string {
  return typeof value === "string" &&
    /^ui:\/\/[A-Za-z0-9][A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*$/.test(value) &&
    !containsLatestAlias(value);
}

function isSameOriginLaunchUri(value: unknown): value is string {
  if (
    typeof value !== "string" || !value.startsWith("/") ||
    value.startsWith("//") || value.includes("\\") || value.includes("#") ||
    value.includes("?") || containsLatestAlias(value)
  ) return false;
  try {
    const base = new URL("https://workbench.invalid/");
    const target = new URL(value, base);
    return target.origin === base.origin && target.username === "" &&
      target.password === "" && target.pathname.startsWith("/");
  } catch {
    return false;
  }
}

function isSameOriginReadResourceUri(value: unknown): value is string {
  return typeof value === "string" &&
    /^\/api\/thread\/viewer-apps\/resources\/[a-f0-9]{64}$/.test(value);
}

function isMimeType(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(
      value,
    );
}

function containsLatestAlias(value: string): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return true;
  }
  return /(?:^|[/:?&#=._-])latest(?:$|[/:?&#=._-])/i.test(decoded);
}

function isExactSemver(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const numeric = "(?:0|[1-9]\\d*)";
  const prerelease =
    "(?:(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*)";
  const build = "(?:[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)";
  return new RegExp(
    `^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease})?(?:\\+${build})?$`,
  ).test(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

function isSchemaIdentity(value: unknown): value is string {
  return isIdentifier(value) && /\/\d+\.\d+(?:\.\d+)?$/.test(value);
}

function isSha256Fingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isJsonRecord(
  value: unknown,
): value is Readonly<Record<string, ThreadViewerSessionJson>> {
  return isRecord(value) && isJsonValue(value);
}

function isJsonValue(value: unknown): value is ThreadViewerSessionJson {
  if (
    value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return true;
  if (Array.isArray(value)) {
    return isDenseUnadornedArray(value) && value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/**
 * Admit only ordinary dense arrays whose own keys are exactly `length` and
 * every numeric index. This stays local to the viewer-session boundary so
 * historical deterministic JSON fingerprints elsewhere are not changed.
 */
export function isDenseUnadornedArray(
  value: unknown,
): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
      return false;
    }
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
  const expected = [...keys].toSorted();
  const actual = Object.keys(value).toSorted();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}
