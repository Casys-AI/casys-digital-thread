import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  encodeGeometryModuleDecisionParameters,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_UNIT_SYSTEM,
  type GeometryModuleCapture,
  type GeometryModuleChild,
  type GeometryModuleDraftCapture,
  GeometryModuleEvidenceError,
  type GeometryModuleInputBundleIdentity,
  geometryModuleInputBundleMatchesIdentity,
  type GeometryModuleManifest,
  geometryModuleManifestFromDraft,
  parseGeometryModuleCapture,
  parseGeometryModuleDecisionParameters,
  parseGeometryModuleDraftCapture,
  parseGeometryModuleManifest,
} from "./geometry-module-evidence.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "./geometry-part-manifest.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "./geometry-proposal.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "../module-assembly/geometry-module-assembly-execution.ts";
import { validateGeometryModuleInputBundleManifest } from "../module-assembly/geometry-module-input-bundle.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
} from "../placement/cad-placement-analysis-capture.ts";
import {
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  PROJECT_SOURCE_CLOSURE_URI_PREFIX,
} from "../../project-source-workspace/closure.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const G = "1".repeat(64);
const encoder = new TextEncoder();
const BUNDLE_BYTES = encoder.encode("geometry-module-input-bundle/1.0");
const STEP_BYTES = encoder.encode("ISO-10303-21;MODULE-STEP");
const GLB_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
const ARM_STEP_BYTES = encoder.encode("ISO-10303-21;ARM-STEP");
const BASE_STEP_BYTES = encoder.encode("ISO-10303-21;BASE-STEP");

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function sourceClosure(digest = A, byteCount = 128) {
  return {
    schemaVersion: PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
    fingerprint: fp(digest),
    byteCount,
    casUri: `${PROJECT_SOURCE_CLOSURE_URI_PREFIX}${digest}`,
  };
}

