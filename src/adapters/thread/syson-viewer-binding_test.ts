import { assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { buildSysonViewerBinding } from "./syson-viewer-binding.ts";

Deno.test("SysON viewer binding fails closed before parsing an unsupported malformed project basis", async () => {
  await assertRejects(
    () =>
      buildSysonViewerBinding({
        project: {} as never,
        thread: {} as never,
        artifactId: "artifact-a",
        captureText: "{}",
        packages: [],
      }),
    Error,
  );
});

Deno.test("SysON viewer binding accepts the writer's 3.0 requirements input bijection", async () => {
  const binding = await buildSysonViewerBinding(
    await requirementsFixture("requirements-capture/3.0") as never,
  );
  assertEquals(binding?.session.payload.resultSchema, "requirements-capture/3.0");
});

Deno.test("SysON viewer binding accepts the recapture writer's 4.0 requirements input bijection", async () => {
  const binding = await buildSysonViewerBinding(
    await requirementsFixture("requirements-capture/4.0") as never,
  );
  assertEquals(binding?.session.payload.resultSchema, "requirements-capture/4.0");
});

Deno.test("SysON viewer binding rejects a recapture whose Thread inputs omit its signed predecessor", async () => {
  const fixture = await requirementsFixture("requirements-capture/4.0");
  const predecessorId =
    fixture.thread.artifacts.find((item) =>
      item.id.startsWith("requirements-Wing-") && item.id !== fixture.artifactId
    )!.id;
  const thread = structuredClone(fixture.thread);
  const anchor = thread.artifacts.find((item) => item.id === fixture.artifactId)!;
  anchor.inputArtifactIds = anchor.inputArtifactIds.filter((id) =>
    id !== predecessorId
  );
  thread.consumptions = thread.consumptions.filter((item) =>
    item.artifactId !== predecessorId
  );
  thread.provenance = thread.provenance.filter((item) =>
    item.from.id !== predecessorId && item.to.id !== predecessorId
  );
  await assertRejects(
    () => buildSysonViewerBinding({ ...fixture, thread } as never),
    Error,
  );
});

async function requirementsFixture(
  schema: "requirements-capture/3.0" | "requirements-capture/4.0",
) {
  const at = "2026-09-07T12:00:00.000Z";
  const fp = (digit: string) => ({
    algorithm: "sha256" as const,
    digest: digit.repeat(64),
  });
  const seed = {
    artifactId: "seed-b",
    fingerprint: fp("b"),
    producerRunId: "run:seed",
  };
  const architecture = {
    artifactId: `architecture-${"c".repeat(64)}`,
    fingerprint: fp("c"),
    producerRunId: "run:architecture",
  };
  const predecessor = {
    artifactId: `requirements-Wing-${"d".repeat(64)}`,
    fingerprint: fp("d"),
    producerRunId: "run:requirements-v3",
  };
  const runId = schema === "requirements-capture/3.0"
    ? "run:requirements-v3"
    : "run:requirements-v4";
  const common = {
    trustedRunId: runId,
    containerComponent: "Wing",
    partDefName: "WingRequirements",
    target: {
      kind: "part-definition",
      label: "Wing",
      elementId: "part-definition:wing",
    },
    architectureBasis: {
      snapshotId: "thread:viewer:r1",
      revision: 1,
      fingerprint: "c".repeat(64),
    },
    requirements: [{
      id: "max-tip-displacement",
      name: "Maximum tip displacement",
      metric: "tipDisplacement",
      operator: "<=",
      limit: { value: 3, unit: "mm" },
    }],
    seed,
    architecture,
    requirementsElementId: "requirement-usage:wing",
    requirementUsage: { id: "requirement-usage:wing", kind: "RequirementUsage" },
    constraintUsages: [{
      requirementId: "max-tip-displacement",
      id: "constraint-usage:max-tip-displacement",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage:max-tip-displacement",
    }],
  };
  const capture = schema === "requirements-capture/3.0"
    ? {
      schemaVersion: schema,
      operation: { id: "model.write-requirements", version: "1" },
      ...common,
      insertedAt: at,
    }
    : {
      schemaVersion: schema,
      operation: { id: "model.recapture-requirements", version: "1" },
      ...common,
      predecessor,
      capturedAt: at,
      subject: {
        id: "reference-usage:wing-target",
        kind: "ReferenceUsage",
        name: "target",
      },
    };
  const captureText = deterministicJson(capture);
  const captureFingerprint = await sha256Fingerprint(capture);
  const artifactId = `requirements-Wing-${captureFingerprint.digest}`;
  const inputs = schema === "requirements-capture/3.0"
    ? [architecture.artifactId]
    : [architecture.artifactId, predecessor.artifactId];
  const fresh = { status: "fresh", changedAt: at, invalidatedByChangeIds: [] };
  const operation = {
    serverId: "syson",
    tool: schema === "requirements-capture/3.0"
      ? "syson_element_insert_sysml"
      : "syson_constraint_extract",
    runId,
  };
  const artifact = {
    id: artifactId,
    name: "Requirements: Wing",
    kind: "sysml-model",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: `casys://requirements-capture/Wing/sha256/${captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: inputs,
    freshness: fresh,
  };
  const artifacts = [
    {
      id: seed.artifactId,
      name: "Seed",
      kind: "sysml-model",
      version: seed.fingerprint.digest,
      fingerprint: seed.fingerprint,
      uri: `casys://syson-model-seed-capture/sha256/${seed.fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_model_create",
        runId: seed.producerRunId,
      },
      inputArtifactIds: [],
      freshness: fresh,
    },
    {
      id: architecture.artifactId,
      name: "Architecture",
      kind: "sysml-model",
      version: architecture.fingerprint.digest,
      fingerprint: architecture.fingerprint,
      uri: `casys://architecture-capture/sha256/${architecture.fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: architecture.producerRunId,
      },
      inputArtifactIds: [],
      freshness: fresh,
    },
    ...(schema === "requirements-capture/4.0"
      ? [{
        id: predecessor.artifactId,
        name: "Prior requirements",
        kind: "sysml-model",
        version: predecessor.fingerprint.digest,
        fingerprint: predecessor.fingerprint,
        uri:
          `casys://requirements-capture/Wing/sha256/${predecessor.fingerprint.digest}`,
        mediaType: "application/json",
        producer: {
          serverId: "syson",
          tool: "syson_element_insert_sysml",
          runId: predecessor.producerRunId,
        },
        inputArtifactIds: [architecture.artifactId],
        freshness: fresh,
      }]
      : []),
    artifact,
  ];
  const consumption = (id: string, consumer = operation) => ({
    id: `consume-${consumer.runId}-${id}`,
    artifactId: id,
    consumer,
    observedFingerprint: artifacts.find((item) => item.id === id)!.fingerprint,
    verifiedAt: at,
    status: "verified",
  });
  const consumptions = [
    ...(schema === "requirements-capture/4.0"
      ? [
        consumption(architecture.artifactId, {
          serverId: "syson",
          tool: "syson_element_insert_sysml",
          runId: predecessor.producerRunId,
        }),
      ]
      : []),
    ...inputs.map((id) => consumption(id)),
  ];
  const link = (
    id: string,
    relation: string,
    from: { kind: string; id: string },
    to: { kind: string; id: string },
  ) => ({ id, relation, from, to, rationale: "exact fixture provenance" });
  const provenance = [
    ...(schema === "requirements-capture/4.0"
      ? [
        link("prior-derived", "derived_from", {
          kind: "artifact",
          id: predecessor.artifactId,
        }, { kind: "artifact", id: architecture.artifactId }),
      ]
      : []),
    ...inputs.map((id) =>
      link(`derived-${id}`, "derived_from", { kind: "artifact", id: artifactId }, {
        kind: "artifact",
        id,
      })
    ),
    ...consumptions.map((item) =>
      link(`uses-${item.id}`, "uses", { kind: "consumption", id: item.id }, {
        kind: "artifact",
        id: item.artifactId,
      })
    ),
  ];
  const thread = {
    schemaVersion: "1.0",
    id: "thread:viewer:r1",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "project:project-viewer",
      name: "Viewer fixture",
      kind: "system",
      version: seed.fingerprint.digest,
      modelArtifactId: seed.artifactId,
    },
    freshness: fresh,
    changeSet: {
      id: "changes-r1",
      name: "viewer fixture",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [],
    },
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  };
  return {
    project: await validProject(thread.id, thread.subject.id, at),
    thread,
    artifactId,
    captureText,
    packages: [{
      app: { id: "io.casys.mcp-syson", version: "0.8.7" },
      manifest: {
        uri: "ui://mcp-syson/manifest",
        path: "/immutable/manifest.json",
        fingerprint: "sha256:unused",
      },
      resources: [{
        uri: "ui://mcp-syson/requirements-viewer",
        path: "/immutable/requirements.html",
        fingerprint: "sha256:unused",
        resultSchemas: [schema],
        sessionSchemas: [
          "io.casys.mcp-syson.recorded-authored-requirements-session/1.0",
        ],
        acceptedActions: ["viewer.session.apply"],
      }],
    }],
  };
}

