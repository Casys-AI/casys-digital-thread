/**
 * Tests for the geometry-decision-model.ts parser.
 *
 * Invariants under test:
 *
 * - A well-formed parameter list (as produced by encodeGeometryDecisionParameters)
 *   is parsed into a valid GeometryDecisionView with correct values.
 * - Missing required parameters produce an invalid view, not a thrown error.
 * - A malformed fingerprint digest produces an invalid view.
 * - Zero assembly files and zero components are accepted.
 * - The primaryAssetPreviewPath prefers glTF over other formats.
 * - When no assembly files are present, primaryAssetPreviewPath is undefined.
 * - A parameter list with no geometry.draft.digest key is invalid.
 *
 * Tests are named as invariant phrases, not method names.
 */

import { assertEquals } from "@std/assert";
import {
  encodeGeometryBundleDecisionParameters,
  type GeometryBundleManifest,
} from "../domain/cad/canonical/geometry-bundle.ts";
import {
  encodeGeometryDecisionParameters,
  type GeometryManifest,
} from "../domain/cad/canonical/geometry-proposal.ts";
import {
  encodeGeometryPartDecisionParameters,
  type GeometryPartManifest,
} from "../domain/cad/canonical/geometry-part-manifest.ts";
import {
  type GeometryDecisionParameter,
  parseGeometryDecisionView,
} from "./src/cad/geometry-decision-model.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const HEX64_A = "a".repeat(64);
const HEX64_B = "b".repeat(64);
const HEX64_C = "c".repeat(64);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid parameter list for the geometry MRTR decision. */
function minimalParams(
  overrides: Partial<Record<string, string | number | boolean>> = {},
  extraParams: GeometryDecisionParameter[] = [],
): GeometryDecisionParameter[] {
  const base: Record<string, string | number | boolean> = {
    "geometry.draft.digest": HEX64_A,
    "geometry.manifest.schemaVersion": "geometry-manifest/1.0",
    "geometry.manifest.architectureBasis.snapshotId": "snap-arch-001",
    "geometry.manifest.architectureBasis.revision": 3,
    "geometry.manifest.architectureBasis.artifactFingerprint": HEX64_B,
    "geometry.manifest.unitSystem": "mm",
    "geometry.manifest.exportFormats": "gltf",
    "geometry.manifest.scriptHash": HEX64_C,
    "geometry.manifest.assemblyFiles.count": 1,
    "geometry.manifest.assemblyFiles.0.format": "gltf",
    "geometry.manifest.assemblyFiles.0.name": "geometry-preview-assembly",
    "geometry.manifest.assemblyFiles.0.fingerprint": HEX64_A,
    "geometry.manifest.components.count": 0,
    "geometry.manifest.partMeshes.count": 0,
    ...overrides,
  };
  const params: GeometryDecisionParameter[] = Object.entries(base).map((
    [key, value],
  ) => ({
    key,
    label: key,
    value,
  }));
  return [...params, ...extraParams];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("a well-formed geometry decision parameter list parses into a valid view", () => {
  const result = parseGeometryDecisionView(minimalParams());
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.draftDigest, HEX64_A);
  assertEquals(result.architecture.snapshotId, "snap-arch-001");
  assertEquals(result.architecture.revision, 3);
  assertEquals(result.architecture.artifactDigest, HEX64_B);
  assertEquals(result.unitSystem, "mm");
  assertEquals(result.exportFormats, ["gltf"]);
  assertEquals(result.scriptDigest, HEX64_C);
  assertEquals(result.assemblyFiles.length, 1);
  assertEquals(result.assemblyFiles[0]!.format, "gltf");
  assertEquals(result.assemblyFiles[0]!.name, "geometry-preview-assembly");
  assertEquals(result.assemblyFiles[0]!.digest, HEX64_A);
  assertEquals(result.components.length, 0);
  assertEquals(result.primaryAssetFormat, "gltf");
});

Deno.test("a missing required parameter produces an invalid view, not a thrown error", () => {
  const params = minimalParams();
  // Remove the required draft digest.
  const filtered = params.filter((p) => p.key !== "geometry.draft.digest");
  const result = parseGeometryDecisionView(filtered);
  assertEquals(result.kind, "invalid");
  if (result.kind !== "invalid") return;
  assertEquals(result.reason.includes("geometry.draft.digest"), true);
});

