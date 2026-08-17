/**
 * Resolve the unique compile.seal-admission@1 cadSource a later
 * `analyze.seal-sensitivity-study@1` MRTR may bind.
 *
 * cadSource is an admission artifact URI + sha256. A cad-model,
 * `design.write-geometry@1` STEP, isolated-geometry document, or recipeSource
 * 1.0 is a lookalike and never a cadSource.
 */

import { locateModuleLevelNumericBinding } from "./sensitivity-source-substitution.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../thread/thread-snapshot.ts";

export const SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL =
  "compile.seal-admission@1" as const;

const REJECTED_CAD_SOURCE_TOOLS = new Set([
  "design.write-geometry@1",
  "design.seal-isolated-geometry@1",
  "design.execute-build123d@1",
]);

export type SensitivityStudySealDiagnosticCode =
  | "catalog-absent"
  | "catalog-ambiguous"
  | "catalog-unavailable"
  | "catalog-integrity-failed"
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
          "The admitted source parameter does not equal the catalogued case baseValue.",
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
