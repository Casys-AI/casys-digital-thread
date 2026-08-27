/**
 * Resolve the unique compile.seal-admission@3 cadSource a later
 * `analyze.seal-sensitivity-study@1` MRTR may bind.
 *
 * cadSource is an admission artifact URI + sha256. A cad-model,
 * `design.write-geometry@1` STEP, isolated-geometry document, or recipeSource
 * 1.0 is a lookalike and never a cadSource.
 */

import { COMPILE_SEAL_ADMISSION_PRODUCER_TOOL } from "../../compile/admission/technical-compilation-proposal.ts";
import { locateModuleLevelNumericBinding } from "./sensitivity-source-substitution.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";

export const SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL =
  COMPILE_SEAL_ADMISSION_PRODUCER_TOOL;

const REJECTED_CAD_SOURCE_TOOLS = new Set([
  "design.write-geometry@1",
  "design.seal-isolated-geometry@1",
  "design.execute-build123d@1",
]);

export const SENSITIVITY_CATALOG_OFFER_CAPTURE_URI_PREFIX =
  "casys://sensitivity-catalog-offer-capture/" as const;
export const FEA_PROOF_CASE_CAPTURE_URI_PREFIX =
  "casys://fea-proof-case-capture/" as const;
export const VERIFY_SEAL_PROOF_CASE_TOOL = "verify.seal-proof-case@1" as const;

export type SensitivityStudySealDiagnosticCode =
  | "catalog-absent"
  | "catalog-ambiguous"
  | "catalog-unavailable"
  | "catalog-integrity-failed"
  | "catalog-offer-ambiguous"
  | "catalog-offer-unavailable"
  | "catalog-offer-integrity-failed"
  | "catalog-offer-admission-unlinked"
  | "catalog-offer-case-mismatch"
  | "basis-latest"
  | "basis-mismatch"
  | "basis-absent"
  | "basis-ambiguous"
  | "project-mismatch"
  | "subject-mismatch"
  | "admission-absent"
  | "admission-ambiguous"
  | "admission-unavailable"
  | "semantic-key-unbound"
  | "admission-parameter-mismatch"
  | "cad-source-lookalike"
  | "project-state-unavailable"
  | "project-state-mismatch"
  | "basis-not-current"
  | "compiled-identities-conflict"
  | "proposal-grammar-rejected";

export interface SensitivityStudySealDiagnostic {
  readonly code: SensitivityStudySealDiagnosticCode;
  readonly artifactId: string | null;
  readonly message: string;
}

export interface SensitivityAdmissionSourceView {
  readonly sourceText: string;
  readonly analysis: {
    readonly symbols: readonly {
      readonly name: string;
      readonly kind: string;
      readonly span?: {
        readonly start: { readonly line: number; readonly column: number };
        readonly end: { readonly line: number; readonly column: number };
      };
    }[];
  };
}

export function isCompileAdmissionArtifact(artifact: ThreadArtifact): boolean {
  return artifact.kind === "document" &&
    artifact.producer.tool === SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL;
}

export function isRejectedCadSourceLookalike(artifact: ThreadArtifact): boolean {
  if (isCompileAdmissionArtifact(artifact)) return false;
  return artifact.kind === "cad-model" ||
    artifact.kind === "step" ||
    REJECTED_CAD_SOURCE_TOOLS.has(artifact.producer.tool);
}

export function listCompileAdmissionArtifacts(
  snapshot: ThreadSnapshot,
): readonly ThreadArtifact[] {
  return snapshot.artifacts.filter(isCompileAdmissionArtifact);
}

export function listRejectedCadSourceLookalikes(
  snapshot: ThreadSnapshot,
): readonly ThreadArtifact[] {
  return snapshot.artifacts.filter(isRejectedCadSourceLookalike);
}

export function isSensitivityCatalogOfferArtifact(
  artifact: ThreadArtifact,
): boolean {
  return artifact.kind === "document" &&
    artifact.producer.tool === VERIFY_SEAL_PROOF_CASE_TOOL &&
    (artifact.uri?.startsWith(SENSITIVITY_CATALOG_OFFER_CAPTURE_URI_PREFIX) ??
      false);
}

export function isFeaProofCaseArtifact(artifact: ThreadArtifact): boolean {
  return artifact.kind === "document" &&
    artifact.producer.tool === VERIFY_SEAL_PROOF_CASE_TOOL &&
    (artifact.uri?.startsWith(FEA_PROOF_CASE_CAPTURE_URI_PREFIX) ?? false);
}

export function listSensitivityCatalogOfferArtifacts(
  snapshot: ThreadSnapshot,
): readonly ThreadArtifact[] {
  return snapshot.artifacts.filter(isSensitivityCatalogOfferArtifact);
}

export function listFeaProofCaseArtifacts(
  snapshot: ThreadSnapshot,
): readonly ThreadArtifact[] {
  return snapshot.artifacts.filter(isFeaProofCaseArtifact);
}

export function matchAdmittedSensitivityParameter(
  sources: readonly SensitivityAdmissionSourceView[],
  semanticKey: string,
  expectedValue: number,
):
  | { readonly status: "matched" }
  | {
    readonly status: "unbound";
    readonly code: "semantic-key-unbound" | "admission-parameter-mismatch";
    readonly message: string;
  } {
  if (sources.length !== 1) {
    return {
      status: "unbound",
      code: "semantic-key-unbound",
      message:
        "The sealed compilation admission must carry exactly one Build123d source.",
    };
  }
  const source = sources[0]!;
  const matches = source.analysis.symbols.filter((symbol) =>
    symbol.name === semanticKey && symbol.kind === "parameter"
  );
  if (matches.length !== 1 || matches[0]!.span === undefined) {
    return {
      status: "unbound",
      code: "semantic-key-unbound",
      message:
        `The admitted source has no unique module-level numeric binding named ${semanticKey}.`,
    };
  }
  try {
    const binding = locateModuleLevelNumericBinding(
      source.sourceText,
      matches[0]!.span,
      semanticKey,
    );
    if (binding.value !== expectedValue) {
      return {
        status: "unbound",
        code: "admission-parameter-mismatch",
        message:
          "The admitted source parameter does not equal the study template baseValue.",
      };
    }
    return { status: "matched" };
  } catch (error) {
    return {
      status: "unbound",
      code: "semantic-key-unbound",
      message: error instanceof Error
        ? error.message
        : `The admitted source has no unique module-level numeric binding named ${semanticKey}.`,
    };
  }
}

export function sensitivityCadSourceUri(
  projectId: string,
  artifactId: string,
): string {
  return `thread-artifact://${projectId}/${artifactId}`;
}
