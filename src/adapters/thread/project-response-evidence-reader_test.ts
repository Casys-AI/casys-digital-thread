import { assertEquals } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { approvedBriefBasisForProject } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { ThreadProjectResponseEvidenceReader } from "./project-response-evidence-reader.ts";

const AT = "2026-09-07T12:00:00.000Z";

Deno.test("evidence reader maps a native current trace without capture or solver bytes", async () => {
  const { project, store } = await approvedProject();
  const fixture = await tracedCapture(project, "requirements-capture/5.0");
  const facts = await reader(store, fixture.captureText).read({
    project,
    thread: fixture.thread,
  });
  assertEquals(facts.traces.length, 1);
  const trace = facts.traces[0]!;
  assertEquals(trace.status, "available");
  if (trace.status !== "available") return;
  assertEquals(trace.origin, "native");
  assertEquals(trace.sourceBrief.snapshotId, project.framing!.currentBrief!.id);
  assertEquals(trace.requirements[0]!.sourceItemId, "success");
  assertEquals(trace.requirements[0]!.sourceState, "unchanged");
  assertEquals(
    JSON.stringify(facts).includes(fixture.captureText.slice(0, 40)),
    false,
  );
  assertEquals("sourceText" in facts, false);
});

Deno.test("evidence reader preserves TRACE GAP from the existing capture reader", async () => {
  const { project, store } = await approvedProject();
  const fixture = await tracedCapture(project, "requirements-capture/3.0");
  const facts = await reader(store, fixture.captureText).read({
    project,
    thread: fixture.thread,
  });
  assertEquals(facts.traces, [{
    status: "TRACE GAP",
    artifactId: fixture.artifactId,
    threadRequirementIds: [
      `requirement-${fixture.fingerprint.digest}-${fixture.capturedId}`,
    ],
  }]);
});

Deno.test("evidence reader without Thread returns empty facts", async () => {
  const { project, store } = await approvedProject();
  const facts = await reader(store, "{}").read({ project });
  assertEquals(facts.traces, []);
  assertEquals(facts.evaluations, []);
  assertEquals(facts.archivedRefKeys, []);
});

Deno.test("evidence reader copies archive keys and evaluation identities from Thread", async () => {
  const { project, store } = await approvedProject();
  const fixture = await tracedCapture(project, "requirements-capture/5.0");
  const thread = {
    ...fixture.thread,
    evaluations: [{
      id: "eval-1",
      name: "Displacement",
      requirementId: fixture.thread.requirements[0]!.id,
      observationIds: ["obs-1"],
      status: "pass",
      evaluatedAt: AT,
      evaluator: { serverId: "syson", tool: "evaluate", runId: "run:eval" },
      evidenceArtifactIds: [],
      message: "pass",
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    }],
    observations: [{
      id: "obs-1",
      name: "Displacement",
      metric: "maxDisplacement",
      quantity: { value: 1, unit: "mm" },
      source: {
        operation: { serverId: "syson", tool: "observe", runId: "run:obs" },
        artifactIds: [fixture.artifactId],
        capturedAt: AT,
      },
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    }],
    changeSet: {
      changes: [{
        id: "chg-archive",
        kind: "archived",
        target: { kind: "evaluation", id: "eval-old" },
        summary: "Retired predecessor.",
      }],
    },
  } as unknown as ThreadSnapshot;
  const facts = await reader(store, fixture.captureText).read({
    project,
    thread,
  });
  assertEquals(facts.archivedRefKeys, ["evaluation:eval-old"]);
  assertEquals(facts.evaluations[0]!.id, "eval-1");
  assertEquals(facts.evaluations[0]!.status, "pass");
  assertEquals(facts.observations[0]!.id, "obs-1");
  assertEquals(facts.observations[0]!.sourceArtifactIds, [fixture.artifactId]);
});

function reader(store: MemoryProjectStore, captureText: string) {
  return new ThreadProjectResponseEvidenceReader({
    projects: store,
    captures: { read: () => Promise.resolve(captureText) },
  });
}

