/**
 * Read-only geometry/STEP source admission shared by the proof-seal review
 * and `verify.seal-proof-case@1`.
 *
 * This reopens the geometry-capture CAS and the canonical STEP bytes, then
 * recomputes the STEP SHA-256 itself. It does not claim a run, write Thread
 * state, or move the MRTR gate. A later seal still requires the distinct
 * human approval.
 */

import type { CanonicalAssetReader } from "../../../ports/out/canonical-asset-reader.ts";
import type { FeaProofDecisionParameters } from "../../../../domain/fea/seal-case/fea-proof-proposal.ts";
import type { FeaProofSealBindingDiagnostic } from "../../../../domain/fea/seal-case/fea-proof-seal-bindings.ts";
import {
  fingerprintsEqual,
  sha256Hex,
} from "../../../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../../../domain/kernel/case-validation.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  parseGeometryPartManifest,
} from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import { parseGeometryPartDraftAdmission } from "../../../../domain/cad/canonical/geometry-draft-admission.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";

/** Bundle captures the seal executor already admits. Not 1.x geometry captures. */
export const FEA_PROOF_SEAL_GEOMETRY_CAPTURE_SCHEMAS = [
  "geometry-capture/2.1",
  GEOMETRY_PART_CAPTURE_SCHEMA,
] as const;

export interface FeaProofSealGeometryCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export type FeaProofSealSourceAdmission =
  | {
    readonly status: "admitted";
    readonly geometryArtifact: ThreadArtifact;
    readonly stepArtifact: ThreadArtifact;
    readonly stepBytes: number;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: FeaProofSealBindingDiagnostic;
  };

export async function admitFeaProofSealSource(input: {
  readonly snapshot: ThreadSnapshot;
  readonly decisionParams: FeaProofDecisionParameters;
  readonly geometryCaptures: FeaProofSealGeometryCaptureReader;
  readonly stepAssets: CanonicalAssetReader;
}): Promise<FeaProofSealSourceAdmission> {
  const identity = admitGeometryArtifactIdentity(
    input.snapshot,
    input.decisionParams,
  );
  if (identity.status !== "admitted") return identity;

  let geoCaptureText: string | undefined;
  try {
    geoCaptureText = await input.geometryCaptures.read(
      identity.geometryArtifact.fingerprint,
    );
  } catch (error) {
    return refused(
      "unavailable",
      "geometry-capture-unavailable",
      identity.geometryArtifact.id,
      `Geometry capture ${
        input.decisionParams.geometryArtifact.fingerprint.digest.slice(0, 16)
      }… could not be reopened: ${errorMessage(error)}.`,
    );
  }
  if (!geoCaptureText) {
    return refused(
      "unavailable",
      "geometry-capture-unavailable",
      identity.geometryArtifact.id,
      `Geometry capture ${
        input.decisionParams.geometryArtifact.fingerprint.digest.slice(0, 16)
      }… is not readable from the content-addressed store.`,
    );
  }

  const inspected = inspectGeometryCapture(
    geoCaptureText,
    input.decisionParams,
    identity.geometryArtifact.id,
  );
  if (inspected.status !== "ok") return inspected;

  const stepIdentity = admitStepArtifactIdentity(
    input.snapshot,
    input.decisionParams,
    inspected,
  );
  if (stepIdentity.status !== "admitted") return stepIdentity;

  let stepBytesData: Uint8Array;
  try {
    stepBytesData = await input.stepAssets.read(input.decisionParams.step.digest);
  } catch (error) {
    return refused(
      "unavailable",
      "step-unavailable",
      stepIdentity.stepArtifact.id,
      `STEP file read failed: ${errorMessage(error)}`,
    );
  }
  if (stepBytesData.byteLength !== input.decisionParams.step.bytes) {
    return refused(
      "unresolved",
      "step-mismatch",
      stepIdentity.stepArtifact.id,
      `STEP byte count mismatch: expected ${input.decisionParams.step.bytes}, ` +
        `got ${stepBytesData.byteLength}.`,
    );
  }

  const observedStepDigest = await sha256Hex(stepBytesData);
  if (
    !fingerprintsEqual(
      { algorithm: "sha256", digest: observedStepDigest },
      { algorithm: "sha256", digest: input.decisionParams.step.digest },
    )
  ) {
    return refused(
      "unresolved",
      "step-mismatch",
      stepIdentity.stepArtifact.id,
      `STEP SHA-256 mismatch: expected ` +
        `${input.decisionParams.step.digest.slice(0, 16)}…, ` +
        `got ${observedStepDigest.slice(0, 16)}….`,
    );
  }

  return {
    status: "admitted",
    geometryArtifact: identity.geometryArtifact,
    stepArtifact: stepIdentity.stepArtifact,
    stepBytes: stepBytesData.byteLength,
  };
}

