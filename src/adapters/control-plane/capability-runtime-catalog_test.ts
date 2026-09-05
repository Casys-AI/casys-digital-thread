import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createFirstPartyCapabilityRuntimeCatalog,
} from "./first-party-capability-binding-catalog.ts";
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
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
} from "../cad/module-assembly/geometry-module-assembly-microsandbox-qualification-candidate.ts";

Deno.test("first-party catalogue adopts the exact qualified geometry-module candidate", async () => {
  const [catalog, candidate] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createGeometryModuleAssemblerMicrosandboxQualificationCandidate(),
  ]);
  const unit = catalog.units.find((value) => value.id === candidate.unit.id);
  assertEquals(unit, {
    id: candidate.unit.id,
    version: candidate.unit.version,
    manifestFingerprint: candidate.unit.manifestFingerprint,
    materials: candidate.materials,
  });
  assertEquals(
    catalog.bindings.find((value) => value.id === candidate.binding.id),
    {
      id: candidate.binding.id,
      version: candidate.binding.version,
      capability: candidate.selector.capability,
      use: candidate.selector.use,
      qualification: "qualified",
      adapter: candidate.contract,
      profile: {
        id: candidate.profile.id,
        version: candidate.profile.version,
        fingerprint: null,
      },
      unitIds: [candidate.unit.id],
      qualificationEvidence: {
        id: `${candidate.binding.id}-qualification`,
        source: candidate.contract.source,
        fingerprint: null,
      },
      runtimeModes: [],
      limitations: [
        "This binding assembles an exact static immediate compound only.",
        "It does not cover collision, contact, clearance, motion, forces, resistance, safety, or fabricability.",
      ],
    },
  );
});

Deno.test("first-party catalogue binds admitted geometry export to its admission-backed adapter", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();

  assertEquals(
    catalog.bindings.find((binding) =>
      binding.id === "build123d-export-admitted-source"
    )
      ?.adapter,
    {
      id: "build123d-admitted-geometry-export-adapter",
      version: "1.0.0",
      source: "src/adapters/cad/canonical/admission-backed-geometry-export-adapter.ts",
    },
  );
});

Deno.test("atomic first-party runtime catalogue exposes only runtime materials and keeps acquisition internal", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  assertEquals(catalog.productionEligible, false);
  const syson = catalog.units.find((unit) => unit.id === "casys.syson-stack");
  assertEquals(syson?.version, "1.0.1");
  assertEquals(
    syson?.materials.find((material) => material.id === "syson-app-image")
      ?.imageReference,
    "ghcr.io/casys-ai/syson@sha256:d372ae26e5d32e5c599fa7c1599d42c73cf9a54e101cfe6f77175f313d7d84e9",
  );
  assertEquals(
    syson?.materials.find((material) => material.id === "syson-app-image")
      ?.platforms,
    ["linux/amd64", "linux/arm64"],
  );
  const modelica = catalog.units.find((unit) => unit.id === "casys.modelica-worker");
  assertEquals(modelica?.version, "2.0.0");
  assertEquals(modelica?.materials.map((material) => material.id), [
    "modelica-worker-image",
  ]);
  assertEquals(modelica?.materials[0]?.effects.security, "reviewed");
  assertEquals(modelica?.manifestFingerprint, {
    algorithm: "sha256",
    digest: "152f2581bb59a9c6ed0a05e145b9fae21b7ae0e72ccea5f2c36ab16a94aff4d5",
  });
  assertEquals(
    modelica?.materials[0]?.imageReference,
    "docker.io/casys/modelica-microsandbox-worker@sha256:834c759291320eb5f35ccb6eba03587445d259dcb38a2814c5def4ac41d5d730",
  );
  assertEquals(catalog.units.map((unit) => unit.id), [
    "casys.syson-stack",
    "casys.mcp-build123d-sandbox",
    "casys.mcp-build123d-observation",
    "casys.build123d-isolated-worker",
    "casys.geometry-module-assembler-worker",
    "casys.calculix-worker",
    "casys.mcp-calculix",
    "casys.modelica-worker",
    "casys.spice-worker",
    "casys.mcp-chrono",
  ]);
  assertEquals(
    catalog.bindings.find((binding) => binding.id === "openmodelica-qualified-kit")
      ?.unitIds,
    ["casys.modelica-worker"],
  );
  assertEquals(
    catalog.bindings.find((binding) => binding.id === "openmodelica-qualified-kit")
      ?.qualification,
    "qualified",
  );
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
  assertEquals(calculix?.materials[0]?.platforms, ["linux/amd64", "linux/arm64"]);
  assertEquals(calculix?.materials[0]?.launchGroup?.id, "casys-mcp-calculix");
  assertEquals(calculix?.materials[0]?.launchGroup?.version, "0.8.2");
  assertEquals(
    calculix?.materials[0]?.launchGroup?.fingerprint.algorithm,
    "sha256",
  );
  assert(
    /^[a-f0-9]{64}$/.test(
      calculix?.materials[0]?.launchGroup?.fingerprint.digest ?? "",
    ),
  );
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
    catalog.bindings.find((binding) => binding.id === "openmodelica-admitted-modelica")
      ?.unitIds,
    ["casys.modelica-worker"],
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.spice-worker")?.materials.map((
      material,
    ) => material.imageReference).length,
    1,
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.spice-worker")?.materials[0]
      ?.kind,
    "microvm-image",
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.spice-worker")?.version,
    "1.1.0",
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.geometry-module-assembler-worker")
      ?.version,
    "1.2.0",
  );
  const chrono = catalog.units.find((unit) => unit.id === "casys.mcp-chrono");
  assertEquals(chrono?.version, "0.3.2");
  assertEquals(
    chrono?.materials[0]?.imageReference,
    "ghcr.io/casys-ai/mcp-chrono@sha256:2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557",
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
    security: "reviewed",
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

  const runtimeModeClaim = structuredClone(catalog) as unknown as Record<
    string,
    unknown
  >;
  const claimedBinding = (runtimeModeClaim.bindings as Record<string, unknown>[])[0]!;
  const claimedUnit = (runtimeModeClaim.units as Record<string, unknown>[])[0]!;
  const claimedMaterial = (claimedUnit.materials as Record<string, unknown>[])[0]!;
  claimedBinding.runtimeModes = [{
    material: {
      unitId: claimedUnit.id,
      materialId: claimedMaterial.id,
      imageDigest: String(claimedMaterial.imageReference).slice(
        String(claimedMaterial.imageReference).lastIndexOf("@sha256:") + 8,
      ),
    },
    targetPlatform: "linux/arm64",
    mode: "native",
    qualificationAttestationFingerprint: null,
  }];
  await assertRejects(
    () => validateCapabilityRuntimeCatalog(runtimeModeClaim),
    TypeError,
    "runtimeModes must be empty",
  );

  assertThrows(
    () =>
      validateCapabilityRuntimeHostObservation({
        schemaVersion: CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
        identityFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        platform: "linux/arm64",
        emulatedPlatforms: ["linux/arm64"],
        images: [],
      }),
    TypeError,
    "emulatedPlatforms",
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
  await assertRejects(
    () =>
      validateCapabilityRuntimeAdminLock({
        schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
        revision: 1,
        previous: null,
        units: [],
      }, catalog),
    TypeError,
    "greater than 0 must name the exact previous",
  );
});
