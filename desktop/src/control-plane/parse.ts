import {
  CONFIG_DIGEST_PATTERN,
  CONTROL_PLANE_HANDSHAKE_SCHEMA,
  CONTROL_PLANE_INSPECT_SCHEMA,
  CONTROL_PLANE_LIFECYCLE_SCHEMA,
  CONTROL_PLANE_MARKER_SCHEMA,
  CONTROL_PLANE_MCP_URL,
  CONTROL_PLANE_SERVER_NAME,
  type ControlPlaneHandshake,
  type ControlPlaneHealthDocument,
  type ControlPlaneInspectDocument,
  type ControlPlaneLifecycleIdentity,
  type ControlPlaneMarker,
  EXACT_VERSION_PATTERN,
  type ExpectedControlPlaneIdentity,
  type ExpectedLiveControlPlaneIdentity,
  HANDSHAKE_MAX_BYTES,
  HANDSHAKE_RECOVERY,
  HANDSHAKE_TIMEOUT_MS,
  INSPECT_RECOVERY,
  type InspectLockState,
  LAUNCH_ID_PATTERN,
  MARKER_RECOVERY,
  PROBE_RECOVERY,
  STARTED_AT_PATTERN,
  VERSION_ALIASES,
} from "./contracts.ts";
import { fail, type HostResult, ok } from "../host/result.ts";

const MARKER_KEYS = [
  "schema",
  "productVersion",
  "serverVersion",
  "launchId",
  "pid",
  "endpoint",
  "configDigest",
  "startedAt",
] as const;

const HANDSHAKE_KEYS = [
  "schema",
  "status",
  "productVersion",
  "serverVersion",
  "launchId",
  "configDigest",
] as const;
const INSPECT_KEYS = [
  "schema",
  "productVersion",
  "serverVersion",
  "expectedConfigDigest",
  "configuration",
  "marker",
  "lock",
] as const;
const LIFECYCLE_KEYS = [
  "schema",
  "productVersion",
  "serverVersion",
  "launchId",
  "configDigest",
] as const;
const HEALTH_KEYS = ["status", "server", "version"] as const;
const LOCK_STATES: readonly InspectLockState[] = [
  "held",
  "free",
  "unavailable",
];
const CONFIGURATION_STATES = [
  "verified",
  "missing",
  "mismatch",
  "error",
] as const;

export function parseJsonDocument(
  text: string,
  path: string,
  recovery: string,
): HostResult<unknown> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return fail(`${codePrefix(path)}.empty`, `${path} is empty`, recovery);
  }
  try {
    return ok(JSON.parse(trimmed) as unknown);
  } catch {
    return fail(
      `${codePrefix(path)}.corrupt`,
      `${path} is not strictly JSON`,
      recovery,
    );
  }
}

export function parseMarker(value: unknown): HostResult<ControlPlaneMarker> {
  const record = exactRecord(value, MARKER_KEYS, "marker", MARKER_RECOVERY);
  if (!record.ok) return record;

  if (record.value.schema !== CONTROL_PLANE_MARKER_SCHEMA) {
    return fail(
      "marker.schema-invalid",
      `marker.schema must be ${CONTROL_PLANE_MARKER_SCHEMA}`,
      MARKER_RECOVERY,
    );
  }

  const productVersion = exactVersion(
    record.value.productVersion,
    "marker.productVersion",
    "marker",
    MARKER_RECOVERY,
  );
  if (!productVersion.ok) return productVersion;

  const serverVersion = exactVersion(
    record.value.serverVersion,
    "marker.serverVersion",
    "marker",
    MARKER_RECOVERY,
  );
  if (!serverVersion.ok) return serverVersion;

  const launchId = exactLaunchId(
    record.value.launchId,
    "marker.launchId",
    "marker",
    MARKER_RECOVERY,
  );
  if (!launchId.ok) return launchId;

  const pid = exactPid(record.value.pid);
  if (!pid.ok) return pid;

  if (record.value.endpoint !== CONTROL_PLANE_MCP_URL) {
    return fail(
      "marker.endpoint-invalid",
      "marker.endpoint must be the exact Desktop-owned loopback MCP URL",
      MARKER_RECOVERY,
    );
  }

  const configDigest = exactDigest(
    record.value.configDigest,
    "marker.configDigest",
    "marker",
    MARKER_RECOVERY,
  );
  if (!configDigest.ok) return configDigest;

  const startedAt = exactStartedAt(record.value.startedAt);
  if (!startedAt.ok) return startedAt;

  return ok(deepFreeze({
    schema: CONTROL_PLANE_MARKER_SCHEMA,
    productVersion: productVersion.value,
    serverVersion: serverVersion.value,
    launchId: launchId.value,
    pid: pid.value,
    endpoint: CONTROL_PLANE_MCP_URL,
    configDigest: configDigest.value,
    startedAt: startedAt.value,
  }));
}

