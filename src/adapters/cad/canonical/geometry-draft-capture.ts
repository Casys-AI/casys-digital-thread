/**
 * Draft geometry capture for admitted export, later sealed by
 * `design.write-geometry@1` (D2).
 *
 * WHY A SEPARATE DRAFT STORE — the preview run calls `build123d_export`
 * before any human MRTR decision.  Its output MUST never appear in a
 * ThreadSnapshot so that the canonical evidence thread remains unambiguous
 * (Invariant 4 + D2 decision).  This module materialises the provider result
 * into four stores:
 *
 *   a) `state/local/geometry-source-captures/` — exact native source envelopes
 *   b) `state/local/source-analysis-captures/` — passive source-local facts
 *   c) `state/local/geometry-draft-captures/` — content-addressed JSON captures
 *      (FileCaptureStore<"geometry-draft">)
 *   d) `state/local/geometry-draft-assets/` — raw binary files keyed by their
 *      SHA-256 and reopened only by authorized CAD execution/seal flows
 *
 * The operator reviews the MRTR proposal (which carries the `draftDigest`) and
 * approves the exact bytes they previewed.  The write executor later reads the
 * draft from (a) and verifies every binary in (b) against the signed hashes
 * before promoting anything into the canonical thread.
 *
 * SCRIPT EXECUTION — `validateGeometryScript` is called before any provider
 * dispatch (D4). The exact validated source and its passive parser result are
 * both persisted and reread before build123d receives the same text. Every
 * provider-side export name and identity remains server-fixed.
 *
 * BINARY RESOURCE PERSISTENCE — each returned artifact names an immutable MCP URI.
 * The server reads that exact URI, validates MIME, byte count and SHA-256, then
 * persists only those verified bytes through the draft asset store.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";

// `exactRecord` rejects unadvertised provider fields at both the result and
// artifact levels before a resource URI can be read.
import type {
  GeometryComponentBinding,
  GeometryExportFormat,
  GeometryManifest,
} from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  type GeometryDraftAdmission,
  parseGeometryDraftAdmission,
} from "../../../domain/cad/canonical/geometry-draft-admission.ts";
import { assertGeometryManifestArtifactIdentities } from "../../../domain/cad/canonical/geometry-proposal.ts";
import { validateGeometryScript } from "../../../domain/cad/source/geometry-script-validation.ts";
import {
  assertGeometryBundleManifest,
  type GeometryBundleComponentBinding,
  type GeometryBundleExportFormat,
  type GeometryBundleManifest,
  type GeometryBundleOccurrence,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import type { GeometryDraftAssetStore } from "../../../application/ports/out/cad/canonical/geometry-draft-asset-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type {
  ExpectedProviderResource,
  ProviderResourceReader,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  type GeometrySourceAnalysisCaptureDependencies,
  GeometrySourceAnalysisCaptureService,
} from "../source/geometry-source-analysis-capture.ts";
import type {
  GeometrySourceAnalysisReference,
} from "../../../domain/cad/source/geometry-source-analysis-reference.ts";
import { BUILD123D_EXPORT_TIMEOUT_MS } from "./build123d-export-contract.ts";

// ── Schema constant ───────────────────────────────────────────────────────────

/** Current assembly draft: preview-run identity plus exact source-analysis. */
export const GEOMETRY_DRAFT_CAPTURE_SCHEMA = "geometry-draft-capture/1.2" as const;
/** Current complete-system bundle draft: N+1 sources plus exact sourceAnalyses. */
export const GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA =
  "geometry-draft-capture/2.1" as const;

export type CurrentGenericGeometryDraftCaptureSchema =
  | typeof GEOMETRY_DRAFT_CAPTURE_SCHEMA
  | typeof GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA;

/** Current generic drafts only. Old 1.0/1.1/2.0 identities are unsupported. */
export function currentGenericGeometryDraftCaptureSchema(
  value: unknown,
): CurrentGenericGeometryDraftCaptureSchema {
  if (
    value === GEOMETRY_DRAFT_CAPTURE_SCHEMA ||
    value === GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA
  ) {
    return value;
  }
  throw new TypeError(
    `Unsupported geometry draft capture schema: ${String(value)}.`,
  );
}

/** Server-fixed name prefix used for all geometry preview exports. */
const PREVIEW_ASSEMBLY_NAME = "geometry-preview-assembly" as const;

// ── Public types ──────────────────────────────────────────────────────────────

