/**
 * Immutable, code-owned candidate and fixture for local geometry-module
 * assembler qualification.  This is deliberately outside the runtime
 * catalogue: qualification evidence never selects or activates a binding.
 */

import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  createGeometryModuleInputBundle,
  type GeometryModuleInputBundle,
} from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  createMicrosandboxRuntimeAttestation,
  pinnedOciImageReference,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  type AtomicCapabilityRuntimeMaterial,
  fingerprintAtomicCapabilityRuntimeUnit,
} from "../../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { FirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import {
  createGeometryModuleAssemblyServerOptionsForBoundCandidateImport,
  createLocalGeometryModuleAssemblyServerOptions,
  geometryModuleAssemblyPolicyBody,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_POLICY_BODY,
} from "./first-party-geometry-module-assembly.ts";
import type { GeometryModuleAssemblyServerOptions } from "./geometry-module-assembly-composition.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
} from "./fixed-geometry-module-assembly-execution.ts";
import { FixedGeometryModuleAssemblyProfileCatalog } from "./fixed-geometry-module-assembly-profile.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

export const GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CANDIDATE_ID =
  "build123d-module-assembler-arm64-native-v1" as const;
export const GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_FIXTURE_ID =
  "geometry-module-assembler-two-bracket-v1" as const;
export const GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_SPEC_ID =
  "build123d-module-assembler-arm64-native-v3-spec" as const;

const QUALIFICATION_FIXTURE_STEP_PATH = "examples/bracket/bracket.step";
const QUALIFICATION_FIXTURE_STEP_SHA256 =
  "7e8bcb45b8ad081b701f7f5e15fd79b8e75db27bb09fba2d821fafc6c4c585ac";
const QUALIFICATION_UNIT_ID = "casys.geometry-module-assembler-worker" as const;
/** The atomic runtime unit changed with the removal of the acquisition input. */
export const GEOMETRY_MODULE_ASSEMBLER_QUALIFICATION_UNIT_VERSION = "1.2.0" as const;
const QUALIFICATION_MATERIAL_ID = "geometry-module-assembler-worker-image" as const;

/** Evidence-only until a separate catalogue change adopts the candidate. */
const QUALIFICATION_BINDING = Object.freeze({
  id: "build123d-geometry-module-immediate-compound",
  version: "1.0.0",
});

const QUALIFICATION_CONTRACT = Object.freeze({
  id: "build123d-module-assembler-adapter",
  version: "1.0.0",
  source: "src/adapters/cad/module-assembly/fixed-geometry-module-assembler.ts",
});

function qualificationRuntimeMaterial(
  imageReference: string,
): AtomicCapabilityRuntimeMaterial {
  return Object.freeze({
    id: QUALIFICATION_MATERIAL_ID,
    kind: "microvm-image" as const,
    imageReference: pinnedOciImageReference(
      imageReference,
      "$geometryModuleAssemblerQualification.runtimeImage",
    ),
    platforms: ["linux/arm64"] as const,
    lifecycle: "ephemeral" as const,
    launchGroup: null,
    effects: Object.freeze({
      downloadBytes: null,
      storageBytes: null,
      services: [{ id: QUALIFICATION_MATERIAL_ID, lifecycle: "ephemeral" as const }],
      volumes: [],
      network: "deny-all" as const,
      loopbackPorts: [],
      bindMounts: [],
      privileged: false as const,
      dockerSocket: false as const,
      devices: [],
      secretSlots: [],
      licence: {
        status: "reviewed" as const,
        reference:
          "docs/reference/runtime/capability-packs/atomic-runtime-boundaries.md",
      },
      security: "reviewed" as const,
    }),
  });
}

export interface GeometryModuleAssemblerMicrosandboxQualificationFixture {
  readonly id: typeof GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_FIXTURE_ID;
  readonly childStep: {
    readonly path: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly bundle: GeometryModuleInputBundle;
}

export interface GeometryModuleAssemblerMicrosandboxQualificationCandidate {
  readonly id: typeof GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CANDIDATE_ID;
  readonly fingerprint: ContentFingerprint;
  readonly binding: typeof QUALIFICATION_BINDING;
  readonly selector: {
    readonly capability: typeof GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY;
    readonly use: "preparation";
  };
  readonly contract: typeof QUALIFICATION_CONTRACT;
  readonly profile: {
    readonly id: "build123d-module-assembler-v1";
    readonly version: "1.0.0";
    readonly fingerprint: ContentFingerprint;
  };
  readonly unit: {
    readonly id: typeof QUALIFICATION_UNIT_ID;
    readonly version: typeof GEOMETRY_MODULE_ASSEMBLER_QUALIFICATION_UNIT_VERSION;
    readonly manifestFingerprint: ContentFingerprint;
  };
  /** Exact atomic manifest: the executable Microsandbox runtime worker. */
  readonly materials: readonly [AtomicCapabilityRuntimeMaterial];
  /** The runtime worker is the only material carried by execution attestation. */
  readonly material: {
    readonly unitId: typeof QUALIFICATION_UNIT_ID;
    readonly materialId: typeof QUALIFICATION_MATERIAL_ID;
    readonly imageDigest: string;
  };
  readonly targetPlatform: "linux/arm64";
  readonly mode: "native";
  readonly launchGroup: null;
  readonly image: {
    readonly reference: string;
    readonly manifestDigest: string;
    readonly os: "linux";
    readonly architecture: "arm64";
    readonly user: string;
    readonly entrypoint: readonly string[];
  };
  readonly policy: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
    readonly network: "deny-all";
    readonly pullPolicy: "never";
  };
  readonly fixture: GeometryModuleAssemblerMicrosandboxQualificationFixture;
  readonly specification: {
    readonly id: typeof GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_SPEC_ID;
    readonly version: "3.0.0";
    readonly fingerprint: ContentFingerprint;
  };
}