async function tracedCapture(
  project: EngineeringProjectSnapshot,
  schema: "requirements-capture/3.0" | "requirements-capture/5.0",
) {
  const brief = project.framing!.currentBrief!;
  const basis = approvedBriefBasisForProject(project);
  const briefContentFingerprint = await sha256Fingerprint(brief);
  const capturedId = schema === "requirements-capture/3.0"
    ? "max-displacement"
    : "maxDisplacement";
  const common = {
    trustedRunId: "run:requirements",
    containerComponent: "Wing",
    partDefName: "WingRequirements",
    target: { kind: "part-definition", label: "Wing", elementId: "part:wing" },
    architectureBasis: {
      snapshotId: "thread:trace",
      revision: 1,
      fingerprint: "a".repeat(64),
    },
    requirements: [{
      id: capturedId,
      name: "Maximum displacement",
      metric: "maxDisplacement",
      operator: "<=",
      limit: { value: 2, unit: "mm" },
    }],
    seed: { artifactId: "seed", fingerprint: fp("b"), producerRunId: "run:seed" },
    architecture: {
      artifactId: "architecture-a",
      fingerprint: fp("a"),
      producerRunId: "run:architecture",
    },
    requirementsElementId: "requirement-usage:wing",
    requirementUsage: { id: "requirement-usage:wing", kind: "RequirementUsage" },
    constraintUsages: [{
      requirementId: capturedId,
      id: "constraint-usage:max-displacement",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage:max-displacement",
    }],
  };
  const capture = schema === "requirements-capture/5.0"
    ? {
      schemaVersion: schema,
      operation: { id: "model.write-requirements", version: "2" },
      ...common,
      insertedAt: AT,
      briefProvenance: {
        schemaVersion: "requirements-brief-provenance/1.0",
        briefBasis: basis,
        briefContentFingerprint,
        container: { sourceItem: brief.items.find((item) => item.id === "mission") },
        requirements: [{
          requirementId: "maxDisplacement",
          sourceItem: brief.items.find((item) => item.id === "success"),
          declaredThreshold: { value: 2, unit: "mm" },
          transformation: "identity",
        }],
      },
    }
    : {
      schemaVersion: schema,
      operation: { id: "model.write-requirements", version: "1" },
      ...common,
      insertedAt: AT,
    };
  const fingerprint = await sha256Fingerprint(capture);
  const artifactId = `requirements-Wing-${fingerprint.digest}`;
  const requirementId = `requirement-${fingerprint.digest}-${capturedId}`;
  const thread = {
    artifacts: [{
      id: artifactId,
      name: "Requirements: Wing",
      kind: "sysml-model",
      version: fingerprint.digest,
      fingerprint,
      uri: `casys://requirements-capture/Wing/sha256/${fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: schema === "requirements-capture/5.0"
          ? "model.write-requirements@2"
          : "syson_element_insert_sysml",
        runId: "run:requirements",
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    }],
    requirements: [{
      id: requirementId,
      name: "Requirement max displacement",
      statement: "Maximum displacement: maxDisplacement <= 2 mm.",
      version: fingerprint.digest,
      criterion: {
        metric: "maxDisplacement",
        operator: "<=",
        limit: { value: 2, unit: "mm" },
      },
      trace: {
        sourceArtifactId: artifactId,
        elementId: "requirement-usage:wing",
        targetArtifactIds: ["architecture-a"],
      },
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    evaluations: [],
    changeSet: { changes: [] },
  } as unknown as ThreadSnapshot;
  return {
    artifactId,
    captureText: deterministicJson(capture),
    fingerprint,
    capturedId,
    thread,
  };
}

async function approvedProject(): Promise<{
  readonly project: EngineeringProjectSnapshot;
  readonly store: MemoryProjectStore;
}> {
  const store = new MemoryProjectStore();
  const commands = new ProjectBriefCommandService(store, () => AT);
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await commands.startProject(agent, {
    commandId: "start",
    projectId: "project-response-trace",
    projectName: "Trace fixture",
    issuedAt: AT,
    intent: "Trace requirements clauses.",
    intentSource: { kind: "human", reference: "conversation:trace" },
  });
  project = await commands.proposeBrief(agent, {
    commandId: "propose",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Trace requirements clauses.",
      sourceRefs: [{ kind: "intent", reference: "conversation:trace" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Inspect the recorded trace.",
      sourceRefs: [{ kind: "document", reference: "brief:mission" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Displacement stays at or below 2 mm.",
      sourceRefs: [{ kind: "document", reference: "brief:limit" }],
      dependsOnItemIds: [],
    }],
  });
  project = await commands.approveBrief(human, {
    commandId: "approve",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Fixture approval.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  return { project, store };
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  #current: EngineeringProjectSnapshot | undefined;
  #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(
    _projectId?: string,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(this.#current && structuredClone(this.#current));
  }

  getRevision(
    _projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const value = this.#revisions.get(revision);
    return Promise.resolve(value && structuredClone(value));
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    this.#current = structuredClone(snapshot);
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#current?.revision !== expectedRevision) {
      return Promise.reject(new Error("CAS failed."));
    }
    this.#current = structuredClone(snapshot);
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}

function fp(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}