/** One assembly-level export file from the preview run. */
export interface GeometryDraftAssemblyFile {
  readonly format: GeometryExportFormat;
  /** Stable server-fixed export name (no path, no extension). */
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

/** One per-component presentation STL from the preview run. */
export interface GeometryDraftPartMesh {
  readonly usageName: string;
  readonly elementId: string;
  /** Stable server-fixed export name (no path, no extension). */
  readonly name: string;
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
    readonly serverId: "build123d-sandbox";
    readonly tool: "build123d_export";
    /** Orchestrator identity assigned to this exact preview dispatch. */
    readonly runId: string;
  };
  /** Validated Python script that was submitted to the provider. */
  readonly script: string;
  readonly scriptHash: ContentFingerprint;
  /** Passive facts derived from these exact bytes before provider dispatch. */
  readonly sourceAnalysis: GeometrySourceAnalysisReference;
  /** Export formats requested for the assembly call. */
  readonly exportFormats: ReadonlyArray<GeometryExportFormat>;
  /** Reviewed component bindings retained as metadata; v1 exports no per-part mesh. */
  readonly components: ReadonlyArray<GeometryComponentBinding>;
  readonly assemblyFiles: ReadonlyArray<GeometryDraftAssemblyFile>;
  readonly partMeshes: ReadonlyArray<GeometryDraftPartMesh>;
  readonly admission?: GeometryDraftAdmission;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryDraftCaptureInput {
  /** Python geometry script — validated with validateGeometryScript before dispatch. */
  readonly script: string;
  /** Manifest built from the operation parameters; components remain binding metadata. */
  readonly manifest: GeometryManifest;
  /** Required later by `design.write-geometry@1`. Preview drafts omit it. */
  readonly admission?: GeometryDraftAdmission;
}

export interface GeometryDraftCaptureOptions {
  /**
   * Server-owned passive analysis path. The source and bundle stores are
   * durable CAS records; the frontend has no provider or authority access.
   */
  readonly sourceAnalysis: GeometrySourceAnalysisCaptureDependencies;
  /**
   * Server-owned reader for the exact immutable provider resource named by the
   * export receipt. It can only issue `resources/read`, never discovery.
   */
  readonly resourceReader: ProviderResourceReader;
  /** Draft-only binary CAS. It persists only the verified resource bytes. */
  readonly draftAssets: GeometryDraftAssetStore;
  /**
   * Exact preview-dispatch identity. Production generates one per invocation;
   * tests may inject a stable value without impersonating the later seal run.
   */
  readonly previewRunId?: string;
}

export interface GeometryBundleDraftDefinitionFile {
  readonly format: GeometryBundleExportFormat;
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryBundleDraftPartDefinition {
  readonly elementId: string;
  readonly label: string;
  /** Exact, independently executable PartDefinition source. */
  readonly script: string;
  readonly scriptHash: ContentFingerprint;
  readonly files: ReadonlyArray<GeometryBundleDraftDefinitionFile>;
}

export interface GeometryBundleDraftProviderCall {
  readonly ordinal: number;
  readonly role: "assembly" | "part-definition";
  readonly partDefinitionElementId?: string;
  readonly exportName: string;
  readonly scriptHash: ContentFingerprint;
  readonly formats: ReadonlyArray<GeometryBundleExportFormat>;
}

export interface GeometryBundleDraftCapture {
  readonly schemaVersion: typeof GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA;
  readonly kind: "geometry-draft";
  readonly capturedAt: string;
  readonly subject: GeometryBundleManifest["architectureBasis"];
  readonly predecessor?: GeometryBundleManifest["predecessor"];
  readonly producer: {
    readonly serverId: "build123d-sandbox";
    readonly tool: "build123d_export";
    readonly runId: string;
  };
  /** Hash-derived namespace that isolates server-owned export names across previews. */
  readonly exportNamePrefix: string;
  readonly assembly: {
    readonly script: string;
    readonly scriptHash: ContentFingerprint;
    readonly exportFormats: ReadonlyArray<GeometryBundleExportFormat>;
    readonly files: ReadonlyArray<GeometryDraftAssemblyFile>;
  };
  readonly sourceAnalyses: {
    readonly assembly: GeometrySourceAnalysisReference;
    readonly partDefinitions: ReadonlyArray<{
      readonly elementId: string;
      readonly analysis: GeometrySourceAnalysisReference;
    }>;
  };
  readonly components: ReadonlyArray<GeometryBundleComponentBinding>;
  readonly partExportFormats: ReadonlyArray<GeometryBundleExportFormat>;
  readonly partDefinitions: ReadonlyArray<GeometryBundleDraftPartDefinition>;
  readonly occurrences: ReadonlyArray<GeometryBundleOccurrence>;
  /** Exact ordered N+1 call plan executed under producer.runId. */
  readonly providerCalls: ReadonlyArray<GeometryBundleDraftProviderCall>;
  readonly admission?: GeometryDraftAdmission;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryBundleDraftCaptureInput {
  readonly assemblyScript: string;
  /** Incomplete v2 manifest. Script/file hashes must not be supplied by callers. */
  readonly manifest: GeometryBundleManifest;
  /** Exactly one independent script for each manifest PartDefinition identity. */
  readonly partDefinitionScripts: ReadonlyArray<{
    readonly elementId: string;
    readonly script: string;
  }>;
  /** Required later by `design.write-geometry@1`. Preview drafts omit it. */
  readonly admission?: GeometryDraftAdmission;
}

/** Persisted binary metadata that the seal must re-prove against local bytes. */
export interface GeometryBundleDraftAssetMetadata {
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Execute the geometry preview and materialise the result as a draft capture.
 *
 * Steps:
 *  1. `validateGeometryScript` — fail-closed, D4.
 *  2. `sha256Fingerprint` on the script bytes (for the signed MRTR proposal).
 *  3. Capture/re-read the exact source, analyse it, then capture/re-read the
 *     passive source-analysis bundle.
 *  4. `build123d_export` for the assembly in the requested formats.
 *  5. Keep component bindings as metadata; per-part export is deferred to v2.
 *  6. Read and persist every verified binary to `state/local/geometry-draft-assets/{sha256}`.
 *  7. Build + save the JSON draft capture to the FileCaptureStore.
 *  8. Return the typed capture (whose `fingerprint.digest` = the draftDigest).
 */
export async function captureGeometryDraft(
  client: McpToolClient,
  input: GeometryDraftCaptureInput,
  draftStore: FileCaptureStore<"geometry-draft">,
  options: GeometryDraftCaptureOptions,
  now: () => string = () => new Date().toISOString(),
): Promise<GeometryDraftCapture> {
  const { script, manifest } = input;
  // This is also enforced by the MRTR parser. Keep it here so the planning-only
  // preview refuses an invalid request before the provider sees any call.
  assertGeometryManifestArtifactIdentities(manifest);
  const previewRunId = options.previewRunId ??
    `geometry-preview:${crypto.randomUUID()}`;
  if (previewRunId.trim() === "") {
    throw new TypeError("previewRunId must be a non-empty string.");
  }

  // Step 1: fail-closed D4 validation before any provider call.
  validateGeometryScript(script);

  // Step 2: script hash — computed before network I/O so failure cannot leave
  // partial state that looks like a successful draft.
  const scriptHash = await sha256FingerprintOfText(script);

  // Step 3: preserve and analyse these exact bytes before the provider sees
  // them. The analysis is passive: it creates no assertion, admission, plan,
  // ThreadSnapshot entity, or provider request.
  const sourceAnalysis = await new GeometrySourceAnalysisCaptureService(
    options.sourceAnalysis,
  ).capture({ selector: { kind: "assembly" }, sourceText: script });
  if (!fingerprintsEqual(sourceAnalysis.sourceFingerprint, scriptHash)) {
    throw new Error(
      "Geometry source analysis did not retain the exact preview script hash.",
    );
  }

  // Step 4: assembly export.
  const assemblyResult = await client.callTool({
    name: "build123d_export",
    arguments: {
      script,
      formats: [...manifest.exportFormats],
      name: PREVIEW_ASSEMBLY_NAME,
      timeout_ms: BUILD123D_EXPORT_TIMEOUT_MS,
    },
  });
  const assemblyProviderFiles = normalizeAssemblyExport(
    assemblyResult.structuredContent,
    manifest.exportFormats,
  );
  const assemblyFiles = assemblyProviderFiles.map(providerFileToDraftFile);
  assertGeometryManifestArtifactIdentities({
    ...manifest,
    artifactHashes: { assemblyFiles, partMeshes: [] },
  });

  // Read and persist assembly binary assets immediately after the call.
  await persistProviderResources(assemblyProviderFiles, options);

  // Step 4: per-component STL exports — DEFERRED to v2.
  //
  // WHY NOT IN V1 — producing per-component meshes requires a dedicated script
  // per component (isolating the sub-solid and assigning it to `result`).
  // Repeating the ASSEMBLY script with a different `name` argument exports the
  // entire model each time: the resulting artefacts are labelled `usageName`
  // but contain full-assembly bytes — a "no hidden heuristics" violation.
  //
  // The correct solution (a) needs a server-fixed convention for extracting a
  // named sub-solid without agent-interpolated code.  Until that convention is
  // designed and reviewed, only the assembly export is produced.
  const partMeshes: GeometryDraftPartMesh[] = [];

  // Step 6: build + save the JSON capture.
  const capturedAt = now();
  const admission = stampDraftAdmission(input.admission, scriptHash);
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
      serverId: "build123d-sandbox" as const,
      tool: "build123d_export" as const,
      runId: previewRunId,
    },
    script,
    scriptHash,
    sourceAnalysis,
    exportFormats: [...manifest.exportFormats],
    components: [...manifest.components],
    assemblyFiles: Object.freeze(assemblyFiles),
    partMeshes: Object.freeze(partMeshes),
    ...(admission === undefined ? {} : { admission }),
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

/**
 * Execute a geometry-bundle/2.0 preview using independent reviewed sources.
 *
 * The existing provider has no safe "extract child by identity" operation.
 * V2 therefore requires one complete `result` script per PartDefinition and
 * calls the existing provider once per definition with an ordinal,
 * server-owned export name. The assembly script is never parsed, interpolated,
 * or relabelled as a part.
 */
export async function captureGeometryBundleDraft(
  client: McpToolClient,
  input: GeometryBundleDraftCaptureInput,
  draftStore: FileCaptureStore<"geometry-draft">,
  options: GeometryDraftCaptureOptions,
  now: () => string = () => new Date().toISOString(),
): Promise<GeometryBundleDraftCapture> {
  const { manifest } = input;
  if (
    manifest.scriptHash || manifest.artifactHashes ||
    manifest.partDefinitions.some((definition) =>
      definition.scriptHash || definition.files
    )
  ) {
    throw new TypeError(
      "Geometry bundle preview input must not contain caller-supplied script or artifact hashes.",
    );
  }
  assertGeometryBundleManifest(manifest);

  const scriptsByDefinitionId = new Map<string, string>();
  for (const [index, candidate] of input.partDefinitionScripts.entries()) {
    if (candidate.elementId.trim() === "" || candidate.script.trim() === "") {
      throw new TypeError(
        `partDefinitionScripts[${index}] requires a non-empty elementId and script.`,
      );
    }
    if (scriptsByDefinitionId.has(candidate.elementId)) {
      throw new TypeError(
        `partDefinitionScripts contains duplicate PartDefinition elementId ${candidate.elementId}.`,
      );
    }
    scriptsByDefinitionId.set(candidate.elementId, candidate.script);
  }
  const expectedDefinitionIds = new Set(
    manifest.partDefinitions.map((definition) => definition.elementId),
  );
  if (
    scriptsByDefinitionId.size !== expectedDefinitionIds.size ||
    [...expectedDefinitionIds].some((id) => !scriptsByDefinitionId.has(id)) ||
    [...scriptsByDefinitionId.keys()].some((id) => !expectedDefinitionIds.has(id))
  ) {
    throw new TypeError(
      "partDefinitionScripts must cover every manifest PartDefinition identity exactly once.",
    );
  }

  // Validate and hash every source before the first provider call. A late bad
  // definition must not leave a partial provider sequence that looks reviewable.
  validateGeometryScript(input.assemblyScript);
  for (const definition of manifest.partDefinitions) {
    validateGeometryScript(scriptsByDefinitionId.get(definition.elementId)!);
  }
  const assemblyScriptHash = await sha256FingerprintOfText(input.assemblyScript);
  const definitionScriptHashes = new Map<string, ContentFingerprint>();
  for (const definition of manifest.partDefinitions) {
    definitionScriptHashes.set(
      definition.elementId,
      await sha256FingerprintOfText(scriptsByDefinitionId.get(definition.elementId)!),
    );
  }

  // Persist and analyse the complete N+1 source set before the first provider
  // call. A later rejected PartDefinition may leave passive CAS records, but it
  // can never leave a partial build123d execution that appears reviewable.
  const sourceAnalysisService = new GeometrySourceAnalysisCaptureService(
    options.sourceAnalysis,
  );
  const assemblySourceAnalysis = await sourceAnalysisService.capture({
    selector: { kind: "assembly" },
    sourceText: input.assemblyScript,
  });
  if (
    !fingerprintsEqual(
      assemblySourceAnalysis.sourceFingerprint,
      assemblyScriptHash,
    )
  ) {
    throw new Error(
      "Geometry assembly analysis did not retain the exact preview script hash.",
    );
  }
  const partDefinitionSourceAnalyses: Array<{
    readonly elementId: string;
    readonly analysis: GeometrySourceAnalysisReference;
  }> = [];
  for (const definition of manifest.partDefinitions) {
    const analysis = await sourceAnalysisService.capture({
      selector: {
        kind: "part-definition",
        elementId: definition.elementId,
      },
      sourceText: scriptsByDefinitionId.get(definition.elementId)!,
    });
    if (
      !fingerprintsEqual(
        analysis.sourceFingerprint,
        definitionScriptHashes.get(definition.elementId)!,
      )
    ) {
      throw new Error(
        `Geometry PartDefinition ${definition.elementId} analysis did not retain the exact preview script hash.`,
      );
    }
    partDefinitionSourceAnalyses.push({
      elementId: definition.elementId,
      analysis,
    });
  }

  const previewRunId = options.previewRunId ??
    `geometry-preview:${crypto.randomUUID()}`;
  if (previewRunId.trim() === "") {
    throw new TypeError("previewRunId must be a non-empty string.");
  }
  const previewRunDigest = await sha256FingerprintOfText(previewRunId);
  const exportNamePrefix = `geometry-preview-${previewRunDigest.digest}`;
  const assemblyExportName = `${exportNamePrefix}-assembly`;
  const assemblyResult = await client.callTool({
    name: "build123d_export",
    arguments: {
      script: input.assemblyScript,
      formats: [...manifest.exportFormats],
      name: assemblyExportName,
      timeout_ms: BUILD123D_EXPORT_TIMEOUT_MS,
    },
  });
  const assemblyProviderFiles = normalizeBundleExport(
    assemblyResult.structuredContent,
    manifest.exportFormats,
    assemblyExportName,
    "assembly",
  );
  const assemblyFiles = assemblyProviderFiles.map(providerFileToDraftFile);

  const partDefinitions: GeometryBundleDraftPartDefinition[] = [];
  const partDefinitionProviderFiles: ProviderGeometryFile[] = [];
  for (const [index, definition] of manifest.partDefinitions.entries()) {
    const name = definitionExportName(exportNamePrefix, index);
    const script = scriptsByDefinitionId.get(definition.elementId)!;
    const result = await client.callTool({
      name: "build123d_export",
      arguments: {
        script,
        formats: [...manifest.partExportFormats],
        name,
        timeout_ms: BUILD123D_EXPORT_TIMEOUT_MS,
      },
    });
    const providerFiles = normalizeBundleExport(
      result.structuredContent,
      manifest.partExportFormats,
      name,
      `PartDefinition ${index}`,
    );
    partDefinitionProviderFiles.push(...providerFiles);
    partDefinitions.push({
      elementId: definition.elementId,
      label: definition.label,
      script,
      scriptHash: definitionScriptHashes.get(definition.elementId)!,
      files: providerFiles.map(providerFileToDraftFile),
    });
  }

  const completedManifest: GeometryBundleManifest = {
    ...manifest,
    scriptHash: assemblyScriptHash,
    artifactHashes: {
      assemblyFiles: assemblyFiles.map(({ format, name, fingerprint }) => ({
        format,
        name,
        fingerprint,
      })),
      partMeshes: [],
    },
    partDefinitions: partDefinitions.map((definition) => ({
      elementId: definition.elementId,
      label: definition.label,
      scriptHash: definition.scriptHash,
      files: definition.files.map(({ format, name, fingerprint }) => ({
        format,
        name,
        fingerprint,
      })),
    })),
  };
  // Deliberately permits equal content hashes across distinct definitions.
  // Identity is the exact PartDefinition id, not the content-addressed blob.
  assertGeometryBundleManifest(completedManifest, { requireCompleted: true });
  const admission = stampDraftAdmission(input.admission, assemblyScriptHash);

  // No local binary is exposed until the complete N+1 response set validates.
  await persistProviderResources(
    [
      ...assemblyProviderFiles,
      ...partDefinitionProviderFiles,
    ],
    options,
  );

  const unsigned = {
    schemaVersion: GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA,
    kind: "geometry-draft" as const,
    capturedAt: now(),
    subject: manifest.architectureBasis,
    ...(manifest.predecessor ? { predecessor: manifest.predecessor } : {}),
    producer: {
      serverId: "build123d-sandbox" as const,
      tool: "build123d_export" as const,
      runId: previewRunId,
    },
    exportNamePrefix,
    assembly: {
      script: input.assemblyScript,
      scriptHash: assemblyScriptHash,
      exportFormats: [...manifest.exportFormats],
      files: assemblyFiles,
    },
    sourceAnalyses: {
      assembly: assemblySourceAnalysis,
      partDefinitions: partDefinitionSourceAnalyses,
    },
    components: [...manifest.components],
    partExportFormats: [...manifest.partExportFormats],
    partDefinitions,
    occurrences: [...manifest.occurrences],
    providerCalls: [
      {
        ordinal: 0,
        role: "assembly" as const,
        exportName: assemblyExportName,
        scriptHash: assemblyScriptHash,
        formats: [...manifest.exportFormats],
      },
      ...partDefinitions.map((definition, index) => ({
        ordinal: index + 1,
        role: "part-definition" as const,
        partDefinitionElementId: definition.elementId,
        exportName: definition.files[0]!.name,
        scriptHash: definition.scriptHash,
        formats: [...manifest.partExportFormats],
      })),
    ],
    ...(admission === undefined ? {} : { admission }),
  };
  const fingerprint = await sha256Fingerprint(unsigned);
  const captureText = deterministicJson(unsigned);
  await draftStore.save(fingerprint, captureText);
  if (await draftStore.read(fingerprint) !== captureText) {
    throw new Error("Geometry bundle draft was not durably readable after save.");
  }
  return Object.freeze({ ...unsigned, fingerprint });
}

/** Reconstruct exactly the signable v2 manifest from a reviewed v2 draft. */
export function geometryBundleManifestFromDraft(
  draft: Omit<GeometryBundleDraftCapture, "fingerprint">,
): GeometryBundleManifest {
  const manifest: GeometryBundleManifest = {
    schemaVersion: "geometry-manifest/2.0",
    architectureBasis: draft.subject,
    ...(draft.predecessor ? { predecessor: draft.predecessor } : {}),
    components: draft.components,
    unitSystem: "mm",
    placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
    exportFormats: draft.assembly.exportFormats,
    partExportFormats: draft.partExportFormats,
    scriptHash: draft.assembly.scriptHash,
    artifactHashes: {
      assemblyFiles: draft.assembly.files.map(({ format, name, fingerprint }) => ({
        format,
        name,
        fingerprint,
      })),
      partMeshes: [],
    },
    partDefinitions: draft.partDefinitions.map((definition) => ({
      elementId: definition.elementId,
      label: definition.label,
      scriptHash: definition.scriptHash,
      files: definition.files.map(({ format, name, fingerprint }) => ({
        format,
        name,
        fingerprint,
      })),
    })),
    occurrences: draft.occurrences,
  };
  assertGeometryBundleManifest(manifest, { requireCompleted: true });
  return manifest;
}

export interface GeometryBundleCanonicalSources {
  readonly assembly: {
    readonly script: string;
    readonly scriptHash: ContentFingerprint;
  };
  readonly partDefinitions: ReadonlyArray<{
    readonly elementId: string;
    readonly script: string;
    readonly scriptHash: ContentFingerprint;
  }>;
  readonly providerCalls: ReadonlyArray<GeometryBundleDraftProviderCall>;
}

/** Verify the raw approved source bytes before copying them into the canonical capture. */
export async function requireGeometryBundleCanonicalSources(
  draft: Omit<GeometryBundleDraftCapture, "fingerprint">,
): Promise<GeometryBundleCanonicalSources> {
  const assemblyHash = await sha256FingerprintOfText(draft.assembly.script);
  if (
    assemblyHash.algorithm !== draft.assembly.scriptHash.algorithm ||
    assemblyHash.digest !== draft.assembly.scriptHash.digest
  ) {
    throw new Error("Geometry bundle assembly source does not match its signed hash.");
  }
  const partDefinitions = [];
  for (const definition of draft.partDefinitions) {
    const observed = await sha256FingerprintOfText(definition.script);
    if (
      observed.algorithm !== definition.scriptHash.algorithm ||
      observed.digest !== definition.scriptHash.digest
    ) {
      throw new Error(
        `Geometry bundle PartDefinition ${definition.elementId} source does not match its signed hash.`,
      );
    }
    partDefinitions.push({
      elementId: definition.elementId,
      script: definition.script,
      scriptHash: definition.scriptHash,
    });
  }
  const expectedCalls: GeometryBundleDraftProviderCall[] = [
    {
      ordinal: 0,
      role: "assembly",
      exportName: `${draft.exportNamePrefix}-assembly`,
      scriptHash: draft.assembly.scriptHash,
      formats: draft.assembly.exportFormats,
    },
    ...draft.partDefinitions.map((definition, index) => ({
      ordinal: index + 1,
      role: "part-definition" as const,
      partDefinitionElementId: definition.elementId,
      exportName: `${draft.exportNamePrefix}-definition-${
        String(index).padStart(3, "0")
      }`,
      scriptHash: definition.scriptHash,
      formats: draft.partExportFormats,
    })),
  ];
  if (deterministicJson(draft.providerCalls) !== deterministicJson(expectedCalls)) {
    throw new Error(
      "Geometry bundle providerCalls do not match the exact ordered N+1 source plan.",
    );
  }
  return {
    assembly: {
      script: draft.assembly.script,
      scriptHash: draft.assembly.scriptHash,
    },
    partDefinitions,
    providerCalls: draft.providerCalls,
  };
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
 *     { format, artifact: { schemaVersion, uri, format, mimeType, bytes, sha256 } }
 *   ]
 * }
 *
 * The `files` array is ordered to match the `formats` argument supplied to the
 * tool.  We verify that order exactly; any deviation is a contract violation.
 */
function normalizeAssemblyExport(
  value: unknown,
  requestedFormats: ReadonlyArray<GeometryExportFormat>,
): ProviderGeometryFile<GeometryExportFormat>[] {
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
    return normalizeProviderGeometryFile(
      candidate,
      format,
      PREVIEW_ASSEMBLY_NAME,
      `assembly file ${index}`,
    );
  });
}

function definitionExportName(prefix: string, index: number): string {
  return `${prefix}-definition-${String(index).padStart(3, "0")}`;
}

function normalizeBundleExport(
  value: unknown,
  requestedFormats: ReadonlyArray<GeometryBundleExportFormat>,
  expectedName: string,
  exportContext: string,
): ProviderGeometryFile<GeometryBundleExportFormat>[] {
  const root = exactRecord(
    value,
    ["files", "kind", "metrics", "schemaVersion"],
    `build123d_export ${exportContext} structuredContent`,
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new Error(
      `build123d_export ${exportContext} returned an unsupported structuredContent contract.`,
    );
  }
  if (
    !root.metrics || typeof root.metrics !== "object" || Array.isArray(root.metrics)
  ) {
    throw new Error(
      `build123d_export ${exportContext} metrics must be an object.`,
    );
  }
  if (!Array.isArray(root.files) || root.files.length !== requestedFormats.length) {
    throw new Error(
      `build123d_export ${exportContext} must return exactly ${requestedFormats.length} file(s).`,
    );
  }
  return (root.files as unknown[]).map((candidate, fileIndex) => {
    const format = requestedFormats[fileIndex]!;
    const context = `${exportContext} file ${fileIndex}`;
    return normalizeProviderGeometryFile(candidate, format, expectedName, context);
  });
}

export interface ProviderGeometryFile<
  Format extends GeometryExportFormat = GeometryExportFormat,
> {
  readonly format: Format;
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
  readonly resource: ExpectedProviderResource;
}

export function normalizeProviderGeometryFile<
  Format extends GeometryExportFormat,
>(
  value: unknown,
  expectedFormat: Format,
  name: string,
  context: string,
): ProviderGeometryFile<Format> {
  const file = exactRecord(value, ["format", "artifact"], context);
  if (file.format !== expectedFormat) {
    throw new Error(
      `${context}: expected format "${expectedFormat}", got "${String(file.format)}".`,
    );
  }
  const artifact = exactRecord(
    file.artifact,
    ["schemaVersion", "uri", "format", "mimeType", "bytes", "sha256"],
    `${context}.artifact`,
  );
  if (artifact.schemaVersion !== "build123d-export-artifact/1.0") {
    throw new Error(`${context}.artifact schemaVersion is unsupported.`);
  }
  if (artifact.format !== expectedFormat) {
    throw new Error(
      `${context}.artifact format must equal the enclosing format "${expectedFormat}".`,
    );
  }
  const bytes = requirePositiveInt(artifact.bytes, `${context}.artifact bytes`);
  const digest = requireSha256Digest(
    artifact.sha256,
    `${context}.artifact sha256`,
  );
  const mediaType = expectedMediaType(expectedFormat);
  if (artifact.mimeType !== mediaType) {
    throw new Error(
      `${context}.artifact mimeType must be ${mediaType} for ${expectedFormat}.`,
    );
  }
  const uri = requireBuild123dArtifactUri(
    artifact.uri,
    digest,
    expectedFormat,
    `${context}.artifact uri`,
  );
  return {
    format: expectedFormat,
    name,
    bytes,
    fingerprint: { algorithm: "sha256", digest },
    resource: { uri, mediaType, byteCount: bytes, sha256: digest },
  };
}

export function providerFileToDraftFile<
  Format extends GeometryExportFormat,
>(file: ProviderGeometryFile<Format>): {
  readonly format: Format;
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
} {
  return {
    format: file.format,
    name: file.name,
    bytes: file.bytes,
    fingerprint: file.fingerprint,
  };
}

function expectedMediaType(format: GeometryExportFormat): string {
  switch (format) {
    case "step":
      return "model/step";
    case "stl":
      return "model/stl";
    case "gltf":
      return "model/gltf-binary";
  }
}

function requireBuild123dArtifactUri(
  value: unknown,
  digest: string,
  format: GeometryExportFormat,
  context: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${context} must be a string.`);
  }
  const extension = format === "gltf" ? "glb" : format;
  const expected = `casys://build123d/artifacts/${digest}.${extension}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${context} must be an absolute build123d artifact URI.`);
  }
  if (
    value !== expected || parsed.href !== expected || parsed.protocol !== "casys:" ||
    parsed.hostname !== "build123d" || parsed.pathname !==
      `/artifacts/${digest}.${extension}` ||
    parsed.search !== "" || parsed.hash !== "" ||
    parsed.username !== "" || parsed.password !== "" || parsed.port !== ""
  ) {
    throw new Error(`${context} must be the exact digest-bound build123d URI.`);
  }
  return expected;
}

