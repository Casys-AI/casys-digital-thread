/**
 * Exact DFM-check capture viewer aliases.
 *
 * Opens the registered capture session already anchored on the measured
 * DFM evidence. Never creates, reanchors, or synthesizes a session payload.
 */
import type {
  EngineeringCaseCatalog,
  ThreadArtifact,
  ThreadGraphRef,
} from "../thread/types.ts";
import type { ThreadViewerSession } from "../thread/viewer-sessions-client.ts";
import {
  hasUnambiguousDfmCheckCaseMembership,
  isOverviewDfmCaseOrResultArtifact,
  isOverviewDfmCheckCapture,
} from "./overview/hulls/domain-groups.ts";
import {
  overviewCanonicalViewerNodeKey,
  type OverviewViewerAliasEdge,
  type OverviewViewerOpenTarget,
} from "./overview-thread-viewer-discovery.ts";

export interface OverviewDfmViewerAliasRecord {
  readonly key: string;
  readonly ref: Pick<ThreadGraphRef, "kind" | "id">;
  readonly entityKind: string;
  readonly artifactKind?: string;
  readonly engineeringCaseRefs?: readonly string[];
}

export interface OverviewDfmViewerAliasInput {
  readonly records: readonly OverviewDfmViewerAliasRecord[];
  readonly artifacts: readonly ThreadArtifact[];
  readonly edges: readonly OverviewViewerAliasEdge[];
  readonly sessions: readonly ThreadViewerSession[];
  readonly catalog?: EngineeringCaseCatalog;
}

/**
 * Unique source_of / evidences aliases onto one registered DFM capture.
 * Requirement and sealed-case rows alias only when typed joins resolve
 * exactly one result capture. Conflicts and dangling edges refuse.
 */
export function overviewDfmCaptureViewerAliases(
  input: OverviewDfmViewerAliasInput,
): ReadonlyMap<string, readonly OverviewViewerOpenTarget[]> {
  const recordsByKey = new Map(
    input.records.map((record) => [record.key, record]),
  );
  const artifactsById = new Map(
    input.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const sessionsByAnchor = new Map<string, string[]>();
  for (const session of input.sessions) {
    const nodeKey = overviewCanonicalViewerNodeKey(session);
    if (!nodeKey) continue;
    sessionsByAnchor.set(nodeKey, [
      ...sessionsByAnchor.get(nodeKey) ?? [],
      session.id,
    ]);
  }
  const aliases = new Map<string, readonly OverviewViewerOpenTarget[]>();
  for (const record of input.records) {
    const captureKey = uniqueDfmCaptureKey(
      record,
      input.edges,
      recordsByKey,
      artifactsById,
      input.catalog,
    );
    if (captureKey === undefined) continue;
    const sessionIds = sessionsByAnchor.get(captureKey) ?? [];
    if (sessionIds.length !== 1) continue;
    aliases.set(record.key, [{
      sessionId: sessionIds[0]!,
      nodeKey: captureKey,
    }]);
  }
  return aliases;
}

/** Compose independent alias maps. Conflicting targets omit that record. */
export function mergeOverviewViewerAliases(
  ...groups: readonly ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>[]
): ReadonlyMap<string, readonly OverviewViewerOpenTarget[]> {
  const merged = new Map<string, readonly OverviewViewerOpenTarget[]>();
  const conflicts = new Set<string>();
  for (const group of groups) {
    for (const [key, targets] of group) {
      if (conflicts.has(key)) continue;
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, targets);
        continue;
      }
      if (!sameOpenTargets(existing, targets)) {
        merged.delete(key);
        conflicts.add(key);
      }
    }
  }
  return merged;
}

