/**
 * Draft geometry capture for the `design.preview-geometry@1` tool (D2).
 *
 * WHY A SEPARATE DRAFT STORE — the preview run calls `build123d_export`
 * before any human MRTR decision.  Its output MUST never appear in a
 * ThreadSnapshot so that the canonical evidence thread remains unambiguous
 * (Invariant 4 + D2 decision).  This module materialises the provider result
 * into two stores:
 *
 *   a) `state/local/geometry-drafts/`       — content-addressed JSON captures
 *      (FileCaptureStore<"geometry-draft">)
 *   b) `state/local/geometry-draft-assets/` — raw binary files keyed by their
 *      SHA-256, served by `/api/draft-assets/<digest>`
 *
 * The operator reviews the MRTR proposal (which carries the `draftDigest`) and
 * approves the exact bytes they previewed.  The write executor later reads the
 * draft from (a) and verifies every binary in (b) against the signed hashes
 * before promoting anything into the canonical thread.
 *
 * SCRIPT EXECUTION — `validateGeometryScript` is called before any provider
 * dispatch (D4).  A single assembly `build123d_export` call is made; N
 * per-component STL calls follow when the manifest lists components.
 * All names are server-fixed; no agent-supplied string reaches the provider.
 *
 * BINARY MATERIALIZATION — each file returned by the provider carries a
 * `sha256` field we treat as the expected digest.  We verify by re-computing
 * SHA-256 after copying from Docker; any mismatch aborts the capture without
 * leaving a stale file in the draft-assets directory.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";

// `exactRecord` is used for the root structuredContent shape where we know
// all keys exactly.  For per-file items we use `requireFileShape` below,
// which allows the optional `viewer` field on glTF files without violating
// the fail-closed contract on truly unexpected keys.
import type {
  GeometryComponentBinding,
  GeometryExportFormat,
  GeometryManifest,
} from "../../domain/platform/geometry-proposal.ts";
import { validateGeometryScript } from "../../domain/platform/geometry-script-validation.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { FileCaptureStore } from "./file-capture-store.ts";

// ── Schema constant ───────────────────────────────────────────────────────────

export const GEOMETRY_DRAFT_CAPTURE_SCHEMA = "geometry-draft-capture/1.0" as const;

/** Server-fixed name prefix used for all geometry preview exports. */
const PREVIEW_ASSEMBLY_NAME = "geometry-preview-assembly" as const;

/** Derive a server-fixed part-mesh name from a component's usageName. */
function previewPartName(usageName: string): string {
  return `geometry-preview-${usageName}`;
}

// ── Public types ──────────────────────────────────────────────────────────────

