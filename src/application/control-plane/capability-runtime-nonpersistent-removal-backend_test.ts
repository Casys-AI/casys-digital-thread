import { assertEquals, assertThrows } from "@std/assert";
import { capabilityRuntimeNonpersistentRemovalBackend } from "./capability-runtime-nonpersistent-removal-backend.ts";
import type { AtomicCapabilityRuntimeMaterial } from "../../domain/capability/runtime/capability-runtime-catalog.ts";

Deno.test("non-persistent backend is derived from catalogue kind and lifecycle, never caller flags", () => {
  assertEquals(
    capabilityRuntimeNonpersistentRemovalBackend(cacheMaterial()),
    "docker-cache",
  );
  assertEquals(
    capabilityRuntimeNonpersistentRemovalBackend(microvmMaterial()),
    "microsandbox-cache",
  );
  assertThrows(
    () =>
      capabilityRuntimeNonpersistentRemovalBackend({
        ...cacheMaterial(),
        launchGroup: {
          id: "casys-syson",
          version: "1.0.1",
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        },
      }),
    Error,
    "launchGroup null",
  );
  assertThrows(
    () =>
      capabilityRuntimeNonpersistentRemovalBackend({
        ...cacheMaterial(),
        kind: "compose-service",
        lifecycle: "persistent",
      }),
    Error,
    "unavailable",
  );
});

function cacheMaterial(): AtomicCapabilityRuntimeMaterial {
  return {
    id: "source-image",
    kind: "oci-image",
    imageReference: `casys/source@sha256:${"a".repeat(64)}`,
    platforms: ["linux/arm64"],
    lifecycle: "cache",
    launchGroup: null,
    effects: {
      downloadBytes: null,
      storageBytes: null,
      services: [],
      volumes: [],
      network: "deny-all",
      loopbackPorts: [],
      bindMounts: [],
      privileged: false,
      dockerSocket: false,
      devices: [],
      secretSlots: [],
      licence: { status: "reviewed", reference: null },
      security: "reviewed",
    },
  };
}

function microvmMaterial(): AtomicCapabilityRuntimeMaterial {
  return {
    ...cacheMaterial(),
    id: "worker-image",
    kind: "microvm-image",
    lifecycle: "ephemeral",
  };
}
