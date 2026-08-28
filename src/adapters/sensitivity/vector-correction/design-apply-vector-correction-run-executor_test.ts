import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { assembleVectorCorrectionDecision } from "../../../domain/sensitivity/vector-correction/vector-correction-assembly.ts";
import {
  DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
  encodeVectorCorrectionDecisionParameters,
} from "../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
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
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  type SensitivityStudyCapture,
} from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  makeSensitivityStudyReuseResult,
  SENSITIVITY_STUDY_REUSE_ARTIFACT_ID_PREFIX,
  SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX,
  type SensitivityStudyResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import { reconstructSensitivityEdgesFromStudyCapture } from "../../../domain/sensitivity/edges/sensitivity-edge-from-study.ts";
import {
  DesignApplyVectorCorrectionRunExecutor,
} from "./design-apply-vector-correction-run-executor.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl04";
const SUBJECT_ID = "lamp-arm";
const RUN_ID = "run.vector-correction";
const WORK_ID = "work.vector-correction";
const DECISION_ID = "decision.vector-correction";
const APPROVAL_ID = "approval.vector-correction";
const COMMAND_ID = "command.vector-correction";
const METRIC = "assembly_max_displacement";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

Deno.test(
  "un succès publie un document correction-proposal-capture/1.0 sans observation, évaluation, violation, ni artefact SysON",
  async () => {
    const fixture = await createFixture();
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "design.apply-vector-correction@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(
      sealed?.[0]?.uri?.startsWith("casys://correction-proposal-capture/sha256/"),
      true,
    );
    const capture = JSON.parse(
      (await fixture.captures.read(sealed![0]!.fingerprint))!,
    );
    assertEquals(capture.schemaVersion, "correction-proposal-capture/1.0");
    assertEquals(capture.grants, "none");
    const addedObservations = snapshot!.observations.filter((item) =>
      !fixture.basisSnapshot.observations.some((base) => base.id === item.id)
    );
    const addedEvaluations = snapshot!.evaluations.filter((item) =>
      !fixture.basisSnapshot.evaluations.some((base) => base.id === item.id)
    );
    const addedViolations = snapshot!.violations.filter((item) =>
      !fixture.basisSnapshot.violations.some((base) => base.id === item.id)
    );
    assertEquals(addedObservations, []);
    assertEquals(addedEvaluations, []);
    assertEquals(addedViolations, []);
    assertEquals(
      snapshot!.artifacts.some((item) => item.kind === "sysml-model"),
      false,
    );
  },
);

Deno.test("vector correction reopens an exact-reused scientific result", async () => {
  const fixture = await createFixture({ reuseResult: true });
  const project = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(project.agentRuns[0]?.status, "completed");
  assertEquals(fixture.captures.saved.length, 1);
});

Deno.test(
  "the executor refuses a human origin before any store access",
  async () => {
    const executor = new DesignApplyVectorCorrectionRunExecutor({
      projects: { get: () => Promise.reject(new Error("must not read")) } as never,
      commands: {} as never,
      snapshots: {} as never,
      studyCaptures: {} as never,
      captures: {} as never,
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
  },
);

Deno.test(
  "l'executor relit la study capture par fingerprint avant tout calcul ; un digest divergent échoue avant publication",
  async () => {
    const fixture = await createFixture({ divergeStudyBytes: true });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "parameter_mismatch",
    );
    assertEquals(fixture.captures.saved.length, 0);
  },
);

Deno.test(
  "les paramètres signés qui ne Object.is-matchent pas le recalcul sont parameter_mismatch ; rien n'est publié",
  async () => {
    const fixture = await createFixture({ driverCurrent: 50.5 });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "parameter_mismatch",
    );
    assertEquals(fixture.captures.saved.length, 0);
  },
);

Deno.test("l'executor n'importe aucun client MCP provider", async () => {
  const text = await Deno.readTextFile(
    new URL("./design-apply-vector-correction-run-executor.ts", import.meta.url),
  );
  assertEquals(text.includes("HttpMcpToolClient"), false);
  assertEquals(text.includes("mcp-tool-client"), false);
  assertEquals(text.includes("callTool"), false);
});

