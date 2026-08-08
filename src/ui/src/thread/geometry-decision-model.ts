/**
 * Browser-safe model for a human geometry-sealing decision (design.write-geometry@1).
 *
 * WHY THIS MODULE EXISTS — the MRTR proposal produced by `project_geometry_preview`
 * carries a flat key-value parameter list (matching the `encodeGeometryDecisionParameters`
 * convention from the domain layer).  This module re-parses those parameters into
 * typed view objects so the Workbench can display the draft digest, the architecture
 * basis, and the asset counts without depending on the server-side domain layer.
 *
 * The only authority for the canonical interpretation of the parameter keys is the
 * domain layer (`geometry-proposal.ts`); this model must stay in sync with that
 * encoding.  Any mismatch is surfaced as `{ kind: "invalid" }` so the UI always
 * renders something, never crashes.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface GeometryDecisionAssemblyFile {
  readonly format: "step" | "gltf" | "stl";
  readonly name: string;
  /** Hex-64 SHA-256 of the binary asset. */
  readonly digest: string;
}

export interface GeometryDecisionComponent {
  readonly usageName: string;
  readonly elementId: string;
  readonly label: string;
}

/** Successfully parsed geometry decision view — all fields are readable. */
export interface GeometryDecisionValid {
  readonly kind: "valid";
  /** Hex-64 SHA-256 of the draft JSON capture in the draft store. */
  readonly draftDigest: string;
  readonly architecture: {
    readonly snapshotId: string;
    readonly revision: number;
    /** Hex-64 SHA-256 of the architecture SysML artifact. */
    readonly artifactDigest: string;
  };
  readonly unitSystem: "mm";
  readonly exportFormats: readonly string[];
  /** Hex-64 SHA-256 of the geometry script that produced this draft. */
  readonly scriptDigest: string;
  readonly assemblyFiles: readonly GeometryDecisionAssemblyFile[];
  readonly components: readonly GeometryDecisionComponent[];
  /**
   * URL path to preview one assembly file binary on the BFF
   * `/api/draft-assets/<digest>` endpoint.
   */
  readonly primaryAssetPreviewPath: string | undefined;
}

/** The parameter list is present but could not be fully parsed. */
export interface GeometryDecisionInvalid {
  readonly kind: "invalid";
  readonly reason: string;
}

export type GeometryDecisionView =
  | GeometryDecisionValid
  | GeometryDecisionInvalid;

// ── Flat-parameter type (mirrors EngineeringDecisionProposal.parameters shape) ─

export interface GeometryDecisionParameter {
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse a geometry MRTR decision's flat parameter list into a typed view.
 *
 * Returns `{ kind: "invalid", reason }` on any parse failure — the caller
 * must never throw for a missing or malformed parameter; the UI degrades
 * gracefully.
 */
export function parseGeometryDecisionView(
  params: readonly GeometryDecisionParameter[],
): GeometryDecisionView {
  try {
    return parseOrThrow(params);
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

function parseOrThrow(
  params: readonly GeometryDecisionParameter[],
): GeometryDecisionValid {
  const map = new Map<string, string | number | boolean>(
    params.map((p) => [p.key, p.value]),
  );

  const draftDigest = hex64(map, "geometry.draft.digest");
  const snapshotId = nonEmpty(
    map,
    "geometry.manifest.architectureBasis.snapshotId",
  );
  const revision = positiveInt(
    map,
    "geometry.manifest.architectureBasis.revision",
  );
  const artifactDigest = hex64(
    map,
    "geometry.manifest.architectureBasis.artifactFingerprint",
  );
  const unitSystem = exactString(
    map,
    "geometry.manifest.unitSystem",
    "mm" as const,
  );
  const exportFormatsRaw = nonEmpty(map, "geometry.manifest.exportFormats");
  const exportFormats = exportFormatsRaw.split(",").map((s) => s.trim());
  const scriptDigest = hex64(map, "geometry.manifest.scriptHash");

  const assemblyFileCount = nonNegativeInt(
    map,
    "geometry.manifest.assemblyFiles.count",
  );
  const assemblyFiles: GeometryDecisionAssemblyFile[] = [];
  for (let i = 0; i < assemblyFileCount; i++) {
    const format = oneOfFormat(
      map,
      `geometry.manifest.assemblyFiles.${i}.format`,
    );
    const name = nonEmpty(map, `geometry.manifest.assemblyFiles.${i}.name`);
    const digest = hex64(
      map,
      `geometry.manifest.assemblyFiles.${i}.fingerprint`,
    );
    assemblyFiles.push({ format, name, digest });
  }

  const componentCount = nonNegativeInt(
    map,
    "geometry.manifest.components.count",
  );
  const components: GeometryDecisionComponent[] = [];
  for (let i = 0; i < componentCount; i++) {
    const usageName = nonEmpty(
      map,
      `geometry.manifest.components.${i}.usageName`,
    );
    const elementId = nonEmpty(
      map,
      `geometry.manifest.components.${i}.elementId`,
    );
    const label = nonEmpty(map, `geometry.manifest.components.${i}.label`);
    components.push({ usageName, elementId, label });
  }

  // The primary asset is the first gltf (preferred for in-browser preview) or
  // the first assembly file.
  const gltfFile = assemblyFiles.find((f) => f.format === "gltf");
  const primaryFile = gltfFile ?? assemblyFiles[0];
  const primaryAssetPreviewPath = primaryFile
    ? `/api/draft-assets/${primaryFile.digest}`
    : undefined;

  return {
    kind: "valid",
    draftDigest,
    architecture: { snapshotId, revision, artifactDigest },
    unitSystem,
    exportFormats,
    scriptDigest,
    assemblyFiles,
    components,
    primaryAssetPreviewPath,
  };
}

function hex64(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const s = String(raw);
  if (!FINGERPRINT_RE.test(s)) {
    throw new Error(
      `${key} must be a 64-char lowercase hex SHA-256 (got: ${
        s.slice(0, 16)
      }…)`,
    );
  }
  return s;
}

function nonEmpty(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const s = String(raw).trim();
  if (s.length === 0) throw new Error(`${key} must not be empty`);
  return s;
}

function positiveInt(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${key} must be a positive integer (got: ${raw})`);
  }
  return n;
}

function nonNegativeInt(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const raw = map.get(key);
  if (raw === undefined) throw new Error(`Missing parameter: ${key}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`${key} must be a non-negative integer (got: ${raw})`);
  }
  return n;
}

function exactString<const T extends string>(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
  expected: T,
): T {
  const s = nonEmpty(map, key);
  if (s !== expected) {
    throw new Error(`${key} must be "${expected}" (got: ${s})`);
  }
  return expected;
}

function oneOfFormat(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): "step" | "gltf" | "stl" {
  const s = nonEmpty(map, key);
  if (s !== "step" && s !== "gltf" && s !== "stl") {
    throw new Error(`${key} must be step, gltf, or stl (got: ${s})`);
  }
  return s;
}
