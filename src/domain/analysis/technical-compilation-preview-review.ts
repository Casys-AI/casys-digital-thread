/**
 * Agent-facing join gaps for a technical-compilation preview.
 *
 * The `technical-compilation/1.0` document keeps its closed diagnostic
 * record (`code` / `profileRef` / `subjectRef`). Changing that shape would
 * break reread of sealed admissions. This review is assembled after compile
 * from the same sources and SysML elements; it is not stored in the document
 * and confers no admission authority.
 */

import { deepFreeze } from "../kernel/case-validation.ts";
import type {
  TechnicalCompilationDiagnostic,
  TechnicalCompilationStatus,
} from "./technical-compilation.ts";
import type {
  TechnicalCompilationJoinElement,
  TechnicalCompilationJoinSource,
} from "./technical-compilation-join.ts";

export const TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY = {
  noNamedNumericLever:
    "A constructor photo is not admission-ready. Capture a module-level named numeric literal that reaches result.",
  noUniquePartDefinition:
    "The server joins result to a PartDefinition only when that join is unique. Do not pass bindings.",
  noUniqueAttributeUsage:
    "Declare attribute.<slug>.name and attribute.<slug>.parent on model.write-architecture@1 for this parameter name. Do not invent a binding or SysML text.",
} as const;

export type TechnicalCompilationJoinGap =
  | {
    readonly code: "source.no-named-numeric-lever";
    readonly sourceId: string;
    readonly recovery:
      typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noNamedNumericLever;
  }
  | {
    readonly code: "binding.missing";
    readonly relation: "represents";
    readonly sourceId: string;
    readonly symbolName: string;
    readonly symbolKind: "artifact";
    readonly reason: "no-unique-PartDefinition";
    readonly candidateCount: number;
    readonly recovery:
      typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniquePartDefinition;
  }
  | {
    readonly code: "binding.missing";
    readonly relation: "parameterizes";
    readonly sourceId: string;
    readonly symbolName: string;
    readonly symbolKind: "parameter";
    readonly reason: "no-unique-AttributeUsage";
    readonly candidateCount: number;
    readonly recovery:
      typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniqueAttributeUsage;
  };

/**
 * Explain compiler join diagnostics with names and a legal next move.
 *
 * Only `binding.missing` and `source.no-named-numeric-lever` are hoisted.
 * Other document codes stay on the document. Unknown `binding.missing`
 * subjects fail closed: the compiler emitted them from these sources.
 */
export function assembleTechnicalCompilationJoinGaps(
  diagnostics: readonly TechnicalCompilationDiagnostic[],
  sources: readonly TechnicalCompilationJoinSource[],
  elements: readonly TechnicalCompilationJoinElement[],
): readonly TechnicalCompilationJoinGap[] {
  const gaps: TechnicalCompilationJoinGap[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "source.no-named-numeric-lever") {
      const source = resolveSource(diagnostic.subjectRef, sources);
      if (!source || source.analysis.source.id !== diagnostic.subjectRef) {
        throw new TypeError(
          `Join gap ${diagnostic.code} subjectRef must name an exact reopened source.`,
        );
      }
      gaps.push({
        code: "source.no-named-numeric-lever",
        sourceId: source.analysis.source.id,
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noNamedNumericLever,
      });
      continue;
    }
    if (diagnostic.code !== "binding.missing") continue;
    const source = resolveSource(diagnostic.subjectRef, sources);
    if (!source) {
      throw new TypeError(
        "Join gap binding.missing subjectRef must name an exact reopened source.",
      );
    }
    const sourceId = source.analysis.source.id;
    const prefix = `${sourceId}:`;
    if (!diagnostic.subjectRef.startsWith(prefix)) {
      throw new TypeError(
        "Join gap binding.missing subjectRef must name a source symbol.",
      );
    }
    const symbolId = diagnostic.subjectRef.slice(prefix.length);
    const symbol = source.analysis.symbols.find((item) => item.id === symbolId);
    if (!symbol) {
      throw new TypeError(
        "Join gap binding.missing subjectRef must name an exact parser symbol.",
      );
    }
    if (symbol.kind === "parameter") {
      const candidateCount = elements.filter((element) =>
        element.kind === "AttributeUsage" && element.name === symbol.name
      ).length;
      gaps.push({
        code: "binding.missing",
        relation: "parameterizes",
        sourceId,
        symbolName: symbol.name,
        symbolKind: "parameter",
        reason: "no-unique-AttributeUsage",
        candidateCount,
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniqueAttributeUsage,
      });
      continue;
    }
    if (symbol.kind === "artifact") {
      const candidateCount = elements.filter((element) =>
        element.kind === "PartDefinition"
      ).length;
      gaps.push({
        code: "binding.missing",
        relation: "represents",
        sourceId,
        symbolName: symbol.name,
        symbolKind: "artifact",
        reason: "no-unique-PartDefinition",
        candidateCount,
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniquePartDefinition,
      });
      continue;
    }
    throw new TypeError(
      `Join gap binding.missing cannot explain symbol kind ${symbol.kind}.`,
    );
  }
  gaps.sort(compareGaps);
  return deepFreeze(gaps);
}

export function compilationPreviewContent(input: {
  readonly status: TechnicalCompilationStatus;
  readonly draftId?: string;
  readonly gaps: readonly TechnicalCompilationJoinGap[];
}): string {
  if (input.status === "ready-for-review") {
    const draft = input.draftId ?? "the draft";
    return (
      `Technical compilation ${draft} is ready for review and was reread from draft CAS. ` +
      `Its document and exact draft reference are not EngineeringProject or Thread state, ` +
      `an MRTR decision, or execution authority. Construct a later MRTR proposal only from ` +
      `decisionParameters returned by this preview; if none are present, do not invent them.`
    );
  }
  const explained = input.gaps.map(gapSentence).join(" ");
  const gapText = explained.length > 0 ? ` ${explained}` : "";
  return (
    `Technical compilation preview is ${input.status}. No reviewable draft was created.` +
    `${gapText} ` +
    `The returned document is diagnostic only and creates no EngineeringProject or Thread state, ` +
    `MRTR decision, or execution authority. Do not invent bindings, profileRequests, or SysML text.`
  );
}

function gapSentence(gap: TechnicalCompilationJoinGap): string {
  if (gap.code === "source.no-named-numeric-lever") {
    return `${gap.code} on ${gap.sourceId}: ${gap.recovery}`;
  }
  const target = gap.relation === "represents"
    ? "PartDefinition(s)"
    : "AttributeUsage(s)";
  return (
    `${gap.code} ${gap.relation} ${gap.symbolName} ` +
    `(${gap.reason}, ${gap.candidateCount} ${target}): ${gap.recovery}`
  );
}

function resolveSource(
  subjectRef: string,
  sources: readonly TechnicalCompilationJoinSource[],
): TechnicalCompilationJoinSource | undefined {
  const exact = sources.find((source) => source.analysis.source.id === subjectRef);
  if (exact) return exact;
  const matches = sources.filter((source) =>
    subjectRef.startsWith(`${source.analysis.source.id}:`)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function compareGaps(
  left: TechnicalCompilationJoinGap,
  right: TechnicalCompilationJoinGap,
): number {
  return compareText(gapSortKey(left), gapSortKey(right));
}

function gapSortKey(gap: TechnicalCompilationJoinGap): string {
  if (gap.code === "source.no-named-numeric-lever") {
    return `${gap.code}\u0000${gap.sourceId}`;
  }
  return `${gap.code}\u0000${gap.sourceId}\u0000${gap.relation}\u0000${gap.symbolName}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