function placementAnalysis(digest = B, byteCount = 64) {
  return {
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint: fp(digest),
    byteCount,
    casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${digest}`,
  };
}

function child(
  usageElementId: string,
  partDefinitionElementId: string,
  step: { readonly fingerprint: ReturnType<typeof fp>; readonly bytes: number },
): GeometryModuleChild {
  return {
    usageElementId,
    partDefinitionElementId,
    placement: {
      translationMm: [1, 0, 0],
      rotationDeg: [0, 90, 0],
    },
    placementCapture: fp(B),
    childGeometry: {
      schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
      artifactId: `geometry-${E}`,
      fingerprint: fp(E),
    },
    authoritativeStep: step,
  };
}

function inputBundleIdentity(
  assets: IsolationAssets,
  children: ReadonlyArray<GeometryModuleChild>,
): GeometryModuleInputBundleIdentity {
  let offset = 0;
  const occurrences = children.map((row) => {
    const occurrence = {
      usageElementId: row.usageElementId,
      partDefinitionElementId: row.partDefinitionElementId,
      placement: row.placement,
      childCapture: row.childGeometry,
      step: {
        mediaType: GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
        byteOffset: offset,
        byteCount: row.authoritativeStep.bytes,
        sha256: row.authoritativeStep.fingerprint.digest,
      },
    };
    offset += row.authoritativeStep.bytes;
    return occurrence;
  });
  return {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: assets.bundle.fingerprint,
    byteCount: assets.bundle.byteCount,
    manifest: validateGeometryModuleInputBundleManifest({
      schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
      unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
      placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
      occurrences,
    }),
  };
}

interface IsolationAssets {
  readonly bundle: {
    readonly fingerprint: ReturnType<typeof fp>;
    readonly byteCount: number;
  };
  readonly step: {
    readonly fingerprint: ReturnType<typeof fp>;
    readonly bytes: number;
  };
  readonly glb: { readonly fingerprint: ReturnType<typeof fp>; readonly bytes: number };
  readonly armStep: {
    readonly fingerprint: ReturnType<typeof fp>;
    readonly bytes: number;
  };
  readonly baseStep: {
    readonly fingerprint: ReturnType<typeof fp>;
    readonly bytes: number;
  };
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
}

async function isolationAssets(
  overrides: {
    readonly destruction?: "proven" | "acknowledged-unattested";
    readonly exitCode?: number;
    readonly sourceBytes?: Uint8Array;
    readonly profileId?: string;
  } = {},
): Promise<IsolationAssets> {
  const sourceBytes = overrides.sourceBytes ?? BUNDLE_BYTES;
  const bundleDigest = await fingerprintResourceBytes(sourceBytes);
  const stepDigest = await fingerprintResourceBytes(STEP_BYTES);
  const glbDigest = await fingerprintResourceBytes(GLB_BYTES);
  const armDigest = await fingerprintResourceBytes(ARM_STEP_BYTES);
  const baseDigest = await fingerprintResourceBytes(BASE_STEP_BYTES);
  const runId = "run.geometry-module.assembly.1";
  const outputs = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.map((declaration) => ({
    ...declaration,
    bytes: declaration.role === "assembly.step" ? STEP_BYTES : GLB_BYTES,
    sha256: declaration.role === "assembly.step" ? stepDigest : glbDigest,
  }));
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration: 0,
    profile: {
      id: overrides.profileId ?? GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id,
      version: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version,
    },
    source: { bytes: sourceBytes, sha256: bundleDigest },
    policy: {
      id: "isolation.geometry-module-assembly-v1",
      version: "1.0.0",
      fingerprint: fp(A),
    },
    outputs: outputs.map(({ role, basename, mediaType, format }) => ({
      role,
      basename,
      mediaType,
      format,
    })),
  });
  const publicationMembers = outputs.map((output) => ({
    role: output.role,
    basename: output.basename,
    mediaType: output.mediaType,
    format: output.format,
    byteCount: output.bytes.byteLength,
    sha256: output.sha256,
    casUri: `casys://isolated-output/sha256/${output.sha256}`,
  }));
  const receipt = isolatedCodeExecutionReceiptRecord(
    await createIsolatedCodeExecutionReceipt({
      request,
      runtime: {
        isolationClass: "kernel-isolated",
        imageDigest: fp(A),
        requestedLimits: {
          maxWallTimeMs: 1_000,
          maxCpuTimeMs: 500,
          maxMemoryBytes: 64_000_000,
          maxProcesses: 4,
          maxStdoutBytes: 1_024,
          maxStderrBytes: 1_024,
          maxOutputFileBytes: 1_024,
          maxOutputTotalBytes: 2_048,
        },
        limitAssurance: {
          maxWallTimeMs: "backend-attested",
          maxCpuTimeMs: "unattested",
          maxMemoryBytes: "backend-attested",
          maxProcesses: "unattested",
          maxStdoutBytes: "broker-observed-cap",
          maxStderrBytes: "broker-observed-cap",
          maxOutputFileBytes: "broker-observed-cap",
          maxOutputTotalBytes: "broker-observed-cap",
        },
      },
      termination: {
        kind: "exited",
        exitCode: overrides.exitCode ?? 0,
        signal: null,
      },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: publicationMembers.map((member, index) => ({
        ...member,
        validation: "accepted" as const,
        persistence: "staged-reread-atomic-commit" as const,
        bytes: outputs[index]!.bytes,
      })),
      destruction: overrides.destruction === "acknowledged-unattested"
        ? {
          status: "acknowledged-unattested",
          runId,
          acknowledgementFingerprint: fp(F),
        }
        : {
          status: "proven",
          runId,
          proofFingerprint: fp(E),
        },
      publication: await createIsolatedOutputPublicationRef(
        runId,
        0,
        await fingerprintIsolatedOutputPublicationManifest(
          runId,
          0,
          publicationMembers,
        ),
      ),
    }),
  );
  return {
    bundle: { fingerprint: fp(bundleDigest), byteCount: sourceBytes.byteLength },
    step: { fingerprint: fp(stepDigest), bytes: STEP_BYTES.byteLength },
    glb: { fingerprint: fp(glbDigest), bytes: GLB_BYTES.byteLength },
    armStep: { fingerprint: fp(armDigest), bytes: ARM_STEP_BYTES.byteLength },
    baseStep: { fingerprint: fp(baseDigest), bytes: BASE_STEP_BYTES.byteLength },
    receipt,
  };
}

