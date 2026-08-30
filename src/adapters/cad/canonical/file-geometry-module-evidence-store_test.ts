import { assertEquals, assertRejects } from "@std/assert";
import {
  GEOMETRY_MODULE_ASSEMBLY_ASSETS,
  GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
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
  type GeometryModuleDraftCapture,
  type GeometryModuleManifest,
} from "../../../domain/cad/canonical/geometry-module-evidence.ts";
import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "../../../domain/cad/canonical/geometry-part-manifest.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import { validateGeometryModuleInputBundleManifest } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
} from "../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  PROJECT_SOURCE_CLOSURE_URI_PREFIX,
} from "../../../domain/project-source-workspace/closure.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import {
  FileGeometryModuleCaptureStore,
  FileGeometryModuleDraftStore,
} from "./file-geometry-module-evidence-store.ts";

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

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

async function fixture() {
  const bundleDigest = await fingerprintResourceBytes(BUNDLE_BYTES);
  const stepDigest = await fingerprintResourceBytes(STEP_BYTES);
  const glbDigest = await fingerprintResourceBytes(GLB_BYTES);
  const armDigest = await fingerprintResourceBytes(ARM_STEP_BYTES);
  const runId = "run.geometry-module.assembly.1";
  const children = [{
    usageElementId: "sysml.usage.arm",
    partDefinitionElementId: "sysml.part.arm",
    placement: { translationMm: [1, 0, 0] as const, rotationDeg: [0, 90, 0] as const },
    placementCapture: fp(B),
    childGeometry: {
      schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
      artifactId: `geometry-${E}`,
      fingerprint: fp(E),
    },
    authoritativeStep: {
      fingerprint: fp(armDigest),
      bytes: ARM_STEP_BYTES.byteLength,
    },
  }];
  const inputBundle = {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: fp(bundleDigest),
    byteCount: BUNDLE_BYTES.byteLength,
    manifest: validateGeometryModuleInputBundleManifest({
      schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
      unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
      placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
      occurrences: [{
        usageElementId: children[0]!.usageElementId,
        partDefinitionElementId: children[0]!.partDefinitionElementId,
        placement: children[0]!.placement,
        childCapture: children[0]!.childGeometry,
        step: {
          mediaType: GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
          byteOffset: 0,
          byteCount: children[0]!.authoritativeStep.bytes,
          sha256: children[0]!.authoritativeStep.fingerprint.digest,
        },
      }],
    }),
  };
  const assemblyStep = { fingerprint: fp(stepDigest), bytes: STEP_BYTES.byteLength };
  const assemblyGlb = { fingerprint: fp(glbDigest), bytes: GLB_BYTES.byteLength };
  const receipt = {
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
    capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
    runId,
    inputBundle: {
      fingerprint: inputBundle.fingerprint,
      byteCount: inputBundle.byteCount,
    },
    assembly: {
      step: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.step,
        fingerprint: assemblyStep.fingerprint,
        byteCount: assemblyStep.bytes,
      },
      glb: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
        fingerprint: assemblyGlb.fingerprint,
        byteCount: assemblyGlb.bytes,
      },
    },
    implementation: {
      id: "fixture-neutral-cad-assembler",
      version: "2026.1",
      evidenceFingerprint: fp(E),
    },
  } as const;
  const manifest: GeometryModuleManifest = {
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
    sourceClosure: {
      schemaVersion: PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
      kind: PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
      fingerprint: fp(A),
      byteCount: 128,
      casUri: `${PROJECT_SOURCE_CLOSURE_URI_PREFIX}${A}`,
    },
    placementAnalysis: {
      schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
      kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
      fingerprint: fp(B),
      byteCount: 64,
      casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${B}`,
    },
    children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly: {
      inputBundle,
      step: { fingerprint: assemblyStep.fingerprint },
      glb: { fingerprint: assemblyGlb.fingerprint },
    },
  };
  const draft: Omit<GeometryModuleDraftCapture, "fingerprint"> = {
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
    inputBundle,
    receipt,
    assemblyStep,
    assemblyGlb,
  };
  const capture: GeometryModuleCapture = {
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
    inputBundle,
    receipt,
    assemblyStep,
    assemblyGlb,
    sealedAt: "2026-08-25T10:05:00.000Z",
  };
  return { draft, capture };
}

Deno.test("module evidence stores save and reread through the existing geometry CAS", async () => {
  await usingDirectory(async (directory) => {
    const { draft, capture } = await fixture();
    const draftStore = new FileGeometryModuleDraftStore(
      new FileCaptureStore({
        ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
        directory: `${directory}/drafts`,
      }),
    );
    const captureStore = new FileGeometryModuleCaptureStore(
      new FileCaptureStore({
        ...GEOMETRY_CAPTURE_DESCRIPTOR,
        directory: `${directory}/captures`,
      }),
    );

    const persistedDraft = await draftStore.save(draft);
    const repeatedDraft = await draftStore.save(draft);
    assertEquals(repeatedDraft.fingerprint, persistedDraft.fingerprint);
    assertEquals(
      persistedDraft.uri,
      `casys://geometry-draft-capture/sha256/${persistedDraft.fingerprint.digest}`,
    );
    assertEquals(
      omitFingerprint(
        await draftStore.read(persistedDraft.fingerprint) as GeometryModuleDraftCapture,
      ),
      draft,
    );

    const persistedCapture = await captureStore.save(capture);
    assertEquals(
      persistedCapture.uri,
      `casys://geometry-capture/sha256/${persistedCapture.fingerprint.digest}`,
    );
    assertEquals(await captureStore.read(persistedCapture.fingerprint), capture);
  });
});

Deno.test("module evidence stores reject foreign schemas and corrupted bytes", async () => {
  await usingDirectory(async (directory) => {
    const { draft, capture } = await fixture();
    const draftStore = new FileGeometryModuleDraftStore(
      new FileCaptureStore({
        ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
        directory: `${directory}/drafts`,
      }),
    );
    const captureStore = new FileGeometryModuleCaptureStore(
      new FileCaptureStore({
        ...GEOMETRY_CAPTURE_DESCRIPTOR,
        directory: `${directory}/captures`,
      }),
    );
    const persistedDraft = await draftStore.save(draft);
    const persistedCapture = await captureStore.save(capture);
    await Deno.writeTextFile(
      `${directory}/drafts/${persistedDraft.fingerprint.digest}.json`,
      `${deterministicJson(draft)}\n`,
    );
    await assertRejects(
      () => draftStore.read(persistedDraft.fingerprint),
      Error,
    );
    await Deno.writeTextFile(
      `${directory}/captures/${persistedCapture.fingerprint.digest}.json`,
      "{}",
    );
    await assertRejects(
      () => captureStore.read(persistedCapture.fingerprint),
      Error,
    );
    await assertRejects(
      () => draftStore.save({ schemaVersion: "geometry-part-draft-capture/1.1" }),
      Error,
    );
  });
});

function omitFingerprint(
  draft: GeometryModuleDraftCapture,
): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  const { fingerprint: _fingerprint, ...unsigned } = draft;
  return unsigned;
}

async function usingDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "geometry-module-evidence-" });
  try {
    await run(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
