import type {
  ProposedThreadAction,
  RequirementEvaluation,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityRef,
  ThreadFreshnessStatus,
  ThreadObservation,
  ThreadProvenanceLink,
  ThreadSnapshot,
  ThreadViolation,
  TracedRequirement,
} from "./thread-snapshot.ts";
import {
  ANALYSIS_GRAPH_SCHEMA,
  type AnalysisGraph,
  validateAnalysisGraph,
} from "./analysis-graph.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import { validateThreadSnapshot } from "./thread-snapshot-validation.ts";

/** A provider-native identity that an extension can prove structurally. */
export interface ThreadProviderBindingProof {
  provider: string;
  kind: string;
  id: string;
}

/**
 * One independently captured, causally bounded branch of a digital thread.
 *
 * Provider adapters return extensions instead of taking ownership of the root
 * snapshot. The assembler remains the only place that advances revisions.
 */
export interface ThreadSnapshotExtension {
  id: string;
  name: string;
  subjectId: string;
  capturedAt: string;
  artifacts: ThreadArtifact[];
  consumptions: ThreadArtifactConsumption[];
  observations: ThreadObservation[];
  requirements: TracedRequirement[];
  evaluations: RequirementEvaluation[];
  violations: ThreadViolation[];
  provenance: ThreadProvenanceLink[];
  proposedActions: ProposedThreadAction[];
  /**
   * Optional semantic facts captured by this branch.  Supplying one upgrades
   * the assembled successor to ThreadSnapshot 1.1; it never changes
   * provenance relation meanings or execution authority.
   */
  analysisGraph?: AnalysisGraph;
  /**
   * Optional retirement entries. Each entry records that the named entity has
   * been retired (append-only status change); the entity itself remains in every
   * snapshot array. No content is altered; each entry materializes as an
   * "archived" ThreadChange with a companion "changes" provenance link.
   *
   * WHY THIS IS SEPARATE FROM artifacts — an archived entry carries no bytes
   * and produces no new entity. The applyThreadSnapshotExtensionIfNew
   * idempotence branch for length===0 artifacts still applies directly, letting
   * the executor hold its own coarser guard (archivedRefKeys coverage check)
   * without fighting the extension machinery.
   */
  archived?: Array<{ target: ThreadEntityRef; summary: string }>;
  /**
   * Optional explicit provider identities carried by this evidence branch.
   * The subject-manifest binder still also accepts structural URI/run proofs
   * for legacy-independent artifact branches.
   */
  bindingProofs?: ThreadProviderBindingProof[];
}

/**
 * Reuse a validated standalone evidence snapshot as a branch of a wider
 * explicitly bound subject. Historical change links stay in the standalone
 * snapshot; the destination assembler creates its own artifact-change links.
 */
export function snapshotEvidenceExtension(
  snapshot: ThreadSnapshot,
  options: {
    id: string;
    name: string;
    subjectId: string;
  },
): ThreadSnapshotExtension {
  const validated = validateThreadSnapshot(snapshot);
  return {
    id: options.id,
    name: options.name,
    subjectId: options.subjectId,
    capturedAt: validated.generatedAt,
    artifacts: structuredClone([...validated.artifacts]),
    consumptions: structuredClone([...validated.consumptions]),
    observations: structuredClone([...validated.observations]),
    requirements: structuredClone([...validated.requirements]),
    evaluations: structuredClone([...validated.evaluations]),
    violations: structuredClone([...validated.violations]),
    provenance: validated.provenance.filter((link) => link.relation !== "changes")
      .map((link) => structuredClone(link)),
    proposedActions: structuredClone([...validated.proposedActions]),
    ...(validated.analysisGraph === undefined
      ? {}
      : { analysisGraph: structuredClone(validated.analysisGraph) }),
  };
}