function completeManifest(assets: IsolationAssets): GeometryModuleManifest {
  const children = [
    child("sysml.usage.arm", "sysml.part.arm", assets.armStep),
    child("sysml.usage.base", "sysml.part.base", assets.baseStep),
  ];
  return {
    schemaVersion: GEOMETRY_MODULE_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: "snapshot.12",
      revision: 12,
      artifactFingerprint: fp(A),
    },
    structureCapture: {
      schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
      artifactId: `part-definitions-${F}`,
      fingerprint: fp(F),
      uri: `casys://part-definitions-capture/sha256/${F}`,
      byteCount: 512,
      architecture: {
        artifactId: `architecture-${A}`,
        fingerprint: fp(A),
        uri: `casys://architecture-capture/sha256/${A}`,
      },
    },
    target: {
      partDefinitionElementId: "sysml.part.assembly",
      label: "Assembly",
    },
    predecessor: {
      schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
      artifactId: `geometry-module-${G}`,
      fingerprint: fp(G),
      partDefinitionElementId: "sysml.part.assembly",
    },
    sourceClosure: sourceClosure(),
    placementAnalysis: placementAnalysis(),
    children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly: {
      inputBundle: inputBundleIdentity(assets, children),
      step: { fingerprint: assets.step.fingerprint },
      glb: { fingerprint: assets.glb.fingerprint },
    },
  };
}

function completeDraft(
  assets: IsolationAssets,
): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  const manifest = completeManifest(assets);
  return {
    schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    kind: GEOMETRY_MODULE_DRAFT_KIND,
    architectureBasis: manifest.architectureBasis,
    structureCapture: manifest.structureCapture,
    target: manifest.target,
    predecessor: manifest.predecessor,
    sourceClosure: manifest.sourceClosure,
    placementAnalysis: manifest.placementAnalysis,
    children: manifest.children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    inputBundle: manifest.assembly!.inputBundle,
    receipt: assets.receipt,
    assemblyStep: assets.step,
    assemblyGlb: assets.glb,
  };
}

function completeCapture(assets: IsolationAssets): GeometryModuleCapture {
  const manifest = completeManifest(assets);
  const draft = completeDraft(assets);
  return {
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: "run.geometry-module.1",
    draftDigest: A,
    manifest,
    architectureBasis: {
      artifactId: `architecture-${A}`,
      fingerprint: fp(A),
      producerRunId: "run.architecture.12",
    },
    structureCapture: manifest.structureCapture,
    sourceClosure: manifest.sourceClosure,
    placementAnalysis: manifest.placementAnalysis,
    children: manifest.children,
    predecessor: manifest.predecessor,
    inputBundle: draft.inputBundle,
    receipt: assets.receipt,
    assemblyStep: draft.assemblyStep,
    assemblyGlb: draft.assemblyGlb,
    sealedAt: "2026-08-25T10:05:00.000Z",
  };
}

function withChildren(
  assets: IsolationAssets,
  children: ReadonlyArray<GeometryModuleChild>,
): GeometryModuleCapture {
  const capture = completeCapture(assets);
  const inputBundle = inputBundleIdentity(assets, children);
  return {
    ...capture,
    manifest: {
      ...capture.manifest,
      children,
      assembly: {
        ...capture.manifest.assembly!,
        inputBundle,
      },
    },
    children,
    inputBundle,
  };
}

Deno.test("module manifest round-trips through the exact flat MRTR grammar", async () => {
  const assets = await isolationAssets();
  const manifest = completeManifest(assets);
  const encoded = encodeGeometryModuleDecisionParameters(A, manifest);
  const params = new Map(encoded.map((parameter) => [parameter.key, parameter.value]));
  assertEquals(parseGeometryModuleDecisionParameters(params), {
    draftDigest: A,
    manifest,
  });
});

Deno.test("module manifest rejects bundle fields, source text and descendant copies", async () => {
  const manifest = completeManifest(await isolationAssets());
  for (
    const field of [
      "components",
      "occurrences",
      "partDefinitions",
      "script",
      "sourceText",
      "verdict",
      "descendantManifests",
      "programDigest",
      "lowerer",
      "compilerProfile",
    ]
  ) {
    assertThrows(
      () => parseGeometryModuleManifest({ ...manifest, [field]: [] }),
      Error,
    );
  }
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        children: [{
          ...manifest.children[0],
          script: "from build123d import Box\nresult = Box(1, 1, 1)\n",
        }],
      }),
    Error,
  );
});