Deno.test("a malformed fingerprint digest in the draft key produces an invalid view", () => {
  const params = minimalParams({ "geometry.draft.digest": "not-a-hex-digest" });
  const result = parseGeometryDecisionView(params);
  assertEquals(result.kind, "invalid");
});

Deno.test("zero assembly files and zero components are accepted as a valid view", () => {
  const params = minimalParams({
    "geometry.manifest.assemblyFiles.count": 0,
    "geometry.manifest.components.count": 0,
  });
  // Remove any assembly file sub-keys to ensure there are none.
  const filtered = params.filter(
    (p) => !p.key.startsWith("geometry.manifest.assemblyFiles.0."),
  );
  const result = parseGeometryDecisionView(filtered);
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.assemblyFiles.length, 0);
  assertEquals(result.components.length, 0);
  assertEquals(result.primaryAssetFormat, undefined);
});

Deno.test("primaryAssetPreviewPath prefers the gltf file over other assembly formats", () => {
  const params = minimalParams(
    {
      "geometry.manifest.assemblyFiles.count": 2,
      "geometry.manifest.assemblyFiles.0.format": "step",
      "geometry.manifest.assemblyFiles.0.name": "geometry-preview-assembly",
      "geometry.manifest.assemblyFiles.0.fingerprint": HEX64_A,
      "geometry.manifest.assemblyFiles.1.format": "gltf",
      "geometry.manifest.assemblyFiles.1.name": "geometry-preview-assembly",
      "geometry.manifest.assemblyFiles.1.fingerprint": HEX64_B,
    },
  );
  const result = parseGeometryDecisionView(params);
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.primaryAssetPreviewPath, `/api/draft-assets/${HEX64_B}`);
  assertEquals(result.primaryAssetFormat, "gltf");
});

Deno.test("primaryAssetPreviewPath is undefined when there are no assembly files", () => {
  const params = minimalParams({
    "geometry.manifest.assemblyFiles.count": 0,
  });
  const filtered = params.filter(
    (p) => !p.key.startsWith("geometry.manifest.assemblyFiles.0."),
  );
  const result = parseGeometryDecisionView(filtered);
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.primaryAssetPreviewPath, undefined);
  assertEquals(result.primaryAssetFormat, undefined);
});

Deno.test("primaryAssetFormat is stl when the only assembly file is stl", () => {
  const params = minimalParams({
    "geometry.manifest.assemblyFiles.0.format": "stl",
    "geometry.manifest.assemblyFiles.0.fingerprint": HEX64_A,
  });
  const result = parseGeometryDecisionView(params);
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.primaryAssetFormat, "stl");
  assertEquals(
    result.primaryAssetPreviewPath,
    `/api/draft-assets/${HEX64_A}`,
  );
});

Deno.test("a parameter list with one component is parsed with correct bindings", () => {
  const params = minimalParams(
    {
      "geometry.manifest.components.count": 1,
    },
    [
      {
        key: "geometry.manifest.components.0.usageName",
        label: "Component 0 usage name",
        value: "dripTray",
      },
      {
        key: "geometry.manifest.components.0.elementId",
        label: "Component 0 element ID",
        value: "urn:syson:element:abc123",
      },
      {
        key: "geometry.manifest.components.0.label",
        label: "Component 0 label",
        value: "Drip Tray",
      },
    ],
  );
  const result = parseGeometryDecisionView(params);
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.components.length, 1);
  assertEquals(result.components[0]!.usageName, "dripTray");
  assertEquals(result.components[0]!.elementId, "urn:syson:element:abc123");
  assertEquals(result.components[0]!.label, "Drip Tray");
});

Deno.test("an assembly file with an invalid format produces an invalid view", () => {
  const params = minimalParams({
    "geometry.manifest.assemblyFiles.0.format": "pdf",
  });
  const result = parseGeometryDecisionView(params);
  assertEquals(result.kind, "invalid");
});

