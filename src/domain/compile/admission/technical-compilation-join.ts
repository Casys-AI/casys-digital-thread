/**
 * Server-owned compile-preview join.
 *
 * The agent names the project and captured source references. Profile
 * selection and SysML bindings are unique joins only. A reachable CAD
 * lever is reopened from source+analysis; this module does not invent one.
 */

import { deepFreeze, rejectDuplicates } from "../../kernel/case-validation.ts";
import type { SourceAnalysisBundle } from "../source/source-analysis.ts";
import type {
  TechnicalCompilationProfileCatalog,
  TechnicalCompilationProfileRequest,
  TechnicalSemanticBinding,
} from "./technical-compilation.ts";
import type { TechnicalSourceAttachmentAlignment } from "./technical-source-analysis-capture-locator.ts";

export interface TechnicalCompilationJoinSource {
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
  readonly attachmentTarget?: {
    readonly elementId: string;
    readonly elementKind: string;
  };
  readonly attachmentAlignment?: TechnicalSourceAttachmentAlignment;
  readonly effectiveUnit:
    import("./technical-compilation.ts").TechnicalCompilationSource["effectiveUnit"];
}

export interface TechnicalCompilationJoinElement {
  readonly id: string;
  readonly kind: string;
  readonly name?: string;
  /** Exact captured owner for an AttributeUsage; never a display-label join. */
  readonly parentElementId?: string;
}

export function deriveTechnicalCompilationProfileRequests(
  sources: readonly TechnicalCompilationJoinSource[],
  catalog: TechnicalCompilationProfileCatalog,
): readonly TechnicalCompilationProfileRequest[] {
  const grouped = new Map<string, {
    readonly profileId: string;
    readonly profileVersion: string;
    readonly sourceIds: string[];
  }>();
  for (const source of sources) {
    const sourceId = source.analysis.source.id;
    const matches = catalog.profiles.filter((profile) =>
      profile.sourceRole === source.analysis.source.role &&
      profile.language === source.analysis.source.language
    );
    if (matches.length !== 1) {
      throw new TypeError(
        `Source ${sourceId} has no unique compilation profile for ` +
          `${source.analysis.source.role}/${source.analysis.source.language}.`,
      );
    }
    const profile = matches[0]!;
    const key = `${profile.id}@${profile.version}`;
    const group = grouped.get(key);
    if (group) group.sourceIds.push(sourceId);
    else {
      grouped.set(key, {
        profileId: profile.id,
        profileVersion: profile.version,
        sourceIds: [sourceId],
      });
    }
  }
  const requests = [...grouped.values()].map((group) => {
    const sourceIds = [...new Set(group.sourceIds)].sort(compareText);
    return {
      profileId: group.profileId,
      profileVersion: group.profileVersion,
      sourceIds,
    };
  }).sort((left, right) =>
    compareText(
      `${left.profileId}@${left.profileVersion}`,
      `${right.profileId}@${right.profileVersion}`,
    )
  );
  rejectDuplicates(
    requests.map((request) => `${request.profileId}@${request.profileVersion}`),
    "$derived.profileRequests id/version pairs",
  );
  return deepFreeze(requests);
}

/**
 * Bind only when the join is unique. Ambiguous or missing SysML stays unbound
 * so the compiler can emit `binding.missing`.
 */
export function deriveUniqueTechnicalCompilationBindings(
  sources: readonly TechnicalCompilationJoinSource[],
  elements: readonly TechnicalCompilationJoinElement[],
): readonly TechnicalSemanticBinding[] {
  const bindings: TechnicalSemanticBinding[] = [];
  for (const source of sources) {
    const sourceId = source.analysis.source.id;
    for (const symbol of source.analysis.symbols) {
      if (symbol.kind !== "parameter") continue;
      const attributes = elements.filter((element) =>
        element.kind === "AttributeUsage" && element.name === symbol.name
      );
      if (attributes.length !== 1) continue;
      const attribute = attributes[0]!;
      bindings.push({
        id: `binding:${sourceId}:${symbol.id}:parameterizes`,
        sourceId,
        sourceSymbolId: symbol.id,
        sysmlElementId: attribute.id,
        sysmlElementKind: attribute.kind,
        relation: "parameterizes",
      });
    }

    const representedArtifacts = source.analysis.symbols.filter((symbol) =>
      symbol.kind === "artifact" &&
      (symbol.name === "result" ||
        (source.analysis.source.role === "modelica-model" &&
          source.analysis.source.language === "modelica") ||
        (source.analysis.source.role === "spice-circuit" &&
          source.analysis.source.language === "spice"))
    );
    const represented = source.attachmentAlignment === "exact" &&
        source.attachmentTarget
      ? elements.find((element) =>
        element.id === source.attachmentTarget!.elementId &&
        element.kind === source.attachmentTarget!.elementKind
      )
      : undefined;
    if (representedArtifacts.length === 1 && represented !== undefined) {
      const result = representedArtifacts[0]!;
      bindings.push({
        id: `binding:${sourceId}:${result.id}:represents`,
        sourceId,
        sourceSymbolId: result.id,
        sysmlElementId: represented.id,
        sysmlElementKind: represented.kind,
        relation: "represents",
      });
    }
  }
  bindings.sort((left, right) => compareText(left.id, right.id));
  rejectDuplicates(bindings.map((binding) => binding.id), "$derived.bindings ids");
  rejectDuplicates(
    bindings.map((binding) => `${binding.sourceId}:${binding.sourceSymbolId}`),
    "$derived.bindings source/symbol pairs",
  );
  return deepFreeze(bindings);
}

/**
 * Unique `represents` PartDefinition, or nothing. A PartUsage target is not
 * a geometry identity.
 */
export function selectUniqueRepresentedPartDefinition(
  bindings: readonly TechnicalSemanticBinding[],
): { readonly elementId: string } | undefined {
  const matches = bindings.filter((binding) =>
    binding.relation === "represents" &&
    binding.sysmlElementKind === "PartDefinition"
  );
  if (matches.length !== 1) return undefined;
  const elementId = matches[0]!.sysmlElementId.trim();
  return elementId === "" ? undefined : { elementId };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