export async function createGeometryModuleAssemblerMicrosandboxQualificationCandidate(): Promise<
  GeometryModuleAssemblerMicrosandboxQualificationCandidate
> {
  return await createGeometryModuleAssemblerQualificationCandidateFromAuthority({
    options: await createLocalGeometryModuleAssemblyServerOptions(),
    imageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
    policyBody: LOCAL_GEOMETRY_MODULE_ASSEMBLY_POLICY_BODY,
  });
}

export async function createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<GeometryModuleAssemblerMicrosandboxQualificationCandidate> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
  );
  const candidate =
    await createGeometryModuleAssemblerQualificationCandidateFromAuthority({
      options: await createGeometryModuleAssemblyServerOptionsForBoundCandidateImport(
        record,
      ),
      imageReference: record.candidate.microsandbox.candidateReference,
      policyBody: geometryModuleAssemblyPolicyBody(
        record.candidate.microsandbox.candidateReference,
      ),
    });
  if (candidate.image.manifestDigest !== record.identities.microsandboxManifestDigest) {
    throw new TypeError(
      "The geometry-module imported-candidate authority did not retain the bound Microsandbox digest.",
    );
  }
  return candidate;
}

async function createGeometryModuleAssemblerQualificationCandidateFromAuthority(input: {
  readonly options: GeometryModuleAssemblyServerOptions;
  readonly imageReference: string;
  readonly policyBody: ReturnType<typeof geometryModuleAssemblyPolicyBody>;
}): Promise<GeometryModuleAssemblerMicrosandboxQualificationCandidate> {
  const fixture = await createGeometryModuleAssemblerMicrosandboxQualificationFixture();
  const profile = await new FixedGeometryModuleAssemblyProfileCatalog(
    input.options.profile,
  ).initial();
  if (
    profile.executionProfile.id !== GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id ||
    profile.executionProfile.version !==
      GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version
  ) {
    throw new Error("The geometry-module qualification profile is not registered.");
  }
  const materials = Object.freeze(
    [qualificationRuntimeMaterial(input.imageReference)] as const,
  );
  const imageDigest = profile.runtime.imageDigest.digest;
  const unit = {
    id: QUALIFICATION_UNIT_ID,
    version: GEOMETRY_MODULE_ASSEMBLER_QUALIFICATION_UNIT_VERSION,
    manifestFingerprint: await fingerprintAtomicCapabilityRuntimeUnit({
      id: QUALIFICATION_UNIT_ID,
      version: GEOMETRY_MODULE_ASSEMBLER_QUALIFICATION_UNIT_VERSION,
      materials,
    }),
  };
  const policy = {
    id: profile.isolationPolicy.id,
    version: profile.isolationPolicy.version,
    fingerprint: profile.isolationPolicy.fingerprint,
    network: "deny-all" as const,
    pullPolicy: "never" as const,
  };
  const candidateBody = {
    id: GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CANDIDATE_ID,
    binding: QUALIFICATION_BINDING,
    selector: {
      capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
      use: "preparation" as const,
    },
    contract: QUALIFICATION_CONTRACT,
    profile: {
      id: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id,
      version: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version,
      fingerprint: profile.profileFingerprint,
    },
    unit,
    materials,
    material: {
      unitId: QUALIFICATION_UNIT_ID,
      materialId: QUALIFICATION_MATERIAL_ID,
      imageDigest,
    },
    targetPlatform: "linux/arm64" as const,
    mode: "native" as const,
    launchGroup: null,
    image: {
      reference: profile.imageReference,
      manifestDigest: `sha256:${imageDigest}`,
      os: "linux" as const,
      architecture: "arm64" as const,
      user: GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      entrypoint: [
        GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    },
    policy,
    fixture,
    specification: {
      id: GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_SPEC_ID,
      version: "3.0.0" as const,
      fingerprint: await sha256Fingerprint({
        schemaVersion:
          "geometry-module-assembler-microsandbox-qualification-specification/3.0",
        profile: {
          id: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id,
          version: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version,
          fingerprint: profile.profileFingerprint,
        },
        image: profile.runtime.imageDigest,
        worker: {
          user:
            GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
          entrypoint: [
            GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.executable,
            ...GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.args,
          ],
        },
        policy: input.policyBody,
        fixture: {
          id: fixture.id,
          fingerprint: fixture.bundle.fingerprint,
        },
        oracle: {
          id: "two-bracket-occt-exact-absolute-placements",
          version: "3.0.0",
          root: { meshes: 0, children: 1 },
          container: { meshes: 0, children: 2 },
          leaves: { meshes: 1, children: 0, distinctMeshIndices: true },
          geometry: {
            fixtureTopologyAndGeometry: "exact",
            occurrenceTranslationsMm: [[0, 0, 0], [80, 0, 0]],
            translationToleranceMm: 1e-3,
          },
          glb: "published-non-degenerate-triangle",
        },
      }),
    },
  };
  return Object.freeze({
    ...candidateBody,
    fingerprint: await sha256Fingerprint(candidateManifest(candidateBody)),
  });
}

export async function createGeometryModuleAssemblerMicrosandboxQualificationFixture(): Promise<
  GeometryModuleAssemblerMicrosandboxQualificationFixture
> {
  const childStep = await Deno.readFile(QUALIFICATION_FIXTURE_STEP_PATH);
  const digest = await fingerprintResourceBytes(childStep);
  if (digest !== QUALIFICATION_FIXTURE_STEP_SHA256) {
    throw new Error("The geometry-module qualification STEP fixture drifted.");
  }
  const bundle = await createGeometryModuleInputBundle([
    qualificationOccurrence("qualification.left", [0, 0, 0], childStep),
    qualificationOccurrence("qualification.right", [80, 0, 0], childStep),
  ]);
  return Object.freeze({
    id: GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_FIXTURE_ID,
    childStep: {
      path: QUALIFICATION_FIXTURE_STEP_PATH,
      fingerprint: { algorithm: "sha256" as const, digest },
    },
    bundle,
  });
}

export function candidateManifest(
  value:
    & Omit<GeometryModuleAssemblerMicrosandboxQualificationCandidate, "fingerprint">
    & { readonly fingerprint?: ContentFingerprint },
) {
  const { fingerprint: _fingerprint, fixture, ...body } = value;
  return {
    ...body,
    fixture: {
      id: fixture.id,
      childStep: fixture.childStep,
      bundle: {
        manifest: fixture.bundle.manifest,
        fingerprint: fixture.bundle.fingerprint,
      },
    },
  };
}

export async function assertExactGeometryModuleAssemblerQualificationCandidate(
  value: GeometryModuleAssemblerMicrosandboxQualificationCandidate,
  expected?: GeometryModuleAssemblerMicrosandboxQualificationCandidate,
): Promise<GeometryModuleAssemblerMicrosandboxQualificationCandidate> {
  const current = expected ??
    await createGeometryModuleAssemblerMicrosandboxQualificationCandidate();
  const expectedFingerprint = await sha256Fingerprint(candidateManifest(value));
  if (
    !fingerprintsEqual(value.fingerprint, expectedFingerprint) ||
    deterministicJson(candidateManifest(value)) !==
      deterministicJson(candidateManifest(current)) ||
    !fingerprintsEqual(value.fingerprint, current.fingerprint)
  ) {
    throw new TypeError("The geometry-module qualification candidate drifted.");
  }
  return current;
}

export function geometryModuleAssemblerQualificationRuntime(
  candidate: GeometryModuleAssemblerMicrosandboxQualificationCandidate,
) {
  return createMicrosandboxRuntimeAttestation({
    imageReference: candidate.image.reference,
    limits: LOCAL_GEOMETRY_MODULE_ASSEMBLY_POLICY_BODY.limits,
  });
}

function qualificationOccurrence(
  usageElementId: string,
  translationMm: readonly [number, number, number],
  stepBytes: Uint8Array,
) {
  return {
    usageElementId,
    partDefinitionElementId: "qualification-bracket",
    placement: { translationMm, rotationDeg: [0, 0, 0] as const },
    childCapture: {
      schemaVersion: "geometry-part-capture/1.0" as const,
      artifactId: `geometry-part-${usageElementId}`,
      fingerprint: {
        algorithm: "sha256" as const,
        digest: usageElementId === "qualification.left"
          ? "a".repeat(64)
          : "b".repeat(64),
      },
    },
    stepBytes: Uint8Array.from(stepBytes),
  };
}
