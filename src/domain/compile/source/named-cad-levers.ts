/**
 * Named module-level numeric levers in admitted behave CAD.
 *
 * A hash-sealed photo of constructor literals cannot feed the sensitivity
 * grid. The compiler reuses the same finite-literal grammar as
 * `locateModuleLevelNumericBinding`: expressions are not levers.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import type { SourceAnalysisBundle, SourceAnalysisSpan } from "./source-analysis.ts";
import {
  locateModuleLevelNumericBinding,
  sourceSpanOffsets,
} from "../../sensitivity/study/sensitivity-source-substitution.ts";

export interface NamedNumericLever {
  readonly semanticKey: string;
  readonly value: number;
}

export interface AnalysisReachableNamedNumericLever extends NamedNumericLever {
  readonly sourceId: string;
  readonly sourceSymbolId: string;
  readonly resultSymbolId: string;
}

export interface GeometryAffectingNamedNumericLever
  extends AnalysisReachableNamedNumericLever {
  readonly parameterBindingId: string;
  readonly parameterSysmlElementId: string;
}

export type CadLeverCaptureDiagnosis =
  | { readonly status: "not-applicable" }
  | {
    readonly status: "ok";
    readonly levers: readonly NamedNumericLever[];
  }
  | {
    readonly status: "unresolved";
    readonly code: "source.no-named-numeric-lever";
    readonly levers: readonly [];
    readonly message: string;
  };

export interface NamedCadLeverBinding {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceSymbolId: string;
  readonly sysmlElementId: string;
  readonly relation: string;
}

const MODULE_LEVEL_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/;

export function listNamedNumericLevers(
  sourceText: string,
): readonly NamedNumericLever[] {
  const levers: NamedNumericLever[] = [];
  let line = 1;
  let lineStart = 0;
  while (lineStart <= sourceText.length) {
    const newline = sourceText.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? sourceText.length : newline;
    const lineText = sourceText.slice(lineStart, lineEnd);
    if (!startsIndented(lineText)) {
      const match = MODULE_LEVEL_ASSIGNMENT.exec(lineText);
      if (match) {
        const name = match[1]!;
        try {
          const binding = locateModuleLevelNumericBinding(sourceText, {
            start: { line, column: 0 },
            end: { line, column: name.length },
          }, name);
          if (remainderAfterLiteralIsIdle(sourceText, binding.valueSpan)) {
            levers.push({ semanticKey: binding.name, value: binding.value });
          }
        } catch {
          // RHS is not a bare finite literal — not a lever.
        }
      }
    }
    if (newline === -1) break;
    line += 1;
    lineStart = newline + 1;
  }
  return deepFreeze(levers);
}

/**
 * Literal parameters the qualified analysis proves can reach `result`.
 *
 * This is the capture-time handle. It does not require a SysML binding.
 * `unused = 1` is not included: the analyzer owns reachability.
 */
export function listAnalysisReachableNamedNumericLevers(
  sourceText: string,
  analysis: SourceAnalysisBundle,
): readonly AnalysisReachableNamedNumericLever[] {
  if (analysis.source.role !== "cad-script") return deepFreeze([]);
  const resultSymbols = analysis.symbols.filter((symbol) =>
    symbol.kind === "artifact" && symbol.name === "result"
  );
  if (resultSymbols.length !== 1) return deepFreeze([]);
  const resultId = resultSymbols[0]!.id;
  const outgoing = new Map<string, string[]>();
  for (const dependency of analysis.dependencies) {
    const targets = outgoing.get(dependency.fromSymbolId) ?? [];
    targets.push(dependency.toSymbolId);
    outgoing.set(dependency.fromSymbolId, targets);
  }
  const levers: AnalysisReachableNamedNumericLever[] = [];
  for (const symbol of analysis.symbols) {
    if (
      symbol.kind !== "parameter" || symbol.span === undefined ||
      !reachesSymbol(symbol.id, resultId, outgoing)
    ) continue;
    try {
      const binding = locateModuleLevelNumericBinding(
        sourceText,
        symbol.span,
        symbol.name,
      );
      if (remainderAfterLiteralIsIdle(sourceText, binding.valueSpan)) {
        levers.push({
          semanticKey: binding.name,
          value: binding.value,
          sourceId: analysis.source.id,
          sourceSymbolId: symbol.id,
          resultSymbolId: resultId,
        });
      }
    } catch {
      // The parser fact is not a bare finite literal, so it is not a lever.
    }
  }
  return deepFreeze(sortReachableLevers(levers));
}

