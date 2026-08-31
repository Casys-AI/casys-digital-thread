/**
 * One-target Build123d export capture.
 *
 * Unlike `geometry-draft-capture.ts` this module has no assembly or bundle
 * vocabulary. It captures exactly one server-derived PartDefinition target,
 * makes exactly one provider call, and persists a review-only draft for a
 * later targeted sealer.
 */

import type { GeometryDraftAssetStore } from "../../../application/ports/out/cad/canonical/geometry-draft-asset-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  assertPartDraftJoinsAdmission,
  type GeometryPartDraftAdmission,
  parseGeometryPartDraftAdmission,
} from "../../../domain/cad/canonical/geometry-draft-admission.ts";
import {
  assertGeometryPartManifest,
  type GeometryPartExportFormat,
  type GeometryPartManifest,
  parseGeometryPartManifest,
} from "../../../domain/cad/canonical/geometry-part-manifest.ts";
import { validateGeometryScript } from "../../../domain/cad/source/geometry-script-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex as sha256Bytes,
} from "../../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";
import type { ProviderResourceReader } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  type GeometrySourceAnalysisCaptureDependencies,
  GeometrySourceAnalysisCaptureService,
} from "../source/geometry-source-analysis-capture.ts";
import type {
  GeometrySourceAnalysisReference,
} from "../../../domain/cad/source/geometry-source-analysis-reference.ts";
import {
  normalizeProviderGeometryFile,
  persistProviderResources,
  providerFileToDraftFile,
  type ProviderGeometryFile,
} from "./geometry-draft-capture.ts";
import { BUILD123D_EXPORT_TIMEOUT_MS } from "./build123d-export-contract.ts";

/** Fixed by the server; no caller can choose an export profile. */
export const GEOMETRY_PART_DRAFT_EXPORT_FORMATS = ["step", "gltf"] as const;
export const GEOMETRY_PART_DRAFT_CAPTURE_SCHEMA =
  "geometry-part-draft-capture/1.1" as const;

export interface GeometryPartDraftFile {
  readonly format: GeometryPartExportFormat;
  /** Server-owned basename; no provider path becomes a semantic identity. */
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryPartDraftCapture {
  readonly schemaVersion: typeof GEOMETRY_PART_DRAFT_CAPTURE_SCHEMA;
  readonly kind: "geometry-part-draft";
  readonly capturedAt: string;
  readonly architectureBasis: GeometryPartManifest["architectureBasis"];
  readonly predecessor?: GeometryPartManifest["predecessor"];
  readonly producer: {
    readonly serverId: "build123d-sandbox";
    readonly tool: "build123d_export";
    readonly runId: string;
  };
  readonly exportName: string;
  readonly exportFormats: ReadonlyArray<GeometryPartExportFormat>;
  readonly target: {
    readonly partDefinitionElementId: string;
    readonly label: string;
    readonly script: string;
    readonly scriptHash: ContentFingerprint;
    readonly files: ReadonlyArray<GeometryPartDraftFile>;
  };
  readonly sourceAnalysis: GeometrySourceAnalysisReference;
  /** Exact compile admission plus source and target identity for P2b recross. */
  readonly admission: GeometryPartDraftAdmission;
  readonly providerCall: {
    readonly ordinal: 0;
    readonly exportName: string;
    readonly scriptHash: ContentFingerprint;
    readonly formats: ReadonlyArray<GeometryPartExportFormat>;
    readonly timeoutMs: typeof BUILD123D_EXPORT_TIMEOUT_MS;
  };
  /** In-memory only; the content-addressed filename carries this identity. */
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryPartDraftCaptureInput {
  /** Exact sealed Build123d bytes. Never caller-supplied on the public command. */
  readonly script: string;
  /** Incomplete server-derived part manifest. */
  readonly manifest: GeometryPartManifest;
  readonly admission: GeometryPartDraftAdmission;
}

/** Reconstruct the sole signable target manifest from a reviewed target draft. */
export function geometryPartManifestFromDraft(
  draft: Omit<GeometryPartDraftCapture, "fingerprint">,
): GeometryPartManifest {
  const manifest = parseGeometryPartManifest({
    schemaVersion: "geometry-part-manifest/1.0",
    architectureBasis: draft.architectureBasis,
    ...(draft.predecessor === undefined ? {} : { predecessor: draft.predecessor }),
    target: {
      partDefinitionElementId: draft.target.partDefinitionElementId,
      label: draft.target.label,
      scriptHash: draft.target.scriptHash,
      files: draft.target.files.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: file.fingerprint,
      })),
    },
    unitSystem: "mm",
    exportFormats: draft.exportFormats,
  }, { requireCompleted: true });
  return manifest;
}