/** One assembly-level export file from the preview run. */
export interface GeometryDraftAssemblyFile {
  readonly format: GeometryExportFormat;
  /** Stable server-fixed export name (no path, no extension). */
  readonly name: string;
  /** Full path returned by the provider (inside the container). */
  readonly containerPath: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

/** One per-component presentation STL from the preview run. */
export interface GeometryDraftPartMesh {
  readonly usageName: string;
  readonly elementId: string;
  /** Stable server-fixed export name (no path, no extension). */
  readonly name: string;
  /** Full path returned by the provider (inside the container). */
  readonly containerPath: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

/**
 * Immutable JSON capture persisted in the draft store.
 *
 * `fingerprint` covers the entire unsigned record so the write executor can
 * verify integrity when it reloads the draft by digest.
 */
export interface GeometryDraftCapture {
  readonly schemaVersion: typeof GEOMETRY_DRAFT_CAPTURE_SCHEMA;
  readonly kind: "geometry-draft";
  readonly capturedAt: string;
  readonly subject: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactFingerprint: ContentFingerprint;
  };
  readonly producer: {
    readonly serverId: "build123d";
    readonly tool: "build123d_export";
  };
  /** Validated Python script that was submitted to the provider. */
  readonly script: string;
  readonly scriptHash: ContentFingerprint;
  /** Export formats requested for the assembly call. */
  readonly exportFormats: ReadonlyArray<GeometryExportFormat>;
  /** Components listed in the manifest (used for per-part STL calls). */
  readonly components: ReadonlyArray<GeometryComponentBinding>;
  readonly assemblyFiles: ReadonlyArray<GeometryDraftAssemblyFile>;
  readonly partMeshes: ReadonlyArray<GeometryDraftPartMesh>;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryDraftCaptureInput {
  /** Python geometry script — validated with validateGeometryScript before dispatch. */
  readonly script: string;
  /** Manifest built from the operation parameters; components drive part-mesh calls. */
  readonly manifest: GeometryManifest;
}

export interface GeometryDraftCaptureOptions {
  /**
   * Docker Compose service that owns the `/exports` volume, e.g. "mcp-build123d".
   * Server-fixed: never supplied by an agent.
   */
  readonly build123dService: string;
  /**
   * Path to the directory containing `docker-compose.yml`.
   * Passed as `--project-directory` to `docker compose cp`.
   * Defaults to "." (the Deno process CWD).
   */
  readonly composeProjectDirectory?: string;
  /**
   * Override for the binary-asset materializer, used in tests to avoid
   * Docker dependencies.  Production code leaves this undefined.
   *
   * WHY INJECTABLE — the materializer is a `docker compose cp` boundary.
   * Tests that validate the JSON capture shape must not require a live Docker
   * daemon; the materializer is the only I/O beyond the MCP client mock.
   */
  readonly materializeAsset?: (sha256: string, containerPath: string) => Promise<void>;
}

// ── Materialization errors ────────────────────────────────────────────────────

export type GeometryDraftMaterializationCode =
  | "copy_failed"
  | "read_failed"
  | "sha256_mismatch";

/**
 * Thrown when a draft binary asset cannot be materialized from Docker.
 *
 * Callers MUST treat this as stop-for-review.  The provider outcome is
 * certain (the export succeeded), but the local copy failed.  Automatic
 * retry of the entire export is NOT permitted because we cannot predict
 * whether the Docker volume still holds the same bytes.
 */
export class GeometryDraftMaterializationError extends Error {
  constructor(
    readonly code: GeometryDraftMaterializationCode,
    readonly context: Readonly<Record<string, string>>,
    message: string,
  ) {
    super(message);
    this.name = "GeometryDraftMaterializationError";
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Execute the geometry preview and materialise the result as a draft capture.
 *
 * Steps:
 *  1. `validateGeometryScript` — fail-closed, D4.
 *  2. `sha256Fingerprint` on the script bytes (for the signed MRTR proposal).
 *  3. `build123d_export` for the assembly in the requested formats.
 *  4. For each manifest component, `build123d_export` for a per-part STL.
 *  5. Materialise every binary to `state/local/geometry-draft-assets/{sha256}`.
 *  6. Build + save the JSON draft capture to the FileCaptureStore.
 *  7. Return the typed capture (whose `fingerprint.digest` = the draftDigest).
 */
export async function captureGeometryDraft(
  client: McpToolClient,
  input: GeometryDraftCaptureInput,
  draftStore: FileCaptureStore<"geometry-draft">,
  options: GeometryDraftCaptureOptions,
  now: () => string = () => new Date().toISOString(),
): Promise<GeometryDraftCapture> {
  const { script, manifest } = input;
  const { build123dService, composeProjectDirectory = "." } = options;
  const materialize = options.materializeAsset ??
    ((sha256: string, containerPath: string) =>
      materializeToDraftAssets(
        sha256,
        containerPath,
        build123dService,
        composeProjectDirectory,
      ));

  // Step 1: fail-closed D4 validation before any provider call.
  validateGeometryScript(script);

  // Step 2: script hash — computed before network I/O so failure cannot leave
  // partial state that looks like a successful draft.
  const scriptHash = await sha256FingerprintOfText(script);

  // Step 3: assembly export.
  const assemblyResult = await client.callTool({
    name: "build123d_export",
    arguments: {
      script,
      formats: [...manifest.exportFormats],
      name: PREVIEW_ASSEMBLY_NAME,
      timeout_ms: 120000,
    },
  });
  const assemblyFiles = normalizeAssemblyExport(
    assemblyResult.structuredContent,
    manifest.exportFormats,
  );

  // Materialise assembly binary assets immediately after the call.
  for (const file of assemblyFiles) {
    await materialize(file.fingerprint.digest, file.containerPath);
  }

  // Step 4: per-component STL exports.
  const partMeshes: GeometryDraftPartMesh[] = [];
  for (const component of manifest.components) {
    const partName = previewPartName(component.usageName);
    const partResult = await client.callTool({
      name: "build123d_export",
      arguments: {
        script,
        formats: ["stl"],
        name: partName,
        timeout_ms: 120000,
      },
    });
    const mesh = normalizePartMesh(
      partResult.structuredContent,
      component,
      partName,
    );
    await materialize(mesh.fingerprint.digest, mesh.containerPath);
    partMeshes.push(mesh);
  }

  // Step 6: build + save the JSON capture.
  const capturedAt = now();
  const unsigned = {
    schemaVersion: GEOMETRY_DRAFT_CAPTURE_SCHEMA,
    kind: "geometry-draft" as const,
    capturedAt,
    subject: {
      snapshotId: manifest.architectureBasis.snapshotId,
      revision: manifest.architectureBasis.revision,
      artifactFingerprint: manifest.architectureBasis.artifactFingerprint,
    },
    producer: {
      serverId: "build123d" as const,
      tool: "build123d_export" as const,
    },
    script,
    scriptHash,
    exportFormats: [...manifest.exportFormats],
    components: [...manifest.components],
    assemblyFiles: Object.freeze(assemblyFiles),
    partMeshes: Object.freeze(partMeshes),
  };
  // Fingerprint the unsigned object so SHA-256(deterministicJson(unsigned))
  // matches SHA-256(captureText bytes) — the invariant FileCaptureStore.save
  // checks.  The stored JSON does NOT carry a self-referential fingerprint field;
  // the digest is implicit in the filename (`{digest}.json`).  The caller
  // receives the fingerprint on the in-memory return value only.
  const fingerprint = await sha256Fingerprint(unsigned);
  const captureText = deterministicJson(unsigned);
  const capture: GeometryDraftCapture = Object.freeze({ ...unsigned, fingerprint });

  await draftStore.save(fingerprint, captureText);

  const readback = await draftStore.read(fingerprint);
  if (readback !== captureText) {
    throw new Error(
      "Geometry draft capture was not durably readable after save.",
    );
  }

  return capture;
}

// ── Normalizers (pinned to the real build123d_export contract) ────────────────

/**
 * Normalise the structuredContent of a build123d_export assembly call.
 *
 * Expected contract (schemaVersion "1.0", kind "export"):
 * {
 *   schemaVersion: "1.0",
 *   kind: "export",
 *   metrics: {},
 *   files: [
 *     { format, path, bytes, sha256 },          // non-glTF
 *     { format, path, bytes, sha256, viewer? },  // glTF may carry optional viewer
 *   ]
 * }
 *
 * The `files` array is ordered to match the `formats` argument supplied to the
 * tool.  We verify that order exactly; any deviation is a contract violation.
 */
function normalizeAssemblyExport(
  value: unknown,
  requestedFormats: ReadonlyArray<GeometryExportFormat>,
): GeometryDraftAssemblyFile[] {
  const root = exactRecord(
    value,
    ["files", "kind", "metrics", "schemaVersion"],
    "build123d_export assembly structuredContent",
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new Error(
      "build123d_export assembly returned an unsupported structuredContent contract.",
    );
  }
  if (
    !root.metrics || typeof root.metrics !== "object" || Array.isArray(root.metrics)
  ) {
    throw new Error("build123d_export assembly metrics must be an object.");
  }
  if (!Array.isArray(root.files) || root.files.length !== requestedFormats.length) {
    throw new Error(
      `build123d_export assembly must return exactly ${requestedFormats.length} file(s).`,
    );
  }
  return (root.files as unknown[]).map((candidate: unknown, index: number) => {
    const format = requestedFormats[index]!;
    const item = requireFileShape(candidate, format, `assembly file ${index}`);
    if (item.format !== format) {
      throw new Error(
        `build123d_export assembly file ${index}: expected format "${format}", got "${item.format}".`,
      );
    }
    return {
      format: format as GeometryExportFormat,
      name: PREVIEW_ASSEMBLY_NAME,
      containerPath: requireNonEmptyString(item.path, `assembly file ${index} path`),
      bytes: requirePositiveInt(item.bytes, `assembly file ${index} bytes`),
      fingerprint: {
        algorithm: "sha256" as const,
        digest: requireSha256Digest(item.sha256, `assembly file ${index} sha256`),
      },
    };
  });
}

function normalizePartMesh(
  value: unknown,
  component: GeometryComponentBinding,
  partName: string,
): GeometryDraftPartMesh {
  const root = exactRecord(
    value,
    ["files", "kind", "metrics", "schemaVersion"],
    `build123d_export part ${component.usageName} structuredContent`,
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new Error(
      `build123d_export part ${component.usageName} returned an unsupported structuredContent.`,
    );
  }
  if (!Array.isArray(root.files) || root.files.length !== 1) {
    throw new Error(
      `build123d_export part (${component.usageName}) must return exactly one STL file.`,
    );
  }
  const item = requireFileShape(
    root.files[0],
    "stl",
    `part ${component.usageName} file`,
  );
  if (item.format !== "stl") {
    throw new Error(
      `build123d_export part ${component.usageName}: expected format "stl", got "${item.format}".`,
    );
  }
  return {
    usageName: component.usageName,
    elementId: component.elementId,
    name: partName,
    containerPath: requireNonEmptyString(item.path, `part ${component.usageName} path`),
    bytes: requirePositiveInt(item.bytes, `part ${component.usageName} bytes`),
    fingerprint: {
      algorithm: "sha256" as const,
      digest: requireSha256Digest(item.sha256, `part ${component.usageName} sha256`),
    },
  };
}

/**
 * Validate a single file entry from `build123d_export`.
 *
 * Required fields: bytes, format, path, sha256.
 * Allowed extra field for glTF only: viewer (optional — may be present or absent).
 * Any other unexpected field is a contract violation.
 */
function requireFileShape(
  value: unknown,
  format: GeometryExportFormat,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const required = ["bytes", "format", "path", "sha256"] as const;
  for (const key of required) {
    if (!Object.hasOwn(rec, key)) {
      throw new Error(`${context} is missing required field '${key}'.`);
    }
  }
  const allowed = new Set<string>([
    ...required,
    ...(format === "gltf" ? ["viewer"] : []),
  ]);
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) {
      throw new Error(`${context} has unsupported field '${key}'.`);
    }
  }
  return rec;
}

// ── Binary asset materialisation ─────────────────────────────────────────────

const DRAFT_ASSETS_DIR = "state/local/geometry-draft-assets" as const;

/**
 * Copy a provider-side binary from the Docker exports volume to the
 * local draft-assets directory, keyed by its SHA-256 digest.
 *
 * WHY KEYED BY DIGEST — the BFF endpoint `/api/draft-assets/<digest>` must
 * serve these files by content address.  Storing them by original filename
 * would require a separate name→digest index that could drift.
 *
 * Idempotent: if `DRAFT_ASSETS_DIR/{digest}` already exists and verifies,
 * no Docker copy is performed.
 */
async function materializeToDraftAssets(
  sha256: string,
  containerPath: string,
  service: string,
  composeProjectDirectory: string,
): Promise<void> {
  const localPath = `${DRAFT_ASSETS_DIR}/${sha256}`;

  // Idempotent: verify existing file before touching Docker.
  const existing = await readFileSafe(localPath);
  if (existing !== undefined) {
    const actual = await sha256Hex(existing);
    if (actual === sha256) return;
    // Stale bytes — remove and re-materialise.
    await removeFileSafe(localPath);
  }

  await Deno.mkdir(DRAFT_ASSETS_DIR, { recursive: true });

  const tmpPath = `${DRAFT_ASSETS_DIR}/.${crypto.randomUUID()}.tmp`;
  const command = new Deno.Command("docker", {
    args: [
      "compose",
      "--project-directory",
      composeProjectDirectory,
      "cp",
      `${service}:${containerPath}`,
      tmpPath,
    ],
    stdout: "null",
    stderr: "piped",
  });

  let output: Deno.CommandOutput;
  try {
    output = await command.output();
  } catch (error) {
    throw new GeometryDraftMaterializationError(
      "copy_failed",
      { sha256, containerPath, service, error: String(error) },
      `docker compose cp failed for geometry draft asset ${sha256}: ${String(error)}`,
    );
  }

  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    await removeFileSafe(tmpPath);
    throw new GeometryDraftMaterializationError(
      "copy_failed",
      {
        sha256,
        containerPath,
        service,
        exitCode: String(output.code),
        stderr: stderr.slice(0, 512),
      },
      `docker compose cp exited ${output.code} for geometry draft asset ${sha256}: ${
        stderr.slice(0, 200)
      }`,
    );
  }