async function validProject(snapshotId: string, subjectId: string, at: string) {
  const root = await Deno.makeTempDir({ prefix: "syson-viewer-binding-" });
  try {
    const briefs = new ProjectBriefCommandService(
      new FileEngineeringProjectRevisionStore(root),
      () => at,
    );
    const agent = { kind: "agent" as const, actorId: "agent:test" };
    const human = { kind: "human" as const, actorId: "human:test" };
    let project = await briefs.startProject(
      agent,
      {
        commandId: "start",
        projectId: "project-viewer",
        projectName: "Viewer fixture",
        issuedAt: at,
        intent: "Exercise exact viewer bindings.",
        intentSource: { kind: "human", reference: "conversation:test" },
      },
    );
    project = await briefs.proposeBrief(agent, {
      commandId: "propose-brief",
      projectId: project.project.id,
      expectedRevision: project.revision,
      issuedAt: at,
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Exercise exact viewer bindings.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Read recorded SysON evidence.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement: "Keep the viewer read-only.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
        dependsOnItemIds: [],
      }],
    });
    project = await briefs.approveBrief(human, {
      commandId: "approve-brief",
      projectId: project.project.id,
      expectedRevision: project.revision,
      issuedAt: at,
      briefSnapshotId: project.framing!.proposedBrief!.id,
      briefRevision: project.framing!.proposedBrief!.revision,
      rationale: "Approved fixture baseline.",
      inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
    });
    return {
      ...project,
      threadSnapshots: [{ snapshotId, revision: 1, subjectId }],
    };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
