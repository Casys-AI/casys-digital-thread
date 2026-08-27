/**
 * Complete canonical evidence for one PartDefinition geometry.
 *
 * This parser owns the closed capture grammar. Thread membership, active-tip
 * selection and binary publication remain application/adapter recrosses.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Hex,
} from "../../kernel/deterministic-json.ts";
import {
  type GeometrySourceAnalysisReference,
  parseGeometrySourceAnalysisReference,
} from "../source/geometry-source-analysis-reference.ts";
import {
  type GeometryPartDraftAdmission,
  parseGeometryPartDraftAdmission,
  requireNamedCadLeverInDraftScript,
} from "./geometry-draft-admission.ts";
import type { GeometryModuleCapture } from "./geometry-module-capture.ts";
import { parseGeometryModuleCapture } from "./geometry-module-capture.ts";
import { GEOMETRY_MODULE_CAPTURE_SCHEMA } from "../geometry-module-contract.ts";
import { digest, parseFingerprint } from "./geometry-module-identities.ts";
import {
  encodeGeometryPartDecisionParameters,
  GEOMETRY_PART_CAPTURE_SCHEMA,
  type GeometryPartManifest,
  parseGeometryPartManifest,
} from "./geometry-part-manifest.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "./geometry-proposal.ts";

export interface GeometryPartCaptureArchitectureBasis {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface GeometryPartCapturePreviewProducer {
  readonly serverId: "build123d-sandbox";
  readonly tool: "build123d_export";
  readonly runId: string;
}

export interface GeometryPartCaptureSourceScript {
  readonly partDefinitionElementId: string;
  readonly label: string;
  readonly script: string;
  readonly scriptHash: ContentFingerprint;
  readonly admission: GeometryPartDraftAdmission;
  readonly authoritativeStep: {
    readonly fileIndex: number;
    readonly fingerprint: ContentFingerprint;
    readonly bytes: number;
  };
}

export interface GeometryPartCapture {
  readonly schemaVersion: typeof GEOMETRY_PART_CAPTURE_SCHEMA;
  readonly operation: typeof DESIGN_WRITE_GEOMETRY_OPERATION;
  readonly trustedRunId: string;
  readonly draftDigest: string;
  readonly manifest: GeometryPartManifest;
  readonly architectureBasis: GeometryPartCaptureArchitectureBasis;
  readonly previewProducer: GeometryPartCapturePreviewProducer;
  readonly sourceScript: GeometryPartCaptureSourceScript;
  readonly sourceAnalysis: GeometrySourceAnalysisReference;
  readonly sealedAt: string;
}

export type CanonicalGeometryCapture = GeometryPartCapture | GeometryModuleCapture;

export async function parseGeometryPartCapture(
  value: unknown,
): Promise<GeometryPartCapture> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "previewProducer",
      "sourceScript",
      "sourceAnalysis",
      "sealedAt",
    ],
    "$geometryPartCapture",
  );
  literalValue(
    root.schemaVersion,
    GEOMETRY_PART_CAPTURE_SCHEMA,
    "$geometryPartCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$geometryPartCapture.operation",
  );
  literalValue(
    operation.id,
    DESIGN_WRITE_GEOMETRY_OPERATION.id,
    "$geometryPartCapture.operation.id",
  );
  literalValue(
    operation.version,
    DESIGN_WRITE_GEOMETRY_OPERATION.version,
    "$geometryPartCapture.operation.version",
  );

  const draftDigest = digest(
    root.draftDigest,
    "$geometryPartCapture.draftDigest",
  );
  const manifest = parseGeometryPartManifest(root.manifest, {
    requireCompleted: true,
  });
  // The flat MRTR grammar is the signed inverse used by the sealer. Calling
  // the encoder here rejects a manifest that is structurally parseable but
  // cannot be represented by that exact decision contract.
  encodeGeometryPartDecisionParameters(draftDigest, manifest);
  if (deterministicJson(manifest) !== deterministicJson(root.manifest)) {
    throw new TypeError(
      "$geometryPartCapture.manifest is not the canonical completed manifest record.",
    );
  }

  const architectureRecord = exactRecord(
    root.architectureBasis,
    ["artifactId", "fingerprint", "producerRunId"],
    "$geometryPartCapture.architectureBasis",
  );
  const architectureFingerprint = parseFingerprint(
    architectureRecord.fingerprint,
    "$geometryPartCapture.architectureBasis.fingerprint",
  );
  const architectureArtifactId = safeId(
    architectureRecord.artifactId,
    "$geometryPartCapture.architectureBasis.artifactId",
  );
  if (architectureArtifactId !== `architecture-${architectureFingerprint.digest}`) {
    throw new TypeError(
      "$geometryPartCapture.architectureBasis.artifactId must be architecture-<digest>.",
    );
  }
  if (
    !fingerprintsEqual(
      architectureFingerprint,
      manifest.architectureBasis.artifactFingerprint,
    )
  ) {
    throw new TypeError(
      "$geometryPartCapture architecture fingerprint does not equal the signed manifest basis.",
    );
  }
  const architectureBasis: GeometryPartCaptureArchitectureBasis = {
    artifactId: architectureArtifactId,
    fingerprint: architectureFingerprint,
    producerRunId: safeId(
      architectureRecord.producerRunId,
      "$geometryPartCapture.architectureBasis.producerRunId",
    ),
  };

  const previewRecord = exactRecord(
    root.previewProducer,
    ["serverId", "tool", "runId"],
    "$geometryPartCapture.previewProducer",
  );
  literalValue(
    previewRecord.serverId,
    "build123d-sandbox",
    "$geometryPartCapture.previewProducer.serverId",
  );
  literalValue(
    previewRecord.tool,
    "build123d_export",
    "$geometryPartCapture.previewProducer.tool",
  );
  const previewProducer: GeometryPartCapturePreviewProducer = {
    serverId: "build123d-sandbox",
    tool: "build123d_export",
    runId: safeId(
      previewRecord.runId,
      "$geometryPartCapture.previewProducer.runId",
    ),
  };

  const source = exactRecord(
    root.sourceScript,
    [
      "partDefinitionElementId",
      "label",
      "script",
      "scriptHash",
      "admission",
      "authoritativeStep",
    ],
    "$geometryPartCapture.sourceScript",
  );
  const partDefinitionElementId = nonEmptyText(
    source.partDefinitionElementId,
    "$geometryPartCapture.sourceScript.partDefinitionElementId",
  );
  const label = nonBlankText(
    source.label,
    "$geometryPartCapture.sourceScript.label",
  );
  const script = nonBlankText(
    source.script,
    "$geometryPartCapture.sourceScript.script",
  );
  const scriptHash = parseFingerprint(
    source.scriptHash,
    "$geometryPartCapture.sourceScript.scriptHash",
  );
  requireNamedCadLeverInDraftScript(
    script,
    "$geometryPartCapture.sourceScript.script",
  );
  const admission = parseGeometryPartDraftAdmission(
    source.admission,
    "$geometryPartCapture.sourceScript.admission",
  );
  const stepRecord = exactRecord(
    source.authoritativeStep,
    ["fileIndex", "fingerprint", "bytes"],
    "$geometryPartCapture.sourceScript.authoritativeStep",
  );
  const fileIndex = nonNegativeInteger(
    stepRecord.fileIndex,
    "$geometryPartCapture.sourceScript.authoritativeStep.fileIndex",
  );
  const authoritativeStep = {
    fileIndex,
    fingerprint: parseFingerprint(
      stepRecord.fingerprint,
      "$geometryPartCapture.sourceScript.authoritativeStep.fingerprint",
    ),
    bytes: positiveInteger(
      stepRecord.bytes,
      "$geometryPartCapture.sourceScript.authoritativeStep.bytes",
    ),
  };
  const signedStep = manifest.target.files?.[fileIndex];
  if (
    signedStep?.format !== "step" ||
    !fingerprintsEqual(signedStep.fingerprint, authoritativeStep.fingerprint)
  ) {
    throw new TypeError(
      "$geometryPartCapture authoritative STEP is not the exact signed STEP file.",
    );
  }
  if (
    partDefinitionElementId !== manifest.target.partDefinitionElementId ||
    label !== manifest.target.label ||
    !fingerprintsEqual(scriptHash, manifest.target.scriptHash) ||
    admission.target.partDefinitionElementId !== partDefinitionElementId ||
    admission.target.label !== label ||
    !fingerprintsEqual(admission.sourceFingerprint, scriptHash)
  ) {
    throw new TypeError(
      "$geometryPartCapture source, target, admission and signed manifest identities diverge.",
    );
  }
  const observedScriptHash: ContentFingerprint = {
    algorithm: "sha256",
    digest: await sha256Hex(new TextEncoder().encode(script)),
  };
  if (!fingerprintsEqual(observedScriptHash, scriptHash)) {
    throw new TypeError(
      "$geometryPartCapture sourceScript.script does not match scriptHash.",
    );
  }

  const sourceAnalysis = await parseGeometrySourceAnalysisReference(
    root.sourceAnalysis,
    "$geometryPartCapture.sourceAnalysis",
  );
  if (
    sourceAnalysis.selector.kind !== "part-definition" ||
    sourceAnalysis.selector.elementId !== partDefinitionElementId ||
    !fingerprintsEqual(sourceAnalysis.sourceFingerprint, scriptHash)
  ) {
    throw new TypeError(
      "$geometryPartCapture source analysis does not name the exact target source.",
    );
  }

  return deepFreeze({
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$geometryPartCapture.trustedRunId",
    ),
    draftDigest,
    manifest,
    architectureBasis,
    previewProducer,
    sourceScript: {
      partDefinitionElementId,
      label,
      script,
      scriptHash,
      admission,
      authoritativeStep,
    },
    sourceAnalysis,
    sealedAt: canonicalInstant(root.sealedAt, "$geometryPartCapture.sealedAt"),
  });
}

export async function parseCanonicalGeometryCapture(
  value: unknown,
): Promise<CanonicalGeometryCapture> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("$canonicalGeometryCapture must be an object.");
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  if (schemaVersion === GEOMETRY_PART_CAPTURE_SCHEMA) {
    return await parseGeometryPartCapture(value);
  }
  if (schemaVersion === GEOMETRY_MODULE_CAPTURE_SCHEMA) {
    return await parseGeometryModuleCapture(value);
  }
  throw new TypeError(
    "$canonicalGeometryCapture must be geometry-part-capture/1.0 or geometry-module-capture/1.0.",
  );
}

function nonBlankText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be non-blank text.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function canonicalInstant(value: unknown, path: string): string {
  const text = nonBlankText(value, path);
  if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) {
    throw new TypeError(`${path} must be a canonical ISO-8601 instant.`);
  }
  return text;
}