export async function persistProviderResources<
  Format extends GeometryExportFormat,
>(
  files: ReadonlyArray<ProviderGeometryFile<Format>>,
  options: GeometryDraftCaptureOptions,
): Promise<void> {
  if (!options.resourceReader || !options.draftAssets) {
    throw new TypeError(
      "Geometry draft capture requires a server-owned resource reader and draft asset store.",
    );
  }
  for (const file of files) {
    const resource = await options.resourceReader.read(file.resource);
    const persisted = await options.draftAssets.persist(resource.bytes.copy());
    if (
      persisted.byteCount !== file.bytes ||
      !fingerprintsEqual(persisted.fingerprint, file.fingerprint)
    ) {
      throw new Error(
        `Geometry draft asset store did not preserve ${file.fingerprint.digest}.`,
      );
    }
  }
}

/** Fail closed on every persisted v2 definition export identity at seal time. */
export function assertGeometryBundleDraftDefinitionPaths(
  value: unknown,
  exportNamePrefix: string,
): void {
  if (!Array.isArray(value)) {
    throw new Error("Geometry bundle draft partDefinitions must be an array.");
  }
  value.forEach((candidate, definitionIndex) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(
        `Geometry bundle draft PartDefinition ${definitionIndex} must be an object.`,
      );
    }
    const files = (candidate as Record<string, unknown>).files;
    if (!Array.isArray(files)) {
      throw new Error(
        `Geometry bundle draft PartDefinition ${definitionIndex} files must be an array.`,
      );
    }
    files.forEach((rawFile, fileIndex) => {
      if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) {
        throw new Error(
          `Geometry bundle draft PartDefinition ${definitionIndex} file ${fileIndex} must be an object.`,
        );
      }
      const file = rawFile as Record<string, unknown>;
      if (file.format !== "step" && file.format !== "gltf" && file.format !== "stl") {
        throw new Error(
          `Geometry bundle draft PartDefinition ${definitionIndex} file ${fileIndex} has invalid format.`,
        );
      }
      if (
        file.name !== definitionExportName(exportNamePrefix, definitionIndex)
      ) {
        throw new Error(
          `Geometry bundle draft PartDefinition ${definitionIndex} file ${fileIndex} does not retain its server-owned export name.`,
        );
      }
    });
  });
}

