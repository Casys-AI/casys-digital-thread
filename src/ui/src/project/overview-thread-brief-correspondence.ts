import type {
  EngineeringWorkbenchRequirementsBriefTrace,
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";

export type OverviewBriefTrace = Extract<
  EngineeringWorkbenchRequirementsBriefTrace,
  { readonly status: "available" }
>;

/** A read-only source note, not a fabricated Thread entity or verdict. */
export interface OverviewBriefSourceHeroNode {
  readonly kind: "brief-source";
  readonly key: string;
  readonly lane: "requirements";
  readonly groupKey: "brief";
  readonly label: string;
  readonly color: string;
  readonly emphasis: boolean;
  readonly brief: OverviewBriefTrace["originalBrief"];
  readonly sourceItem:
    OverviewBriefTrace["requirements"][number]["originalSourceItem"];
  readonly correspondences: readonly {
    readonly trace: OverviewBriefTrace;
    readonly requirementId: string;
    readonly threadRequirementId: string;
    readonly sourceItemId: string;
  }[];
}

/** Leaf presentation contract; it must not import its consuming hero model. */
interface OverviewBriefCorrespondenceEdge {
  readonly key: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly kind: "brief-correspondence";
  readonly emphasis: boolean;
  readonly pathCount: number;
  readonly pathKeys: readonly string[];
}

export function overviewBriefSourceKey(
  briefSnapshotId: string,
  sourceItemId: string,
): string {
  return `brief-source:${JSON.stringify([briefSnapshotId, sourceItemId])}`;
}

/** Hide the documentary wrapper only; keep the original artifact inspectable. */
export function isRequirementsBriefClaimArtifact(
  artifact: ThreadArtifact | undefined,
): boolean {
  return artifact?.kind === "document" &&
    artifact.producer?.serverId === "digital-thread" &&
    artifact.producer.tool === "record.seal-requirements-brief-trace@1" &&
    /^casys:\/\/requirements-brief-trace\/sha256\/[a-f0-9]{64}$/.test(
      artifact.uri ?? "",
    );
}

/**
 * Display only exact joins already validated by the server. Documentary claims
 * take precedence over initial provenance. Ambiguous sources never make a cable.
 * In particular, a current brief cannot retarget an older declared source.
 */
export function buildOverviewBriefCorrespondences(
  thread: ThreadWorkbenchSnapshot,
  traces: readonly EngineeringWorkbenchRequirementsBriefTrace[],
  visibleRequirementKeys: ReadonlySet<string>,
): {
  readonly nodes: readonly OverviewBriefSourceHeroNode[];
  readonly edges: readonly OverviewBriefCorrespondenceEdge[];
} {
  const artifacts = new Map(thread.artifacts.map((item) => [item.id, item]));
  const requirementIds = new Set(thread.requirements.map((item) => item.id));
  type Candidate = {
    readonly trace: OverviewBriefTrace;
    readonly entry: OverviewBriefTrace["requirements"][number];
  };
  const candidates = new Map<string, Candidate[]>();
  for (const trace of traces) {
    if (trace.status !== "available" || !artifacts.has(trace.artifactId)) {
      continue;
    }
    if (
      trace.declaration && (
        trace.declaration.artifactId !== trace.artifactId ||
        !isRequirementsBriefClaimArtifact(artifacts.get(trace.artifactId)) ||
        !artifacts.has(trace.declaration.requirementsArtifactId)
      )
    ) continue;
    for (const entry of trace.requirements) {
      if (
        !requirementIds.has(entry.threadRequirementId) ||
        !visibleRequirementKeys.has(
          `requirement:${entry.threadRequirementId}`,
        ) ||
        !trace.threadRequirementIds.includes(entry.threadRequirementId) ||
        entry.sourceItemId !== entry.originalSourceItem.id
      ) continue;
      const entries = candidates.get(entry.threadRequirementId) ?? [];
      entries.push({ trace, entry });
      candidates.set(entry.threadRequirementId, entries);
    }
  }

  const sources = new Map<string, OverviewBriefSourceHeroNode>();
  const edges: OverviewBriefCorrespondenceEdge[] = [];
  for (const [requirementId, entries] of candidates) {
    const claims = entries.filter(({ trace }) =>
      trace.declaration !== undefined
    );
    const selected = claims.length > 0 ? claims : entries;
    if (selected.length !== 1) continue;
    const { trace, entry } = selected[0]!;
    const key = overviewBriefSourceKey(
      trace.originalBrief.snapshotId,
      entry.sourceItemId,
    );
    const correspondence = {
      trace,
      requirementId: entry.requirementId,
      threadRequirementId: requirementId,
      sourceItemId: entry.sourceItemId,
    };
    const prior = sources.get(key);
    sources.set(key, {
      kind: "brief-source",
      key,
      lane: "requirements",
      groupKey: "brief",
      label: entry.sourceItemId,
      color: "#7c3aed",
      emphasis: (prior?.emphasis ?? false) || entry.state !== "unchanged",
      brief: trace.originalBrief,
      sourceItem: entry.originalSourceItem,
      correspondences: [...(prior?.correspondences ?? []), correspondence],
    });
    const toKey = `requirement:${requirementId}`;
    edges.push({
      key: `${key}>${toKey}#brief-correspondence`,
      fromKey: key,
      toKey,
      kind: "brief-correspondence",
      emphasis: entry.state !== "unchanged",
      pathCount: 1,
      pathKeys: [JSON.stringify([
        "brief-correspondence",
        trace.artifactId,
        trace.originalBrief.snapshotId,
        entry.sourceItemId,
        requirementId,
      ])],
    });
  }
  return {
    nodes: [...sources.values()].sort((a, b) => a.key.localeCompare(b.key)),
    edges: edges.sort((a, b) => a.key.localeCompare(b.key)),
  };
}
