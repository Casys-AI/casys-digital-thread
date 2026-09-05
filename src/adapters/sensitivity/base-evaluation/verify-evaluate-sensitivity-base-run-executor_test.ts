import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import { MODEL_EVALUATE_REQUIREMENT_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { computeSensitivities } from "../../../domain/sensitivity/study/sensitivity-study.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  type SensitivityStudyCapture,
} from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  makeSensitivityStudyReuseResult,
  SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX,
  type SensitivityStudyResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { VerifyEvaluateSensitivityBaseRunExecutor } from "./verify-evaluate-sensitivity-base-run-executor.ts";
import {
  recordingCapabilityRuntimeSession,
  successfulCapabilityRuntimeFor,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl05";
const SUBJECT_ID = "arm";
const RUN_ID = "run.evaluate-base";
const WORK_ID = "work.evaluate-base";
const DECISION_ID = "decision.evaluate-base";
const APPROVAL_ID = "approval.evaluate-base";
const COMMAND_ID = "command.evaluate-base";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

Deno.test("the executor refuses a human origin before any store access", async () => {
  const executor = new VerifyEvaluateSensitivityBaseRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read")) } as never,
    commands: {} as never,
    snapshots: {} as never,
    studyCaptures: {} as never,
    captures: {} as never,
    syson: { callTool: () => Promise.reject(new Error("must not call")) } as never,
    lease: {} as never,
  });
  await assertRejects(
    () =>
      executor.execute(HUMAN, {
        commandId: COMMAND_ID,
        projectId: PROJECT_ID,
        expectedRevision: 1,
        issuedAt: AT,
        runId: RUN_ID,
      }),
    EngineeringProjectCommandError,
    "authenticated agent",
  );
});