Deno.test("geometry review fails closed on duplicate and unexpected parameters", () => {
  const duplicate = parseGeometryDecisionView(minimalParams({}, [{
    key: "geometry.draft.digest",
    label: "duplicate",
    value: HEX64_B,
  }]));
  assertEquals(duplicate.kind, "invalid");

  const unexpected = parseGeometryDecisionView(minimalParams({}, [{
    key: "geometry.internal.requestState",
    label: "must never be projected",
    value: "secret",
  }]));
  assertEquals(unexpected.kind, "invalid");
});

Deno.test("geometry review rejects an unsupported manifest schema", () => {
  assertEquals(
    parseGeometryDecisionView(minimalParams({
      "geometry.manifest.schemaVersion": "geometry-manifest/9.0",
    })).kind,
    "invalid",
  );
});

Deno.test("a v2 geometry decision exposes separate definitions and occurrences", () => {
  const base = minimalParams({
    "geometry.manifest.schemaVersion": "geometry-manifest/2.0",
    "geometry.manifest.predecessor.present": false,
    "geometry.manifest.placementConvention": "right-handed-mm-extrinsic-xyz-degrees",
    "geometry.manifest.exportFormats": "gltf,step",
    "geometry.manifest.assemblyFiles.count": 2,
    "geometry.manifest.assemblyFiles.1.format": "step",
    "geometry.manifest.assemblyFiles.1.name": "geometry-preview-assembly",
    "geometry.manifest.assemblyFiles.1.fingerprint": HEX64_B,
    "geometry.manifest.components.count": 1,
    "geometry.manifest.components.0.usageName": "base",
    "geometry.manifest.components.0.elementId": "usage-base",
    "geometry.manifest.components.0.label": "Base",
    "geometry.manifest.partExportFormats": "step",
    "geometry.manifest.partDefinitions.count": 1,
    "geometry.manifest.partDefinitions.0.elementId": "def-base",
    "geometry.manifest.partDefinitions.0.label": "WeightedBase",
    "geometry.manifest.partDefinitions.0.scriptHash": HEX64_B,
    "geometry.manifest.partDefinitions.0.files.count": 1,
    "geometry.manifest.partDefinitions.0.files.0.format": "step",
    "geometry.manifest.partDefinitions.0.files.0.name": "weighted-base",
    "geometry.manifest.partDefinitions.0.files.0.fingerprint": HEX64_C,
    "geometry.manifest.occurrences.count": 1,
    "geometry.manifest.occurrences.0.usageElementId": "usage-base",
    "geometry.manifest.occurrences.0.partDefinitionElementId": "def-base",
    "geometry.manifest.occurrences.0.translationMm.0": 0,
    "geometry.manifest.occurrences.0.translationMm.1": 0,
    "geometry.manifest.occurrences.0.translationMm.2": 0,
    "geometry.manifest.occurrences.0.rotationDeg.0": 0,
    "geometry.manifest.occurrences.0.rotationDeg.1": 0,
    "geometry.manifest.occurrences.0.rotationDeg.2": 0,
  }).filter((parameter) => parameter.key !== "geometry.manifest.partMeshes.count");
  const result = parseGeometryDecisionView(base);
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.schemaVersion, "geometry-manifest/2.0");
  assertEquals(result.partDefinitions[0]?.label, "WeightedBase");
  assertEquals(result.occurrences[0]?.partDefinitionElementId, "def-base");
  assertEquals(result.partExportFormats, ["step"]);
  assertEquals(result.predecessor, undefined);
});

