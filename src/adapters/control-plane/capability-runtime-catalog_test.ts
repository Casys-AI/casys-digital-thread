import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createFirstPartyCapabilityRuntimeCatalog,
  createFirstPartyChronoRolloverPredecessorUnit,
  createFirstPartySysonRolloverPredecessorUnit,
} from "./first-party-capability-binding-catalog.ts";
import {
  createFirstPartyChronoRolloverPredecessorLaunchGroup,
  createFirstPartySysonRolloverPredecessorLaunchGroup,
} from "./first-party-capability-runtime-launch-groups.ts";
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
  const predecessorSyson = await createFirstPartySysonRolloverPredecessorUnit();
  const predecessorChrono = await createFirstPartyChronoRolloverPredecessorUnit();
  assertEquals(predecessorSyson.version, "1.0.0");
  // The retired descriptor is a historical authority, not a derived alias for
  // the current SysON material. Keep both fingerprints literal so a future
  // successor update cannot silently rewrite the 1.0.0 rollover basis.
  assertEquals(predecessorSyson.manifestFingerprint, {
    algorithm: "sha256",
    digest: "e8ac01cd5c94330d8ea89d6d1f9b24c363a3067bbb2923faac8dd56d53c7b7fd",
  });
  const predecessorLaunchGroup =
    await createFirstPartySysonRolloverPredecessorLaunchGroup();
  assertEquals(predecessorLaunchGroup.fingerprint, {
    algorithm: "sha256",
    digest: "8e470a77b13ae58bc70e0d4cc5b6deaff1e4f58b85f704b1ddaba74bb7e4d1a6",
  });
  assertEquals(predecessorChrono.id, "casys.mcp-chrono");
  assertEquals(predecessorChrono.version, "0.3.1");
  assertEquals(predecessorChrono.manifestFingerprint, {
    algorithm: "sha256",
    digest: "62c24230102e9b94955ffd27c8f3d9bea49e3f90bc03ff511f650569e22d399d",
  });
  const predecessorChronoLaunchGroup =
    await createFirstPartyChronoRolloverPredecessorLaunchGroup();
  assertEquals(predecessorChronoLaunchGroup.id, "casys-chrono");
  assertEquals(predecessorChronoLaunchGroup.version, "1.0.0");
  assertEquals(predecessorChronoLaunchGroup.fingerprint, {
    algorithm: "sha256",
    digest: "ddf2ea1f75ed3ca1606ab905ff7e37bfbf3b7e975e919856678484d9c0251985",
  });
  assertEquals(
    predecessorChrono.materials.find((material) => material.id === "mcp-chrono-image")
      ?.imageReference,
    "ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c",
  );
  assertEquals(
    predecessorChrono.materials.find((material) => material.id === "mcp-chrono-image")
      ?.launchGroup,
    {
      id: "casys-chrono",
      version: "1.0.0",
      fingerprint: predecessorChronoLaunchGroup.fingerprint,
    },
  );
  assertEquals(
    catalog.units.some((unit) =>
      unit.id === predecessorChrono.id &&
      unit.version === predecessorChrono.version &&
      unit.manifestFingerprint.digest === predecessorChrono.manifestFingerprint.digest
    ),
    false,
  );
  assertEquals(
    predecessorSyson.materials.find((material) => material.id === "syson-app-image")
      ?.imageReference,
    "ghcr.io/casys-ai/syson@sha256:fc599abb95587913de11ff6de68060b5593956abc0c47bc753cd19e2987141a6",
  );
  assertEquals(
    predecessorSyson.materials.find((material) => material.id === "syson-app-image")
      ?.platforms,
    ["linux/arm64"],
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.modelica-qualified-worker")
      ?.manifestFingerprint,
    {
      algorithm: "sha256",
      digest: "399f9694c732189e475995662254f2ba1fba90b3d75620a0a5221c70cb3f5272",
    },
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.modelica-worker")
      ?.manifestFingerprint,
    {
      algorithm: "sha256",
      digest: "defeacb0fb2e702bfa5ff73585fcdaac7ac634667d69443d7fbb45ce48dd2cf6",
    },
  );
  assertEquals(
    catalog.units.find((unit) => unit.id === "casys.modelica-qualified-worker")
      ?.materials[0]?.imageReference,
    catalog.units.find((unit) => unit.id === "casys.modelica-worker")
      ?.materials[0]?.imageReference,
  );
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