Deno.test("module children must be immediate, ordered by usage identity, and name capture plus STEP", async () => {
  const manifest = completeManifest(await isolationAssets());
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        children: [manifest.children[1]!, manifest.children[0]!],
      }),
    GeometryModuleEvidenceError,
  );
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        children: [manifest.children[0]!, {
          ...manifest.children[1]!,
          usageElementId: manifest.children[0]!.usageElementId,
        }],
      }),
    GeometryModuleEvidenceError,
  );
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        children: [{
          ...manifest.children[0]!,
          childGeometry: {
            ...manifest.children[0]!.childGeometry,
            schemaVersion: "geometry-capture/2.1",
          },
        }, manifest.children[1]!],
      }),
    GeometryModuleEvidenceError,
  );
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        children: [{
          ...manifest.children[0]!,
          placementCapture: fp(A),
        }, manifest.children[1]!],
      }),
    GeometryModuleEvidenceError,
  );
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        children: [{
          usageElementId: manifest.children[0]!.usageElementId,
          partDefinitionElementId: manifest.children[0]!.partDefinitionElementId,
          placement: manifest.children[0]!.placement,
          placementCapture: manifest.children[0]!.placementCapture,
          childGeometry: manifest.children[0]!.childGeometry,
        }, manifest.children[1]!],
      }),
    Error,
  );
});

Deno.test("a geometry module rejects empty children and a missing placement analysis", async () => {
  const assets = await isolationAssets();
  const manifest = completeManifest(assets);
  assertThrows(
    () => parseGeometryModuleManifest({ ...manifest, children: [] }),
    GeometryModuleEvidenceError,
  );
  const { placementAnalysis: _placement, ...withoutPlacement } = manifest;
  assertThrows(
    () => parseGeometryModuleManifest(withoutPlacement),
    GeometryModuleEvidenceError,
  );
});

Deno.test("parseStructureCapture rejects a non-canonical part-definitions artifact id", async () => {
  const manifest = completeManifest(await isolationAssets());
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        structureCapture: {
          ...manifest.structureCapture,
          artifactId: `structure-${F}`,
        },
      }),
    GeometryModuleEvidenceError,
  );
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        structureCapture: {
          ...manifest.structureCapture,
          artifactId: `part-definitions-${A}`,
          fingerprint: fp(A),
        },
      }),
    GeometryModuleEvidenceError,
  );
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        structureCapture: {
          ...manifest.structureCapture,
          architecture: {
            artifactId: `architecture-${B}`,
            fingerprint: fp(B),
            uri: `casys://architecture-capture/sha256/${B}`,
          },
        },
      }),
    GeometryModuleEvidenceError,
  );
});

Deno.test("module predecessor is scoped to the exact PartDefinition target", async () => {
  const manifest = completeManifest(await isolationAssets());
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        predecessor: {
          ...manifest.predecessor!,
          partDefinitionElementId: "sysml.part.other",
        },
      }),
    GeometryModuleEvidenceError,
  );
  assertThrows(
    () =>
      parseGeometryModuleManifest({
        ...manifest,
        predecessor: {
          artifactId: manifest.predecessor!.artifactId,
          fingerprint: manifest.predecessor!.fingerprint,
        },
      }),
    Error,
  );
});

Deno.test("module evidence round-trips an opaque target with a leaf predecessor", async () => {
  const manifest = completeManifest(await isolationAssets());
  const opaqueTarget = "https://syson.example/elements#assembly/1";
  const leafPredecessor = {
    ...manifest.predecessor!,
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    partDefinitionElementId: opaqueTarget,
  };
  const changed = {
    ...manifest,
    target: { ...manifest.target, partDefinitionElementId: opaqueTarget },
    predecessor: leafPredecessor,
  };
  const encoded = encodeGeometryModuleDecisionParameters(F, changed);
  const decoded = parseGeometryModuleDecisionParameters(
    new Map(encoded.map((parameter) => [parameter.key, parameter.value])),
  );
  assertEquals(decoded.manifest.target.partDefinitionElementId, opaqueTarget);
  assertEquals(
    decoded.manifest.predecessor?.schemaVersion,
    GEOMETRY_PART_CAPTURE_SCHEMA,
  );
  assertEquals(
    decoded.manifest.structureCapture,
    manifest.structureCapture,
  );
});

