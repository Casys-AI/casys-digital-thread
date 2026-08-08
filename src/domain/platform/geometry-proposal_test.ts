import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeGeometryDecisionParameters,
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryManifest,
  GeometryProposalError,
  parseGeometryDecisionParameters,
} from "./geometry-proposal.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const HEX64 = "a".repeat(64);
const HEX64_B = "b".repeat(64);
const HEX64_C = "c".repeat(64);

/** A complete, valid manifest with all optional fields filled in. */
const VALID_MANIFEST: GeometryManifest = {
  schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
  architectureBasis: {
    snapshotId: "snap-001",
    revision: 3,
    artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
  },
  components: [
    { usageName: "dripTray", elementId: "elem-01", label: "Drip Tray" },
  ],
  unitSystem: "mm",
  exportFormats: ["gltf", "step"],
  scriptHash: { algorithm: "sha256", digest: HEX64_B },
  artifactHashes: {
    assemblyFiles: [
      {
        format: "gltf",
        name: "assembly.glb",
        fingerprint: { algorithm: "sha256", digest: HEX64_C },
      },
    ],
    partMeshes: [],
  },
};

function buildParams(
  manifest: GeometryManifest = VALID_MANIFEST,
  draftDigest: string = HEX64,
): ReadonlyMap<string, string | number | boolean> {
  const pairs = encodeGeometryDecisionParameters(draftDigest, manifest);
  return new Map(pairs.map(({ key, value }) => [key, value]));
}

// ── Missing parameter tests ───────────────────────────────────────────────────

Deno.test("parseGeometryDecisionParameters rejects when geometry.draft.digest is absent", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.delete("geometry.draft.digest");
  assertThrows(
    () => parseGeometryDecisionParameters(mut),
    GeometryProposalError,
    "geometry.draft.digest",
  );
  const err = (() => {
    try {
      parseGeometryDecisionParameters(mut);
    } catch (e) {
      return e as GeometryProposalError;
    }
  })();
  assertEquals(err?.code, "missing_parameter");
});

Deno.test("parseGeometryDecisionParameters rejects when schemaVersion is absent", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.delete("geometry.manifest.schemaVersion");
  assertThrows(
    () => parseGeometryDecisionParameters(mut),
    GeometryProposalError,
  );
});

Deno.test("parseGeometryDecisionParameters rejects when architectureBasis.revision is absent", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.delete("geometry.manifest.architectureBasis.revision");
  assertThrows(
    () => parseGeometryDecisionParameters(mut),
    GeometryProposalError,
  );
});

Deno.test("parseGeometryDecisionParameters rejects when scriptHash is absent", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.delete("geometry.manifest.scriptHash");
  assertThrows(
    () => parseGeometryDecisionParameters(mut),
    GeometryProposalError,
  );
});

Deno.test("parseGeometryDecisionParameters rejects when assemblyFiles.count is absent", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.delete("geometry.manifest.assemblyFiles.count");
  assertThrows(
    () => parseGeometryDecisionParameters(mut),
    GeometryProposalError,
  );
});

// ── Invalid-format tests ──────────────────────────────────────────────────────

Deno.test("parseGeometryDecisionParameters rejects an invalid SHA-256 fingerprint (too short)", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.set("geometry.draft.digest", "abc123");
  assertThrows(() => parseGeometryDecisionParameters(mut), GeometryProposalError);
  const err = (() => {
    try {
      parseGeometryDecisionParameters(mut);
    } catch (e) {
      return e as GeometryProposalError;
    }
  })();
  assertEquals(err?.code, "invalid_format");
});

Deno.test("parseGeometryDecisionParameters rejects an uppercase fingerprint", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.set("geometry.draft.digest", "A".repeat(64));
  assertThrows(() => parseGeometryDecisionParameters(mut), GeometryProposalError);
});

Deno.test("parseGeometryDecisionParameters rejects an unknown export format", () => {
  const params = buildParams();
  const mut = new Map(params);
  mut.set("geometry.manifest.exportFormats", "step,ply");
  assertThrows(
    () => parseGeometryDecisionParameters(mut),
    GeometryProposalError,
  );
  const err = (() => {
    try {
      parseGeometryDecisionParameters(mut);
    } catch (e) {
      return e as GeometryProposalError;
    }
  })();
  assertEquals(err?.code, "invalid_format");
});

Deno.test("parseGeometryDecisionParameters accepts zero assembly files", () => {
  const params = buildParams();
  const mut = new Map(params);
  // Count 0 is valid: a draft may have produced only part meshes.
  mut.set("geometry.manifest.assemblyFiles.count", 0);
  const result = parseGeometryDecisionParameters(mut);
  assertEquals(result.manifest.artifactHashes?.assemblyFiles.length, 0);
});