Deno.test(
  "a success publishes evaluations that cite sensitivity-base observation ids",
  async () => {
    const fixture = await createFixture();
    const project = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(project.agentRuns[0]?.status, "completed");
    const snapshot = await fixture.snapshots.get(
      project.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const added = snapshot!.evaluations.filter((item) =>
      !fixture.basis.evaluations.some((base) => base.id === item.id)
    );
    assertEquals(added.length, 2);
    assertEquals(
      added.every((item) =>
        item.observationIds[0]?.startsWith("sensitivity-base-") &&
        item.comparison?.observationId === item.observationIds[0]
      ),
      true,
    );
    assertEquals(fixture.capabilityRuntimeSession.releases, 1);
    assertEquals(added.map((item) => item.status).sort(), ["fail", "pass"]);
    assertEquals(
      snapshot!.violations.some((item) =>
        item.evaluationId === added.find((ev) => ev.status === "fail")?.id
      ),
      true,
    );
  },
);

Deno.test("the base evaluator reopens an exact-reused scientific result", async () => {
  const fixture = await createFixture({ reuseResult: true });
  const project = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(project.agentRuns[0]?.status, "completed");
  assertEquals(fixture.syson.calls, 1);
});

Deno.test("an unlinked study metric fails closed before SysON is called", async () => {
  const fixture = await createFixture({ dropRequirement: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "No Thread requirement names metric",
  );
  assertEquals(fixture.syson.calls, 0);
});

Deno.test("a SysON failure after claim fails the run and writes no Thread successor", async () => {
  const fixture = await createFixture({ sysonDown: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    Error,
    "syson unavailable",
  );
  assertEquals(fixture.syson.calls, 1);
  assertEquals(fixture.commands.project.agentRuns[0]?.status, "failed");
  assertEquals(fixture.snapshots.saved, 0);
  assertEquals(fixture.capabilityRuntimeSession.releases, 1);
});

Deno.test("the base evaluator keeps the run queued when JIT activation fails", async () => {
  const capabilityRuntimeSession = recordingCapabilityRuntimeSession(() =>
    Promise.reject(new Error("exact SysON host group unavailable"))
  );
  const fixture = await createFixture({ capabilityRuntimeSession });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    Error,
    "host group unavailable",
  );
  assertEquals(capabilityRuntimeSession.events, ["begin"]);
  assertEquals(fixture.syson.calls, 0);
  assertEquals(fixture.commands.project.agentRuns[0]?.status, "queued");
});

async function createFixture(
  options: {
    readonly dropRequirement?: boolean;
    readonly sysonDown?: boolean;
    readonly reuseResult?: boolean;
    readonly capabilityRuntimeSession?: ReturnType<
      typeof recordingCapabilityRuntimeSession
    >;
  } = {},
) {
  const world = await buildWorld(options);
  const operation = {
    id: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id,
    version: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version,
    bindings: [{
      name: "studyCapture",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: world.snapshot.id,
          snapshotRevision: world.snapshot.revision,
          kind: "artifact" as const,
          id: world.artifactId,
        },
      },
    }],
  };
  const runBasis = {
    kind: "thread-snapshot" as const,
    snapshotId: world.snapshot.id,
    revision: world.snapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runFingerprint = await sha256Fingerprint({
    operation,
    basis: runBasis,
  });
  const evidenceRefs = [{
    snapshotId: world.snapshot.id,
    snapshotRevision: world.snapshot.revision,
    kind: "artifact" as const,
    id: world.artifactId,
  }];
  const decisionFingerprint = await sha256Fingerprint({
    operation,
    evidenceRefs,
  });
  const project = {
    schemaVersion: "4.0",
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Evaluate fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Join", statement: "Evaluate study-base observations." },
    },
    threadSnapshots: [runBasis],
    phases: [{
      id: "phase.verify",
      name: "Verify",
      order: 1,
      description: "Evaluate.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.verify",
      title: "Evaluate study-base",
      description: "Join observations to requirements.",
      kind: "verify",
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
      summary: "Evaluate study-base.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.verify",
      title: "Approve study-base evaluation",
      question: "Evaluate the exact study-base observations?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: runBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: evidenceRefs,
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary: "Evaluate study-base.",
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
      rationale: "Reviewed the binding.",
      baseSnapshot: runBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: evidenceRefs,
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(world.snapshot);
  const syson = new MemorySyson(options.sysonDown === true);
  const commands = new MemoryCommands(project);
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
    MODEL_EVALUATE_REQUIREMENT_CAPABILITY.id,
  );
  const capabilityRuntimeSession = options.capabilityRuntimeSession ??
    capability.capabilityRuntimeSession;
  const projects = {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  } satisfies EngineeringProjectRevisionStore;
  return {
    basis: world.snapshot,
    syson,
    snapshots,
    commands,
    capabilityRuntimeSession,
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    executor: new VerifyEvaluateSensitivityBaseRunExecutor({
      projects,
      commands,
      snapshots,
      studyCaptures: new MemoryStudyCaptures(world.fingerprint, world.captureText),
      captures: new MemoryEvalCaptures(),
      syson,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
      capabilityRuntime: capability.capabilityRuntime,
      capabilityRuntimeSession,
    }),
  };
}

async function buildWorld(options: {
  readonly dropRequirement?: boolean;
  readonly reuseResult?: boolean;
}) {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl05-arm-thickness-isolated.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV3(template, {
    artifactUri: `thread-artifact://${PROJECT_ID}/admission`,
    sha256: "a".repeat(64),
  });
  const base = studyCase.metrics.map((metric, index) => ({
    metric: metric.id,
    value: index === 0 ? 1.2 : 6.04,
    unit: metric.unit,
  }));
  const stepped = studyCase.metrics.map((metric, index) => ({
    metric: metric.id,
    value: index === 0 ? 1.1 : 5,
    unit: metric.unit,
  }));
  const freshCapture: SensitivityStudyCapture = {
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
    derivatives: computeSensitivities(
      studyCase,
      new Map(base.map((item) => [item.metric, item])),
      new Map(stepped.map((item) => [item.metric, item])),
    ),
    capturedAt: AT,
  };
  const capture: SensitivityStudyResult = options.reuseResult
    ? await makeSensitivityStudyReuseResult({
      trustedRunId: "run.sensitivity",
      studyCase,
      record: {
        result: {
          measurements: { base, stepped },
          derivatives: freshCapture.derivatives,
        },
      } as never,
      reuseReceiptFingerprint: {
        algorithm: "sha256",
        digest: "6".repeat(64),
      },
      capturedAt: AT,
    })
    : freshCapture;
  const fingerprint = await sha256Fingerprint(capture);
  const artifactId = `sensitivity-study-${fingerprint.digest}`;
  const briefId = "artifact.brief";
  const requirementsArtifactId = "requirements-fixture";
  const requirements = studyCase.metrics.map((metric, index) => ({
    id: `requirement-fixture-${metric.id}`,
    name: metric.id,
    statement: metric.id,
    version: "1",
    criterion: {
      metric: metric.id,
      operator: "<=" as const,
      limit: {
        value: index === 0 ? 1 : 60_000_000,
        unit: index === 0 ? "mm" : "Pa",
      },
    },
    trace: {
      sourceArtifactId: requirementsArtifactId,
      elementId: "el-1",
      targetArtifactIds: [briefId],
    },
    freshness: fresh(),
  }));
  const keptRequirements = options.dropRequirement
    ? requirements.slice(0, 1)
    : requirements;
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.evaluate.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Arm",
      kind: "part",
      version: "r1",
      modelArtifactId: briefId,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.study",
      name: "Study",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [
        change("change.brief", briefId, {
          algorithm: "sha256",
          digest: "1".repeat(64),
        }),
        change("change.study", artifactId, fingerprint),
        change("change.requirements", requirementsArtifactId, {
          algorithm: "sha256",
          digest: "5".repeat(64),
        }),
      ],
    },
    artifacts: [
      {
        id: briefId,
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
        freshness: fresh(),
      },
      {
        id: requirementsArtifactId,
        name: "Requirements",
        kind: "document",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "5".repeat(64) },
        producer: {
          serverId: "digital-thread",
          tool: "model.write-requirements@1",
          runId: "run.req",
        },
        inputArtifactIds: [],
        freshness: fresh(),
      },
      {
        id: artifactId,
        name: "Sensitivity study",
        kind: "evidence",
        version: fingerprint.digest,
        fingerprint,
        uri: capture.schemaVersion === SENSITIVITY_STUDY_CAPTURE_SCHEMA
          ? `casys://sensitivity-study-capture/sha256/${fingerprint.digest}`
          : `${SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX}${fingerprint.digest}`,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: "analyze.run-fea-sensitivity@1",
          runId: "run.sensitivity",
        },
        inputArtifactIds: [briefId],
        freshness: fresh(),
      },
    ],
    consumptions: [{
      id: `consume-${briefId}-by-${artifactId}`,
      artifactId: briefId,
      consumer: {
        serverId: "digital-thread",
        tool: "analyze.run-fea-sensitivity@1",
        runId: "run.sensitivity",
      },
      observedFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      verifiedAt: AT,
      status: "verified",
    }],
    observations: base.map((item) => ({
      id: `sensitivity-base-${item.metric}-${fingerprint.digest}`,
      name: `${item.metric} at base`,
      metric: item.metric,
      quantity: { value: item.value, unit: item.unit },
      source: {
        operation: {
          serverId: "digital-thread",
          tool: "analyze.run-fea-sensitivity@1",
          runId: "run.sensitivity",
        },
        artifactIds: [artifactId],
        capturedAt: AT,
      },
      freshness: fresh(),
    })),
    requirements: keptRequirements,
    evaluations: [],
    violations: [],
    provenance: [
      link("changes", "change", "change.brief", "artifact", briefId),
      link("changes", "change", "change.study", "artifact", artifactId),
      link(
        "changes",
        "change",
        "change.requirements",
        "artifact",
        requirementsArtifactId,
      ),
      link(
        "uses",
        "consumption",
        `consume-${briefId}-by-${artifactId}`,
        "artifact",
        briefId,
      ),
      link("derived_from", "artifact", artifactId, "artifact", briefId),
      ...base.map((item) =>
        link(
          "derived_from",
          "observation",
          `sensitivity-base-${item.metric}-${fingerprint.digest}`,
          "artifact",
          artifactId,
        )
      ),
      ...keptRequirements.map((requirement) =>
        link("traces_to", "requirement", requirement.id, "artifact", briefId)
      ),
    ],
    proposedActions: [],
  });
  return {
    snapshot,
    captureText: deterministicJson(capture),
    fingerprint,
    artifactId,
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function change(id: string, artifactId: string, fingerprint: ContentFingerprint) {
  return {
    id,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifactId },
    summary: `Created ${artifactId}.`,
    afterFingerprint: fingerprint,
  };
}