Deno.test("the browser parser stays in parity with the domain v2 MRTR encoder", () => {
  const fingerprint = (digest: string) => ({
    algorithm: "sha256" as const,
    digest,
  });
  const manifest: GeometryBundleManifest = {
    schemaVersion: "geometry-manifest/2.0",
    architectureBasis: {
      snapshotId: "thread:r4",
      revision: 4,
      artifactFingerprint: fingerprint(HEX64_A),
    },
    predecessor: {
      artifactId: "geometry-r3",
      fingerprint: fingerprint(HEX64_B),
    },
    components: [{
      usageName: "base",
      elementId: "usage-base",
      label: "Base",
    }],
    unitSystem: "mm",
    placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
    exportFormats: ["step", "gltf"],
    partExportFormats: ["step"],
    partDefinitions: [{
      elementId: "definition-base",
      label: "Weighted base",
      scriptHash: fingerprint(HEX64_B),
      files: [{
        format: "step",
        name: "weighted-base.step",
        fingerprint: fingerprint(HEX64_C),
      }],
    }],
    occurrences: [{
      usageElementId: "usage-base",
      partDefinitionElementId: "definition-base",
      placement: {
        translationMm: [0, 0, 0],
        rotationDeg: [0, 0, 0],
      },
    }],
    scriptHash: fingerprint(HEX64_C),
    artifactHashes: {
      assemblyFiles: [{
        format: "step",
        name: "desk-lamp.step",
        fingerprint: fingerprint(HEX64_A),
      }, {
        format: "gltf",
        name: "desk-lamp.glb",
        fingerprint: fingerprint(HEX64_B),
      }],
      partMeshes: [],
    },
  };

  const result = parseGeometryDecisionView(
    encodeGeometryBundleDecisionParameters(HEX64_C, manifest),
  );
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.predecessor, {
    artifactId: "geometry-r3",
    digest: HEX64_B,
  });
  assertEquals(result.assemblyFiles.map((file) => file.format), [
    "step",
    "gltf",
  ]);
});

Deno.test("the browser parser presents a target PartDefinition without assembly or placement claims", () => {
  const fingerprint = (digest: string) => ({
    algorithm: "sha256" as const,
    digest,
  });
  const manifest: GeometryPartManifest = {
    schemaVersion: "geometry-part-manifest/1.0",
    architectureBasis: {
      snapshotId: "thread:r4",
      revision: 4,
      artifactFingerprint: fingerprint(HEX64_A),
    },
    unitSystem: "mm",
    exportFormats: ["step", "gltf"],
    target: {
      partDefinitionElementId: "definition-arm",
      label: "Arm",
      scriptHash: fingerprint(HEX64_B),
      files: [{
        format: "step",
        name: "arm.step",
        fingerprint: fingerprint(HEX64_C),
      }, {
        format: "gltf",
        name: "arm.glb",
        fingerprint: fingerprint(HEX64_A),
      }],
    },
  };
  const result = parseGeometryDecisionView(
    encodeGeometryPartDecisionParameters(HEX64_C, manifest),
  );
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.schemaVersion, "geometry-part-manifest/1.0");
  assertEquals(result.targetPart?.partDefinitionElementId, "definition-arm");
  assertEquals(result.assemblyFiles, []);
  assertEquals(result.components, []);
  assertEquals(result.occurrences, []);
});

Deno.test("the browser parser stays compatible with geometry capture 1.1 manifest parameters", () => {
  const fingerprint = (digest: string) => ({
    algorithm: "sha256" as const,
    digest,
  });
  const manifest: GeometryManifest = {
    schemaVersion: "geometry-manifest/1.0",
    architectureBasis: {
      snapshotId: "thread:r4",
      revision: 4,
      artifactFingerprint: fingerprint(HEX64_A),
    },
    components: [{
      usageName: "base",
      elementId: "usage-base",
      label: "Weighted base",
    }],
    unitSystem: "mm",
    exportFormats: ["gltf", "step"],
    scriptHash: fingerprint(HEX64_C),
    artifactHashes: {
      assemblyFiles: [{
        format: "gltf",
        name: "desk-lamp.glb",
        fingerprint: fingerprint(HEX64_A),
      }, {
        format: "step",
        name: "desk-lamp.step",
        fingerprint: fingerprint(HEX64_B),
      }],
      partMeshes: [{
        semanticKey: "weighted-base",
        name: "weighted-base.stl",
        fingerprint: fingerprint(HEX64_C),
      }],
    },
  };
  const result = parseGeometryDecisionView(
    encodeGeometryDecisionParameters(HEX64_A, manifest),
  );
  assertEquals(result.kind, "valid");
  if (result.kind !== "valid") return;
  assertEquals(result.schemaVersion, "geometry-manifest/1.0");
  assertEquals(result.assemblyFiles.map((file) => file.format), [
    "gltf",
    "step",
  ]);
  assertEquals(result.components[0]?.elementId, "usage-base");
});