// ── Round-trip test ───────────────────────────────────────────────────────────

Deno.test("encodeGeometryDecisionParameters and parseGeometryDecisionParameters round-trip preserves all typed fields", () => {
  const draft = HEX64;
  const encoded = encodeGeometryDecisionParameters(draft, VALID_MANIFEST);
  const params = new Map(encoded.map(({ key, value }) => [key, value]));
  const result = parseGeometryDecisionParameters(params);

  assertEquals(result.draftDigest, draft);
  assertEquals(result.manifest.schemaVersion, GEOMETRY_MANIFEST_SCHEMA);
  assertEquals(result.manifest.architectureBasis.snapshotId, "snap-001");
  assertEquals(result.manifest.architectureBasis.revision, 3);
  assertEquals(result.manifest.architectureBasis.artifactFingerprint.digest, HEX64);
  assertEquals(result.manifest.unitSystem, "mm");
  assertEquals([...result.manifest.exportFormats], ["gltf", "step"]);
  assertEquals(result.manifest.scriptHash?.digest, HEX64_B);
  assertEquals(result.manifest.artifactHashes?.assemblyFiles.length, 1);
  assertEquals(result.manifest.artifactHashes?.assemblyFiles[0]?.format, "gltf");
  assertEquals(result.manifest.artifactHashes?.assemblyFiles[0]?.name, "assembly.glb");
  assertEquals(
    result.manifest.artifactHashes?.assemblyFiles[0]?.fingerprint.digest,
    HEX64_C,
  );
  assertEquals(result.manifest.components.length, 1);
  assertEquals(result.manifest.components[0]?.usageName, "dripTray");
  assertEquals(result.manifest.components[0]?.elementId, "elem-01");
  assertEquals(result.manifest.components[0]?.label, "Drip Tray");
});

Deno.test("round-trip with zero components preserves empty component list", () => {
  const manifestNoComponents: GeometryManifest = {
    ...VALID_MANIFEST,
    components: [],
  };
  const encoded = encodeGeometryDecisionParameters(HEX64, manifestNoComponents);
  const params = new Map(encoded.map(({ key, value }) => [key, value]));
  const result = parseGeometryDecisionParameters(params);
  assertEquals(result.manifest.components.length, 0);
});

Deno.test("round-trip with multiple part meshes preserves all entries", () => {
  const manifestWithMeshes: GeometryManifest = {
    ...VALID_MANIFEST,
    artifactHashes: {
      assemblyFiles: VALID_MANIFEST.artifactHashes!.assemblyFiles,
      partMeshes: [
        {
          semanticKey: "drip-tray",
          name: "drip-tray.stl",
          fingerprint: { algorithm: "sha256", digest: HEX64 },
        },
        {
          semanticKey: "water-tank",
          name: "water-tank.stl",
          fingerprint: { algorithm: "sha256", digest: HEX64_B },
        },
      ],
    },
  };
  const encoded = encodeGeometryDecisionParameters(HEX64, manifestWithMeshes);
  const params = new Map(encoded.map(({ key, value }) => [key, value]));
  const result = parseGeometryDecisionParameters(params);
  assertEquals(result.manifest.artifactHashes?.partMeshes.length, 2);
  assertEquals(result.manifest.artifactHashes?.partMeshes[0]?.semanticKey, "drip-tray");
  assertEquals(
    result.manifest.artifactHashes?.partMeshes[1]?.semanticKey,
    "water-tank",
  );
});

// ── encode guard tests ────────────────────────────────────────────────────────

Deno.test("encodeGeometryDecisionParameters rejects a manifest without scriptHash", () => {
  const incomplete: GeometryManifest = {
    ...VALID_MANIFEST,
    scriptHash: undefined,
  };
  assertThrows(
    () => encodeGeometryDecisionParameters(HEX64, incomplete),
    GeometryProposalError,
  );
  const err = (() => {
    try {
      encodeGeometryDecisionParameters(HEX64, incomplete);
    } catch (e) {
      return e as GeometryProposalError;
    }
  })();
  assertEquals(err?.code, "manifest_incomplete");
});

Deno.test("encodeGeometryDecisionParameters rejects a manifest without artifactHashes", () => {
  const incomplete: GeometryManifest = {
    ...VALID_MANIFEST,
    artifactHashes: undefined,
  };
  assertThrows(
    () => encodeGeometryDecisionParameters(HEX64, incomplete),
    GeometryProposalError,
  );
});
