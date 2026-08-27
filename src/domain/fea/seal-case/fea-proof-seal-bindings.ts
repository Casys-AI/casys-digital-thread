/**
 * Resolve Thread artifacts a later `verify.seal-proof-case@1` MRTR may bind.
 *
 * The caller never supplies hashes, boxes, material or SysON UUIDs. The
 * catalogued MechanicalProofCase predicts the STEP; this module only finds
 * the matching Thread identities. Ambiguity is unresolved — it does not pick
 * the assembly cad-model when several STEPs exist.
 */

import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import type { MechanicalProofCase } from "./mechanical-proof-case.ts";

export const FEA_PROOF_GEOMETRY_KIND = "cad-model" as const;
export const FEA_PROOF_STEP_KIND = "step" as const;
export const FEA_PROOF_GEOMETRY_URI_PREFIX = "casys://geometry-capture/" as const;

const CAD_ASSET_STEP_ID =
  /^cad-asset-([a-f0-9]{64})-definition-\d+-\d+-([a-f0-9]{64})$/;
const CAD_TARGET_ASSET_STEP_ID =
  /^cad-asset-([a-f0-9]{64})-target-(\d+)-([a-f0-9]{64})$/;

export type FeaProofSealBindingDiagnosticCode =
  | "unknown-proof-case"
  | "source-absent"
  | "source-unavailable"
  | "source-corrupt"
  | "source-mismatch"
  | "cad-lineage-unavailable"
  | "cad-lineage-ambiguous"
  | "cad-lineage-invalid"
  | "basis-latest"
  | "basis-mismatch"
  | "basis-absent"
  | "basis-ambiguous"
  | "project-mismatch"
  | "subject-mismatch"
  | "step-absent"
  | "step-ambiguous"
  | "geometry-absent"
  | "geometry-ambiguous"
  | "geometry-identity-rejected"
  | "geometry-capture-unavailable"
  | "geometry-capture-invalid"
  | "step-unavailable"
  | "step-mismatch"
  | "requirements-absent"
  | "requirements-ambiguous"
  | "requirements-retired"
  | "requirements-component-mismatch"
  | "requirements-capture-unavailable"
  | "requirements-capture-invalid"
  | "project-state-unavailable"
  | "project-state-mismatch"
  | "basis-not-current"
  | "compiled-identities-conflict"
  | "sensitivity-catalog-unavailable"
  | "proposal-grammar-rejected";

export interface FeaProofSealBindingDiagnostic {
  readonly code: FeaProofSealBindingDiagnosticCode;
  readonly artifactId: string | null;
  readonly message: string;
}

export interface FeaProofSealThreadBindings {
  readonly geometryArtifact: ThreadArtifact;
  readonly stepArtifact: ThreadArtifact;
  readonly requirementsArtifact: ThreadArtifact;
}

export function resolveFeaProofSealThreadBindings(
  snapshot: ThreadSnapshot,
  proofCase: MechanicalProofCase,
  projectId: string,
  requirementsArtifact: ThreadArtifact,
):
  | { readonly status: "resolved"; readonly bindings: FeaProofSealThreadBindings }
  | {
    readonly status: "unresolved";
    readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
  } {
  const diagnostics: FeaProofSealBindingDiagnostic[] = [];
  if (proofCase.project.id !== projectId) {
    diagnostics.push({
      code: "project-mismatch",
      artifactId: null,
      message:
        `Catalogued proof case project.id "${proofCase.project.id}" does not match ` +
        `requested projectId "${projectId}".`,
    });
  }
  if (proofCase.project.subjectId !== snapshot.subject.id) {
    diagnostics.push({
      code: "subject-mismatch",
      artifactId: null,
      message:
        `Catalogued proof case subjectId "${proofCase.project.subjectId}" does not match ` +
        `Thread subject "${snapshot.subject.id}".`,
    });
  }

  const steps = snapshot.artifacts.filter((artifact) =>
    artifact.kind === FEA_PROOF_STEP_KIND &&
    artifact.mediaType === "model/step" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.version === proofCase.expectedCadArtifact.sha256 &&
    artifact.fingerprint.digest === proofCase.expectedCadArtifact.sha256
  );
  if (steps.length === 0) {
    diagnostics.push({
      code: "step-absent",
      artifactId: null,
      message:
        `No STEP artifact in the named basis matches expectedCadArtifact.sha256 ` +
        `${proofCase.expectedCadArtifact.sha256.slice(0, 16)}….`,
    });
  } else if (steps.length > 1) {
    diagnostics.push({
      code: "step-ambiguous",
      artifactId: null,
      message:
        `The named basis has ${steps.length} STEP artifacts with the catalogued SHA-256; ` +
        "the review will not pick one.",
    });
  }

  const step = steps.length === 1 ? steps[0]! : undefined;
  const geometry = step
    ? resolveGeometryForStep(snapshot, step)
    : { status: "absent" as const };
  if (geometry.status === "absent") {
    diagnostics.push({
      code: "geometry-absent",
      artifactId: step?.id ?? null,
      message:
        "No cad-model geometry capture in the named basis can be joined to the catalogued STEP.",
    });
  } else if (geometry.status === "ambiguous") {
    diagnostics.push({
      code: "geometry-ambiguous",
      artifactId: null,
      message:
        "Several cad-model captures could own the catalogued STEP; the review will not pick one.",
    });
  }

  if (
    diagnostics.length > 0 ||
    !step ||
    geometry.status !== "one"
  ) {
    return { status: "unresolved", diagnostics };
  }

  return {
    status: "resolved",
    bindings: {
      geometryArtifact: geometry.artifact,
      stepArtifact: step,
      requirementsArtifact,
    },
  };
}

/**
 * Exact Thread join from a catalogued part STEP to its owning geometry
 * capture. `cad-asset-<digest>-definition-…` and `cad-asset-<digest>-target-…`
 * name `geometry-<digest>`; assembly or opaque STEP ids stay absent.
 */
export function resolveGeometryForStep(
  snapshot: ThreadSnapshot,
  step: ThreadArtifact,
):
  | { readonly status: "one"; readonly artifact: ThreadArtifact }
  | { readonly status: "absent" }
  | { readonly status: "ambiguous" } {
  const parsed = CAD_ASSET_STEP_ID.exec(step.id);
  const targetParsed = CAD_TARGET_ASSET_STEP_ID.exec(step.id);
  const captureDigest = parsed?.[1] ?? targetParsed?.[1];
  const assetDigest = parsed?.[2] ?? targetParsed?.[3];
  if (captureDigest && assetDigest === step.fingerprint.digest) {
    const geometryId = `geometry-${captureDigest}`;
    const matches = snapshot.artifacts.filter((artifact) =>
      artifact.id === geometryId &&
      artifact.kind === FEA_PROOF_GEOMETRY_KIND &&
      artifact.uri?.startsWith(FEA_PROOF_GEOMETRY_URI_PREFIX)
    );
    if (matches.length === 1) return { status: "one", artifact: matches[0]! };
    if (matches.length > 1) return { status: "ambiguous" };
  }
  // A cad-model capture is never itself proof geometry.  The step identity
  // must name its owning capture deterministically; a one-capture fallback
  // would let an unrelated or opaque STEP be attached to a proof case.
  return { status: "absent" };
}