/**
 * Re-prove the fixed target-export namespace without trusting provider paths.
 * It is intentionally usable by the canonical sealer after the provider has
 * gone away, so promotion cannot rerun Build123d.
 */
export async function assertGeometryPartDraftPaths(
  draft: Omit<GeometryPartDraftCapture, "fingerprint">,
): Promise<void> {
  const expectedExportName = await targetExportName(
    draft.producer.runId,
    draft.target.partDefinitionElementId,
  );
  if (draft.exportName !== expectedExportName) {
    throw new TypeError(
      "Target geometry exportName is not derived from its exact preview run and PartDefinition.",
    );
  }
  if (
    deterministicJson(draft.providerCall) !== deterministicJson({
      ordinal: 0,
      exportName: expectedExportName,
      scriptHash: draft.target.scriptHash,
      formats: draft.exportFormats,
      timeoutMs: BUILD123D_EXPORT_TIMEOUT_MS,
    })
  ) {
    throw new TypeError(
      "Target geometry provider call is not the exact server-owned one-call export record.",
    );
  }
  draft.target.files.forEach((file, index) => {
    if (file.name !== expectedExportName) {
      throw new TypeError(
        `Target geometry draft file ${index} does not retain its server-owned export name.`,
      );
    }
  });
}

/** One exact metadata row per target binary, including the signed byte count. */
export function geometryPartDraftAssetMetadata(
  draft: Omit<GeometryPartDraftCapture, "fingerprint">,
): readonly {
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}[] {
  const seen = new Map<string, number>();
  for (const file of draft.target.files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
      throw new TypeError("Target geometry binary byte count must be positive.");
    }
    const prior = seen.get(file.fingerprint.digest);
    if (prior !== undefined && prior !== file.bytes) {
      throw new TypeError(
        "Target geometry draft repeats a binary digest with conflicting byte counts.",
      );
    }
    seen.set(file.fingerprint.digest, file.bytes);
  }
  return draft.target.files.map((file) => ({
    name: file.name,
    bytes: file.bytes,
    fingerprint: file.fingerprint,
  }));
}

export interface GeometryPartDraftCaptureOptions {
  readonly sourceAnalysis: GeometrySourceAnalysisCaptureDependencies;
  readonly resourceReader: ProviderResourceReader;
  readonly draftAssets: GeometryDraftAssetStore;
  /** Server-generated invocation identity; tests may pin it. */
  readonly previewRunId?: string;
}

/**
 * Analyze, export, read the exact provider resources and persist one target draft.
 * All validation and source capture happens before the sole provider call.
 */
