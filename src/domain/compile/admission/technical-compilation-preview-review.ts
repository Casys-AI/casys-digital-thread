/**
 * Agent-facing join gaps for a technical-compilation preview.
 *
 * The `technical-compilation/2.0` document keeps its closed diagnostic
 * record (`code` / `profileRef` / `subjectRef`). V4 is a clean breaking cut:
 * no 1.0 replay or compatibility path exists. This review is assembled after
 * compile from the same sources and SysML elements; it is not stored in the
 * document and confers no admission authority.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import type { ModelicaThermalMethodSheet } from "../../modelica/thermal-method-sheet.ts";
import type {
  TechnicalCompilationDiagnostic,
  TechnicalCompilationStatus,
  TechnicalCompilationTarget,
  TechnicalSemanticBinding,
} from "./technical-compilation.ts";
import type {
  TechnicalCompilationJoinElement,
  TechnicalCompilationJoinSource,
} from "./technical-compilation-join.ts";
import type { TechnicalCompilationAdmissionOperation } from "./technical-compilation-admission-operation.ts";

export const TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY = {
  noNamedNumericLever:
    "A constructor photo is not admission-ready. Capture a module-level named numeric literal that reaches result.",
  noUniquePartDefinition:
    "The server joins result to a PartDefinition only when that join is unique. Do not pass bindings.",
  noUniqueAttributeUsage:
    "Declare attribute.<slug>.name and attribute.<slug>.parent on model.write-architecture@1 for this parameter name. Do not invent a binding or SysML text.",
  thermalParameterizes:
    "The thermal method sheet parameter must recross the unique v2 parameterizes binding for that exact source symbol and AttributeUsage. Do not invent a binding.",
  thermalOutputRequirement:
    "The thermal method sheet output must name an exact source symbol and RequirementUsage. Do not invent a requirement or observation.",
  dependencyLowering:
    "No language-specific deterministic lowering exists for this multi-file closure. Root-only closures remain the executable path.",
  differentBasis:
    "The attachment declaredAgainst Thread and architecture must equal this exact compilation basis. Do not pretend carried-forward without an explicit lineage proof.",
  targetMissing:
    "The attachment target element id and kind must exist exactly in this compilation basis.",
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
  }
  | {
    readonly code: "thermal-method-sheet.parameter.unresolved";
    readonly modelSymbolId: string;
    readonly attributeUsageId: string;
    readonly reason: "symbol-absent" | "no-unique-parameterizes";
    readonly recovery:
      typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.thermalParameterizes;
  }
  | {
    readonly code: "thermal-method-sheet.output.unresolved";
    readonly modelSymbolId: string;
    readonly role: "final" | "max_abs";
    readonly requirementElementId: string;
    readonly reason: "symbol-absent" | "requirement-absent";
    readonly recovery:
      typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.thermalOutputRequirement;
  }
  | {
    readonly code: "source.dependency-lowering-unavailable";
    readonly sourceId: string;
    readonly closureKind: "unlowered-closure";
    readonly recovery:
      typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.dependencyLowering;
  }
  | {
    readonly code: "attachment.different-basis";
    readonly sourceId: string;
    readonly recovery: typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.differentBasis;
  }
  | {
    readonly code: "attachment.target-missing";
    readonly sourceId: string;
    readonly recovery: typeof TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.targetMissing;
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
    if (diagnostic.code === "source.dependency-lowering-unavailable") {
      const source = resolveSource(diagnostic.subjectRef, sources);
      if (!source || source.analysis.source.id !== diagnostic.subjectRef) {
        throw new TypeError(
          `Join gap ${diagnostic.code} subjectRef must name an exact reopened source.`,
        );
      }
      gaps.push({
        code: "source.dependency-lowering-unavailable",
        sourceId: source.analysis.source.id,
        closureKind: source.effectiveUnit.closureKind === "unlowered-closure"
          ? "unlowered-closure"
          : (() => {
            throw new TypeError(
              "A dependency-lowering gap must name an explicitly unlowered closure.",
            );
          })(),
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.dependencyLowering,
      });
      continue;
    }
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

export function assembleAttachmentAlignmentGaps(
  sources: readonly TechnicalCompilationJoinSource[],
): readonly TechnicalCompilationJoinGap[] {
  const gaps: TechnicalCompilationJoinGap[] = [];
  for (const source of sources) {
    if (source.attachmentAlignment === "different-basis") {
      gaps.push({
        code: "attachment.different-basis",
        sourceId: source.analysis.source.id,
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.differentBasis,
      });
    }
    if (source.attachmentAlignment === "target-missing") {
      gaps.push({
        code: "attachment.target-missing",
        sourceId: source.analysis.source.id,
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.targetMissing,
      });
    }
  }
  gaps.sort(compareGaps);
  return deepFreeze(gaps);
}

/**
 * Recross one reviewed thermal method sheet against unique v2 parameterizes
 * bindings and exact RequirementUsage identities. Absence of a sheet is not a
 * gap: compilation does not invent a method. Named gaps never invent physics.
 *
 * Recross is source/target scoped: it applies only to the unique Modelica
 * compilation (`modelica-source-qualification` + `modelica-model`/`modelica`).
 * A CAD or SPICE preview must not recross a sealed thermal method sheet.
 */