function uniqueDfmCaptureKey(
  record: OverviewDfmViewerAliasRecord,
  edges: readonly OverviewViewerAliasEdge[],
  recordsByKey: ReadonlyMap<string, OverviewDfmViewerAliasRecord>,
  artifactsById: ReadonlyMap<string, ThreadArtifact>,
  catalog: EngineeringCaseCatalog | undefined,
): string | undefined {
  if (record.ref.kind === "observation") {
    return uniqueLinkedDfmCapture(
      record,
      edges,
      "source_of",
      recordsByKey,
      artifactsById,
      catalog,
    );
  }
  if (record.entityKind === "evaluation") {
    return uniqueLinkedDfmCapture(
      record,
      edges,
      "evidences",
      recordsByKey,
      artifactsById,
      catalog,
    );
  }
  if (record.ref.kind === "requirement") {
    return uniqueRequirementDfmCapture(
      record,
      edges,
      recordsByKey,
      artifactsById,
      catalog,
    );
  }
  if (isDfmCaseRecord(record, artifactsById)) {
    return uniqueCaseDfmCapture(
      record,
      edges,
      recordsByKey,
      artifactsById,
      catalog,
    );
  }
  return undefined;
}

function uniqueLinkedDfmCapture(
  record: OverviewDfmViewerAliasRecord,
  edges: readonly OverviewViewerAliasEdge[],
  relation: "source_of" | "evidences",
  recordsByKey: ReadonlyMap<string, OverviewDfmViewerAliasRecord>,
  artifactsById: ReadonlyMap<string, ThreadArtifact>,
  catalog: EngineeringCaseCatalog | undefined,
): string | undefined {
  const sources = uniqueArtifactSources(record, edges, relation);
  if (sources.length !== 1) return undefined;
  const captureKey = sources[0]!;
  const capture = recordsByKey.get(captureKey);
  if (
    capture === undefined ||
    !isDfmCaptureRecord(capture, artifactsById)
  ) {
    return undefined;
  }
  if (!compatibleDfmCaseMembership(record, capture, catalog)) {
    return undefined;
  }
  return captureKey;
}

function uniqueRequirementDfmCapture(
  requirement: OverviewDfmViewerAliasRecord,
  edges: readonly OverviewViewerAliasEdge[],
  recordsByKey: ReadonlyMap<string, OverviewDfmViewerAliasRecord>,
  artifactsById: ReadonlyMap<string, ThreadArtifact>,
  catalog: EngineeringCaseCatalog | undefined,
): string | undefined {
  const evaluationKeys = new Set<string>();
  for (const edge of edges) {
    if (
      edge.relation !== "evaluates" ||
      edge.from.kind !== "requirement" ||
      edge.from.id !== requirement.ref.id ||
      edge.to.kind !== "evaluation"
    ) {
      continue;
    }
    evaluationKeys.add(graphRefKey(edge.to));
  }
  if (evaluationKeys.size === 0) return undefined;
  const captures = new Set<string>();
  for (const evaluationKey of evaluationKeys) {
    const evaluation = recordsByKey.get(evaluationKey);
    if (evaluation === undefined) return undefined;
    const captureKey = uniqueLinkedDfmCapture(
      evaluation,
      edges,
      "evidences",
      recordsByKey,
      artifactsById,
      catalog,
    );
    if (captureKey === undefined) return undefined;
    captures.add(captureKey);
  }
  if (captures.size !== 1) return undefined;
  const captureKey = [...captures][0]!;
  const capture = recordsByKey.get(captureKey);
  if (
    capture === undefined ||
    !compatibleDfmCaseMembership(requirement, capture, catalog)
  ) {
    return undefined;
  }
  return captureKey;
}

function uniqueCaseDfmCapture(
  caseRecord: OverviewDfmViewerAliasRecord,
  edges: readonly OverviewViewerAliasEdge[],
  recordsByKey: ReadonlyMap<string, OverviewDfmViewerAliasRecord>,
  artifactsById: ReadonlyMap<string, ThreadArtifact>,
  catalog: EngineeringCaseCatalog | undefined,
): string | undefined {
  const captures = new Set<string>();
  for (const edge of edges) {
    if (
      (edge.relation !== "input_to" && edge.relation !== "derived_from") ||
      edge.from.kind !== caseRecord.ref.kind ||
      edge.from.id !== caseRecord.ref.id ||
      edge.to.kind !== "artifact"
    ) {
      continue;
    }
    const targetKey = graphRefKey(edge.to);
    const target = recordsByKey.get(targetKey);
    if (target === undefined) return undefined;
    if (isDfmCaptureRecord(target, artifactsById)) captures.add(targetKey);
  }
  if (captures.size !== 1) return undefined;
  const captureKey = [...captures][0]!;
  const capture = recordsByKey.get(captureKey);
  if (
    capture === undefined ||
    !compatibleDfmCaseMembership(caseRecord, capture, catalog)
  ) {
    return undefined;
  }
  return captureKey;
}

