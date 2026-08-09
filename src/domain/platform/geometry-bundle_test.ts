import { assertEquals, assertThrows } from "@std/assert";
import {
  assertGeometryBundleManifest,
  encodeGeometryBundleDecisionParameters,
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
  GeometryBundleError,
  type GeometryBundleManifest,
  parseGeometryBundleDecisionParameters,
} from "./geometry-bundle.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function completeManifest(): GeometryBundleManifest {
  return {
    schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: "snapshot:architecture",
      revision: 4,
      artifactFingerprint: { algorithm: "sha256", digest: A },
    },
    components: [{ elementId: "usage:one", usageName: "left", label: "Left" }, {
      elementId: "usage:two",
      usageName: "right",
      label: "Right",
    }],
    unitSystem: "mm",
    placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
    exportFormats: ["step", "gltf"],
    partExportFormats: ["step", "gltf", "stl"],
    scriptHash: { algorithm: "sha256", digest: B },
    artifactHashes: {
      assemblyFiles: [{
        format: "step",
        name: "geometry-preview-assembly",
        fingerprint: { algorithm: "sha256", digest: A },
      }, {
        format: "gltf",
        name: "geometry-preview-assembly",
        fingerprint: { algorithm: "sha256", digest: B },
      }],
      partMeshes: [],
    },
    partDefinitions: [{
      elementId: "definition:shared",
      label: "Shared Definition",
      scriptHash: { algorithm: "sha256", digest: C },
      files: [{
        format: "step",
        name: "geometry-preview-definition-000",
        fingerprint: { algorithm: "sha256", digest: A },
      }, {
        format: "gltf",
        name: "geometry-preview-definition-000",
        fingerprint: { algorithm: "sha256", digest: B },
      }, {
        format: "stl",
        name: "geometry-preview-definition-000",
        fingerprint: { algorithm: "sha256", digest: C },
      }],
    }],
    occurrences: [{
      usageElementId: "usage:one",
      partDefinitionElementId: "definition:shared",
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    }, {
      usageElementId: "usage:two",
      partDefinitionElementId: "definition:shared",
      placement: { translationMm: [10, 0, 0], rotationDeg: [0, 0, 90] },
    }],
  };
}

Deno.test("geometry bundle MRTR round-trip preserves exact identities and placements", () => {
  const manifest = completeManifest();
  const encoded = encodeGeometryBundleDecisionParameters(C, manifest);
  const parsed = parseGeometryBundleDecisionParameters(
    new Map(encoded.map(({ key, value }) => [key, value])),
  );
  assertEquals(parsed, { draftDigest: C, manifest });
});

Deno.test("geometry bundle permits one PartDefinition reused by multiple PartUsages", () => {
  assertGeometryBundleManifest(completeManifest(), { requireCompleted: true });
});

Deno.test("geometry bundle permits distinct PartDefinitions with identical bytes", () => {
  const manifest = completeManifest();
  const sharedFiles = manifest.partDefinitions[0]!.files!;
  const secondDefinition = {
    elementId: "definition:second",
    label: "Second Definition",
    scriptHash: { algorithm: "sha256" as const, digest: C },
    files: sharedFiles,
  };
  const candidate: GeometryBundleManifest = {
    ...manifest,
    partDefinitions: [...manifest.partDefinitions, secondDefinition],
    occurrences: [{
      ...manifest.occurrences[0]!,
      partDefinitionElementId: "definition:shared",
    }, {
      ...manifest.occurrences[1]!,
      partDefinitionElementId: "definition:second",
    }],
  };
  assertGeometryBundleManifest(candidate, { requireCompleted: true });
});

Deno.test("geometry bundle rejects duplicate PartUsage identity", () => {
  const manifest = completeManifest();
  assertThrows(
    () =>
      assertGeometryBundleManifest({
        ...manifest,
        components: [manifest.components[0]!, manifest.components[0]!],
      }),
    GeometryBundleError,
    "duplicate PartUsage",
  );
});

Deno.test("geometry bundle rejects cross-kind semantic identity collisions", () => {
  const manifest = completeManifest();
  assertThrows(
    () =>
      assertGeometryBundleManifest({
        ...manifest,
        partDefinitions: [{
          ...manifest.partDefinitions[0]!,
          elementId: manifest.components[0]!.elementId,
        }],
        occurrences: manifest.occurrences.map((occurrence) => ({
          ...occurrence,
          partDefinitionElementId: manifest.components[0]!.elementId,
        })),
      }),
    GeometryBundleError,
    "reused across PartUsage and PartDefinition",
  );
});

Deno.test("geometry bundle rejects a missing occurrence", () => {
  const manifest = completeManifest();
  assertThrows(
    () => assertGeometryBundleManifest({ ...manifest, occurrences: [] }),
    GeometryBundleError,
    "cover every component PartUsage exactly once",
  );
});

Deno.test("geometry bundle rejects an occurrence targeting a missing definition", () => {
  const manifest = completeManifest();
  assertThrows(
    () =>
      assertGeometryBundleManifest({
        ...manifest,
        occurrences: [{
          ...manifest.occurrences[0]!,
          partDefinitionElementId: "definition:missing",
        }, manifest.occurrences[1]!],
      }),
    GeometryBundleError,
    "references missing PartDefinition",
  );
});

Deno.test("geometry bundle parser rejects a changed signed file hash", () => {
  const encoded = encodeGeometryBundleDecisionParameters(C, completeManifest());
  const params = new Map(encoded.map(({ key, value }) => [key, value]));
  params.set(
    "geometry.manifest.partDefinitions.0.files.0.fingerprint",
    "not-a-digest",
  );
  assertThrows(
    () => parseGeometryBundleDecisionParameters(params),
    GeometryBundleError,
    "lowercase SHA-256",
  );
});

Deno.test("geometry bundle rejects non-finite placement values", () => {
  const manifest = completeManifest();
  assertThrows(
    () =>
      assertGeometryBundleManifest({
        ...manifest,
        occurrences: [{
          ...manifest.occurrences[0]!,
          placement: {
            ...manifest.occurrences[0]!.placement,
            translationMm: [0, Number.NaN, 0],
          },
        }, manifest.occurrences[1]!],
      }),
    GeometryBundleError,
    "three finite numbers",
  );
});
