/**
 * Apply a sealed z* to one admitted module-level numeric literal.
 *
 * The caller supplies the already-reviewed current and proposed scalars.
 * This module does not invent a step, a neighborhood, or a CAD write.
 */

import type { SourceAnalysisBundle } from "../../compile/source/source-analysis.ts";
import {
  locateModuleLevelNumericBinding,
  substituteModuleLevelNumericLiteral,
} from "../study/sensitivity-source-substitution.ts";

export const COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION = {
  id: "compile.capture-corrected-source",
  version: "1",
} as const;

export type CorrectionSourceSubstitutionReason =
  | "parameter-not-unique"
  | "parameter-span-missing"
  | "current-mismatch"
  | "substitute-noop";

export interface AppliedCorrectionSource {
  readonly status: "applied";
  readonly sourceText: string;
  readonly bindingName: string;
  readonly from: number;
  readonly to: number;
}

export interface UnappliedCorrectionSource {
  readonly status: "unapplied";
  readonly reason: CorrectionSourceSubstitutionReason;
  readonly detail: string;
}

export type CorrectionSourceSubstitution =
  | AppliedCorrectionSource
  | UnappliedCorrectionSource;

export function applyCorrectionToAdmittedSource(input: {
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
  readonly semanticKey: string;
  readonly current: number;
  readonly proposed: number;
}): CorrectionSourceSubstitution {
  const parameters = input.analysis.symbols.filter((symbol) =>
    symbol.name === input.semanticKey && symbol.kind === "parameter"
  );
  if (parameters.length !== 1) {
    return unapplied(
      "parameter-not-unique",
      `Admitted source has ${parameters.length} parameter(s) named ` +
        `"${input.semanticKey}".`,
    );
  }
  const span = parameters[0]!.span;
  if (!span) {
    return unapplied(
      "parameter-span-missing",
      `Parameter "${input.semanticKey}" has no source span.`,
    );
  }
  let binding;
  try {
    binding = locateModuleLevelNumericBinding(
      input.sourceText,
      span,
      input.semanticKey,
    );
  } catch (error) {
    return unapplied(
      "parameter-span-missing",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!Object.is(binding.value, input.current)) {
    return unapplied(
      "current-mismatch",
      `Admitted "${input.semanticKey}" is ${binding.value}, not the signed current ${input.current}.`,
    );
  }
  const next = substituteModuleLevelNumericLiteral(
    input.sourceText,
    binding.valueSpan,
    input.proposed,
  );
  if (next === input.sourceText) {
    return unapplied(
      "substitute-noop",
      `Proposed z* ${input.proposed} did not change the admitted source.`,
    );
  }
  return {
    status: "applied",
    sourceText: next,
    bindingName: input.semanticKey,
    from: input.current,
    to: input.proposed,
  };
}

function unapplied(
  reason: CorrectionSourceSubstitutionReason,
  detail: string,
): UnappliedCorrectionSource {
  return { status: "unapplied", reason, detail };
}