export function parseInspect(
  value: unknown,
): HostResult<ControlPlaneInspectDocument> {
  const record = exactRecord(value, INSPECT_KEYS, "inspect", INSPECT_RECOVERY);
  if (!record.ok) return record;

  if (record.value.schema !== CONTROL_PLANE_INSPECT_SCHEMA) {
    return fail(
      "inspect.schema-invalid",
      `inspect.schema must be ${CONTROL_PLANE_INSPECT_SCHEMA}`,
      INSPECT_RECOVERY,
    );
  }

  const productVersion = exactVersion(
    record.value.productVersion,
    "inspect.productVersion",
    "inspect",
    INSPECT_RECOVERY,
  );
  if (!productVersion.ok) return productVersion;

  const serverVersion = exactVersion(
    record.value.serverVersion,
    "inspect.serverVersion",
    "inspect",
    INSPECT_RECOVERY,
  );
  if (!serverVersion.ok) return serverVersion;

  const expectedConfigDigest = exactDigest(
    record.value.expectedConfigDigest,
    "inspect.expectedConfigDigest",
    "inspect",
    INSPECT_RECOVERY,
  );
  if (!expectedConfigDigest.ok) return expectedConfigDigest;

  if (!isConfigurationState(record.value.configuration)) {
    return fail(
      "inspect.configuration-invalid",
      "inspect.configuration must be verified, missing, mismatch, or error",
      INSPECT_RECOVERY,
    );
  }

  if (!isLockState(record.value.lock)) {
    return fail(
      "inspect.lock-invalid",
      'inspect.lock must be "held", "free", or "unavailable"',
      INSPECT_RECOVERY,
    );
  }

  if ("stop" in record.value || "pid" in record.value) {
    return fail(
      "inspect.mode-invalid",
      "inspect must not expose a stop-by-pid mode",
      INSPECT_RECOVERY,
    );
  }

  if (record.value.marker === null) {
    return ok(deepFreeze({
      schema: CONTROL_PLANE_INSPECT_SCHEMA,
      productVersion: productVersion.value,
      serverVersion: serverVersion.value,
      expectedConfigDigest: expectedConfigDigest.value,
      configuration: record.value.configuration,
      marker: null,
      lock: record.value.lock,
    }));
  }

  const marker = parseMarker(record.value.marker);
  if (!marker.ok) return marker;

  return ok(deepFreeze({
    schema: CONTROL_PLANE_INSPECT_SCHEMA,
    productVersion: productVersion.value,
    serverVersion: serverVersion.value,
    expectedConfigDigest: expectedConfigDigest.value,
    configuration: record.value.configuration,
    marker: marker.value,
    lock: record.value.lock,
  }));
}

export function parseInspectText(
  text: string,
): HostResult<ControlPlaneInspectDocument> {
  const document = parseJsonDocument(text, "inspect", INSPECT_RECOVERY);
  if (!document.ok) return document;
  return parseInspect(document.value);
}

export function parseHandshake(
  value: unknown,
  expected:
    & Pick<
      ExpectedLiveControlPlaneIdentity,
      "productVersion" | "serverVersion" | "configDigest"
    >
    & {
      readonly launchId: string;
    },
): HostResult<ControlPlaneHandshake> {
  const record = exactRecord(
    value,
    HANDSHAKE_KEYS,
    "handshake",
    HANDSHAKE_RECOVERY,
  );
  if (!record.ok) return record;

  if (record.value.schema !== CONTROL_PLANE_HANDSHAKE_SCHEMA) {
    return fail(
      "handshake.schema-invalid",
      `handshake.schema must be ${CONTROL_PLANE_HANDSHAKE_SCHEMA}`,
      HANDSHAKE_RECOVERY,
    );
  }

  if (record.value.status !== "ready") {
    return fail(
      "handshake.status-invalid",
      'handshake.status must be "ready"',
      HANDSHAKE_RECOVERY,
    );
  }

  const productVersion = exactVersion(
    record.value.productVersion,
    "handshake.productVersion",
    "handshake",
    HANDSHAKE_RECOVERY,
  );
  if (!productVersion.ok) return productVersion;

  const serverVersion = exactVersion(
    record.value.serverVersion,
    "handshake.serverVersion",
    "handshake",
    HANDSHAKE_RECOVERY,
  );
  if (!serverVersion.ok) return serverVersion;

  const launchId = exactLaunchId(
    record.value.launchId,
    "handshake.launchId",
    "handshake",
    HANDSHAKE_RECOVERY,
  );
  if (!launchId.ok) return launchId;

  const configDigest = exactDigest(
    record.value.configDigest,
    "handshake.configDigest",
    "handshake",
    HANDSHAKE_RECOVERY,
  );
  if (!configDigest.ok) return configDigest;

  if (productVersion.value !== expected.productVersion) {
    return fail(
      "handshake.mismatch",
      "handshake.productVersion does not match the expected product version",
      HANDSHAKE_RECOVERY,
    );
  }
  if (serverVersion.value !== expected.serverVersion) {
    return fail(
      "handshake.mismatch",
      "handshake.serverVersion does not match the expected server version",
      HANDSHAKE_RECOVERY,
    );
  }
  if (launchId.value !== expected.launchId) {
    return fail(
      "handshake.mismatch",
      "handshake.launchId does not echo the expected launch id",
      HANDSHAKE_RECOVERY,
    );
  }
  if (configDigest.value !== expected.configDigest) {
    return fail(
      "handshake.mismatch",
      "handshake.configDigest does not echo the expected config digest",
      HANDSHAKE_RECOVERY,
    );
  }

  return ok(deepFreeze({
    schema: CONTROL_PLANE_HANDSHAKE_SCHEMA,
    status: "ready",
    productVersion: productVersion.value,
    serverVersion: serverVersion.value,
    launchId: launchId.value,
    configDigest: configDigest.value,
  }));
}

