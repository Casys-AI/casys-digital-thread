import { assertEquals, assertRejects } from "@std/assert";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  type GeometryModuleCapture,
  type GeometryModuleDraftCapture,
  type GeometryModuleManifest,
} from "../../../domain/cad/canonical/geometry-module-evidence.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "../../../domain/cad/canonical/geometry-part-manifest.ts";
import { GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA } from "../../../domain/cad/canonical/geometry-draft-admission.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  PROJECT_SOURCE_CLOSURE_URI_PREFIX,
} from "../../../domain/project-source-workspace/closure.ts";
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
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const G = "1".repeat(64);
const H = "2".repeat(64);

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function fixture() {
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
    children: [{
      usageElementId: "sysml.usage.arm",
      partDefinitionElementId: "sysml.part.arm",
      placement: { translationMm: [1, 0, 0], rotationDeg: [0, 90, 0] },
      placementCapture: fp(B),
      childGeometry: {
        schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
        artifactId: `geometry-${E}`,
        fingerprint: fp(E),
      },
    }],
    unitSystem: "mm",
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    exportFormats: ["step", "gltf"],
    assembly: {
      programDigest: fp(H),
      files: [
        { format: "step", name: "geometry-module-assembly", fingerprint: fp(C) },
        { format: "gltf", name: "geometry-module-assembly", fingerprint: fp(D) },
      ],
    },
  };
  const draft: Omit<GeometryModuleDraftCapture, "fingerprint"> = {
    schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    kind: GEOMETRY_MODULE_DRAFT_KIND,
    capturedAt: "2026-08-25T10:00:00.000Z",
    architectureBasis: manifest.architectureBasis,
    structureCapture: manifest.structureCapture,
    target: manifest.target,
    predecessor: manifest.predecessor,
    sourceClosure: manifest.sourceClosure,
    targetAdmission: {
      schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
      artifactId: `technical-compilation-admission-${C}`,
      fingerprint: fp(C),
      sourceFingerprint: fp(D),
      target: manifest.target,
    },
    placementAnalysis: manifest.placementAnalysis,
    children: manifest.children,
    unitSystem: "mm",
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    exportFormats: manifest.exportFormats,
    lowerer: {
      id: "geometry-module-assembly-lowerer",
      version: "1.0",
      fingerprint: fp(A),
    },
    compilerProfile: {
      profileId: "cad-compiler",
      profileVersion: "1.0",
      profileFingerprint: fp(B),
    },
    assemblyProgramDigest: fp(H),
    reopenedAdmissions: [{
      usageElementId: "sysml.usage.arm",
      admission: {
        schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
        artifactId: `technical-compilation-admission-${C}`,
        fingerprint: fp(C),
        sourceFingerprint: fp(D),
        target: { partDefinitionElementId: "sysml.part.arm", label: "Arm" },
      },
    }],
    assemblyFiles: [
      {
        format: "step",
        name: "geometry-module-assembly",
        fingerprint: fp(C),
        bytes: 2048,
      },
      {
        format: "gltf",
        name: "geometry-module-assembly",
        fingerprint: fp(D),
        bytes: 1024,
      },
    ],
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
    targetAdmission: draft.targetAdmission,
    placementAnalysis: manifest.placementAnalysis,
    children: manifest.children,
    predecessor: manifest.predecessor,
    lowerer: draft.lowerer,
    compilerProfile: draft.compilerProfile,
    assembly: {
      programDigest: fp(H),
      files: draft.assemblyFiles,
      authoritativeStep: { fileIndex: 0, fingerprint: fp(C), bytes: 2048 },
    },
    sealedAt: "2026-08-25T10:05:00.000Z",
  };
  return { draft, capture };
}

Deno.test("module evidence stores save and reread through the existing geometry CAS", async () => {
  await usingDirectory(async (directory) => {
    const { draft, capture } = fixture();
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
    const { draft, capture } = fixture();
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
      () => draftStore.save({ schemaVersion: "geometry-part-draft-capture/1.0" }),
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