export function assembleThermalMethodSheetCompilationGaps(
  sheet: ModelicaThermalMethodSheet | undefined,
  sources: readonly TechnicalCompilationJoinSource[],
  bindings: readonly TechnicalSemanticBinding[],
  elements: readonly TechnicalCompilationJoinElement[],
  uniqueTarget?: TechnicalCompilationTarget,
): readonly TechnicalCompilationJoinGap[] {
  if (
    sheet === undefined ||
    !isModelicaThermalMethodSheetRecrossScope(sources, uniqueTarget)
  ) {
    return [];
  }
  const symbols = sources.flatMap((source) => source.analysis.symbols);
  const gaps: TechnicalCompilationJoinGap[] = [];
  for (const parameter of sheet.parameters) {
    const symbolMatches = symbols.filter((symbol) =>
      symbol.id === parameter.modelSymbolId && symbol.kind === "parameter"
    );
    if (symbolMatches.length !== 1) {
      gaps.push({
        code: "thermal-method-sheet.parameter.unresolved",
        modelSymbolId: parameter.modelSymbolId,
        attributeUsageId: parameter.attributeUsageId,
        reason: "symbol-absent",
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.thermalParameterizes,
      });
      continue;
    }
    const parameterizes = bindings.filter((binding) =>
      binding.relation === "parameterizes" &&
      binding.sourceSymbolId === parameter.modelSymbolId &&
      binding.sysmlElementId === parameter.attributeUsageId &&
      binding.sysmlElementKind === "AttributeUsage"
    );
    if (parameterizes.length !== 1) {
      gaps.push({
        code: "thermal-method-sheet.parameter.unresolved",
        modelSymbolId: parameter.modelSymbolId,
        attributeUsageId: parameter.attributeUsageId,
        reason: "no-unique-parameterizes",
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.thermalParameterizes,
      });
    }
  }
  for (const output of sheet.outputs) {
    const symbolMatches = symbols.filter((symbol) =>
      symbol.id === output.modelSymbolId
    );
    const requirements = elements.filter((element) =>
      element.id === output.requirementElementId &&
      element.kind === "RequirementUsage"
    );
    if (symbolMatches.length !== 1) {
      gaps.push({
        code: "thermal-method-sheet.output.unresolved",
        modelSymbolId: output.modelSymbolId,
        role: output.role,
        requirementElementId: output.requirementElementId,
        reason: "symbol-absent",
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.thermalOutputRequirement,
      });
      continue;
    }
    if (requirements.length !== 1) {
      gaps.push({
        code: "thermal-method-sheet.output.unresolved",
        modelSymbolId: output.modelSymbolId,
        role: output.role,
        requirementElementId: output.requirementElementId,
        reason: "requirement-absent",
        recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.thermalOutputRequirement,
      });
    }
  }
  gaps.sort(compareGaps);
  return deepFreeze(gaps);
}