function uniqueArtifactSources(
  record: OverviewDfmViewerAliasRecord,
  edges: readonly OverviewViewerAliasEdge[],
  relation: "source_of" | "evidences",
): readonly string[] {
  const sources = new Set<string>();
  for (const edge of edges) {
    if (
      edge.relation !== relation ||
      edge.from.kind !== "artifact" ||
      edge.to.kind !== record.ref.kind ||
      edge.to.id !== record.ref.id
    ) {
      continue;
    }
    sources.add(graphRefKey(edge.from));
  }
  return [...sources];
}

function isDfmCaptureRecord(
  record: OverviewDfmViewerAliasRecord,
  artifactsById: ReadonlyMap<string, ThreadArtifact>,
): boolean {
  if (record.ref.kind !== "artifact") return false;
  return isOverviewDfmCheckCapture(artifactsById.get(record.ref.id));
}

function isDfmCaseRecord(
  record: OverviewDfmViewerAliasRecord,
  artifactsById: ReadonlyMap<string, ThreadArtifact>,
): boolean {
  if (record.ref.kind !== "artifact") return false;
  const artifact = artifactsById.get(record.ref.id);
  return isOverviewDfmCaseOrResultArtifact(artifact) &&
    !isOverviewDfmCheckCapture(artifact);
}

function compatibleDfmCaseMembership(
  record: OverviewDfmViewerAliasRecord,
  capture: OverviewDfmViewerAliasRecord,
  catalog: EngineeringCaseCatalog | undefined,
): boolean {
  const recordRefs = dfmCheckCaseRefs(record.engineeringCaseRefs, catalog);
  const captureRefs = dfmCheckCaseRefs(capture.engineeringCaseRefs, catalog);
  if (recordRefs === undefined || captureRefs === undefined) return false;
  if (recordRefs.length === 0 && captureRefs.length === 0) return true;
  if (recordRefs.length === 0 || captureRefs.length === 0) return false;
  if (recordRefs.length !== captureRefs.length) return false;
  return recordRefs.every((key, index) => key === captureRefs[index]);
}

function dfmCheckCaseRefs(
  refs: readonly string[] | undefined,
  catalog: EngineeringCaseCatalog | undefined,
): readonly string[] | undefined {
  if (refs === undefined || refs.length === 0) return [];
  if (!hasUnambiguousDfmCheckCaseMembership(refs)) return undefined;
  const sorted = [...refs].toSorted((left, right) => left.localeCompare(right));
  if (
    catalog === undefined ||
    catalog.schemaVersion !== "engineering-cases/1.1" ||
    catalog.status === "unavailable" ||
    !Array.isArray(catalog.cases) ||
    catalog.cases.length === 0
  ) {
    return sorted;
  }
  const casesByKey = new Map(catalog.cases.map((item) => [item.key, item]));
  for (const key of sorted) {
    const sealed = casesByKey.get(key);
    if (
      sealed === undefined ||
      sealed.family !== "dfm-check" ||
      sealed.caseSchemaVersion !== "dfm-check-case/1.0"
    ) {
      return undefined;
    }
  }
  return sorted;
}

function sameOpenTargets(
  left: readonly OverviewViewerOpenTarget[],
  right: readonly OverviewViewerOpenTarget[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) =>
    item.sessionId === right[index]?.sessionId &&
    item.nodeKey === right[index]?.nodeKey
  );
}

function graphRefKey(reference: Pick<ThreadGraphRef, "kind" | "id">): string {
  return `${reference.kind}:${reference.id}`;
}
