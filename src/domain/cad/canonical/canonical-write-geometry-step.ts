/**
 * Attest a STEP as canonical `design.write-geometry@1` output.
 *
 * Production write-geometry never stamps `model/step` and
 * `producer.tool === design.write-geometry@1` on the same artefact. The JSON
 * primary is `geometry-<captureDigest>`; the STEP child is
 * `cad-asset-<captureDigest>-target-<n>-<stepDigest>` (or a PartDefinition
 * `…-definition-<d>-<f>-<stepDigest>`), produced by `build123d_export`.
 * Isolated CAD and admission artefacts stay refused.
 *
 * DFM currently owns a labelled wrapper; Buy imports this helper directly.
 * Do not duplicate or relax the identity rules.
 */

import { COMPILE_SEAL_ADMISSION_PRODUCER_TOOL } from "../../compile/admission/technical-compilation-proposal.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";

export const DESIGN_WRITE_GEOMETRY_TOOL = "design.write-geometry@1" as const;
export const WRITE_GEOMETRY_CAPTURE_URI_PREFIX = "casys://geometry-capture/" as const;
export const CANONICAL_STEP_MEDIA_TYPE = "model/step" as const;

export const FORBIDDEN_CANONICAL_GEOMETRY_TOOLS = [
  "design.seal-isolated-geometry@1",
  "design.execute-build123d@1",
  COMPILE_SEAL_ADMISSION_PRODUCER_TOOL,
] as const;

const CAD_ASSET_DEFINITION_STEP_ID =
  /^cad-asset-([a-f0-9]{64})-definition-\d+-\d+-([a-f0-9]{64})$/;
const CAD_ASSET_TARGET_STEP_ID =
  /^cad-asset-([a-f0-9]{64})-target-(\d+)-([a-f0-9]{64})$/;

export type CanonicalWriteGeometryStepRefusalCode =
  | "media-type"
  | "sha256"
  | "isolated"
  | "parent-absent"
  | "parent-ambiguous"
  | "parent-isolated"
  | "parent-not-canonical"
  | "not-canonical";

export type CanonicalWriteGeometryStepAttestation =
  | {
    readonly status: "attested";
    readonly step: ThreadArtifact;
    readonly geometry: ThreadArtifact;
  }
  | {
    readonly status: "refused";
    readonly code: CanonicalWriteGeometryStepRefusalCode;
    readonly message: string;
  };

export interface CanonicalWriteGeometryStepOptions {
  /** Human-readable role used in refusal messages. */
  readonly role?: string;
}

export function attestCanonicalWriteGeometryStep(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  expectedSha256?: string,
  options?: CanonicalWriteGeometryStepOptions,
): CanonicalWriteGeometryStepAttestation {
  const role = options?.role ?? "Canonical STEP";
  if (artifact.mediaType !== CANONICAL_STEP_MEDIA_TYPE) {
    return refused(
      "media-type",
      `${role} must be a model/step write-geometry artefact.`,
    );
  }
  if (expectedSha256 !== undefined && artifact.fingerprint.digest !== expectedSha256) {
    return refused(
      "sha256",
      `${role} SHA-256 mismatch: expected ${expectedSha256}, ` +
        `observed ${artifact.fingerprint.digest}.`,
    );
  }
  if (isForbiddenGeometryTool(artifact.producer.tool)) {
    return refused(
      "isolated",
      `Geometry binding refuses ${artifact.producer.tool}; only ` +
        `${DESIGN_WRITE_GEOMETRY_TOOL} is admitted.`,
    );
  }
  if (artifact.producer.tool === DESIGN_WRITE_GEOMETRY_TOOL) {
    return { status: "attested", step: artifact, geometry: artifact };
  }

  const owner = parseWriteGeometryStepOwner(artifact);
  if (!owner) {
    return refused(
      "not-canonical",
      `${role} must be a design.write-geometry@1 canonical artefact.`,
    );
  }

  const geometryId = `geometry-${owner.captureDigest}`;
  const parents = snapshot.artifacts.filter((item) =>
    item.id === geometryId &&
    item.kind === "cad-model" &&
    item.uri?.startsWith(WRITE_GEOMETRY_CAPTURE_URI_PREFIX)
  );
  if (parents.length === 0) {
    return refused(
      "parent-absent",
      `${role} STEP "${artifact.id}" is a write-geometry child but ` +
        `parent ${geometryId} is absent from the basis snapshot.`,
    );
  }
  if (parents.length > 1) {
    return refused(
      "parent-ambiguous",
      `${role} STEP "${artifact.id}" has ${parents.length} parent ` +
        `geometry captures; the seal will not pick one.`,
    );
  }
  const geometry = parents[0]!;
  if (isForbiddenGeometryTool(geometry.producer.tool)) {
    return refused(
      "parent-isolated",
      `Geometry binding refuses ${geometry.producer.tool}; only ` +
        `${DESIGN_WRITE_GEOMETRY_TOOL} is admitted.`,
    );
  }
  if (geometry.producer.tool !== DESIGN_WRITE_GEOMETRY_TOOL) {
    return refused(
      "parent-not-canonical",
      `${role} must be a design.write-geometry@1 canonical artefact.`,
    );
  }
  return { status: "attested", step: artifact, geometry };
}

export function parseWriteGeometryStepOwner(
  artifact: ThreadArtifact,
): { readonly captureDigest: string; readonly stepDigest: string } | undefined {
  const definition = CAD_ASSET_DEFINITION_STEP_ID.exec(artifact.id);
  const target = CAD_ASSET_TARGET_STEP_ID.exec(artifact.id);
  const captureDigest = definition?.[1] ?? target?.[1];
  const stepDigest = definition?.[2] ?? target?.[3];
  if (!captureDigest || !stepDigest) return undefined;
  if (stepDigest !== artifact.fingerprint.digest) return undefined;
  return { captureDigest, stepDigest };
}

export function isForbiddenGeometryTool(tool: string): boolean {
  return (FORBIDDEN_CANONICAL_GEOMETRY_TOOLS as readonly string[]).includes(tool);
}

function refused(
  code: CanonicalWriteGeometryStepRefusalCode,
  message: string,
): CanonicalWriteGeometryStepAttestation {
  return { status: "refused", code, message };
}