  // Verify the copied file's SHA-256.
  const copied = await readFileSafe(tmpPath);
  if (copied === undefined) {
    throw new GeometryDraftMaterializationError(
      "read_failed",
      { sha256, tmpPath },
      `docker compose cp succeeded but geometry draft asset ${sha256} is unreadable at ${tmpPath}.`,
    );
  }
  const actual = await sha256Hex(copied);
  if (actual !== sha256) {
    await removeFileSafe(tmpPath);
    throw new GeometryDraftMaterializationError(
      "sha256_mismatch",
      { expected: sha256, actual, containerPath },
      `SHA-256 mismatch for geometry draft asset: expected ${sha256.slice(0, 16)}…, ` +
        `got ${actual.slice(0, 16)}….`,
    );
  }

  // Atomically publish: rename removes the tmp file on success.
  await Deno.rename(tmpPath, localPath);
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function sha256FingerprintOfText(text: string): Promise<ContentFingerprint> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readFileSafe(path: string): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function removeFileSafe(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch { /* best-effort cleanup */ }
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${context}: expected a non-empty string, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function requirePositiveInt(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${context}: expected a non-negative integer, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function requireSha256Digest(value: unknown, context: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(
      `${context}: expected a 64-char lowercase hex SHA-256, got ${
        JSON.stringify(value)
      }.`,
    );
  }
  return value;
}