Deno.test("module draft binds the input bundle, isolated receipt, child STEP and produced assets", async () => {
  const assets = await isolationAssets();
  const draft = await parseGeometryModuleDraftCapture(completeDraft(assets));
  assertEquals(draft.inputBundle.schemaVersion, GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA);
  assertEquals(draft.receipt.sourceSha256, assets.bundle.fingerprint.digest);
  assertEquals(draft.receipt.destruction.status, "proven");
  assertEquals(draft.receipt.profile, GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE);
  assertEquals(draft.children[0]?.authoritativeStep, assets.armStep);
  assertEquals(Object.hasOwn(draft, "script"), false);
  assertEquals(Object.hasOwn(draft, "lowerer"), false);
  assertEquals(Object.hasOwn(draft, "reopenedAdmissions"), false);
  assertEquals(geometryModuleManifestFromDraft(draft), completeManifest(assets));
  await assertRejects(
    () =>
      parseGeometryModuleDraftCapture({
        ...completeDraft(assets),
        script: "result = 1",
      }),
    Error,
  );
  await assertRejects(
    () =>
      parseGeometryModuleDraftCapture({
        ...completeDraft(assets),
        lowerer: { id: "geometry-module-assembly-lowerer" },
      }),
    Error,
  );
});

Deno.test("module draft refuses an unproven receipt, rejected exit, or mismatched bundle digest", async () => {
  const proven = await isolationAssets();
  const unproven = await isolationAssets({ destruction: "acknowledged-unattested" });
  await assertRejects(
    () =>
      parseGeometryModuleDraftCapture({
        ...completeDraft(proven),
        receipt: unproven.receipt,
      }),
    GeometryModuleEvidenceError,
  );
  const rejected = await isolationAssets({ exitCode: 1 });
  await assertRejects(
    () =>
      parseGeometryModuleDraftCapture({
        ...completeDraft(proven),
        receipt: rejected.receipt,
      }),
    GeometryModuleEvidenceError,
  );
  const foreignSource = await isolationAssets({
    sourceBytes: encoder.encode("foreign-bundle"),
  });
  await assertRejects(
    () =>
      parseGeometryModuleDraftCapture({
        ...completeDraft(proven),
        receipt: foreignSource.receipt,
      }),
    GeometryModuleEvidenceError,
  );
  const foreignProfile = await isolationAssets({
    profileId: "build123d-closed-subset-v1",
  });
  await assertRejects(
    () =>
      parseGeometryModuleDraftCapture({
        ...completeDraft(proven),
        receipt: foreignProfile.receipt,
      }),
    GeometryModuleEvidenceError,
  );
});

Deno.test("module capture seals assembly STEP plus GLB and exact child references only", async () => {
  const assets = await isolationAssets();
  const capture = await parseGeometryModuleCapture(completeCapture(assets));
  assertEquals(capture.schemaVersion, GEOMETRY_MODULE_CAPTURE_SCHEMA);
  assertEquals(capture.operation, DESIGN_WRITE_GEOMETRY_OPERATION);
  assertEquals(capture.assemblyStep, assets.step);
  assertEquals(capture.assemblyGlb, assets.glb);
  assertEquals(capture.receipt.fingerprint, assets.receipt.fingerprint);
  assertEquals(
    capture.children[0]?.childGeometry.schemaVersion,
    GEOMETRY_PART_CAPTURE_SCHEMA,
  );
  await assertRejects(
    () => parseGeometryModuleCapture({ ...completeCapture(assets), verdict: "pass" }),
    Error,
  );
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...completeCapture(assets),
        children: [completeCapture(assets).children[0]!],
      }),
    GeometryModuleEvidenceError,
  );
});