function admitGeometryArtifactIdentity(
  snapshot: ThreadSnapshot,
  decisionParams: FeaProofDecisionParameters,
):
  | { readonly status: "admitted"; readonly geometryArtifact: ThreadArtifact }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: FeaProofSealBindingDiagnostic;
  } {
  const geomDigest = decisionParams.geometryArtifact.fingerprint.digest;
  const expectedGeomId = `geometry-${geomDigest}`;
  const geometryArtifact = snapshot.artifacts.find(
    (artifact) => artifact.id === decisionParams.geometryArtifact.id,
  );
  if (!geometryArtifact) {
    return refused(
      "unresolved",
      "geometry-absent",
      decisionParams.geometryArtifact.id,
      `Geometry artifact "${decisionParams.geometryArtifact.id}" is not present ` +
        "in the current basis snapshot.",
    );
  }
  if (geometryArtifact.id !== expectedGeomId) {
    return refused(
      "unresolved",
      "geometry-identity-rejected",
      geometryArtifact.id,
      `Geometry artifact id "${geometryArtifact.id}" does not match the canonical ` +
        `form "geometry-<digest>" for the signed fingerprint.`,
    );
  }
  if (
    geometryArtifact.kind !== "cad-model" ||
    !fingerprintsEqual(
      geometryArtifact.fingerprint,
      decisionParams.geometryArtifact.fingerprint,
    )
  ) {
    return refused(
      "unresolved",
      "geometry-identity-rejected",
      geometryArtifact.id,
      "Geometry artifact kind or fingerprint does not match the MRTR-signed values.",
    );
  }
  if (!geometryArtifact.uri?.startsWith("casys://geometry-capture/")) {
    return refused(
      "unresolved",
      "geometry-identity-rejected",
      geometryArtifact.id,
      "Geometry artifact URI does not start with the expected geometry-capture prefix.",
    );
  }
  if (
    geometryArtifact.mediaType !== "application/json" ||
    geometryArtifact.producer.serverId !== "digital-thread"
  ) {
    return refused(
      "unresolved",
      "geometry-identity-rejected",
      geometryArtifact.id,
      "Geometry artifact mediaType or producer serverId is not canonical.",
    );
  }
  return { status: "admitted", geometryArtifact };
}