/**
 * Reachable literals that compilation binds uniquely through `parameterizes`.
 *
 * The compiler owns the cross-model binding. A missing binding is
 * `binding.missing`, not `source.no-named-numeric-lever`.
 */
export function listGeometryAffectingNamedNumericLevers(
  sourceText: string,
  analysis: SourceAnalysisBundle,
  bindings: readonly NamedCadLeverBinding[],
): readonly GeometryAffectingNamedNumericLever[] {
  const levers: GeometryAffectingNamedNumericLever[] = [];
  for (const lever of listAnalysisReachableNamedNumericLevers(sourceText, analysis)) {
    const parameterBindings = bindings.filter((binding) =>
      binding.sourceId === lever.sourceId &&
      binding.sourceSymbolId === lever.sourceSymbolId &&
      binding.relation === "parameterizes"
    );
    if (parameterBindings.length !== 1) continue;
    levers.push({
      ...lever,
      parameterBindingId: parameterBindings[0]!.id,
      parameterSysmlElementId: parameterBindings[0]!.sysmlElementId,
    });
  }
  return deepFreeze(levers);
}

/** Capture-time diagnosis: parser-reachable handles only. Bindings are compile. */
export function diagnoseAnalysisReachableCadLevers(
  sourceText: string,
  analysis: SourceAnalysisBundle,
): CadLeverCaptureDiagnosis {
  if (analysis.source.role !== "cad-script") {
    return deepFreeze({ status: "not-applicable" as const });
  }
  const levers = listAnalysisReachableNamedNumericLevers(sourceText, analysis);
  if (levers.length > 0) {
    return deepFreeze({
      status: "ok" as const,
      levers: levers.map((lever) => ({
        semanticKey: lever.semanticKey,
        value: lever.value,
      })),
    });
  }
  return deepFreeze({
    status: "unresolved" as const,
    code: "source.no-named-numeric-lever" as const,
    levers: [],
    message:
      "This CAD source has no module-level named numeric literal that reaches result. A constructor photo is not a behave handle.",
  });
}

function sortReachableLevers(
  levers: AnalysisReachableNamedNumericLever[],
): AnalysisReachableNamedNumericLever[] {
  levers.sort((left, right) =>
    left.semanticKey < right.semanticKey
      ? -1
      : left.semanticKey > right.semanticKey
      ? 1
      : left.value !== right.value
      ? left.value - right.value
      : left.sourceSymbolId < right.sourceSymbolId
      ? -1
      : left.sourceSymbolId > right.sourceSymbolId
      ? 1
      : 0
  );
  return levers;
}

function startsIndented(lineText: string): boolean {
  return lineText.startsWith(" ") || lineText.startsWith("\t");
}

function reachesSymbol(
  startId: string,
  targetId: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
): boolean {
  const pending = [...(outgoing.get(startId) ?? [])];
  const visited = new Set<string>([startId]);
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

function remainderAfterLiteralIsIdle(
  sourceText: string,
  valueSpan: SourceAnalysisSpan,
): boolean {
  const { end } = sourceSpanOffsets(sourceText, valueSpan);
  const newline = sourceText.indexOf("\n", end);
  const rest = sourceText.slice(end, newline === -1 ? sourceText.length : newline)
    .trim();
  return rest === "" || rest.startsWith("#");
}