export function compilationPreviewContent(input: {
  readonly status: TechnicalCompilationStatus;
  readonly draftId?: string;
  /** Present only for a ready preview; it is server-derived and appendable. */
  readonly operation?: Pick<TechnicalCompilationAdmissionOperation, "id" | "version">;
  readonly gaps: readonly TechnicalCompilationJoinGap[];
}): string {
  if (input.status === "ready-for-review") {
    const draft = input.draftId ?? "the draft";
    return (
      `Technical compilation ${draft} is ready for review and was reread from draft CAS. ` +
      `Its document and exact draft reference are not EngineeringProject or Thread state, ` +
      `an MRTR decision, or execution authority. Construct a later MRTR proposal only from ` +
      `decisionParameters returned by this preview; if none are present, do not invent them. ` +
      (input.operation
        ? `Reuse the returned ${input.operation.id}@${input.operation.version} operation verbatim ` +
          `inside the later project_change_append; do not reconstruct its sysmlModel binding. `
        : "Do not reconstruct a work-item operation from the draft or document. ")
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
  if (
    gap.code === "source.no-named-numeric-lever" ||
    gap.code === "attachment.different-basis" ||
    gap.code === "attachment.target-missing"
  ) {
    return `${gap.code} on ${gap.sourceId}: ${gap.recovery}`;
  }
  if (gap.code === "source.dependency-lowering-unavailable") {
    return (
      `${gap.code} on ${gap.sourceId} (${gap.closureKind}): ${gap.recovery}`
    );
  }
  if (gap.code === "thermal-method-sheet.parameter.unresolved") {
    return (
      `${gap.code} ${gap.modelSymbolId} AttributeUsage ${gap.attributeUsageId} ` +
      `(${gap.reason}): ${gap.recovery}`
    );
  }
  if (gap.code === "thermal-method-sheet.output.unresolved") {
    return (
      `${gap.code} ${gap.modelSymbolId} ${gap.role} RequirementUsage ` +
      `${gap.requirementElementId} (${gap.reason}): ${gap.recovery}`
    );
  }
  const target = gap.relation === "represents"
    ? "PartDefinition(s)"
    : "AttributeUsage(s)";
  return (
    `${gap.code} ${gap.relation} ${gap.symbolName} ` +
    `(${gap.reason}, ${gap.candidateCount} ${target}): ${gap.recovery}`
  );
}

function isModelicaThermalMethodSheetRecrossScope(
  sources: readonly TechnicalCompilationJoinSource[],
  uniqueTarget: TechnicalCompilationTarget | undefined,
): boolean {
  if (
    uniqueTarget !== "modelica-source-qualification" ||
    sources.length === 0
  ) {
    return false;
  }
  return sources.every((source) =>
    source.analysis.source.role === "modelica-model" &&
    source.analysis.source.language === "modelica"
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
  if (
    gap.code === "source.no-named-numeric-lever" ||
    gap.code === "source.dependency-lowering-unavailable" ||
    gap.code === "attachment.different-basis" ||
    gap.code === "attachment.target-missing"
  ) {
    return `${gap.code}\u0000${gap.sourceId}`;
  }
  if (gap.code === "thermal-method-sheet.parameter.unresolved") {
    return `${gap.code}\u0000${gap.modelSymbolId}\u0000${gap.attributeUsageId}`;
  }
  if (gap.code === "thermal-method-sheet.output.unresolved") {
    return `${gap.code}\u0000${gap.modelSymbolId}\u0000${gap.role}`;
  }
  return `${gap.code}\u0000${gap.sourceId}\u0000${gap.relation}\u0000${gap.symbolName}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