Deno.test("module capture recrosses architecture and structure identities exactly", async () => {
  const assets = await isolationAssets();
  const capture = completeCapture(assets);
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...capture,
        architectureBasis: {
          ...capture.architectureBasis,
          artifactId: `architecture-${B}`,
        },
      }),
    GeometryModuleEvidenceError,
  );
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...capture,
        architectureBasis: {
          ...capture.architectureBasis,
          fingerprint: fp(B),
          artifactId: `architecture-${B}`,
        },
      }),
    GeometryModuleEvidenceError,
  );
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...capture,
        structureCapture: {
          ...capture.structureCapture,
          fingerprint: fp(A),
          artifactId: `part-definitions-${A}`,
          uri: `casys://part-definitions-capture/sha256/${A}`,
        },
      }),
    GeometryModuleEvidenceError,
  );
});

Deno.test("module capture refuses a receipt or bundle A paired with child table B", async () => {
  const assets = await isolationAssets();
  const capture = completeCapture(assets);
  const moved = withChildren(assets, [{
    ...capture.children[0]!,
    placement: { translationMm: [9, 0, 0], rotationDeg: [0, 0, 0] },
  }, capture.children[1]!]);
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...moved,
        inputBundle: capture.inputBundle,
        manifest: {
          ...moved.manifest,
          assembly: {
            ...moved.manifest.assembly!,
            inputBundle: capture.inputBundle,
          },
        },
      }),
    GeometryModuleEvidenceError,
  );

  const otherCapture = withChildren(assets, [{
    ...capture.children[0]!,
    childGeometry: {
      schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
      artifactId: `geometry-${A}`,
      fingerprint: fp(A),
    },
  }, capture.children[1]!]);
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...otherCapture,
        inputBundle: capture.inputBundle,
        manifest: {
          ...otherCapture.manifest,
          assembly: {
            ...otherCapture.manifest.assembly!,
            inputBundle: capture.inputBundle,
          },
        },
      }),
    GeometryModuleEvidenceError,
  );

  const otherStep = withChildren(assets, [{
    ...capture.children[0]!,
    authoritativeStep: {
      fingerprint: fp(A),
      bytes: capture.children[0]!.authoritativeStep.bytes + 1,
    },
  }, capture.children[1]!]);
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...otherStep,
        inputBundle: capture.inputBundle,
        manifest: {
          ...otherStep.manifest,
          assembly: {
            ...otherStep.manifest.assembly!,
            inputBundle: capture.inputBundle,
          },
        },
      }),
    GeometryModuleEvidenceError,
  );

  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...capture,
        children: [],
        manifest: { ...capture.manifest, children: [] },
      }),
    GeometryModuleEvidenceError,
  );
});

Deno.test("module locators compare the complete identity, not only casUri", async () => {
  const assets = await isolationAssets();
  const capture = completeCapture(assets);
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...capture,
        sourceClosure: sourceClosure(A, 256),
      }),
    GeometryModuleEvidenceError,
  );
  await assertRejects(
    () =>
      parseGeometryModuleCapture({
        ...capture,
        placementAnalysis: placementAnalysis(B, 128),
      }),
    GeometryModuleEvidenceError,
  );
});

Deno.test("the sealer helper matches the persisted identity and is not a byte proof", async () => {
  const assets = await isolationAssets();
  const identity = completeManifest(assets).assembly!.inputBundle;
  assertEquals(
    geometryModuleInputBundleMatchesIdentity({
      fingerprint: identity.fingerprint,
      bytes: { byteLength: identity.byteCount },
      manifest: identity.manifest,
    }, identity),
    true,
  );
  assertEquals(
    geometryModuleInputBundleMatchesIdentity({
      fingerprint: identity.fingerprint,
      bytes: { byteLength: identity.byteCount + 1 },
      manifest: identity.manifest,
    }, identity),
    false,
  );
  const foreign = inputBundleIdentity(assets, [
    child("sysml.usage.arm", "sysml.part.arm", assets.armStep),
    {
      ...child("sysml.usage.base", "sysml.part.base", assets.baseStep),
      placement: { translationMm: [0, 0, 4], rotationDeg: [0, 0, 0] },
    },
  ]);
  assertEquals(
    geometryModuleInputBundleMatchesIdentity({
      fingerprint: identity.fingerprint,
      bytes: { byteLength: identity.byteCount },
      manifest: foreign.manifest,
    }, identity),
    false,
  );
});