/** Add a validated provider branch and create a new immutable snapshot revision. */
export function applyThreadSnapshotExtension(
  base: ThreadSnapshot,
  extension: ThreadSnapshotExtension,
  options: { appliedAt?: string } = {},
): ThreadSnapshot {
  validateThreadSnapshot(base);
  if (extension.subjectId !== base.subject.id) {
    throw new Error(
      `Extension ${extension.id} targets ${extension.subjectId}, expected ${base.subject.id}.`,
    );
  }
  if (!extension.id.trim() || !extension.name.trim()) {
    throw new Error("ThreadSnapshot extension id and name must be non-empty.");
  }
  if (Number.isNaN(Date.parse(extension.capturedAt))) {
    throw new Error("ThreadSnapshot extension capturedAt must be ISO-8601.");
  }
  const appliedAt = options.appliedAt ?? extension.capturedAt;
  if (Number.isNaN(Date.parse(appliedAt))) {
    throw new Error("ThreadSnapshot extension appliedAt must be ISO-8601.");
  }

  const artifactChanges = extension.artifacts.map((artifact) => ({
    id: `${extension.id}:created:${artifact.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifact.id },
    summary: `${extension.name}: captured ${artifact.name}.`,
    afterFingerprint: artifact.fingerprint,
  }));
  const changeLinks: ThreadProvenanceLink[] = artifactChanges.map((change) => ({
    id: `${extension.id}:changes:${change.target.id}`,
    relation: "changes",
    from: { kind: "change", id: change.id },
    to: change.target,
    rationale: "This snapshot extension introduced the captured artifact.",
  }));
  const archivedChanges = (extension.archived ?? []).map((entry) => ({
    // Entity IDs are only unique inside their kind. Keep the kind in the
    // change identity so one cascade can retire e.g. artifact:x and
    // observation:x without creating ambiguous evidence.
    id: `${extension.id}:archived:${entry.target.kind}:${entry.target.id}`,
    kind: "archived" as const,
    target: entry.target,
    summary: entry.summary,
  }));
  const archivedChangeLinks: ThreadProvenanceLink[] = archivedChanges.map((change) => ({
    id: `${extension.id}:changes-archived:${change.target.kind}:${change.target.id}`,
    relation: "changes" as const,
    from: { kind: "change" as const, id: change.id },
    to: change.target,
    rationale:
      "This snapshot extension recorded the retirement of the referenced entity.",
  }));
  const nextRevision = base.revision + 1;
  const analysisGraph = mergeAnalysisGraphs(
    base.analysisGraph,
    extension.analysisGraph,
  );
  const status = aggregateFreshness(
    [
      ...base.artifacts,
      ...base.observations,
      ...base.requirements,
      ...base.evaluations,
      ...base.violations,
      ...extension.artifacts,
      ...extension.observations,
      ...extension.requirements,
      ...extension.evaluations,
      ...extension.violations,
    ].map((item) => item.freshness.status).concat(
      [...base.consumptions, ...extension.consumptions].some((item) =>
          item.status === "mismatch"
        )
        ? ["failed"]
        : [],
    ),
  );
  const merged = {
    ...structuredClone(base),
    id: `${base.subject.id}:r${nextRevision}:${extension.id}`,
    revision: nextRevision,
    previous: { snapshotId: base.id, revision: base.revision },
    generatedAt: appliedAt,
    freshness: rootFreshness(status, appliedAt),
    changeSet: {
      id: extension.id,
      name: extension.name,
      status: "applied" as const,
      createdAt: appliedAt,
      appliedAt,
      // The canonical validator keeps freshness causes and provenance links
      // resolvable inside one snapshot, so the revision carries prior changes.
      changes: [...base.changeSet.changes, ...artifactChanges, ...archivedChanges],
    },
    artifacts: [...base.artifacts, ...extension.artifacts],
    consumptions: [...base.consumptions, ...extension.consumptions],
    observations: [...base.observations, ...extension.observations],
    requirements: [...base.requirements, ...extension.requirements],
    evaluations: [...base.evaluations, ...extension.evaluations],
    violations: [...base.violations, ...extension.violations],
    provenance: [
      ...base.provenance,
      ...extension.provenance,
      ...changeLinks,
      ...archivedChangeLinks,
    ],
    proposedActions: [...base.proposedActions, ...extension.proposedActions],
    ...(analysisGraph === undefined ? {} : {
      schemaVersion: "1.1" as const,
      analysisGraph,
    }),
  };
  return validateThreadSnapshot(merged);
}

/**
 * Advance a persisted thread only when this complete evidence branch is absent.
 *
 * A repeated assembler run must keep the existing immutable head rather than
 * minting another revision for byte-identical provider evidence. A partial
 * match is unsafe: it could conceal a failed or manually edited prior merge,
 * so it is rejected instead of being completed heuristically.
 */
export function applyThreadSnapshotExtensionIfNew(
  base: ThreadSnapshot,
  extension: ThreadSnapshotExtension,
  options: { appliedAt?: string } = {},
): { snapshot: ThreadSnapshot; applied: boolean } {
  const baseAnalysisGraph = base.analysisGraph === undefined
    ? undefined
    : validateAnalysisGraph(base.analysisGraph);
  const extensionAnalysisGraph = extension.analysisGraph === undefined
    ? undefined
    : validateAnalysisGraph(extension.analysisGraph);
  const extensionAssertionIds =
    extensionAnalysisGraph?.relations.map((relation) => relation.assertion.id) ?? [];
  const extensionMemberCount = extension.artifacts.length +
    extensionAssertionIds.length;
  if (extensionMemberCount === 0) {
    return {
      snapshot: applyThreadSnapshotExtension(base, extension, options),
      applied: true,
    };
  }
  const knownArtifacts = new Map(
    base.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const knownAssertions = new Map(
    baseAnalysisGraph?.relations.map((relation) => [
      relation.assertion.id,
      relation,
    ]) ?? [],
  );
  for (const artifact of extension.artifacts) {
    const existing = knownArtifacts.get(artifact.id);
    if (existing && deterministicJson(existing) !== deterministicJson(artifact)) {
      throw new Error(
        `Thread artifact ${artifact.id} conflicts with an already attached artifact.`,
      );
    }
  }
  for (const relation of extensionAnalysisGraph?.relations ?? []) {
    const existing = knownAssertions.get(relation.assertion.id);
    if (existing && deterministicJson(existing) !== deterministicJson(relation)) {
      throw new Error(
        `Analysis assertion ${relation.assertion.id} conflicts with an already attached assertion.`,
      );
    }
  }
  const attachedCount =
    extension.artifacts.filter((artifact) => knownArtifacts.has(artifact.id)).length +
    extensionAssertionIds.filter((id) => knownAssertions.has(id)).length;
  if (attachedCount === extensionMemberCount) {
    return { snapshot: base, applied: false };
  }
  if (attachedCount > 0) {
    throw new Error(
      `Base ThreadSnapshot ${base.id} contains only part of extension ${extension.id}; refusing an ambiguous merge.`,
    );
  }
  return {
    snapshot: applyThreadSnapshotExtension(base, extension, options),
    applied: true,
  };
}

function mergeAnalysisGraphs(
  base: AnalysisGraph | undefined,
  extension: AnalysisGraph | undefined,
): AnalysisGraph | undefined {
  if (base === undefined && extension === undefined) return undefined;
  const validatedBase = base === undefined ? undefined : validateAnalysisGraph(base);
  const validatedExtension = extension === undefined
    ? undefined
    : validateAnalysisGraph(extension);
  const nodes = deduplicateExactNodes([
    ...(validatedBase?.nodes ?? []),
    ...(validatedExtension?.nodes ?? []),
  ]);
  return validateAnalysisGraph({
    schemaVersion: ANALYSIS_GRAPH_SCHEMA,
    nodes,
    relations: [
      ...(validatedBase?.relations ?? []),
      ...(validatedExtension?.relations ?? []),
    ],
  });
}

function deduplicateExactNodes(
  nodes: readonly AnalysisGraph["nodes"][number][],
): AnalysisGraph["nodes"] {
  const nodeById = new Map<string, AnalysisGraph["nodes"][number]>();
  for (const node of nodes) {
    const existing = nodeById.get(node.id);
    if (!existing) {
      nodeById.set(node.id, node);
      continue;
    }
    if (deterministicJson(existing) !== deterministicJson(node)) {
      throw new Error(
        `Analysis graph node ${node.id} conflicts between ThreadSnapshot branches.`,
      );
    }
  }
  return [...nodeById.values()];
}

function aggregateFreshness(
  statuses: ThreadFreshnessStatus[],
): ThreadFreshnessStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("stale")) return "stale";
  return "fresh";
}

/**
 * A revision retains immutable historical evidence.  Its aggregate state can
 * therefore remain stale or failed after a fresh successor branch is added;
 * those non-fresh root states require an explicit validator-visible cause.
 */
function rootFreshness(
  status: ThreadFreshnessStatus,
  changedAt: string,
) {
  return {
    status,
    changedAt,
    ...(status === "stale"
      ? {
        reason:
          "At least one retained entity is stale; replacement evidence is still required.",
      }
      : status === "failed"
      ? {
        reason:
          "At least one retained entity failed or reported a fingerprint mismatch.",
      }
      : {}),
    invalidatedByChangeIds: [],
  };
}