/** Re-prove the run-scoped export namespace and every persisted v2 export name. */
export async function assertGeometryBundleDraftPaths(value: unknown): Promise<void> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Geometry bundle draft must be an object.");
  }
  const draft = value as Record<string, unknown>;
  if (!draft.producer || typeof draft.producer !== "object") {
    throw new Error("Geometry bundle draft producer must be an object.");
  }
  const runId = requireNonEmptyString(
    (draft.producer as Record<string, unknown>).runId,
    "Geometry bundle preview runId",
  );
  const prefix = requireNonEmptyString(
    draft.exportNamePrefix,
    "Geometry bundle exportNamePrefix",
  );
  const runDigest = await sha256FingerprintOfText(runId);
  if (prefix !== `geometry-preview-${runDigest.digest}`) {
    throw new Error(
      "Geometry bundle exportNamePrefix is not derived from the exact preview runId.",
    );
  }
  if (!draft.assembly || typeof draft.assembly !== "object") {
    throw new Error("Geometry bundle draft assembly must be an object.");
  }
  const assemblyFiles = (draft.assembly as Record<string, unknown>).files;
  if (!Array.isArray(assemblyFiles)) {
    throw new Error("Geometry bundle draft assembly files must be an array.");
  }
  assemblyFiles.forEach((rawFile, index) => {
    if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) {
      throw new Error(
        `Geometry bundle draft assembly file ${index} must be an object.`,
      );
    }
    const file = rawFile as Record<string, unknown>;
    if (file.format !== "step" && file.format !== "gltf" && file.format !== "stl") {
      throw new Error(
        `Geometry bundle draft assembly file ${index} has invalid format.`,
      );
    }
    if (file.name !== `${prefix}-assembly`) {
      throw new Error(
        `Geometry bundle draft assembly file ${index} does not retain its server-owned export name.`,
      );
    }
  });
  assertGeometryBundleDraftDefinitionPaths(draft.partDefinitions, prefix);
}

