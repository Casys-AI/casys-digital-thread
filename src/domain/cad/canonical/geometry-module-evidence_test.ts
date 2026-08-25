import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
  encodeGeometryModuleDecisionParameters,
  GEOMETRY_MODULE_ASSEMBLY_GLB_OUTPUT,
  GEOMETRY_MODULE_ASSEMBLY_ISOLATED_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_STEP_OUTPUT,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  type GeometryModuleCapture,
  type GeometryModuleDraftCapture,
  GeometryModuleEvidenceError,
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

function sourceClosure(digest = A) {
  return {
    schemaVersion: PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
    fingerprint: fp(digest),
    byteCount: 128,
    casUri: `${PROJECT_SOURCE_CLOSURE_URI_PREFIX}${digest}`,
  };
}

function placementAnalysis(digest = B) {
  return {
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint: fp(digest),
    byteCount: 64,
    casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${digest}`,
  };
}

function child(
  usageElementId: string,
  partDefinitionElementId: string,
  step: { readonly fingerprint: ReturnType<typeof fp>; readonly bytes: number },
) {
  return {
    usageElementId,
    partDefinitionElementId,
    placement: {
      translationMm: [1, 0, 0] as const,
      rotationDeg: [0, 90, 0] as const,
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
  const outputs = [
    { ...GEOMETRY_MODULE_ASSEMBLY_STEP_OUTPUT, bytes: STEP_BYTES, sha256: stepDigest },
    { ...GEOMETRY_MODULE_ASSEMBLY_GLB_OUTPUT, bytes: GLB_BYTES, sha256: glbDigest },
  ];
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration: 0,
    profile: {
      id: overrides.profileId ?? GEOMETRY_MODULE_ASSEMBLY_ISOLATED_PROFILE.id,
      version: GEOMETRY_MODULE_ASSEMBLY_ISOLATED_PROFILE.version,
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
    children: [
      child("sysml.usage.arm", "sysml.part.arm", assets.armStep),
      child("sysml.usage.base", "sysml.part.base", assets.baseStep),
    ],
    unitSystem: "mm",
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly: {
      inputBundle: {
        schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
        fingerprint: assets.bundle.fingerprint,
        byteCount: assets.bundle.byteCount,
      },
      step: { fingerprint: assets.step.fingerprint },
      glb: { fingerprint: assets.glb.fingerprint },
    },
  };
}

function leafManifest(assets: IsolationAssets): GeometryModuleManifest {
  const { placementAnalysis: _placement, predecessor: _pred, ...rest } =
    completeManifest(assets);
  return {
    ...rest,
    target: { partDefinitionElementId: "sysml.part.leaf", label: "Leaf" },
    children: [],
  };
}

function completeDraft(
  assets: IsolationAssets,
): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  const manifest = completeManifest(assets);
  return {
    schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    kind: GEOMETRY_MODULE_DRAFT_KIND,
    capturedAt: "2026-08-25T10:00:00.000Z",
    architectureBasis: manifest.architectureBasis,
    structureCapture: manifest.structureCapture,
    target: manifest.target,
    predecessor: manifest.predecessor,
    sourceClosure: manifest.sourceClosure,
    placementAnalysis: manifest.placementAnalysis,
    children: manifest.children,
    unitSystem: "mm",
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

Deno.test("a leaf module records structure and assets without fabricating children", async () => {
  const assets = await isolationAssets();
  const manifest = parseGeometryModuleManifest(leafManifest(assets), {
    requireCompleted: true,
  });
  assertEquals(manifest.children, []);
  assertEquals(manifest.placementAnalysis, undefined);
  assertEquals(manifest.assembly?.step.fingerprint, assets.step.fingerprint);
  assertEquals(manifest.assembly?.glb.fingerprint, assets.glb.fingerprint);
});

Deno.test("module draft binds the input bundle, isolated receipt, child STEP and produced assets", async () => {
  const assets = await isolationAssets();
  const draft = await parseGeometryModuleDraftCapture(completeDraft(assets));
  assertEquals(draft.inputBundle.schemaVersion, GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA);
  assertEquals(draft.receipt.sourceSha256, assets.bundle.fingerprint.digest);
  assertEquals(draft.receipt.destruction.status, "proven");
  assertEquals(draft.receipt.profile, GEOMETRY_MODULE_ASSEMBLY_ISOLATED_PROFILE);
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