export function parseHandshakeText(
  text: string,
  expected:
    & Pick<
      ExpectedLiveControlPlaneIdentity,
      "productVersion" | "serverVersion" | "configDigest"
    >
    & {
      readonly launchId: string;
    },
): HostResult<ControlPlaneHandshake> {
  if (new TextEncoder().encode(text).length > HANDSHAKE_MAX_BYTES) {
    return fail(
      "handshake.oversized",
      "handshake exceeds the bounded stdout budget",
      HANDSHAKE_RECOVERY,
    );
  }
  const document = parseJsonDocument(text, "handshake", HANDSHAKE_RECOVERY);
  if (!document.ok) return document;
  return parseHandshake(document.value, expected);
}

export async function readBoundedHandshakeText(
  stream: ReadableStream<Uint8Array>,
  options: {
    readonly maxBytes?: number;
    readonly timeoutMs?: number;
  } = {},
): Promise<HostResult<string>> {
  const maxBytes = options.maxBytes ?? HANDSHAKE_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    while (size <= maxBytes) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === "timeout") {
        return fail(
          "handshake.timeout",
          "handshake was not received before the readiness timeout",
          HANDSHAKE_RECOVERY,
        );
      }
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        return fail(
          "handshake.oversized",
          "handshake exceeds the bounded stdout budget",
          HANDSHAKE_RECOVERY,
        );
      }
      chunks.push(next.value);
      const text = decodeUtf8(chunks);
      if (text === undefined) continue;
      const trimmed = text.trim();
      if (trimmed.length === 0) continue;
      try {
        JSON.parse(trimmed);
        return ok(trimmed);
      } catch {
        // Incomplete JSON still being streamed.
      }
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      // Already released.
    }
  }

  if (size > maxBytes) {
    return fail(
      "handshake.oversized",
      "handshake exceeds the bounded stdout budget",
      HANDSHAKE_RECOVERY,
    );
  }
  const text = decodeUtf8(chunks);
  if (text === undefined || text.trim().length === 0) {
    return fail(
      "handshake.empty",
      "handshake stdout was empty",
      HANDSHAKE_RECOVERY,
    );
  }
  return ok(text.trim());
}

export function parseLifecycleIdentity(
  value: unknown,
): HostResult<ControlPlaneLifecycleIdentity> {
  const record = exactRecord(
    value,
    LIFECYCLE_KEYS,
    "lifecycle",
    PROBE_RECOVERY,
  );
  if (!record.ok) return record;

  if (record.value.schema !== CONTROL_PLANE_LIFECYCLE_SCHEMA) {
    return fail(
      "lifecycle.schema-invalid",
      `lifecycle.schema must be ${CONTROL_PLANE_LIFECYCLE_SCHEMA}`,
      PROBE_RECOVERY,
    );
  }

  const productVersion = exactVersion(
    record.value.productVersion,
    "lifecycle.productVersion",
    "lifecycle",
    PROBE_RECOVERY,
  );
  if (!productVersion.ok) return productVersion;

  const serverVersion = exactVersion(
    record.value.serverVersion,
    "lifecycle.serverVersion",
    "lifecycle",
    PROBE_RECOVERY,
  );
  if (!serverVersion.ok) return serverVersion;

  const launchId = exactLaunchId(
    record.value.launchId,
    "lifecycle.launchId",
    "lifecycle",
    PROBE_RECOVERY,
  );
  if (!launchId.ok) return launchId;

  const configDigest = exactDigest(
    record.value.configDigest,
    "lifecycle.configDigest",
    "lifecycle",
    PROBE_RECOVERY,
  );
  if (!configDigest.ok) return configDigest;

  return ok(deepFreeze({
    schema: CONTROL_PLANE_LIFECYCLE_SCHEMA,
    productVersion: productVersion.value,
    serverVersion: serverVersion.value,
    launchId: launchId.value,
    configDigest: configDigest.value,
  }));
}