/**
 * Read the complete v2 binary inventory without trusting the TypeScript shape.
 *
 * A content-addressed JSON draft can still truthfully contain the SHA-256 of
 * zero bytes. The seal therefore needs the recorded byte count as an
 * independent, positive invariant and must compare it with the stored file
 * before any canonical write.
 */
export function requireGeometryBundleDraftAssetMetadata(
  value: unknown,
): readonly GeometryBundleDraftAssetMetadata[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Geometry bundle draft must be an object.");
  }
  const draft = value as Record<string, unknown>;
  if (
    !draft.assembly || typeof draft.assembly !== "object" ||
    Array.isArray(draft.assembly)
  ) {
    throw new Error("Geometry bundle draft assembly must be an object.");
  }
  const assemblyFiles = (draft.assembly as Record<string, unknown>).files;
  if (!Array.isArray(assemblyFiles)) {
    throw new Error("Geometry bundle draft assembly files must be an array.");
  }
  if (!Array.isArray(draft.partDefinitions)) {
    throw new Error("Geometry bundle draft partDefinitions must be an array.");
  }

  const result = assemblyFiles.map((file, index) =>
    requireDraftAssetMetadata(file, `assembly file ${index}`)
  );
  draft.partDefinitions.forEach((candidate, definitionIndex) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(
        `Geometry bundle draft PartDefinition ${definitionIndex} must be an object.`,
      );
    }
    const files = (candidate as Record<string, unknown>).files;
    if (!Array.isArray(files)) {
      throw new Error(
        `Geometry bundle draft PartDefinition ${definitionIndex} files must be an array.`,
      );
    }
    files.forEach((file, fileIndex) => {
      result.push(
        requireDraftAssetMetadata(
          file,
          `PartDefinition ${definitionIndex} file ${fileIndex}`,
        ),
      );
    });
  });

  const sizeByDigest = new Map<string, number>();
  for (const asset of result) {
    const previous = sizeByDigest.get(asset.fingerprint.digest);
    if (previous !== undefined && previous !== asset.bytes) {
      throw new Error(
        `Geometry bundle draft repeats binary ${asset.fingerprint.digest} with conflicting byte counts.`,
      );
    }
    sizeByDigest.set(asset.fingerprint.digest, asset.bytes);
  }
  return result;
}

