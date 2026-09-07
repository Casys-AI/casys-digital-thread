import { assertEquals, assertNotEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import { buildOverviewThreadHero } from "./src/project/overview-thread-hero-model.ts";
import {
  isRequirementsBriefClaimArtifact,
  overviewBriefSourceKey,
  type OverviewBriefTrace,
} from "./src/project/overview-thread-brief-correspondence.ts";
import type { ThreadArtifact, ThreadGraphNode } from "./src/thread/types.ts";

const claimId = `requirements-brief-trace-${"a".repeat(64)}`;
const requirementId = "REQ-MECH-014";
const captureId = "ART-SYSML-018";
const sourceItem = {
  id: "bracket-bench-stress",
  kind: "success-criterion" as const,
  statement: "The exact approved bench criterion.",
  sourceRefs: [{ kind: "intent" as const, reference: "conversation:fixture" }],
};
const originalBrief = {
  briefId: "fixture:brief",
  snapshotId: "fixture:brief:r3:exact",
  revision: 3,
};
const claim: OverviewBriefTrace = {
  artifactId: claimId,
  status: "available",
  threadRequirementIds: [requirementId],
  originalBrief,
  currentBrief: originalBrief,
  container: {
    sourceItemId: sourceItem.id,
    originalSourceItem: sourceItem,
    state: "unchanged",
  },
  requirements: [{
    threadRequirementId: requirementId,
    requirementId: "bracket_stress_pa",
    sourceItemId: sourceItem.id,
    originalSourceItem: sourceItem,
    state: "unchanged",
  }],
  declaration: {
    kind: "retrospective-documentary",
    artifactId: claimId,
    requirementsArtifactId: captureId,
    linkedAt: "2026-09-07T07:25:30.000Z",
    claimId: "fixture-claim-series",
    revision: 1,
  },
};
const claimArtifact: ThreadArtifact = {
  id: claimId,
  label: "Retrospective documentary brief trace",
  kind: "document",
  system: "digital-thread",
  producer: {
    serverId: "digital-thread",
    tool: "record.seal-requirements-brief-trace@1",
    runId: "fixture-run",
  },
  revision: "a".repeat(64),
  freshness: "fresh",
  uri: `casys://requirements-brief-trace/sha256/${"a".repeat(64)}`,
  dependsOn: [captureId],
};
const claimNode: ThreadGraphNode = {
  id: `graph:${claimId}`,
  ref: { kind: "artifact", id: claimId },
  entityKind: "artifact",
  artifactKind: "document",
  label: claimArtifact.label,
  system: "digital-thread",
  freshness: "fresh",
  summary: "Documentary claim, not a proof.",
};

function fixture() {
  const base = structuredClone(GENERIC_THREAD_FIXTURE);
  return {
    ...base,
    artifacts: [...base.artifacts, claimArtifact],
    graph: { ...base.graph, nodes: [...base.graph.nodes, claimNode] },
  };
}

Deno.test("brief correspondence shows an exact clause cable without an extra claim card or mutating Thread", () => {
  const thread = fixture();
  const before = structuredClone(thread);
  const hero = buildOverviewThreadHero(thread, [], [claim]);
  const sources = hero.nodes.filter((node) => node.kind === "brief-source");
  assertEquals(sources.length, 1);
  assertEquals(sources[0]!.groupKey, "brief");
  assertEquals(sources[0]!.brief, originalBrief);
  assertEquals(sources[0]!.sourceItem, sourceItem);
  assertEquals("node" in sources[0]!, false);
  assertEquals(
    hero.nodes.some((node) => node.key === `artifact:${claimId}`),
    false,
  );
  const edges = hero.edges.filter((edge) => edge.kind === "brief-correspondence");
  assertEquals(edges.length, 1);
  assertEquals(
    edges[0]!.fromKey,
    overviewBriefSourceKey(originalBrief.snapshotId, sourceItem.id),
  );
  assertEquals(edges[0]!.toKey, `requirement:${requirementId}`);
  assertEquals(JSON.parse(edges[0]!.pathKeys[0]!), [
    "brief-correspondence",
    claimId,
    originalBrief.snapshotId,
    sourceItem.id,
    requirementId,
  ]);
  assertEquals(thread, before);
  assertEquals(
    thread.artifacts.some((artifact) => artifact.id === claimId),
    true,
  );
});

Deno.test("empty data or TRACE GAP never manufactures a source from a requirement label", () => {
  for (
    const traces of [[], [{
      status: "TRACE GAP" as const,
      artifactId: captureId,
      threadRequirementIds: [requirementId],
    }]]
  ) {
    const hero = buildOverviewThreadHero(fixture(), [], traces);
    assertEquals(
      hero.nodes.some((node) => node.kind === "brief-source"),
      false,
    );
    assertEquals(
      hero.edges.some((edge) => edge.kind === "brief-correspondence"),
      false,
    );
    assertEquals(
      hero.nodes.some((node) => node.key === `artifact:${claimId}`),
      false,
    );
  }
});

Deno.test("documentary claim takes precedence over initial provenance without silently retargeting to current brief", () => {
  const initial: OverviewBriefTrace = {
    ...claim,
    artifactId: captureId,
    declaration: undefined,
    originalBrief: {
      ...originalBrief,
      snapshotId: "fixture:brief:r1:historic",
      revision: 1,
    },
  };
  const newerCurrent: OverviewBriefTrace = {
    ...claim,
    currentBrief: {
      ...originalBrief,
      snapshotId: "fixture:brief:r4:new",
      revision: 4,
    },
  };
  const hero = buildOverviewThreadHero(fixture(), [], [initial, newerCurrent]);
  const sources = hero.nodes.filter((node) => node.kind === "brief-source");
  assertEquals(sources.length, 1);
  assertEquals(sources[0]!.brief.revision, 3);
  assertEquals(
    sources[0]!.correspondences[0]!.trace.declaration?.artifactId,
    claimId,
  );
  assertEquals(
    hero.edges.some((edge) =>
      edge.fromKey.includes("historic") || edge.fromKey.includes("r4:new")
    ),
    false,
  );
  const initialOnly = buildOverviewThreadHero(fixture(), [], [initial]);
  assertEquals(
    initialOnly.nodes.filter((node) => node.kind === "brief-source")[0]!.brief
      .revision,
    1,
  );
});

Deno.test("ambiguous claims for one requirement never select a correspondence by timestamp or input order", () => {
  const ambiguous = {
    ...claim,
    originalBrief: {
      ...originalBrief,
      snapshotId: "different-approved-source",
    },
  };
  for (const traces of [[claim, ambiguous], [ambiguous, claim]]) {
    const hero = buildOverviewThreadHero(fixture(), [], traces);
    assertEquals(
      hero.edges.some((edge) => edge.kind === "brief-correspondence"),
      false,
    );
  }
});

Deno.test("missing or mismatched exact capture, clause and Thread requirement references fail closed", () => {
  const entry = claim.requirements[0]!;
  const invalid: OverviewBriefTrace[] = [
    { ...claim, artifactId: "absent" },
    {
      ...claim,
      declaration: { ...claim.declaration!, artifactId: "wrong-claim" },
    },
    {
      ...claim,
      declaration: {
        ...claim.declaration!,
        requirementsArtifactId: "absent-capture",
      },
    },
    { ...claim, threadRequirementIds: [] },
    {
      ...claim,
      requirements: [{ ...entry, sourceItemId: "same-label-different-clause" }],
    },
    {
      ...claim,
      requirements: [{ ...entry, threadRequirementId: "absent-requirement" }],
    },
  ];
  for (const trace of invalid) {
    assertEquals(
      buildOverviewThreadHero(fixture(), [], [trace]).edges.some((edge) =>
        edge.kind === "brief-correspondence"
      ),
      false,
    );
  }
});

Deno.test("wrapper hiding requires exact artifact kind, producer and URI, never documentary-looking text", () => {
  assertEquals(isRequirementsBriefClaimArtifact(claimArtifact), true);
  for (
    const artifact of [
      { ...claimArtifact, kind: "source" },
      {
        ...claimArtifact,
        producer: {
          ...claimArtifact.producer!,
          tool: "some-other-operation@1",
        },
      },
      { ...claimArtifact, uri: "casys://not-the-claim" },
    ]
  ) assertEquals(isRequirementsBriefClaimArtifact(artifact), false);
});

Deno.test("source presentation keys retain exact snapshot and clause boundaries", () => {
  assertNotEquals(
    overviewBriefSourceKey("a:b", "c"),
    overviewBriefSourceKey("a", "b:c"),
  );
  assertNotEquals(
    overviewBriefSourceKey("r1", "clause"),
    overviewBriefSourceKey("r3", "clause"),
  );
});
