/**
 * Geometry-affecting CAD levers taken from one sealed compilation admission.
 *
 * A lever is visible only when the compiler uniquely bound it through
 * `parameterizes`. Homonymous names are not a join. This module does not
 * reopen CAS and grants no admission or execution authority.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import {
  listGeometryAffectingNamedNumericLevers,
  type NamedCadLeverBinding,
} from "../source/named-cad-levers.ts";
import type { SourceAnalysisBundle } from "../source/source-analysis.ts";
import { listUnnamedCadConstructorLiterals } from "../source/unnamed-cad-literals.ts";

export interface SealedAdmissionCadLeverSource {
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
}

export interface SealedAdmissionCadLever {
  readonly admissionArtifactId: string;
  readonly sourceId: string;
  readonly sourceSymbolId: string;
  readonly semanticKey: string;
  readonly value: number;
  readonly parameterBindingId: string;
  readonly parameterSysmlElementId: string;
}

export interface SealedAdmissionUnnamedCadLiteral {
  readonly admissionArtifactId: string;
  readonly sourceId: string;
  readonly hostSymbolId: string;
  readonly value: number;
  readonly line: number;
  readonly column: number;
  readonly representedPartDefinitionId: string;
}

export function listSealedAdmissionCadLevers(input: {
  readonly admissionArtifactId: string;
  readonly sources: readonly SealedAdmissionCadLeverSource[];
  readonly bindings: readonly NamedCadLeverBinding[];
}): readonly SealedAdmissionCadLever[] {
  const levers: SealedAdmissionCadLever[] = [];
  for (const source of input.sources) {
    for (
      const lever of listGeometryAffectingNamedNumericLevers(
        source.sourceText,
        source.analysis,
        input.bindings,
      )
    ) {
      levers.push({
        admissionArtifactId: input.admissionArtifactId,
        sourceId: lever.sourceId,
        sourceSymbolId: lever.sourceSymbolId,
        semanticKey: lever.semanticKey,
        value: lever.value,
        parameterBindingId: lever.parameterBindingId,
        parameterSysmlElementId: lever.parameterSysmlElementId,
      });
    }
  }
  return deepFreeze(
    levers.sort((left, right) =>
      compareText(left.admissionArtifactId, right.admissionArtifactId) ||
      compareText(left.sourceId, right.sourceId) ||
      compareText(left.sourceSymbolId, right.sourceSymbolId)
    ),
  );
}

export function listSealedAdmissionUnnamedCadLiterals(input: {
  readonly admissionArtifactId: string;
  readonly sources: readonly SealedAdmissionCadLeverSource[];
  readonly bindings: readonly NamedCadLeverBinding[];
}): readonly SealedAdmissionUnnamedCadLiteral[] {
  const literals: SealedAdmissionUnnamedCadLiteral[] = [];
  for (const source of input.sources) {
    const partDefinitionId = uniqueRepresentedPartDefinitionId(
      source.analysis,
      input.bindings,
    );
    if (partDefinitionId === undefined) continue;
    for (
      const literal of listUnnamedCadConstructorLiterals(
        source.sourceText,
        source.analysis,
      )
    ) {
      literals.push({
        admissionArtifactId: input.admissionArtifactId,
        sourceId: literal.sourceId,
        hostSymbolId: literal.hostSymbolId,
        value: literal.value,
        line: literal.span.start.line,
        column: literal.span.start.column,
        representedPartDefinitionId: partDefinitionId,
      });
    }
  }
  return deepFreeze(
    literals.sort((left, right) =>
      compareText(left.admissionArtifactId, right.admissionArtifactId) ||
      compareText(left.sourceId, right.sourceId) ||
      left.line - right.line ||
      left.column - right.column
    ),
  );
}

function uniqueRepresentedPartDefinitionId(
  analysis: SourceAnalysisBundle,
  bindings: readonly NamedCadLeverBinding[],
): string | undefined {
  const results = analysis.symbols.filter((symbol) =>
    symbol.kind === "artifact" && symbol.name === "result"
  );
  if (results.length !== 1) return undefined;
  const represented = bindings.filter((binding) =>
    binding.sourceId === analysis.source.id &&
    binding.sourceSymbolId === results[0]!.id &&
    binding.relation === "represents"
  );
  if (represented.length !== 1) return undefined;
  return represented[0]!.sysmlElementId;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
