import { assertEquals, assertThrows } from "@std/assert";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
  encodeGeometryModuleDecisionParameters,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
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
import { GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA } from "./geometry-draft-admission.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "./geometry-proposal.ts";
import {
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  PROJECT_SOURCE_CLOSURE_URI_PREFIX,
} from "../../project-source-workspace/closure.ts";

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

function admission(partDefinitionElementId: string, label: string, digest = C) {
  return {
    schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
    artifactId: `technical-compilation-admission-${digest}`,
    fingerprint: fp(digest),
    sourceFingerprint: fp(D),
    target: { partDefinitionElementId, label },
  };
}

function child(
  usageElementId: string,
  partDefinitionElementId: string,
  options: { readonly captureSchema?: typeof GEOMETRY_PART_CAPTURE_SCHEMA } = {},
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
      schemaVersion: options.captureSchema ?? GEOMETRY_PART_CAPTURE_SCHEMA,
      artifactId: `geometry-${E}`,
      fingerprint: fp(E),
    },
  };
}

function completeManifest(): GeometryModuleManifest {
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
      child("sysml.usage.arm", "sysml.part.arm"),
      child("sysml.usage.base", "sysml.part.base"),
    ],
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
}

function leafManifest(): GeometryModuleManifest {
  const { placementAnalysis: _placement, predecessor: _pred, ...rest } =
    completeManifest();
  return {
    ...rest,
    target: { partDefinitionElementId: "sysml.part.leaf", label: "Leaf" },
    children: [],
    assembly: {
      programDigest: fp(H),
      files: completeManifest().assembly!.files,
    },
  };
}

function completeDraft(): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  const manifest = completeManifest();
  return {
    schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    kind: GEOMETRY_MODULE_DRAFT_KIND,
    capturedAt: "2026-08-25T10:00:00.000Z",
    architectureBasis: manifest.architectureBasis,
    structureCapture: manifest.structureCapture,
    target: manifest.target,
    predecessor: manifest.predecessor,
    sourceClosure: manifest.sourceClosure,
    targetAdmission: admission("sysml.part.assembly", "Assembly"),
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
    assemblyProgramDigest: manifest.assembly!.programDigest,
    reopenedAdmissions: [
      {
        usageElementId: "sysml.usage.arm",
        admission: admission("sysml.part.arm", "Arm", C),
      },
      {
        usageElementId: "sysml.usage.base",
        admission: admission("sysml.part.base", "Base", D),
      },
    ],
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
}

function completeCapture(): GeometryModuleCapture {
  const manifest = completeManifest();
  const draft = completeDraft();
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
    targetAdmission: draft.targetAdmission,
    placementAnalysis: manifest.placementAnalysis,
    children: manifest.children,
    predecessor: manifest.predecessor,
    lowerer: draft.lowerer,
    compilerProfile: draft.compilerProfile,
    assembly: {
      programDigest: manifest.assembly!.programDigest,
      files: draft.assemblyFiles,
      authoritativeStep: {
        fileIndex: 0,
        fingerprint: fp(C),
        bytes: 2048,
      },
    },
    sealedAt: "2026-08-25T10:05:00.000Z",
  };
}

Deno.test("module manifest round-trips through the exact flat MRTR grammar", () => {
  const manifest = completeManifest();
  const encoded = encodeGeometryModuleDecisionParameters(A, manifest);
  const params = new Map(encoded.map((parameter) => [parameter.key, parameter.value]));
  assertEquals(parseGeometryModuleDecisionParameters(params), {
    draftDigest: A,
    manifest,
  });
});

Deno.test("module manifest rejects bundle fields, source text and descendant copies", () => {
  const manifest = completeManifest();
  for (
    const field of [
      "components",
      "occurrences",
      "partDefinitions",
      "script",
      "sourceText",
      "verdict",
      "descendantManifests",
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

Deno.test("module children must be immediate, ordered by usage identity, and reference captures", () => {
  const manifest = completeManifest();
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
});

Deno.test("module predecessor is scoped to the exact PartDefinition target", () => {
  const manifest = completeManifest();
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

Deno.test("a leaf module records structure and assets without fabricating children", () => {
  const manifest = parseGeometryModuleManifest(leafManifest(), {
    requireCompleted: true,
  });
  assertEquals(manifest.children, []);
  assertEquals(manifest.placementAnalysis, undefined);
  assertEquals(manifest.assembly?.files[0]?.format, "step");
});

Deno.test("module draft records lowerer identity and reopened admissions without source text", () => {
  const draft = parseGeometryModuleDraftCapture(completeDraft());
  assertEquals(draft.lowerer.id, "geometry-module-assembly-lowerer");
  assertEquals(draft.reopenedAdmissions.length, 2);
  assertEquals(Object.hasOwn(draft, "script"), false);
  assertEquals(geometryModuleManifestFromDraft(draft), completeManifest());
  assertThrows(
    () => parseGeometryModuleDraftCapture({ ...completeDraft(), script: "result = 1" }),
    Error,
  );
  assertThrows(
    () =>
      parseGeometryModuleDraftCapture({
        ...completeDraft(),
        reopenedAdmissions: [completeDraft().reopenedAdmissions[0]!],
      }),
    GeometryModuleEvidenceError,
  );
});

Deno.test("module capture seals assembly assets and exact child references only", () => {
  const capture = parseGeometryModuleCapture(completeCapture());
  assertEquals(capture.schemaVersion, GEOMETRY_MODULE_CAPTURE_SCHEMA);
  assertEquals(capture.operation, DESIGN_WRITE_GEOMETRY_OPERATION);
  assertEquals(capture.assembly.authoritativeStep.fileIndex, 0);
  assertEquals(
    capture.children[0]?.childGeometry.schemaVersion,
    GEOMETRY_PART_CAPTURE_SCHEMA,
  );
  assertThrows(
    () => parseGeometryModuleCapture({ ...completeCapture(), verdict: "pass" }),
    Error,
  );
  assertThrows(
    () =>
      parseGeometryModuleCapture({
        ...completeCapture(),
        children: [completeCapture().children[0]!],
      }),
    GeometryModuleEvidenceError,
  );
});
