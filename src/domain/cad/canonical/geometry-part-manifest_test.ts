import { assertEquals, assertThrows } from "@std/assert";
import {
  assertGeometryPartManifest,
  encodeGeometryPartDecisionParameters,
  GEOMETRY_PART_MANIFEST_SCHEMA,
  type GeometryPartManifest,
  GeometryPartManifestError,
  parseGeometryPartDecisionParameters,
  parseGeometryPartManifest,
} from "./geometry-part-manifest.ts";
import { parseGeometryDecisionParameters } from "./geometry-proposal.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

function completeManifest(): GeometryPartManifest {
  return {
    schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: "snapshot.8",
      revision: 8,
      artifactFingerprint: { algorithm: "sha256", digest: A },
    },
    predecessor: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: `geometry-${B}`,
      fingerprint: { algorithm: "sha256", digest: B },
      partDefinitionElementId: "sysml.part.arm",
    },
    target: {
      partDefinitionElementId: "sysml.part.arm",
      label: "Arm",
      scriptHash: { algorithm: "sha256", digest: C },
      files: [{
        format: "step",
        name: "geometry-part-preview",
        fingerprint: { algorithm: "sha256", digest: D },
      }, {
        format: "gltf",
        name: "geometry-part-preview",
        fingerprint: { algorithm: "sha256", digest: A },
      }],
    },
    unitSystem: "mm",
    exportFormats: ["step", "gltf"],
  };
}

Deno.test("targeted PartDefinition manifest round-trips through the exact flat MRTR grammar", () => {
  const manifest = completeManifest();
  const encoded = encodeGeometryPartDecisionParameters(A, manifest);
  const params = new Map(encoded.map((parameter) => [parameter.key, parameter.value]));

  const parsed = parseGeometryPartDecisionParameters(params);
  const routed = parseGeometryDecisionParameters(params);

  assertEquals(parsed, { draftDigest: A, manifest });
  assertEquals(routed, parsed as unknown);
  assertEquals(routed.manifest.schemaVersion, GEOMETRY_PART_MANIFEST_SCHEMA);
});

Deno.test("targeted PartDefinition manifest rejects bundle and assembly fields", () => {
  const incomplete = completeManifest();
  const forbiddenFields = [
    "components",
    "occurrences",
    "placementConvention",
    "assembly",
    "partDefinitions",
    "scriptHash",
    "artifactHashes",
  ];
  for (const field of forbiddenFields) {
    assertThrows(
      () => parseGeometryPartManifest({ ...incomplete, [field]: [] }),
      Error,
    );
  }
});

Deno.test("targeted PartDefinition manifest requires STEP and completed target facts", () => {
  const manifest = completeManifest();
  assertThrows(
    () => assertGeometryPartManifest({ ...manifest, exportFormats: ["gltf"] }),
    GeometryPartManifestError,
  );
  assertThrows(
    () =>
      assertGeometryPartManifest({
        ...manifest,
        target: {
          partDefinitionElementId: manifest.target.partDefinitionElementId,
          label: manifest.target.label,
        },
      }, { requireCompleted: true }),
    GeometryPartManifestError,
  );
});

Deno.test("targeted PartDefinition parser refuses unreviewed MRTR keys", () => {
  const params = new Map(
    encodeGeometryPartDecisionParameters(A, completeManifest()).map((parameter) => [
      parameter.key,
      parameter.value,
    ]),
  );
  params.set("geometry.manifest.components.count", 0);

  assertThrows(
    () => parseGeometryPartDecisionParameters(params),
    GeometryPartManifestError,
  );
});
