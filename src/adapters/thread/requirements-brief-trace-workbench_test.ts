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
import { projectRequirementsBriefTraces } from "./requirements-brief-trace-workbench.ts";

const AT = "2026-09-07T12:00:00.000Z";

Deno.test("requirements brief trace reopens the sealed historical Project revision and maps only exact Thread requirements", async () => {
  const { project, store } = await approvedProject();
  const fixture = await tracedCapture(project, "requirements-capture/5.0");
  const traces = await projectRequirementsBriefTraces({
    project,
    thread: fixture.thread,
    projects: store,
    captures: { read: () => Promise.resolve(fixture.captureText) },
  });

  assertEquals(traces.length, 1);
  const trace = traces[0]!;
  assertEquals(trace.status, "available");
  if (trace.status !== "available") return;
  assertEquals(trace.originalBrief.snapshotId, project.framing!.currentBrief!.id);
  assertEquals(trace.container.originalSourceItem.id, "mission");
  assertEquals(trace.requirements, [{
    threadRequirementId: `requirement-${fixture.fingerprint.digest}-maxDisplacement`,
    requirementId: "maxDisplacement",
    sourceItemId: "success",
    originalSourceItem: project.framing!.currentBrief!.items.find((item) =>
      item.id === "success"
    )!,
    currentSourceItem: project.framing!.currentBrief!.items.find((item) =>
      item.id === "success"
    )!,
    state: "unchanged",
  }]);
});

Deno.test("requirements brief trace keeps historical v3/v4 captures at literal TRACE GAP", async () => {
  const { project, store } = await approvedProject();
  const fixture = await tracedCapture(project, "requirements-capture/3.0");
  const traces = await projectRequirementsBriefTraces({
    project,
    thread: fixture.thread,
    projects: store,
    captures: { read: () => Promise.resolve(fixture.captureText) },
  });

  assertEquals(traces, [{
    artifactId: fixture.artifactId,
    status: "TRACE GAP",
    threadRequirementIds: [
      `requirement-${fixture.fingerprint.digest}-${fixture.capturedId}`,
    ],
  }]);
});

Deno.test("requirements brief trace accepts exact V6 continuity and omits an unreadable predecessor", async () => {
  const { project, store } = await approvedProject();
  const previous = await tracedCapture(project, "requirements-capture/5.0");
  const current = await tracedCapture(
    project,
    "requirements-capture/5.0",
    (capture) => {
      capture.schemaVersion = "requirements-capture/6.0";
      capture.operation = { id: "model.recapture-requirements", version: "2" };
      capture.predecessor = {
        artifactId: previous.artifactId,
        fingerprint: previous.fingerprint,
        producerRunId: "run:requirements",
      };
      capture.subject = { id: "subject:wing", kind: "ReferenceUsage", name: "target" };
      capture.capturedAt = AT;
      delete capture.insertedAt;
    },
  );
  const tip = current.thread.artifacts[0]!;
  const thread = {
    ...current.thread,
    artifacts: [
      ...previous.thread.artifacts,
      {
        ...tip,
        producer: { ...tip.producer, tool: "model.recapture-requirements@2" },
        inputArtifactIds: [previous.artifactId],
      },
    ],
  };
  const texts = new Map([
    [previous.fingerprint.digest, previous.captureText],
    [current.fingerprint.digest, current.captureText],
  ]);
  const read = {
    project,
    thread,
    projects: store,
    captures: {
      read: (fingerprint: { digest: string }) =>
        Promise.resolve(texts.get(fingerprint.digest)),
    },
  };
  const traces = await projectRequirementsBriefTraces(read);
  assertEquals(traces.length, 1);
  assertEquals(traces[0]!.artifactId, current.artifactId);
  assertEquals(traces[0]!.status, "available");
  texts.delete(previous.fingerprint.digest);
  assertEquals(await projectRequirementsBriefTraces(read), []);
});

Deno.test("requirements brief trace fails closed when the historical approval snapshot cannot be reopened", async () => {
  const { project } = await approvedProject();
  const fixture = await tracedCapture(project, "requirements-capture/5.0");
  const traces = await projectRequirementsBriefTraces({
    project,
    thread: fixture.thread,
    projects: new MemoryProjectStore(),
    captures: { read: () => Promise.resolve(fixture.captureText) },
  });
  assertEquals(traces, []);
});

Deno.test("requirements brief trace rejects a forged sealed clause even when its copied brief fingerprint remains valid", async () => {
  const { project, store } = await approvedProject();
  const fixture = await tracedCapture(
    project,
    "requirements-capture/5.0",
    (capture) => {
      const provenance = capture.briefProvenance as {
        requirements: Array<{ sourceItem: { statement: string } }>;
      };
      provenance.requirements[0]!.sourceItem.statement = "Forged source clause.";
    },
  );
  const traces = await projectRequirementsBriefTraces({
    project,
    thread: fixture.thread,
    projects: store,
    captures: { read: () => Promise.resolve(fixture.captureText) },
  });
  assertEquals(traces, []);
});

Deno.test("requirements brief trace rejects a stale Thread requirement id and non-canonical capture text", async () => {
  const { project, store } = await approvedProject();
  const stale = await tracedCapture(project, "requirements-capture/5.0");
  (stale.thread.requirements[0] as { id: string }).id = "requirement-stale";
  assertEquals(
    await projectRequirementsBriefTraces({
      project,
      thread: stale.thread,
      projects: store,
      captures: { read: () => Promise.resolve(stale.captureText) },
    }),
    [],
  );

  const canonical = await tracedCapture(project, "requirements-capture/5.0");
  assertEquals(
    await projectRequirementsBriefTraces({
      project,
      thread: canonical.thread,
      projects: store,
      captures: {
        read: () => Promise.resolve(`${canonical.captureText}\n`),
      },
    }),
    [],
  );
});

async function tracedCapture(
  project: EngineeringProjectSnapshot,
  schema: "requirements-capture/3.0" | "requirements-capture/5.0",
  mutate?: (capture: Record<string, unknown>) => void,
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
  mutate?.(capture);
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
    projectId: "project-trace",
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

  get(): Promise<EngineeringProjectSnapshot | undefined> {
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
