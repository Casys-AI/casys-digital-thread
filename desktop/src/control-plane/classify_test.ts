import { assertEquals } from "jsr:@std/assert@1.0.14";
import { fail, ok } from "../host/result.ts";
import type { HostResult } from "../host/result.ts";
import { classifyControlPlaneAggregate, classifyOwnership } from "./classify.ts";
import {
  CONTROL_PLANE_INSPECT_SCHEMA,
  CONTROL_PLANE_LIFECYCLE_SCHEMA,
  CONTROL_PLANE_MARKER_SCHEMA,
  CONTROL_PLANE_MCP_URL,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
  type ControlPlaneInspectDocument,
} from "./contracts.ts";

const DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_DIGEST =
  "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";
const EXPECTED = {
  productIdentifier: "ai.casys.digital-thread" as const,
  productVersion: CONTROL_PLANE_PRODUCT_VERSION,
  serverName: "casys-digital-thread-console" as const,
  serverVersion: CONTROL_PLANE_SERVER_VERSION,
  configDigest: DIGEST,
};

const MARKER = {
  schema: CONTROL_PLANE_MARKER_SCHEMA,
  productVersion: CONTROL_PLANE_PRODUCT_VERSION,
  serverVersion: CONTROL_PLANE_SERVER_VERSION,
  launchId: LAUNCH_ID,
  pid: 4242,
  endpoint: CONTROL_PLANE_MCP_URL,
  configDigest: DIGEST,
  startedAt: "2026-08-22T10:00:00Z",
} as const;

const LIFECYCLE = {
  schema: CONTROL_PLANE_LIFECYCLE_SCHEMA,
  productVersion: CONTROL_PLANE_PRODUCT_VERSION,
  serverVersion: CONTROL_PLANE_SERVER_VERSION,
  launchId: LAUNCH_ID,
  configDigest: DIGEST,
} as const;

function inspect(
  overrides: Partial<{
    configuration: "verified" | "missing" | "mismatch" | "error";
    marker: typeof MARKER | null;
    lock: "held" | "free" | "unavailable";
  }> = {},
): HostResult<ControlPlaneInspectDocument> {
  return ok({
    schema: CONTROL_PLANE_INSPECT_SCHEMA,
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    expectedConfigDigest: DIGEST,
    configuration: "verified" as const,
    marker: null,
    lock: "free" as const,
    ...overrides,
  });
}

Deno.test("classifyOwnership accepts absence only after connection refusal and a free empty inspect", () => {
  const result = classifyOwnership({
    listener: "absent",
    inspect: inspect({ configuration: "missing" }),
    lifecycle: null,
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(result.kind, "absent");
});

Deno.test("classifyOwnership is owned only with matching handle, launch, marker, lock, and lifecycle", () => {
  const result = classifyOwnership({
    listener: "exact",
    inspect: inspect({ marker: MARKER, lock: "held" }),
    lifecycle: ok(LIFECYCLE),
    expected: EXPECTED,
    mintedLaunchId: LAUNCH_ID,
    hasOwnedHandle: true,
  });
  assertEquals(result.kind, "owned");
});

Deno.test("classifyOwnership reconnects an exact process without adopting its handle", () => {
  const result = classifyOwnership({
    listener: "exact",
    inspect: inspect({ marker: MARKER, lock: "held" }),
    lifecycle: ok(LIFECYCLE),
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(result.kind, "reconnected");
  assertEquals(result.recovery, undefined);
});

Deno.test("classifyOwnership fails closed for foreign, timed out, and stale states", () => {
  const foreign = classifyOwnership({
    listener: "exact",
    inspect: inspect(),
    lifecycle: ok(LIFECYCLE),
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(foreign.kind, "foreign");
  assertEquals(foreign.recoveryCode, "foreign-listener");

  const timeout = classifyOwnership({
    listener: "ambiguous",
    inspect: inspect(),
    lifecycle: fail("probe.timeout", "timeout", "recover"),
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(timeout.kind, "ambiguous");
  assertEquals(timeout.recoveryCode, "probe-failed");

  const stale = classifyOwnership({
    listener: "absent",
    inspect: inspect({ marker: MARKER, lock: "held" }),
    lifecycle: null,
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(stale.kind, "stale");
  assertEquals(stale.recoveryCode, "marker-invalid");
});

Deno.test("classifyOwnership rejects digest and configuration mismatches", () => {
  const mismatchedInspect: HostResult<ControlPlaneInspectDocument> = ok({
    schema: CONTROL_PLANE_INSPECT_SCHEMA,
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    expectedConfigDigest: OTHER_DIGEST,
    configuration: "verified" as const,
    marker: null,
    lock: "free" as const,
  });
  const digest = classifyOwnership({
    listener: "absent",
    inspect: mismatchedInspect,
    lifecycle: null,
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(digest.kind, "mismatch");
  assertEquals(digest.recoveryCode, "config-mismatch");

  const configuration = classifyOwnership({
    listener: "absent",
    inspect: inspect({ configuration: "mismatch" }),
    lifecycle: null,
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(configuration.kind, "mismatch");
});

Deno.test("classifyOwnership rejects an invalid inspect document before listener inference", () => {
  const result = classifyOwnership({
    listener: "absent",
    inspect: fail("inspect.corrupt", "corrupt", "recover"),
    lifecycle: null,
    expected: EXPECTED,
    hasOwnedHandle: false,
  });
  assertEquals(result.kind, "ambiguous");
  assertEquals(result.recoveryCode, "marker-invalid");
});

Deno.test("classifyControlPlaneAggregate degrades unavailable components and fails on error", () => {
  assertEquals(
    classifyControlPlaneAggregate("ready", "ready", "unavailable", "unresolved"),
    "degraded",
  );
  assertEquals(
    classifyControlPlaneAggregate("ready", "error", "unavailable", "unavailable"),
    "recovery-required",
  );
  assertEquals(
    classifyControlPlaneAggregate("ready", "ready", "ready", "ready"),
    "ready",
  );
});
