import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  validateCapabilityRuntimeAdminLock,
  validateCapabilityRuntimeAdminPolicy,
  validateCapabilityRuntimeCatalog,
  validateCapabilityRuntimeHostObservation,
} from "./capability-runtime-catalog.ts";
import {
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
} from "../../application/control-plane/read-model/capability-runtime-catalog.ts";

Deno.test("atomic first-party runtime catalogue separates sources with distinct lifecycle and evidence", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  assertEquals(catalog.productionEligible, false);
  assertEquals(catalog.units.map((unit) => unit.id), [
    "casys.syson-stack",
    "casys.mcp-build123d-sandbox",
    "casys.mcp-build123d-observation",
    "casys.build123d-isolated-worker",
    "casys.geometry-module-assembler-worker",
    "casys.calculix-worker",
    "casys.mcp-calculix",
    "casys.modelica-qualified-worker",
    "casys.modelica-worker",
    "casys.spice-worker",
    "casys.mcp-chrono",
  ]);
  assertEquals(
    catalog.bindings.find((binding) => binding.id === "calculix-static-structural")
      ?.unitIds,
    ["casys.calculix-worker"],
  );
  const sensitivity = catalog.bindings.find((binding) =>
    binding.id === "calculix-http-static-sensitivity"
  );
  assertEquals(sensitivity?.capability, {
    id: "mechanics.observe-static-structural-sensitivity",
    version: "1",
  });
  assertEquals(sensitivity?.qualification, "unqualified");
  assertEquals(sensitivity?.profile, null);
  assertEquals(sensitivity?.unitIds, ["casys.mcp-calculix"]);
  const calculix = catalog.units.find((unit) => unit.id === "casys.mcp-calculix");
  assertEquals(calculix?.version, "0.8.2");
  assertEquals(
    calculix?.materials[0]?.imageReference,
    "ghcr.io/casys-ai/mcp-calculix@sha256:ea933089d0941dd7c45d7e00a825be64c412edbb334a05dc568745ce885abfc8",
  );
  assertEquals(calculix?.materials[0]?.launchGroup, null);
  assertEquals(calculix?.materials[0]?.effects, {
    downloadBytes: null,
    storageBytes: null,
    services: [{ id: "mcp-calculix", lifecycle: "persistent" }],
    volumes: [
      { id: "calculix-inputs", access: "read-write", preservation: "preserve" },
      { id: "calculix-runs", access: "read-write", preservation: "preserve" },
    ],
    network: "loopback-only",
    loopbackPorts: [3015],
    bindMounts: [],
    privileged: false,
    dockerSocket: false,
    devices: [],
    secretSlots: [],
    licence: {
      status: "reviewed",
      reference: "docs/reference/runtime/capability-packs/atomic-runtime-boundaries.md",
    },
    security: "reviewed",
  });
  assertEquals(
    catalog.bindings.find((binding) => binding.id === "openmodelica-admitted-modelica")
      ?.qualification,
    "unqualified",
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.spice-worker")?.materials.map((
      material,
    ) => material.imageReference).length,
    2,
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.spice-worker")?.materials[0]
      ?.kind,
    "oci-image",
  );
  const chrono = catalog.units.find((unit) => unit.id === "casys.mcp-chrono");
  assertEquals(chrono?.version, "0.3.1");
  assertEquals(
    chrono?.materials[0]?.imageReference,
    "ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c",
  );
  assertEquals(chrono?.materials[0]?.platforms, ["linux/amd64"]);
  assertEquals(chrono?.materials[0]?.effects, {
    downloadBytes: null,
    storageBytes: null,
    services: [{ id: "mcp-chrono", lifecycle: "persistent" }],
    volumes: [{ id: "chrono-data", access: "read-write", preservation: "preserve" }],
    network: "loopback-only",
    loopbackPorts: [3025],
    bindMounts: [],
    privileged: false,
    dockerSocket: false,
    devices: [],
    secretSlots: ["chrono-mcp-bearer-token"],
    licence: {
      status: "unknown",
      reference: "docs/reference/runtime/capability-packs/atomic-runtime-boundaries.md",
    },
    security: "unknown",
  });
  assertEquals(
    catalog.bindings.find((binding) => binding.id === "chrono-prescribed-kinematics")
      ?.qualification,
    "unqualified",
  );
  assertEquals(
    catalog.bindings.find((binding) => binding.id === "chrono-prescribed-kinematics")
      ?.version,
    "1",
  );
});

Deno.test("runtime catalogue parsers fail closed on unsafe fields and lock/policy drift", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const malformed = structuredClone(catalog) as unknown as Record<string, unknown>;
  const firstMaterial = (malformed.units as Record<string, unknown>[])[0]!
    .materials as Record<
      string,
      unknown
    >[];
  firstMaterial[0]!.effects = {
    ...(firstMaterial[0]!.effects as Record<string, unknown>),
    dockerSocket: true,
  };
  await assertRejects(
    () => validateCapabilityRuntimeCatalog(malformed),
    TypeError,
    "dockerSocket must equal false",
  );

  const staleManifest = JSON.parse(JSON.stringify(catalog)) as Record<string, unknown>;
  const staleMaterial = (staleManifest.units as Record<string, unknown>[])[0]!
    .materials as Record<string, unknown>[];
  (staleMaterial[0]!.effects as Record<string, unknown>).network = "deny-all";
  await assertRejects(
    () => validateCapabilityRuntimeCatalog(staleManifest),
    TypeError,
    "does not match the canonical unit body",
  );

  assertThrows(
    () =>
      validateCapabilityRuntimeHostObservation({
        schemaVersion: CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
        platform: "linux/arm64",
        emulatedPlatforms: ["linux/arm64"],
        images: [],
      }),
    TypeError,
    "exclude the native platform",
  );
  assertThrows(
    () =>
      validateCapabilityRuntimeAdminPolicy({
        schemaVersion: CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
        disabledBindingIds: ["invented-binding"],
        preferences: [],
      }, catalog),
    TypeError,
    "unknown binding",
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeAdminLock({
        schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
        revision: 1,
        previous: null,
        units: [{
          id: "casys.calculix-worker",
          version: "1.0.0",
          manifestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
          desired: "active",
        }],
      }, catalog),
    TypeError,
    "does not match",
  );
});
