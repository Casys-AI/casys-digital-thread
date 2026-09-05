import { assertEquals } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadRequirement,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../../presentation/workbench/thread/graph.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { enrichThreadWorkbenchWithRequirementsTargets } from "./requirements-target-workbench-enricher.ts";

const ARCH_DIGEST = "c".repeat(64);
const CAPTURE_DIGEST = "d".repeat(64);
const TARGET = "part-definition:wing";
const USAGE = "requirement-usage:wing";
const REQUIREMENT_ID = "req-displacement";

Deno.test(
  "requirements-target enricher retains exact capture target.elementId and links the PartDefinition",
  async () => {
    const snapshot = workbenchFor();
    const enriched = await enrichThreadWorkbenchWithRequirementsTargets(
      snapshot,
      { read: () => Promise.resolve(deterministicJson(capture())) },
      threadFor(snapshot),
    );
    assertEquals(
      enriched.requirements[0]?.targetElementId,
      TARGET,
    );
    assertEquals(enriched.requirements[0]?.sourceElementId, USAGE);
    const link = enriched.graph.edges.find((edge) =>
      edge.relation === "constrained_by"
    );
    assertEquals(link, {
      id: `structure:constrained-by:${TARGET}:${REQUIREMENT_ID}`,
      from: { kind: "part-definition", id: TARGET },
      to: { kind: "requirement", id: REQUIREMENT_ID },
      relation: "constrained_by",
      rationale:
        `PartDefinition ${TARGET} is the exact requirements-capture target of ` +
        `${REQUIREMENT_ID}.`,
      origin: "structure",
    });
  },
);

Deno.test(
  "requirements-target enricher fails closed when the architecture basis does not recross",
  async () => {
    const snapshot = workbenchFor();
    snapshot.artifacts[0]!.fingerprint = `sha256:${"9".repeat(64)}`;
    const enriched = await enrichThreadWorkbenchWithRequirementsTargets(
      snapshot,
      { read: () => Promise.resolve(deterministicJson(capture())) },
      threadFor(snapshot),
    );
    assertEquals(enriched.requirements[0]?.targetElementId, undefined);
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "constrained_by"),
      [],
    );
  },
);

Deno.test(
  "requirements-target enricher does not parse rationale to invent a target",
  async () => {
    const snapshot = workbenchFor();
    snapshot.requirements[0]!.rationale = `Targets ${TARGET} by name`;
    snapshot.artifacts = snapshot.artifacts.filter((item) =>
      item.producedBy !== "model.write-requirements@1"
    );
    const enriched = await enrichThreadWorkbenchWithRequirementsTargets(
      snapshot,
      { read: () => Promise.reject(new Error("must not reopen")) },
      threadFor(snapshot),
    );
    assertEquals(enriched.requirements[0]?.targetElementId, undefined);
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "constrained_by"),
      [],
    );
  },
);

Deno.test(
  "requirements-target enricher uses the unique current tip and ignores a predecessor",
  async () => {
    const predecessorDigest = "e".repeat(64);
    const snapshot = workbenchFor();
    const predecessor: ThreadArtifact = {
      ...snapshot.artifacts[1]!,
      id: "requirements-capture-wing-old",
      fingerprint: `sha256:${predecessorDigest}`,
      uri: `casys://requirements-capture/Wing/sha256/${predecessorDigest}`,
    };
    snapshot.artifacts = [
      snapshot.artifacts[0]!,
      snapshot.artifacts[1]!,
      predecessor,
    ];
    const current = capture();
    const old = {
      ...capture(),
      target: { ...capture().target, elementId: "part-definition:decoy" },
    };
    const enriched = await enrichThreadWorkbenchWithRequirementsTargets(
      snapshot,
      {
        read: (fingerprint) =>
          Promise.resolve(
            fingerprint.digest === predecessorDigest
              ? deterministicJson(old)
              : deterministicJson(current),
          ),
      },
      threadFor(snapshot, {
        [predecessor.id]: [],
        [snapshot.artifacts[1]!.id]: [predecessor.id],
      }),
    );
    assertEquals(enriched.requirements[0]?.targetElementId, TARGET);
  },
);

Deno.test(
  "requirements-target enricher refuses an ambiguous or retired requirements tip",
  async () => {
    const snapshot = workbenchFor();
    const sibling: ThreadArtifact = {
      ...snapshot.artifacts[1]!,
      id: "requirements-capture-wing-other",
      fingerprint: `sha256:${"f".repeat(64)}`,
      uri: `casys://requirements-capture/Wing/sha256/${"f".repeat(64)}`,
    };
    snapshot.artifacts = [
      snapshot.artifacts[0]!,
      snapshot.artifacts[1]!,
      sibling,
    ];
    const ambiguous = await enrichThreadWorkbenchWithRequirementsTargets(
      snapshot,
      { read: () => Promise.reject(new Error("must not reopen")) },
      threadFor(snapshot),
    );
    assertEquals(ambiguous.requirements[0]?.targetElementId, undefined);

    const retiredSnapshot = workbenchFor();
    const retired = await enrichThreadWorkbenchWithRequirementsTargets(
      retiredSnapshot,
      { read: () => Promise.reject(new Error("must not reopen")) },
      {
        ...threadFor(retiredSnapshot),
        changeSet: {
          changes: [{
            kind: "archived",
            target: { kind: "artifact", id: "requirements-capture-wing" },
          }],
        },
      } as unknown as ThreadSnapshot,
    );
    assertEquals(retired.requirements[0]?.targetElementId, undefined);
  },
);