function requireDraftAssetMetadata(
  value: unknown,
  context: string,
): GeometryBundleDraftAssetMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Geometry bundle draft ${context} must be an object.`);
  }
  const file = value as Record<string, unknown>;
  const fingerprint = exactRecord(
    file.fingerprint,
    ["algorithm", "digest"],
    `Geometry bundle draft ${context} fingerprint`,
  );
  if (fingerprint.algorithm !== "sha256") {
    throw new Error(
      `Geometry bundle draft ${context} fingerprint algorithm must be sha256.`,
    );
  }
  return {
    name: requireNonEmptyString(
      file.name,
      `Geometry bundle draft ${context} name`,
    ),
    bytes: requirePositiveInt(
      file.bytes,
      `Geometry bundle draft ${context} bytes`,
    ),
    fingerprint: {
      algorithm: "sha256",
      digest: requireSha256Digest(
        fingerprint.digest,
        `Geometry bundle draft ${context} fingerprint digest`,
      ),
    },
  };
}

/**
 * Revalidate persisted draft export names at seal time as well as at preview
 * time. This is intentionally `unknown`-based so a persisted current draft
 * cannot bypass the server-owned name contract through TypeScript shape trust.
 */
export function assertGeometryDraftAssemblyPaths(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error("Geometry draft assemblyFiles must be an array.");
  }
  value.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Geometry draft assembly file ${index} must be an object.`);
    }
    const file = candidate as Record<string, unknown>;
    if (file.format !== "step" && file.format !== "gltf" && file.format !== "stl") {
      throw new Error(`Geometry draft assembly file ${index} has invalid format.`);
    }
    if (file.name !== PREVIEW_ASSEMBLY_NAME) {
      throw new Error(
        `Geometry draft assembly file ${index} does not retain the server-owned export name.`,
      );
    }
  });
}

// ── Geometry draft asset location ─────────────────────────────────────────────

/**
 * Canonical local directory for binary draft assets, keyed by SHA-256 digest.
 *
 * WHY EXPORTED — composition, sealing and the Workbench BFF use the same
 * default adapter root. Capture itself writes only through GeometryDraftAssetStore.
 */
export const GEOMETRY_DRAFT_ASSETS_DIR = "state/local/geometry-draft-assets" as const;

// ── Private helpers ───────────────────────────────────────────────────────────

function stampDraftAdmission(
  admission: GeometryDraftAdmission | undefined,
  scriptHash: ContentFingerprint,
): GeometryDraftAdmission | undefined {
  if (admission === undefined) return undefined;
  const parsed = parseGeometryDraftAdmission(admission);
  if (!fingerprintsEqual(parsed.sourceFingerprint, scriptHash)) {
    throw new TypeError(
      "Geometry draft admission source fingerprint must equal the captured script hash.",
    );
  }
  return parsed;
}

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

function fingerprintsEqual(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${context}: expected a positive integer, got ${JSON.stringify(value)}.`,
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
  if (
    value === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  ) {
    throw new Error(`${context}: empty-file SHA-256 is not a geometry asset.`);
  }
  return value;
}