function inspectGeometryCapture(
  geoCaptureText: string,
  decisionParams: FeaProofDecisionParameters,
  geometryArtifactId: string,
):
  | {
    readonly status: "ok";
    readonly family: "bundle";
    readonly matchingDefIndex: number;
    readonly stepFileIndex: number;
  }
  | {
    readonly status: "ok";
    readonly family: "target";
    readonly stepFileIndex: number;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: FeaProofSealBindingDiagnostic;
  } {
  let geoCaptureRecord: unknown;
  try {
    geoCaptureRecord = JSON.parse(geoCaptureText);
  } catch {
    return refused(
      "unresolved",
      "geometry-capture-invalid",
      geometryArtifactId,
      "Geometry capture is not valid JSON.",
    );
  }

  if (
    !geoCaptureRecord ||
    typeof geoCaptureRecord !== "object" ||
    Array.isArray(geoCaptureRecord) ||
    !FEA_PROOF_SEAL_GEOMETRY_CAPTURE_SCHEMAS.includes(
      (geoCaptureRecord as Record<string, unknown>)
        .schemaVersion as typeof FEA_PROOF_SEAL_GEOMETRY_CAPTURE_SCHEMAS[number],
    )
  ) {
    return refused(
      "unresolved",
      "geometry-capture-invalid",
      geometryArtifactId,
      `FEA proof seal requires a canonical V2 geometry bundle or target PartDefinition capture; ` +
        `got schemaVersion="${
          (geoCaptureRecord as Record<string, unknown>)?.schemaVersion
        }".`,
    );
  }

  const geoRecord = geoCaptureRecord as Record<string, unknown>;
  if (geoRecord.schemaVersion === GEOMETRY_PART_CAPTURE_SCHEMA) {
    return inspectTargetGeometryCapture(
      geoRecord,
      decisionParams,
      geometryArtifactId,
    );
  }
  const manifest = geoRecord.manifest as Record<string, unknown> | undefined;
  if (
    !manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
    !Array.isArray(manifest.partDefinitions)
  ) {
    return refused(
      "unresolved",
      "geometry-capture-invalid",
      geometryArtifactId,
      "Geometry capture manifest or partDefinitions is missing or invalid.",
    );
  }

  const partDefinitions = manifest.partDefinitions as Array<
    Record<string, unknown>
  >;
  const targetElementId = decisionParams.target.modelElementId;
  let matchingDefIndex = -1;
  for (let i = 0; i < partDefinitions.length; i++) {
    const def = partDefinitions[i];
    if (def?.elementId === targetElementId) {
      matchingDefIndex = i;
      break;
    }
  }
  if (matchingDefIndex < 0) {
    return refused(
      "unresolved",
      "geometry-capture-invalid",
      geometryArtifactId,
      `Target modelElementId "${targetElementId}" is not found among ` +
        `partDefinitions[].elementId in the geometry capture. ` +
        "Only PartDefinition elements are valid FEA targets (proof load/support " +
        "boxes are expressed in the part's local frame).",
    );
  }

  const matchingDef = partDefinitions[matchingDefIndex]!;
  if (!Array.isArray(matchingDef.files)) {
    return refused(
      "unresolved",
      "geometry-capture-invalid",
      geometryArtifactId,
      `PartDefinition at index ${matchingDefIndex} (elementId "${targetElementId}") ` +
        "has no files in the geometry capture.",
    );
  }

  const files = matchingDef.files as Array<Record<string, unknown>>;
  let stepFileIndex = -1;
  let stepFingerprint: ContentFingerprint | undefined;
  for (let j = 0; j < files.length; j++) {
    const file = files[j];
    if (file?.format === "step") {
      const fp = file.fingerprint as Record<string, unknown> | undefined;
      if (fp && fp.algorithm === "sha256" && typeof fp.digest === "string") {
        stepFingerprint = {
          algorithm: fp.algorithm as "sha256",
          digest: fp.digest,
        };
        stepFileIndex = j;
        break;
      }
    }
  }
  if (stepFileIndex < 0 || !stepFingerprint) {
    return refused(
      "unresolved",
      "geometry-capture-invalid",
      geometryArtifactId,
      `No STEP file found for PartDefinition "${targetElementId}" ` +
        "in the geometry capture.",
    );
  }
  if (stepFingerprint.digest !== decisionParams.step.digest) {
    return refused(
      "unresolved",
      "step-mismatch",
      geometryArtifactId,
      `STEP fingerprint "${stepFingerprint.digest.slice(0, 16)}…" in the ` +
        `geometry capture does not match MRTR-signed step.digest ` +
        `"${decisionParams.step.digest.slice(0, 16)}…".`,
    );
  }
  return { status: "ok", family: "bundle", matchingDefIndex, stepFileIndex };
}

/**
 * Target captures are a distinct, closed schema.  Do not treat them as a
 * degenerate `partDefinitions[]`: exact target identity and the byte-counted
 * authoritative STEP are what make a part-only proof binding truthful.
 */