export function parseHealthDocument(
  value: unknown,
  expected: ExpectedControlPlaneIdentity,
): HostResult<ControlPlaneHealthDocument> {
  const record = exactRecord(value, HEALTH_KEYS, "health", PROBE_RECOVERY);
  if (!record.ok) return record;

  if (record.value.status !== "ok") {
    return fail(
      "health.status-invalid",
      'health.status must be "ok"',
      PROBE_RECOVERY,
    );
  }
  if (record.value.server !== CONTROL_PLANE_SERVER_NAME) {
    return fail(
      "health.server-invalid",
      "health.server must be the exact Desktop control-plane server name",
      PROBE_RECOVERY,
    );
  }
  const version = exactVersion(
    record.value.version,
    "health.version",
    "health",
    PROBE_RECOVERY,
  );
  if (!version.ok) return version;
  if (version.value !== expected.serverVersion) {
    return fail(
      "health.mismatch",
      "health.version does not match the expected server version",
      PROBE_RECOVERY,
    );
  }

  return ok(deepFreeze({
    status: "ok",
    server: CONTROL_PLANE_SERVER_NAME,
    version: version.value,
  }));
}

export function parseConfigDigest(
  value: unknown,
  path: string,
): HostResult<string> {
  return exactDigest(value, path, "config", MARKER_RECOVERY);
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
  recovery: string,
): HostResult<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      `${codePrefix(path)}.schema-invalid`,
      `${path} must be an object`,
      recovery,
    );
  }
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      return fail(
        `${codePrefix(path)}.schema-invalid`,
        `${path} has unsupported field ${key}`,
        recovery,
      );
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) {
      return fail(
        `${codePrefix(path)}.schema-invalid`,
        `${path}.${key} is required`,
        recovery,
      );
    }
  }
  return ok(record);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const item of value) deepFreeze(item);
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) {
        deepFreeze(item);
      }
    }
  }
  return value;
}

function exactVersion(
  value: unknown,
  path: string,
  code: string,
  recovery: string,
): HostResult<string> {
  if (typeof value === "string" && isVersionAlias(value)) {
    return fail(
      `${code}.version-alias`,
      `${path} must not be the alias ${value.toLowerCase()}`,
      recovery,
    );
  }
  if (typeof value !== "string" || !EXACT_VERSION_PATTERN.test(value)) {
    return fail(
      `${code}.version-invalid`,
      `${path} must be an exact MAJOR.MINOR.PATCH version`,
      recovery,
    );
  }
  return ok(value);
}

function exactLaunchId(
  value: unknown,
  path: string,
  code: string,
  recovery: string,
): HostResult<string> {
  if (typeof value !== "string" || !LAUNCH_ID_PATTERN.test(value)) {
    return fail(
      `${code}.launch-id-invalid`,
      `${path} must be a lowercase UUID v4`,
      recovery,
    );
  }
  return ok(value);
}

function exactDigest(
  value: unknown,
  path: string,
  code: string,
  recovery: string,
): HostResult<string> {
  if (typeof value !== "string" || !CONFIG_DIGEST_PATTERN.test(value)) {
    return fail(
      `${code}.digest-invalid`,
      `${path} must be a sha256: hex digest`,
      recovery,
    );
  }
  return ok(value);
}

function exactPid(value: unknown): HostResult<number> {
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < 1 ||
    !Number.isSafeInteger(value)
  ) {
    return fail(
      "marker.pid-invalid",
      "marker.pid must be a positive integer",
      MARKER_RECOVERY,
    );
  }
  return ok(value);
}

function exactStartedAt(value: unknown): HostResult<string> {
  if (typeof value !== "string" || !STARTED_AT_PATTERN.test(value)) {
    return fail(
      "marker.started-at-invalid",
      "marker.startedAt must be an exact UTC ISO-8601 timestamp",
      MARKER_RECOVERY,
    );
  }
  return ok(value);
}

function isLockState(value: unknown): value is InspectLockState {
  return (LOCK_STATES as readonly unknown[]).includes(value);
}

function isConfigurationState(
  value: unknown,
): value is (typeof CONFIGURATION_STATES)[number] {
  return (CONFIGURATION_STATES as readonly unknown[]).includes(value);
}

function isVersionAlias(value: string): boolean {
  return (VERSION_ALIASES as readonly string[]).includes(value.toLowerCase());
}

function codePrefix(path: string): string {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot);
}

function decodeUtf8(chunks: readonly Uint8Array[]): string | undefined {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
