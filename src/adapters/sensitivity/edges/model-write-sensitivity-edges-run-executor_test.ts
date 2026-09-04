import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import { MODEL_AUTHOR_SYSTEM_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { renderSensitivityEdgeSetSysml } from "../../../domain/sensitivity/edges/sensitivity-edge.ts";
import {
  sensitivityEdgesFromStudy,
  sensitivityPartDefName,
} from "../../../domain/sensitivity/edges/sensitivity-edge-from-study.ts";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { computeSensitivities } from "../../../domain/sensitivity/study/sensitivity-study.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { SENSITIVITY_STUDY_CAPTURE_SCHEMA } from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  makeSensitivityStudyReuseResult,
  SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import { FileSensitivityEdgesAttemptStore } from "./file-sensitivity-edges-attempt-store.ts";
import {
  recordingCapabilityRuntimeSession,
  successfulCapabilityRuntimeFor,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";
import {
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  ModelWriteSensitivityEdgesRunExecutor,
  SENSITIVITY_EDGES_CAPTURE_URI_PREFIX,
} from "./model-write-sensitivity-edges-run-executor.ts";

const AT = "2026-08-14T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl04";
const SUBJECT_ID = "lamp-arm";
const RUN_ID = "run.edges";
const WORK_ID = "work.edges";
const DECISION_ID = "decision.edges";
const APPROVAL_ID = "approval.edges";
const STUDY_ID = "sensitivity-study-1";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

Deno.test(
  "model.write-sensitivity-edges@1 re-reads the study capture before rendering SysML",
  async () => {
    const fixture = await createFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      const snapshot = await fixture.snapshots.getFresh(
        project.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      const artifact = snapshot?.artifacts.find((item) =>
        item.producer.tool === "model.write-sensitivity-edges@1"
      );
      assertEquals(artifact?.kind, "sysml-model");
      assertEquals(
        artifact?.uri?.startsWith(SENSITIVITY_EDGES_CAPTURE_URI_PREFIX),
        true,
      );
      const capture = JSON.parse(
        (await fixture.edgeCaptures.read(artifact!.fingerprint))!,
      );
      assertEquals(capture.sysml, fixture.expectedSysml);
      assertEquals(fixture.syson.inserted[0], fixture.expectedSysml);
      assertEquals(findArchitectureArtifactStillDistinct(snapshot!), true);
      assertEquals(fixture.capabilityRuntimeSession.releases, 1);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "model.write-sensitivity-edges@1 reopens an exact-reused scientific result",
  async () => {
    const fixture = await createFixture(true);
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]?.status, "completed");
      assertEquals(fixture.syson.inserted, [fixture.expectedSysml]);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "model.write-sensitivity-edges@1 rejects a study capture with extra keys",
  async () => {
    const fixture = await createFixture();
    try {
      if (!("cad" in fixture.studyCapture)) {
        throw new Error("fresh fixture unexpectedly returned a reused result");
      }
      const tampered = {
        ...fixture.studyCapture,
        cad: {
          ...fixture.studyCapture.cad,
          base: { ...fixture.studyCapture.cad.base, bytes: [1, 2, 3] },
        },
      };
      await fixture.studyCaptures.save(
        fixture.studyFingerprint,
        deterministicJson(tampered),
      );
      await assertRejects(
        () => fixture.executor.execute(AGENT, fixture.command),
        EngineeringProjectCommandError,
        "unsupported field bytes",
      );
      assertEquals(fixture.syson.inserted.length, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "a dispatched same-plan attempt resumes by verifying, never by a second insert",
  async () => {
    const fixture = await createFixture();
    try {
      // Simulate a prior crash between the provider insert and completion:
      // the WAL already holds the exact plan the executor will recompute.
      const planDigest = (await sha256Fingerprint({
        sysml: fixture.expectedSysml,
        parentElementId: "pkg-1",
        editingContextId: "ctx-1",
      })).digest;
      assertEquals(
        await fixture.attempts.begin({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          planDigest,
          dispatchedAt: AT,
        }),
        "dispatch",
      );
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]!.status, "completed");
      assertEquals(fixture.syson.inserted.length, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "a verify resume with an empty extraction fails labelled instead of publishing",
  async () => {
    const fixture = await createFixture();
    try {
      const planDigest = (await sha256Fingerprint({
        sysml: fixture.expectedSysml,
        parentElementId: "pkg-1",
        editingContextId: "ctx-1",
      })).digest;
      await fixture.attempts.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest,
        dispatchedAt: AT,
      });
      fixture.syson.extractResult = { constraints: [] };
      await assertRejects(
        () => fixture.executor.execute(AGENT, fixture.command),
        EngineeringProjectCommandError,
        "Re-extraction does not include",
      );
      assertEquals(fixture.syson.inserted.length, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "model.write-sensitivity-edges@1 refuses a human origin before any store access",
  async () => {
    const executor = new ModelWriteSensitivityEdgesRunExecutor({
      projects: { get: () => Promise.reject(new Error("must not read")) } as never,
      commands: {} as never,
      snapshots: {} as never,
      studyCaptures: {} as never,
      edgeCaptures: {} as never,
      syson: {} as never,
      resolveSysonContext: () => Promise.reject(new Error("must not read")),
      attempts: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(HUMAN, {
          commandId: "c",
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: AT,
          runId: RUN_ID,
        }),
      EngineeringProjectCommandError,
      "authenticated agent",
    );
  },
);

Deno.test(
  "model.write-sensitivity-edges@1 keeps the run queued when JIT activation fails",
  async () => {
    const capabilityRuntimeSession = recordingCapabilityRuntimeSession(() =>
      Promise.reject(new Error("exact SysON host group unavailable"))
    );
    const fixture = await createFixture(false, { capabilityRuntimeSession });
    try {
      await assertRejects(
        () => fixture.executor.execute(AGENT, fixture.command),
        Error,
        "host group unavailable",
      );
      assertEquals(capabilityRuntimeSession.events, ["begin"]);
      assertEquals(fixture.syson.inserted, []);
      assertEquals(fixture.commands.project.agentRuns[0]?.status, "queued");
    } finally {
      await fixture.dispose();
    }
  },
);

function findArchitectureArtifactStillDistinct(snapshot: ThreadSnapshot): boolean {
  const sensitivity = snapshot.artifacts.filter((item) =>
    item.uri?.startsWith(SENSITIVITY_EDGES_CAPTURE_URI_PREFIX)
  );
  const architecture = snapshot.artifacts.filter((item) =>
    item.uri?.startsWith("casys://architecture-capture/")
  );
  return sensitivity.length === 1 && architecture.length === 1;
}

async function createFixture(
  reuseResult = false,
  options: {
    readonly capabilityRuntimeSession?: ReturnType<
      typeof recordingCapabilityRuntimeSession
    >;
  } = {},
) {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-edges-" });
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV3(template, {
    artifactUri: `thread-artifact://${PROJECT_ID}/admission`,
    sha256: "a".repeat(64),
  });
  const base = [
    { metric: "assembly_max_displacement", value: 0.5, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 10, unit: "MPa" },
  ];
  const stepped = [
    { metric: "assembly_max_displacement", value: 1.5, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 8, unit: "MPa" },
  ];
  const derivatives = computeSensitivities(
    studyCase,
    new Map(base.map((item) => [item.metric, item])),
    new Map(stepped.map((item) => [item.metric, item])),
  );
  const freshStudyCapture = {
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "run.sensitivity",
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: "run.sensitivity:cad-base",
        sourceSha256: "1".repeat(64),
        stepSha256: "2".repeat(64),
        stepBytes: 4,
      },
      stepped: {
        executionRunId: "run.sensitivity:cad-stepped",
        sourceSha256: "3".repeat(64),
        stepSha256: "4".repeat(64),
        stepBytes: 4,
      },
    },
    measurements: { base, stepped },
    derivatives,
    capturedAt: AT,
  };
  const studyCapture = reuseResult
    ? await makeSensitivityStudyReuseResult({
      trustedRunId: "run.sensitivity",
      studyCase,
      record: { result: { measurements: { base, stepped }, derivatives } } as never,
      reuseReceiptFingerprint: {
        algorithm: "sha256",
        digest: "6".repeat(64),
      },
      capturedAt: AT,
    })
    : freshStudyCapture;
  const studyFingerprint = await sha256Fingerprint(studyCapture);
  const expectedEdges = sensitivityEdgesFromStudy(
    studyCase,
    new Map(base.map((item) => [item.metric, item])),
    new Map(stepped.map((item) => [item.metric, item])),
    { runId: "run.sensitivity", capturedAt: AT },
  );
  const expectedSysml = renderSensitivityEdgeSetSysml(
    sensitivityPartDefName(studyCase.id),
    expectedEdges,
  );
  const seed = {
    id: "seed-1",
    name: "Seed",
    kind: "sysml-model" as const,
    version: "1",
    fingerprint: { algorithm: "sha256" as const, digest: "e".repeat(64) },
    uri: `casys://syson-model-seed-capture/sha256/${"e".repeat(64)}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_model_create", runId: "run.seed" },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const architecture = {
    id: "arch-1",
    name: "Architecture",
    kind: "sysml-model" as const,
    version: "1",
    fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
    uri: `casys://architecture-capture/${"f".repeat(64)}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "model.write-architecture@1",
      runId: "run.arch",
    },
    inputArtifactIds: ["seed-1"],
    freshness: fresh(AT),
  };
  const studyArtifact = {
    id: STUDY_ID,
    name: "Study",
    kind: "evidence" as const,
    version: studyFingerprint.digest,
    fingerprint: studyFingerprint,
    uri: studyCapture.schemaVersion === SENSITIVITY_STUDY_CAPTURE_SCHEMA
      ? `casys://sensitivity-study-capture/sha256/${studyFingerprint.digest}`
      : `${SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX}${studyFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "analyze.run-fea-sensitivity@1",
      runId: "run.sensitivity",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.edges.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Edges fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.edges",
      name: "Edges",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.study",
        kind: "created",
        target: { kind: "artifact", id: STUDY_ID },
        summary: "Published the sensitivity study.",
        afterFingerprint: studyFingerprint,
      }],
    },
    artifacts: [
      {
        id: "artifact.brief",
        name: "Brief",
        kind: "document",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
        producer: {
          serverId: "digital-thread",
          tool: "baseline.from-approved-brief@1",
          runId: "run.brief",
        },
        inputArtifactIds: [],
        freshness: fresh(AT),
      },
      seed,
      architecture,
      studyArtifact,
    ],
    consumptions: [{
      id: "consume-seed-by-arch",
      artifactId: "seed-1",
      consumer: architecture.producer,
      observedFingerprint: seed.fingerprint,
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.study",
      relation: "changes",
      from: { kind: "change", id: "change.study" },
      to: { kind: "artifact", id: STUDY_ID },
      rationale: "The applied change introduced the study.",
    }, {
      id: "derived-from-seed-by-arch",
      relation: "derived_from",
      from: { kind: "artifact", id: "arch-1" },
      to: { kind: "artifact", id: "seed-1" },
      rationale: "Architecture consumes the seed.",
    }, {
      id: "uses-consume-seed-by-arch",
      relation: "uses",
      from: { kind: "consumption", id: "consume-seed-by-arch" },
      to: { kind: "artifact", id: "seed-1" },
      rationale: "Verified seed consumption.",
    }],
    proposedActions: [],
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const evidenceRef = {
    snapshotId: basisSnapshot.id,
    snapshotRevision: basisSnapshot.revision,
    kind: "artifact" as const,
    id: STUDY_ID,
  };
  const operation = {
    id: "model.write-sensitivity-edges",
    version: "1",
    bindings: [{
      name: "studyCapture",
      source: { kind: "thread-entity" as const, reference: evidenceRef },
    }],
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [evidenceRef],
    proposal: { summary: "Write edges", parameters: [] },
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Edges",
      subjectId: SUBJECT_ID,
      objective: { title: "Write", statement: "Write edges." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.architect",
      name: "Architect",
      order: 1,
      description: "Write edges.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.architect",
      title: "Write edges",
      description: "Insert edges.",
      kind: "architect",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued",
      summary: "Write edges.",
      queuedAt: AT,
      basis: { kind: "thread-snapshot", ...reviewBasis },
      inputFingerprint: await sha256Fingerprint({
        workItemId: WORK_ID,
        basis: { kind: "thread-snapshot", ...reviewBasis },
        operation,
        approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
      }),
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.architect",
      title: "Approve edges",
      question: "Insert edges?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary: "Write edges",
        parameters: [],
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: APPROVAL_ID,
      decisionId: DECISION_ID,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Go.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(basisSnapshot);
  const studyCaptures = new MemoryCaptures();
  await studyCaptures.save(studyFingerprint, deterministicJson(studyCapture));
  const edgeCaptures = new MemoryCaptures();
  const syson = new FakeSyson(expectedSysml);
  const commands = new MemoryCommands(project);
  const attempts = new FileSensitivityEdgesAttemptStore(`${directory}/wal`);
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
    MODEL_AUTHOR_SYSTEM_CAPABILITY.id,
  );
  const capabilityRuntimeSession = options.capabilityRuntimeSession ??
    capability.capabilityRuntimeSession;
  return {
    expectedSysml,
    studyCapture,
    studyFingerprint,
    studyCaptures,
    syson,
    commands,
    capabilityRuntimeSession,
    snapshots,
    edgeCaptures,
    command: {
      commandId: "command.edges",
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    executor: new ModelWriteSensitivityEdgesRunExecutor({
      projects: {
        get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
        getRevision: () =>
          Promise.resolve(project as unknown as EngineeringProjectSnapshot),
        createInitial: () => Promise.reject(new Error("unused")),
        commit: () => Promise.reject(new Error("unused")),
      } as EngineeringProjectRevisionStore,
      commands,
      snapshots,
      studyCaptures: studyCaptures as never,
      edgeCaptures: edgeCaptures as never,
      syson: syson as never,
      resolveSysonContext: () =>
        Promise.resolve({
          editingContextId: "ctx-1",
          parentElementId: "pkg-1",
        }),
      attempts,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
      capabilityRuntime: capability.capabilityRuntime,
      capabilityRuntimeSession,
    }),
    attempts,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

class FakeSyson {
  readonly inserted: string[] = [];
  extractResult: Record<string, unknown> | undefined;
  constructor(private readonly sysml: string) {}
  callTool(
    input: { readonly name: string; readonly arguments: Record<string, unknown> },
  ) {
    if (input.name === "syson_element_insert_sysml") {
      this.inserted.push(String(input.arguments.sysml_text));
      return Promise.resolve({ structuredContent: { ok: true } });
    }
    // The live provider rejects an extract without element_id; keep the fake
    // exactly as strict so a missing argument fails in unit tests first.
    if (typeof input.arguments.element_id !== "string") {
      return Promise.reject(
        new Error(
          "Invalid arguments for syson_constraint_extract: Missing required property: element_id",
        ),
      );
    }
    return Promise.resolve({
      structuredContent: this.extractResult ?? {
        featurePath: [
          "sizeZ_for_assembly_max_displacement",
          "sizeZ_for_assembly_max_von_mises",
        ],
      },
    });
  }
}

class MemorySnapshots {
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(id: string) {
    return Promise.resolve(this.#byId.get(id));
  }
  getFresh(id: string) {
    return this.get(id);
  }
  latest() {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class MemoryCaptures {
  readonly #byDigest = new Map<string, string>();
  save(fingerprint: ContentFingerprint, text: string) {
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({
      uri: `casys://sensitivity-edges-capture/sha256/${fingerprint.digest}`,
      path: `${fingerprint.digest}.json`,
    });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://sensitivity-edges-capture/sha256/${fingerprint.digest}`;
  }
}

type MutableProject = EngineeringProjectSnapshot & { revision: number };

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0] as unknown as {
      status: string;
      startedAt?: string;
      claimedBy?: { id: string; origin: "agent" };
    };
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: "agent" };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    (this.project.agentRuns[0] as { status: string }).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  completeRun(_origin: typeof AGENT, command: CompleteRunCommand) {
    const run = this.project.agentRuns[0] as unknown as {
      status: string;
      resultSnapshot?: CompleteRunCommand["resultSnapshot"];
      evidenceRefs: unknown[];
    };
    run.status = "completed";
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    if (
      !this.project.threadSnapshots.some((item) =>
        item.snapshotId === command.resultSnapshot.snapshotId
      )
    ) {
      (this.project as { threadSnapshots: unknown }).threadSnapshots = [
        ...this.project.threadSnapshots,
        command.resultSnapshot,
      ];
    }
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  failRun(_origin: typeof AGENT, _command: FailRunCommand) {
    (this.project.agentRuns[0] as { status: string }).status = "failed";
    return Promise.resolve(this.project);
  }
}