function inspectTargetGeometryCapture(
  record: Record<string, unknown>,
  decisionParams: FeaProofDecisionParameters,
  geometryArtifactId: string,
):
  | { readonly status: "ok"; readonly family: "target"; readonly stepFileIndex: number }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: FeaProofSealBindingDiagnostic;
  } {
  try {
    exactRecord(
      record,
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
    const manifest = parseGeometryPartManifest(record.manifest, {
      requireCompleted: true,
    });
    if (
      manifest.target.partDefinitionElementId !==
        decisionParams.target.modelElementId
    ) {
      return refused(
        "unresolved",
        "geometry-capture-invalid",
        geometryArtifactId,
        `Target modelElementId "${decisionParams.target.modelElementId}" does not equal ` +
          `the canonical PartDefinition elementId "${manifest.target.partDefinitionElementId}".`,
      );
    }
    const source = exactRecord(
      record.sourceScript,
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
    const sourceHash = source.scriptHash as Record<string, unknown>;
    const admission = parseGeometryPartDraftAdmission(
      source.admission,
      "$geometryPartCapture.sourceScript.admission",
    );
    if (
      source.partDefinitionElementId !== manifest.target.partDefinitionElementId ||
      source.label !== manifest.target.label ||
      sourceHash?.algorithm !== "sha256" ||
      sourceHash.digest !== manifest.target.scriptHash!.digest ||
      !fingerprintsEqual(admission.sourceFingerprint, manifest.target.scriptHash!) ||
      admission.target.partDefinitionElementId !==
        manifest.target.partDefinitionElementId ||
      admission.target.label !== manifest.target.label
    ) {
      return refused(
        "unresolved",
        "geometry-capture-invalid",
        geometryArtifactId,
        "Target capture source/admission identity does not exactly join the signed PartDefinition.",
      );
    }
    const authoritativeStep = exactRecord(
      source.authoritativeStep,
      ["fileIndex", "fingerprint", "bytes"],
      "$geometryPartCapture.sourceScript.authoritativeStep",
    );
    if (
      typeof authoritativeStep.fileIndex !== "number" ||
      !Number.isSafeInteger(authoritativeStep.fileIndex) ||
      authoritativeStep.fileIndex < 0 ||
      typeof authoritativeStep.bytes !== "number" ||
      !Number.isSafeInteger(authoritativeStep.bytes) ||
      authoritativeStep.bytes <= 0
    ) {
      return refused(
        "unresolved",
        "geometry-capture-invalid",
        geometryArtifactId,
        "Target capture authoritative STEP index or byte count is invalid.",
      );
    }
    const stepFile = manifest.target.files![authoritativeStep.fileIndex];
    const stepFingerprint = authoritativeStep.fingerprint as Record<string, unknown>;
    if (
      !stepFile || stepFile.format !== "step" ||
      stepFingerprint?.algorithm !== "sha256" ||
      stepFingerprint.digest !== stepFile.fingerprint.digest ||
      stepFile.fingerprint.digest !== decisionParams.step.digest ||
      authoritativeStep.bytes !== decisionParams.step.bytes
    ) {
      return refused(
        "unresolved",
        "step-mismatch",
        geometryArtifactId,
        "Canonical target STEP identity, digest, or byte count does not match the MRTR-signed proof input.",
      );
    }
    return {
      status: "ok",
      family: "target",
      stepFileIndex: authoritativeStep.fileIndex,
    };
  } catch (error) {
    return refused(
      "unresolved",
      "geometry-capture-invalid",
      geometryArtifactId,
      `Target geometry capture is not an exact canonical PartDefinition record: ${
        errorMessage(error)
      }.`,
    );
  }
}

function admitStepArtifactIdentity(
  snapshot: ThreadSnapshot,
  decisionParams: FeaProofDecisionParameters,
  inspected:
    | {
      readonly status: "ok";
      readonly family: "bundle";
      readonly matchingDefIndex: number;
      readonly stepFileIndex: number;
    }
    | {
      readonly status: "ok";
      readonly family: "target";
      readonly stepFileIndex: number;
    },
):
  | { readonly status: "admitted"; readonly stepArtifact: ThreadArtifact }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: FeaProofSealBindingDiagnostic;
  } {
  const geomDigest = decisionParams.geometryArtifact.fingerprint.digest;
  const stepArtifactId = inspected.family === "target"
    ? `cad-asset-${geomDigest}-target-${inspected.stepFileIndex}-${decisionParams.step.digest}`
    : `cad-asset-${geomDigest}-definition-${inspected.matchingDefIndex}-${inspected.stepFileIndex}-${decisionParams.step.digest}`;
  const stepArtifact = snapshot.artifacts.find(
    (artifact) => artifact.id === stepArtifactId,
  );
  if (!stepArtifact) {
    return refused(
      "unresolved",
      "step-absent",
      stepArtifactId,
      `STEP artifact "${stepArtifactId}" is not present in the current basis snapshot. ` +
        "This artifact should have been created by design.write-geometry@1.",
    );
  }
  if (
    stepArtifact.kind !== "step" ||
    stepArtifact.mediaType !== "model/step" ||
    stepArtifact.version !== decisionParams.step.digest ||
    stepArtifact.fingerprint.algorithm !== "sha256" ||
    stepArtifact.fingerprint.digest !== decisionParams.step.digest ||
    stepArtifact.uri !== `/api/thread/assets/${decisionParams.step.digest}.step`
  ) {
    return refused(
      "unresolved",
      "step-mismatch",
      stepArtifact.id,
      "STEP artifact kind, media type, version, URI, or fingerprint does not match the expected canonical STEP identity.",
    );
  }
  return { status: "admitted", stepArtifact };
}

function refused(
  status: "unavailable" | "unresolved",
  code: FeaProofSealBindingDiagnostic["code"],
  artifactId: string | null,
  message: string,
): {
  readonly status: "unavailable" | "unresolved";
  readonly diagnostic: FeaProofSealBindingDiagnostic;
} {
  return { status, diagnostic: { code, artifactId, message } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