export async function captureGeometryPartDraft(
  client: McpToolClient,
  input: GeometryPartDraftCaptureInput,
  draftStore: FileCaptureStore<"geometry-draft">,
  options: GeometryPartDraftCaptureOptions,
  now: () => string = () => new Date().toISOString(),
): Promise<GeometryPartDraftCapture> {
  const manifest = parseGeometryPartManifest(input.manifest);
  assertGeometryPartManifest(manifest);
  if (manifest.target.scriptHash !== undefined || manifest.target.files !== undefined) {
    throw new TypeError(
      "Target geometry preview input must not contain caller-supplied script or artifact hashes.",
    );
  }
  if (
    deterministicJson(manifest.exportFormats) !==
      deterministicJson(GEOMETRY_PART_DRAFT_EXPORT_FORMATS)
  ) {
    throw new TypeError(
      "Target geometry preview must use the server-fixed STEP and GLTF export formats.",
    );
  }
  if (typeof input.script !== "string" || input.script.length === 0) {
    throw new TypeError("Target geometry preview requires non-empty admitted source.");
  }
  const admission = parseGeometryPartDraftAdmission(input.admission);
  if (
    admission.target.partDefinitionElementId !==
      manifest.target.partDefinitionElementId ||
    admission.target.label !== manifest.target.label
  ) {
    throw new TypeError(
      "Target geometry draft admission does not name the exact manifest PartDefinition.",
    );
  }

  const previewRunId = options.previewRunId ??
    `geometry-part-preview:${crypto.randomUUID()}`;
  if (previewRunId.trim() === "") {
    throw new TypeError("previewRunId must be a non-empty string.");
  }
  const exportName = await targetExportName(
    previewRunId,
    manifest.target.partDefinitionElementId,
  );

  validateGeometryScript(input.script);
  const scriptHash = await sha256FingerprintOfText(input.script);
  assertPartDraftJoinsAdmission(scriptHash, admission);
  const sourceAnalysis = await new GeometrySourceAnalysisCaptureService(
    options.sourceAnalysis,
  ).capture({
    selector: {
      kind: "part-definition",
      elementId: manifest.target.partDefinitionElementId,
    },
    sourceText: input.script,
  });
  if (!fingerprintsEqual(sourceAnalysis.sourceFingerprint, scriptHash)) {
    throw new Error(
      "Target geometry source analysis did not retain the exact admitted script hash.",
    );
  }

  const providerResult = await client.callTool({
    name: "build123d_export",
    arguments: {
      script: input.script,
      formats: [...GEOMETRY_PART_DRAFT_EXPORT_FORMATS],
      name: exportName,
      timeout_ms: BUILD123D_EXPORT_TIMEOUT_MS,
    },
  });
  const providerFiles = normalizeTargetExport(
    providerResult.structuredContent,
    GEOMETRY_PART_DRAFT_EXPORT_FORMATS,
    exportName,
  );
  const files = providerFiles.map(providerFileToDraftFile);

  await persistProviderResources(providerFiles, options);

  const unsigned = {
    schemaVersion: GEOMETRY_PART_DRAFT_CAPTURE_SCHEMA,
    kind: "geometry-part-draft" as const,
    capturedAt: now(),
    architectureBasis: manifest.architectureBasis,
    ...(manifest.predecessor === undefined
      ? {}
      : { predecessor: manifest.predecessor }),
    producer: {
      serverId: "build123d-sandbox" as const,
      tool: "build123d_export" as const,
      runId: previewRunId,
    },
    exportName,
    exportFormats: [...GEOMETRY_PART_DRAFT_EXPORT_FORMATS],
    target: {
      partDefinitionElementId: manifest.target.partDefinitionElementId,
      label: manifest.target.label,
      script: input.script,
      scriptHash,
      files,
    },
    sourceAnalysis,
    admission,
    providerCall: {
      ordinal: 0 as const,
      exportName,
      scriptHash,
      formats: [...GEOMETRY_PART_DRAFT_EXPORT_FORMATS],
      timeoutMs: BUILD123D_EXPORT_TIMEOUT_MS,
    },
  };
  const fingerprint = await sha256Fingerprint(unsigned);
  const text = deterministicJson(unsigned);
  await draftStore.save(fingerprint, text);
  if (await draftStore.read(fingerprint) !== text) {
    throw new Error("Target geometry draft was not durably readable after save.");
  }
  return Object.freeze({ ...unsigned, fingerprint });
}

function normalizeTargetExport(
  value: unknown,
  formats: ReadonlyArray<GeometryPartExportFormat>,
  exportName: string,
): ProviderGeometryFile<GeometryPartExportFormat>[] {
  const root = exactRecord(
    value,
    ["files", "kind", "metrics", "schemaVersion"],
    "build123d_export target structuredContent",
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new Error("build123d_export target returned an unsupported contract.");
  }
  if (
    !root.metrics || typeof root.metrics !== "object" || Array.isArray(root.metrics)
  ) {
    throw new Error("build123d_export target metrics must be an object.");
  }
  if (!Array.isArray(root.files) || root.files.length !== formats.length) {
    throw new Error(
      `build123d_export target must return exactly ${formats.length} file(s).`,
    );
  }
  return root.files.map((candidate, index) => {
    const format = formats[index]!;
    return normalizeProviderGeometryFile(
      candidate,
      format,
      exportName,
      `target file ${index}`,
    );
  });
}

async function targetExportName(runId: string, targetId: string): Promise<string> {
  const digest = await sha256Fingerprint({ runId, targetId });
  return `geometry-part-preview-${digest.digest}`;
}

async function sha256FingerprintOfText(text: string): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await sha256Bytes(new TextEncoder().encode(text)),
  };
}