function capture() {
  return {
    schemaVersion: "requirements-capture/3.0",
    operation: { id: "model.write-requirements", version: "1" },
    trustedRunId: "run:requirements",
    containerComponent: "Wing",
    partDefName: "WingRequirements",
    target: {
      kind: "part-definition",
      label: "Wing",
      elementId: TARGET,
    },
    architectureBasis: {
      snapshotId: "thread:drone-v4:r2",
      revision: 2,
      fingerprint: "a".repeat(64),
    },
    requirements: [{
      id: "max-tip-displacement",
      name: "Maximum tip displacement",
      metric: "tipDisplacement",
      operator: "<=",
      limit: { value: 3, unit: "mm" },
    }],
    seed: {
      artifactId: "artifact:seed",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producerRunId: "run:seed",
    },
    architecture: {
      artifactId: "architecture-capture-root",
      fingerprint: { algorithm: "sha256", digest: ARCH_DIGEST },
      producerRunId: "run:architecture",
    },
    requirementsElementId: USAGE,
    requirementUsage: {
      id: USAGE,
      kind: "RequirementUsage",
    },
    constraintUsages: [{
      requirementId: "max-tip-displacement",
      id: "constraint-usage:max-tip-displacement",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage:max-tip-displacement",
    }],
    insertedAt: "2026-08-08T12:15:00.000Z",
  };
}

function workbenchFor(): ThreadWorkbenchSnapshot {
  const architecture: ThreadArtifact = {
    id: "architecture-capture-root",
    label: "Architecture",
    kind: "sysml-model",
    system: "syson",
    revision: "1",
    freshness: "fresh",
    fingerprint: `sha256:${ARCH_DIGEST}`,
    uri: `casys://architecture-capture/sha256/${ARCH_DIGEST}`,
    producedBy: "model.write-architecture@1",
    dependsOn: [],
  };
  const requirementsCapture: ThreadArtifact = {
    id: "requirements-capture-wing",
    label: "Requirements",
    kind: "sysml-model",
    system: "syson",
    revision: "1",
    freshness: "fresh",
    fingerprint: `sha256:${CAPTURE_DIGEST}`,
    uri: `casys://requirements-capture/Wing/sha256/${CAPTURE_DIGEST}`,
    producedBy: "model.write-requirements@1",
    dependsOn: [architecture.id],
  };
  const requirement: ThreadRequirement = {
    id: REQUIREMENT_ID,
    label: "Displacement",
    source: `syson · ${USAGE}`,
    sourceElementId: USAGE,
    expression: "tipDisplacement <= 3 mm",
    status: "unresolved",
    observationIds: [],
    violationIds: [],
    rationale: "No canonical evaluation recorded.",
  };
  const nodes: ThreadGraphNode[] = [
    graphNode("artifact", architecture.id, architecture.label, "syson"),
    graphNode("part-definition", TARGET, "Wing", "syson"),
    graphNode("requirement", REQUIREMENT_ID, requirement.label, "syson"),
  ];
  const edges: ThreadGraphEdge[] = [{
    id: `structure:contains:${architecture.id}:${TARGET}`,
    from: { kind: "artifact", id: architecture.id },
    to: { kind: "part-definition", id: TARGET },
    relation: "contains",
    rationale: "Architecture contains the root PartDefinition.",
    origin: "structure",
  }];
  return {
    schemaVersion: "thread-workbench/0.2",
    id: "snap",
    subject: { id: "subject", label: "subject", program: "n/a" },
    generatedAt: "2026-08-19T00:00:00.000Z",
    source: "observed",
    sourceLabel: "test",
    change: {
      id: "change",
      title: "change",
      summary: "change",
      author: "n/a",
      revision: "1",
      changedAt: "2026-08-19T00:00:00.000Z",
      status: "pending",
      files: [],
    },
    graph: { nodes, edges },
    evidenceFamilyGraph: {
      schemaVersion: "thread-evidence-family-graph/1.0",
      asOf: { snapshotId: "snap", revision: 1 },
      families: [],
      edges: [],
      omittedSelfLoops: [],
      omittedCycleEdges: [],
    },
    flow: [],
    artifacts: [architecture, requirementsCapture],
    observations: [],
    requirements: [requirement],
    violations: [],
    actions: [],
  };
}

function threadFor(
  snapshot: ThreadWorkbenchSnapshot,
  inputs: Record<string, string[]> = {},
): ThreadSnapshot {
  return {
    changeSet: { changes: [] },
    artifacts: snapshot.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      uri: artifact.uri,
      inputArtifactIds: inputs[artifact.id] ?? artifact.dependsOn,
    })),
  } as unknown as ThreadSnapshot;
}

function graphNode(
  kind: ThreadGraphNode["entityKind"],
  id: string,
  label: string,
  system: string,
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    label,
    system,
    freshness: "fresh",
    summary: label,
  };
}
