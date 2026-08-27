import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import { OWNERSHIP_RECOVERY } from "./contracts.ts";
import {
  buildRendererObservation,
  sanitizeText,
  toDesktopControlPlaneProjection,
} from "./observations.ts";
import {
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
} from "./contracts.ts";

Deno.test("buildRendererObservation keeps four separate observations and degrades when providers are unavailable", () => {
  const observation = buildRendererObservation({
    configuration: { state: "verified", expectedDigest: "sha256:00" },
    ownership: {
      kind: "owned",
      reason: "owned child",
    },
    providers: {
      fleetStatus: "unavailable",
      healthy: 0,
      total: 3,
      drift: 0,
      runCount: 0,
      demoRunCount: 0,
    },
  });
  assertEquals(observation.status, "degraded");
  assertEquals(observation.controlPlane.state, "ready");
  assertEquals(observation.providers.state, "unavailable");
  assertEquals(observation.projectEvidence.state, "unavailable");
  assertEquals(observation.configuration.state, "ready");
  assertEquals(
    observation.projectEvidence.evidence.includes("Directory existence is not proof"),
    true,
  );
});

Deno.test("buildRendererObservation never puts paths, pids, launch ids, or endpoints in renderer fields", () => {
  const observation = buildRendererObservation({
    configuration: { state: "verified", expectedDigest: "ignored" },
    ownership: {
      kind: "foreign",
      reason:
        "listener pid 4242 launch 11111111-1111-4111-8111-111111111111 at http://127.0.0.1:3020/mcp in /Users/ada/Library/Application Support/ai.casys.digital-thread",
      recovery: OWNERSHIP_RECOVERY,
    },
  });
  const text = JSON.stringify(observation);
  for (
    const leak of [
      "/Users/ada",
      "127.0.0.1",
      "http://",
      ":3020",
      "11111111-1111-4111-8111-111111111111",
      "pid 4242",
      "Application Support",
    ]
  ) {
    assertFalse(text.includes(leak), `leaked ${leak}: ${text}`);
  }
  assertEquals(observation.controlPlane.state, "error");
  assertEquals(observation.status, "recovery-required");
});

Deno.test("buildRendererObservation does not treat missing snapshot runs as ready project evidence", () => {
  const observation = buildRendererObservation({
    configuration: { state: "verified", expectedDigest: "x" },
    ownership: { kind: "owned", reason: "owned" },
    providers: {
      fleetStatus: "healthy",
      healthy: 1,
      total: 1,
      drift: 0,
      runCount: 0,
      demoRunCount: 0,
    },
  });
  assertEquals(observation.projectEvidence.state, "unavailable");
  assertEquals(observation.providers.state, "ready");
  assertEquals(observation.status, "degraded");
});

const EXPECTED = {
  productIdentifier: "ai.casys.digital-thread" as const,
  productVersion: CONTROL_PLANE_PRODUCT_VERSION,
  serverName: "casys-digital-thread-console" as const,
  serverVersion: CONTROL_PLANE_SERVER_VERSION,
};

Deno.test("toDesktopControlPlaneProjection preserves drift and labels every run as candidate-unverified", () => {
  const projection = toDesktopControlPlaneProjection({
    configuration: { state: "verified", expectedDigest: "internal" },
    ownership: { kind: "owned", reason: "exact" },
    providers: {
      fleetStatus: "degraded",
      healthy: 2,
      total: 3,
      drift: 1,
      runCount: 2,
      demoRunCount: 1,
    },
    expected: EXPECTED,
  });
  assertEquals(projection, {
    configuration: "verified",
    lifecycle: "owned-ready",
    controlPlaneVersion: CONTROL_PLANE_SERVER_VERSION,
    providers: { state: "degraded", healthy: 2, total: 3, drift: 1 },
    persistedEvidence: "candidate-unverified",
  });
});

Deno.test("toDesktopControlPlaneProjection never fabricates version or verified evidence", () => {
  const projection = toDesktopControlPlaneProjection({
    configuration: { state: "missing", expectedDigest: "internal" },
    ownership: { kind: "absent", reason: "refused" },
    expected: EXPECTED,
  });
  assertEquals(projection, {
    configuration: "missing",
    lifecycle: "unavailable",
    providers: { state: "unknown" },
    persistedEvidence: "unavailable",
  });
  assertEquals("controlPlaneVersion" in projection, false);
});

Deno.test("toDesktopControlPlaneProjection reports exact reconnect without claiming handle ownership", () => {
  const projection = toDesktopControlPlaneProjection({
    configuration: { state: "verified", expectedDigest: "internal" },
    ownership: { kind: "reconnected", reason: "exact" },
    expected: EXPECTED,
  });
  assertEquals(projection.lifecycle, "reconnected-ready");
  assertEquals(projection.controlPlaneVersion, CONTROL_PLANE_SERVER_VERSION);
  assertEquals(projection.providers, { state: "unavailable" });
  assertEquals(projection.persistedEvidence, "unavailable");
});

Deno.test("sanitizeText redacts sensitive tokens as defense in depth", () => {
  const text = sanitizeText(
    "pid=9 at http://127.0.0.1:3020/mcp path /Users/ada/project sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef 11111111-1111-4111-8111-111111111111",
  );
  assertFalse(text.includes("/Users/ada"));
  assertFalse(text.includes("127.0.0.1"));
  assertFalse(text.includes("11111111-1111-4111-8111-111111111111"));
  assertFalse(text.includes("pid=9"));
});