Deno.test("model.write-sensitivity-edges@1 n'est pas une dépendance de queue", async () => {
  const text = await Deno.readTextFile(
    new URL("./design-apply-vector-correction-run-executor.ts", import.meta.url),
  );
  assertEquals(text.includes("write-sensitivity-edges"), false);
  assertEquals(text.includes("MODEL_WRITE_SENSITIVITY_EDGES"), false);
});

async function createFixture(options: {
  readonly divergeStudyBytes?: boolean;
  readonly driverCurrent?: number;
  readonly reuseResult?: boolean;
} = {}) {
  const world = await buildWorld(options.reuseResult === true);
  const assembled = assembleVectorCorrectionDecision({
    evaluation: world.snapshot.evaluations[0]!,
    requirement: world.snapshot.requirements[0],
    observations: world.snapshot.observations,
    study: {
      digest: world.fingerprint.digest,
      baseValue: world.capture.studyCase.baseValue,
      metrics: world.capture.studyCase.metrics,
      baseMeasurements: world.capture.measurements.base,
    },
    studyCapture: {
      artifactId: world.artifactId,
      fingerprint: world.fingerprint,
    },
    edges: reconstructSensitivityEdgesFromStudyCapture(world.capture),
    caseDigest: world.capture.caseDigest,
  });
  if (assembled.status !== "proposed") {
    throw new Error(`fixture assemble failed: ${assembled.reason}`);
  }
  const decision = options.driverCurrent === undefined ? assembled.decision : {
    ...assembled.decision,
    driver: {
      ...assembled.decision.driver,
      current: {
        value: options.driverCurrent,
        unit: assembled.decision.driver.current.unit,
      },
    },
  };
  const parameters = encodeVectorCorrectionDecisionParameters(decision);
  const reviewBasis = {
    snapshotId: world.snapshot.id,
    revision: world.snapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    id: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id,
    version: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version,
    bindings: [
      {
        name: "failingEvaluation",
        source: {
          kind: "thread-entity" as const,
          reference: {
            snapshotId: world.snapshot.id,
            snapshotRevision: world.snapshot.revision,
            kind: "evaluation" as const,
            id: world.evaluationId,
          },
        },
      },
      {
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
      },
    ],
  };
  const summary = "Seal the reviewed vector correction.";
  const evidenceRefs = [
    operation.bindings[0]!.source.reference,
    operation.bindings[1]!.source.reference,
  ];
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: evidenceRefs,
    proposal: { summary, parameters },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Vector fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Correct", statement: "Seal a bounded correction." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.design",
      name: "Design",
      order: 1,
      description: "Seal the correction.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.design",
      title: "Seal vector correction",
      description: "Seal the reviewed correction.",
      kind: "design",
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
      summary: "Seal vector correction.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.design",
      title: "Approve vector correction",
      question: "Seal the exact correction proposal?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: evidenceRefs,
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters,
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
      rationale: "Reviewed the scalars.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: evidenceRefs,
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(world.snapshot);
  const studyCaptures = new MemoryStudyCaptures(
    world.fingerprint,
    options.divergeStudyBytes
      ? deterministicJson({
        ...world.capture,
        trustedRunId: "run.sensitivity-forged",
      })
      : world.captureText,
  );
  const captures = new MemoryCorrectionCaptures();
  const commands = new MemoryCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    basisSnapshot: world.snapshot,
    captures,
    snapshots,
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    executor: new DesignApplyVectorCorrectionRunExecutor({
      projects,
      commands,
      snapshots,
      studyCaptures,
      captures,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
  };
}

async function buildWorld(reuseResult = false) {
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
    { metric: "assembly_max_displacement", value: 1.004, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 10, unit: "MPa" },
  ];
  const stepped = [
    { metric: "assembly_max_displacement", value: 0.996, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 8, unit: "MPa" },
  ];
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
  const capture: SensitivityStudyResult = reuseResult
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
  const artifactId = reuseResult
    ? `${SENSITIVITY_STUDY_REUSE_ARTIFACT_ID_PREFIX}${fingerprint.digest}`
    : `sensitivity-study-${fingerprint.digest}`;
  const observationId = `sensitivity-base-${METRIC}-${fingerprint.digest}`;
  const evaluationId = "eval:disp";
  const requirementId = "req:disp";
  const briefId = "artifact.brief";
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.vector.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Lamp arm",
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
    observations: [{
      id: observationId,
      name: `${METRIC} at base`,
      metric: METRIC,
      quantity: { value: 1.004, unit: "mm" },
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
    }],
    requirements: [{
      id: requirementId,
      name: "Displacement limit",
      statement: "Stay under 1 mm",
      version: "1",
      criterion: { metric: METRIC, operator: "<=", limit: { value: 1, unit: "mm" } },
      trace: {
        sourceArtifactId: briefId,
        elementId: "el.disp",
        targetArtifactIds: [briefId],
      },
      freshness: fresh(),
    }],
    evaluations: [{
      id: evaluationId,
      name: "Failing displacement",
      requirementId,
      observationIds: [observationId],
      status: "fail",
      evaluatedAt: AT,
      evaluator: { serverId: "test", tool: "test", runId: "run.eval" },
      comparison: {
        observationId,
        actual: { value: 1.004, unit: "mm" },
        operator: "<=",
        limit: { value: 1, unit: "mm" },
        normalizedUnit: "mm",
      },
      evidenceArtifactIds: [],
      message: "Fails",
      freshness: fresh(),
    }],
    violations: [{
      id: "violation:disp",
      name: "Displacement exceeds limit",
      requirementId,
      evaluationId,
      severity: "error",
      status: "open",
      detectedAt: AT,
      observationIds: [observationId],
      evidenceArtifactIds: [],
      summary: "The study-base displacement exceeds 1 mm.",
      freshness: fresh(),
    }],
    provenance: [
      link("changes", "change", "change.brief", "artifact", briefId),
      link("changes", "change", "change.study", "artifact", artifactId),
      link(
        "uses",
        "consumption",
        `consume-${briefId}-by-${artifactId}`,
        "artifact",
        briefId,
      ),
      link("derived_from", "artifact", artifactId, "artifact", briefId),
      link("derived_from", "observation", observationId, "artifact", artifactId),
      link("traces_to", "requirement", requirementId, "artifact", briefId),
      link("evaluates", "evaluation", evaluationId, "requirement", requirementId),
      link("uses", "evaluation", evaluationId, "observation", observationId),
      link("caused_by", "violation", "violation:disp", "evaluation", evaluationId),
      link("addresses", "action", "action:review-disp", "violation", "violation:disp"),
    ],
    proposedActions: [{
      id: "action:review-disp",
      name: "Review the displacement failure",
      kind: "review",
      readiness: "ready",
      rationale: "Review the failing evaluation.",
      targets: [{ kind: "evaluation", id: evaluationId }],
      addressesViolationIds: ["violation:disp"],
      dependsOnActionIds: [],
    }],
  });
  return {
    snapshot,
    capture,
    captureText: deterministicJson(capture),
    fingerprint,
    artifactId,
    evaluationId,
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
  relation:
    | "changes"
    | "uses"
    | "derived_from"
    | "traces_to"
    | "evaluates"
    | "caused_by"
    | "addresses",
  fromKind:
    | "change"
    | "consumption"
    | "artifact"
    | "observation"
    | "requirement"
    | "evaluation"
    | "violation"
    | "action",
  fromId: string,
  toKind: "artifact" | "requirement" | "observation" | "evaluation" | "violation",
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
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(snapshotId: string) {
    return Promise.resolve(this.#byId.get(snapshotId));
  }
  getFresh(snapshotId: string) {
    return this.get(snapshotId);
  }
  latest(_subjectId: string) {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
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
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://sensitivity-study-capture/sha256/${fingerprint.digest}`;
  }
}

class MemoryCorrectionCaptures {
  readonly saved: ContentFingerprint[] = [];
  readonly #byDigest = new Map<string, string>();
  save(fingerprint: ContentFingerprint, text: string) {
    this.saved.push(fingerprint);
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({
      uri: this.uriFor(fingerprint),
      path: `${fingerprint.digest}.json`,
    });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://correction-proposal-capture/sha256/${fingerprint.digest}`;
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
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.complete",
      actor: { id: AGENT.actorId, origin: "agent" },
      issuedAt: command.issuedAt,
    });
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