function link(
  relation: "changes" | "uses" | "derived_from" | "traces_to",
  fromKind: "change" | "consumption" | "artifact" | "observation" | "requirement",
  fromId: string,
  toKind: "artifact",
  toId: string,
) {
  return {
    id: `${relation}:${fromKind}:${fromId}->${toKind}:${toId}`,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: `${relation} link`,
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  commandReceipts: unknown[];
};

class MemorySnapshots {
  saved = 0;
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(snapshotId: string) {
    return Promise.resolve(this.#byId.get(snapshotId));
  }
  latest(_subjectId: string) {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
    this.saved += 1;
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class MemoryStudyCaptures {
  constructor(
    private readonly fingerprint: ContentFingerprint,
    private readonly text: string,
  ) {}
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(
      fingerprint.digest === this.fingerprint.digest ? this.text : undefined,
    );
  }
}

class MemoryEvalCaptures {
  readonly #byDigest = new Map<string, string>();
  save(fingerprint: ContentFingerprint, text: string) {
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({ uri: this.uriFor(fingerprint) });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://sensitivity-base-evaluation-capture/sha256/${fingerprint.digest}`;
  }
}

class MemorySyson {
  calls = 0;
  constructor(private readonly down = false) {}
  callTool(call: { name: string; arguments?: Readonly<Record<string, unknown>> }) {
    this.calls += 1;
    if (this.down) return Promise.reject(new Error("syson unavailable"));
    const constraints = call.arguments?.constraints as readonly {
      id: string;
      expression: {
        left: { featurePath: readonly string[] };
        right: { value: number; unit: string };
      };
    }[];
    const values = call.arguments?.values as Record<
      string,
      { value: number; unit: string }
    >;
    return Promise.resolve({
      structuredContent: {
        results: constraints.map((constraint) => {
          const feature = constraint.expression.left.featurePath[0]!;
          const observed = values[feature]!;
          const limit = constraint.expression.right.value;
          const unit = constraint.expression.right.unit;
          const actual = observed.unit === "MPa" && unit === "Pa"
            ? observed.value * 1_000_000
            : observed.value;
          const fail = actual > limit;
          return {
            constraintId: constraint.id,
            status: fail ? "fail" : "pass",
            computedValue: actual,
            threshold: limit,
            margin: limit - actual,
            marginPercent: ((limit - actual) / limit) * 100,
            unit,
          };
        }),
      },
      text: "ok",
    });
  }
  callToolTextResult() {
    return Promise.reject(new Error("unused"));
  }
}

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0]!;
    if (run.status === "queued") {
      (run as { status: string }).status = "running";
      (run as { startedAt?: string }).startedAt = AT;
      (run as { claimedAt?: string }).claimedAt = AT;
      (run as { claimedBy?: { id: string; origin: "agent" } }).claimedBy = {
        id: origin.actorId,
        origin: "agent",
      };
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
      completedAt?: string;
      resultSnapshot?: CompleteRunCommand["resultSnapshot"];
      evidenceRefs: unknown[];
    };
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  failRun(_origin: typeof AGENT, command: FailRunCommand) {
    (this.project.agentRuns[0] as { status: string }).status = "failed";
    (this.project.agentRuns[0] as { failure?: unknown }).failure = {
      code: command.code,
      message: command.message,
    };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}
