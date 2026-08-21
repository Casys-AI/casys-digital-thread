import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  McpToolCall,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { AdmittedObservationEvidenceReader } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  admittedModelicaUnitIdentityPolicy,
  deriveAdmittedObservationEvaluationMethod,
  fingerprintAdmittedObservationEvaluationMethod,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import { encodeAdmittedObservationEvaluationAdmission } from "../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
  type ModelicaThermalMethodSheet,
  validateModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
import { MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA } from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  thermalMethodSheetUri,
  validateModelicaThermalMethodSheetSealCapture,
} from "../thermal-method-sheet/thermal-method-sheet-seal-capture.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  canonicalAdmittedObservationEvaluationCaptureText,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";
import { FileAdmittedObservationEvaluationAttemptStore } from "./file-admitted-observation-evaluation-attempt-store.ts";
import {
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
  VerifyEvaluateAdmittedModelicaObservationsRunExecutor,
} from "./verify-evaluate-admitted-modelica-observations-run-executor.ts";

const AT = "2026-08-21T12:00:00.000Z";
const RETRY_AT = "2026-08-21T13:00:00.000Z";
const PROJECT_ID = "articulated-led-desk-lamp";
const SUBJECT_ID = "articulated-led-desk-lamp";
const RUN_ID = "run.evaluate-observations";
const WORK_ID = "work.evaluate-observations";
const DECISION_ID = "decision.evaluate-observations";
const APPROVAL_ID = "approval.evaluate-observations";
const COMMAND_ID = "command.evaluate-observations";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const ADMITTED_RUN_ID = "run.admitted";
const EVIDENCE_DIGEST = "c".repeat(64);
const CAPTURE_DIGEST = "a".repeat(64);
const RESULT_DIGEST = "b".repeat(64);
const CLAIM_SUMMARY = "Started the admitted Modelica observation evaluation.";
const OBSERVATION_ID = `modelica-admitted-placeholder-output-final-${ADMITTED_RUN_ID}`;

Deno.test(
  "evaluate-admitted-modelica-observations writes unresolved evaluations without a local fail",
  async () => {
    const fixture = await executeFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      const run = project.agentRuns[0]!;
      assertEquals(run.status, "completed");
      const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
      const sealed = snapshot?.artifacts.filter((item) =>
        item.producer.tool ===
          "verify.evaluate-admitted-modelica-observations@1"
      );
      assertEquals(sealed?.length, 1);
      assertEquals(sealed?.[0]?.kind, "document");
      assertEquals(
        snapshot?.evaluations.every((item) => item.status === "unresolved"),
        true,
      );
      assertEquals(snapshot?.violations.length, 0);
      assertEquals(fixture.syson.calls.length, 1);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations refuses a non-agent origin",
  async () => {
    const fixture = await executeFixture();
    try {
      await assertRejects(
        () => fixture.executor.execute(HUMAN, fixture.command),
        EngineeringProjectCommandError,
        "authenticated agent",
      );
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations refuses stale or foreign approval and basis",
  async () => {
    const cases: Array<{
      readonly name: string;
      readonly mutate: (project: MutableProject) => void;
      readonly message: string;
    }> = [
      {
        name: "foreign approval subject",
        mutate: (project) => {
          const approval = project.approvals[0] as {
            baseSnapshot: { subjectId: string };
          };
          approval.baseSnapshot = {
            ...approval.baseSnapshot,
            subjectId: "foreign-subject",
          };
        },
        message: "No exact human-approved",
      },
      {
        name: "stale decision revision",
        mutate: (project) => {
          const decision = project.decisions[0] as {
            baseSnapshot: { revision: number };
          };
          decision.baseSnapshot = {
            ...decision.baseSnapshot,
            revision: 99,
          };
        },
        message: "No exact human-approved",
      },
      {
        name: "agent self-approval",
        mutate: (project) => {
          const approval = project.approvals[0] as {
            decidedByOrigin: string;
          };
          approval.decidedByOrigin = "agent";
        },
        message: "No exact human-approved",
      },
      {
        name: "tampered decision fingerprint",
        mutate: (project) => {
          const decision = project.decisions[0] as {
            inputFingerprint: { algorithm: "sha256"; digest: string };
          };
          decision.inputFingerprint = {
            algorithm: "sha256",
            digest: "f".repeat(64),
          };
          const approval = project.approvals[0] as {
            inputFingerprint: { algorithm: "sha256"; digest: string };
          };
          approval.inputFingerprint = decision.inputFingerprint;
        },
        message: "decision fingerprint no longer seals",
      },
      {
        name: "tampered run input fingerprint",
        mutate: (project) => {
          const run = project.agentRuns[0] as {
            inputFingerprint: { algorithm: "sha256"; digest: string };
          };
          run.inputFingerprint = {
            algorithm: "sha256",
            digest: "e".repeat(64),
          };
        },
        message: "run fingerprint no longer seals",
      },
    ];
    for (const testCase of cases) {
      const fixture = await executeFixture();
      try {
        testCase.mutate(fixture.project);
        await assertRejects(
          () => fixture.executor.execute(AGENT, fixture.command),
          EngineeringProjectCommandError,
          testCase.message,
        );
        assertEquals(fixture.syson.calls.length, 0, testCase.name);
      } finally {
        await fixture.dispose();
      }
    }
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations resumes a completed WAL while running or publishing without a new SysON call",
  async () => {
    const capture = validateAdmittedObservationEvaluationCapture({
      schemaVersion: "modelica-admitted-observation-evaluation-capture/1.0",
      kind: "modelica-admitted-observation-evaluation",
      operation: {
        id: "verify.evaluate-admitted-modelica-observations",
        version: "1",
      },
      request: {
        name: "syson_constraint_evaluate",
        arguments: { constraints: [], values: {} },
      },
      response: {
        structuredContent: {
          results: [{
            constraintId: "placeholder-requirement",
            status: "unresolved",
          }],
        },
      },
      unresolved: [],
    });
    const captureText = canonicalAdmittedObservationEvaluationCaptureText(
      capture,
    );
    const captureFingerprint = await sha256Fingerprint(capture);

    const running = await executeFixture({ runStatus: "running" });
    try {
      await seedCompletedWal(running, captureText, captureFingerprint);
      const project = await running.executor.execute(
        AGENT,
        retryCommand(running.project.revision),
      );
      assertEquals(project.agentRuns[0]?.status, "completed");
      assertEquals(running.syson.calls.length, 0, "running");
      assertEquals(
        (project.commandReceipts ?? []).filter((item) =>
          item.type === "agent-run.claim"
        ).length,
        1,
      );
      const snapshot = await running.snapshots.getFresh(
        project.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      assertEquals(
        snapshot?.evaluations.every((item) => item.status === "unresolved"),
        true,
      );
      assertEquals(
        snapshot?.artifacts.some((item) =>
          item.id ===
            `modelica-admitted-observation-evaluation-${captureFingerprint.digest}`
        ),
        true,
      );
    } finally {
      await running.dispose();
    }

    const publishing = await executeFixture({ losePublishAck: true });
    try {
      await seedCompletedWal(publishing, captureText, captureFingerprint);
      await assertRejects(
        () => publishing.executor.execute(AGENT, publishing.command),
        Error,
        "publish acknowledgement lost",
      );
      assertEquals(publishing.project.agentRuns[0]?.status, "publishing");
      const publishCount = publishing.project.commandReceipts.filter((item) =>
        item.type === "agent-run.publish"
      ).length;
      assertEquals(publishCount, 1);
      const saveCalls = publishing.snapshots.saveCalls;
      const project = await publishing.executor.execute(
        AGENT,
        retryCommand(publishing.project.revision),
      );
      assertEquals(project.agentRuns[0]?.status, "completed");
      assertEquals(publishing.syson.calls.length, 0, "publishing");
      assertEquals(
        publishing.project.commandReceipts.filter((item) =>
          item.type === "agent-run.publish"
        ).length,
        publishCount,
      );
      assertEquals(publishing.snapshots.saveCalls, saveCalls);
      assertEquals(
        (project.commandReceipts ?? []).filter((item) =>
          item.type === "agent-run.claim"
        ).length,
        1,
      );
    } finally {
      await publishing.dispose();
    }
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations refuses a unique foreign method-sheet seal",
  async () => {
    const fixture = await executeFixture({ methodSheet: "foreign" });
    try {
      await assertRejects(
        () => fixture.executor.execute(AGENT, fixture.command),
        EngineeringProjectCommandError,
        "not the signed admission",
      );
      assertEquals(fixture.syson.calls.length, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations successor consumes the admitted run, method sheet, evidence, result and capture",
  async () => {
    const fixture = await executeFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      const snapshot = await fixture.snapshots.getFresh(
        project.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      const evaluationArtifact = snapshot?.artifacts.find((item) =>
        item.producer.tool === "verify.evaluate-admitted-modelica-observations@1"
      );
      const sourceIds = [
        `modelica-thermal-method-sheet-seal-${fixture.sheetSealDigest}`,
        `modelica-admitted-capture-${CAPTURE_DIGEST}`,
        `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
        `modelica-admitted-result-${RESULT_DIGEST}`,
      ];
      assertEquals(evaluationArtifact?.inputArtifactIds, sourceIds);
      assertEquals(
        sourceIds.every((id) =>
          snapshot?.consumptions.some((consumption) =>
            consumption.artifactId === id &&
            consumption.status === "verified" &&
            consumption.observedFingerprint.digest === id.split("-").at(-1) &&
            snapshot.provenance.some((link) =>
              link.relation === "uses" &&
              link.from.kind === "consumption" &&
              link.from.id === consumption.id &&
              link.to.kind === "artifact" &&
              link.to.id === id
            )
          )
        ),
        true,
      );
      assertEquals(
        sourceIds.every((id) =>
          snapshot?.provenance.some((link) =>
            link.relation === "derived_from" &&
            link.from.kind === "artifact" &&
            link.from.id === evaluationArtifact?.id &&
            link.to.kind === "artifact" &&
            link.to.id === id
          )
        ),
        true,
      );
      assertEquals(
        snapshot?.evaluations.every((item) =>
          item.observationIds[0] === OBSERVATION_ID &&
          item.status === "unresolved" &&
          snapshot.provenance.some((link) =>
            link.relation === "uses" &&
            link.from.kind === "evaluation" &&
            link.from.id === item.id &&
            link.to.kind === "observation" &&
            link.to.id === OBSERVATION_ID
          )
        ),
        true,
      );
      assertEquals(
        snapshot?.observations.filter((item) => item.id === OBSERVATION_ID)
          .length,
        1,
      );
      assertEquals(snapshot?.violations.length, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations WAL refuses replay of an unknown dispatch",
  async () => {
    const fixture = await executeFixture();
    try {
      await fixture.attempts.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        dispatchedAt: AT,
      });
      await assertRejects(
        () => fixture.executor.execute(AGENT, fixture.command),
        Error,
        "unknown",
      );
      assertEquals(fixture.syson.calls.length, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

async function executeFixture(
  options: {
    readonly runStatus?: "queued" | "running";
    readonly losePublishAck?: boolean;
    readonly methodSheet?: "matching" | "foreign";
  } = {},
) {
  const directory = await Deno.makeTempDir({
    prefix: "evaluate-admitted-modelica-",
  });
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  const visibleSheet = options.methodSheet === "foreign"
    ? validateModelicaThermalMethodSheet({
      ...validThermalMethodSheetPlaceholder(),
      id: "foreign-thermal-method-sheet",
    })
    : sheet;
  const visibleSheetFingerprint = options.methodSheet === "foreign"
    ? await fingerprintModelicaThermalMethodSheet(visibleSheet)
    : sheetFingerprint;
  const sheetCaptures = new ExecuteMemoryCaptures();
  const sheetSeal = await persistMethodSheetSeal(
    sheetCaptures,
    visibleSheet,
    visibleSheetFingerprint,
  );
  const method = deriveAdmittedObservationEvaluationMethod(
    sheet,
    await admittedModelicaUnitIdentityPolicy(),
  );
  const methodFingerprint = await fingerprintAdmittedObservationEvaluationMethod(
    method,
  );
  const evidenceFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: EVIDENCE_DIGEST,
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "placeholder-thread-snapshot",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Evaluation fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Recorded the documentary brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts: [{
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
    }, {
      id: `modelica-thermal-method-sheet-seal-${sheetSeal.fingerprint.digest}`,
      name: "Modelica thermal method sheet",
      kind: "document",
      version: sheetSeal.fingerprint.digest,
      fingerprint: sheetSeal.fingerprint,
      uri:
        `${MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${sheetSeal.fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.seal-modelica-thermal-method-sheet@1",
        runId: "run.seal-sheet",
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }, {
      id: `modelica-admitted-capture-${CAPTURE_DIGEST}`,
      name: "Admitted Modelica execution capture",
      kind: "document",
      version: CAPTURE_DIGEST,
      fingerprint: { algorithm: "sha256", digest: CAPTURE_DIGEST },
      uri: `casys://modelica-admitted-execution-capture/sha256/${CAPTURE_DIGEST}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-modelica@1",
        runId: ADMITTED_RUN_ID,
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }, {
      id: `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
      name: "Admitted evidence",
      kind: "evidence",
      version: EVIDENCE_DIGEST,
      fingerprint: evidenceFingerprint,
      uri: `casys://isolated-output/sha256/${EVIDENCE_DIGEST}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-modelica@1",
        runId: ADMITTED_RUN_ID,
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }, {
      id: `modelica-admitted-result-${RESULT_DIGEST}`,
      name: "Admitted OpenModelica result",
      kind: "solver-result",
      version: RESULT_DIGEST,
      fingerprint: { algorithm: "sha256", digest: RESULT_DIGEST },
      uri: `casys://isolated-output/sha256/${RESULT_DIGEST}`,
      mediaType: "text/csv",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-modelica@1",
        runId: ADMITTED_RUN_ID,
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }],
    consumptions: [],
    observations: [{
      id: OBSERVATION_ID,
      name: "Admitted Modelica placeholder-output final",
      metric: "placeholder-output.final",
      quantity: { value: 0, unit: "unit-pending-source" },
      source: {
        operation: {
          serverId: "digital-thread",
          tool: "simulate.run-admitted-modelica@1",
          runId: ADMITTED_RUN_ID,
        },
        artifactIds: [
          `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
          `modelica-admitted-result-${RESULT_DIGEST}`,
        ],
        capturedAt: AT,
      },
      freshness: fresh(AT),
    }],
    requirements: [{
      id: "placeholder-requirement",
      name: "placeholder",
      statement: "Placeholder requirement. Not a thermal verdict.",
      version: "1",
      criterion: {
        metric: "placeholder-output",
        operator: "<=",
        limit: { value: 1, unit: "unit-pending-source" },
      },
      trace: {
        sourceArtifactId: "artifact.brief",
        elementId: "placeholder-requirement",
        targetArtifactIds: ["artifact.brief"],
      },
      freshness: fresh(AT),
    }],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes",
      from: { kind: "change", id: "change.brief" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The applied change introduced the brief document.",
    }, {
      id: "trace-requirement-to-brief",
      relation: "traces_to",
      from: { kind: "requirement", id: "placeholder-requirement" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The placeholder requirement constrains the brief artifact.",
    }, {
      id: `${OBSERVATION_ID}-from-evidence`,
      relation: "derived_from",
      from: { kind: "observation", id: OBSERVATION_ID },
      to: {
        kind: "artifact",
        id: `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
      },
      rationale: "The observation is reported by the exact normalized evidence.",
    }, {
      id: `${OBSERVATION_ID}-from-result`,
      relation: "derived_from",
      from: { kind: "observation", id: OBSERVATION_ID },
      to: { kind: "artifact", id: `modelica-admitted-result-${RESULT_DIGEST}` },
      rationale: "The observation is reported by the exact retained solver result.",
    }],
    proposedActions: [],
  });
  const basisFingerprint = await sha256Fingerprint(basisSnapshot);
  const admission = encodeAdmittedObservationEvaluationAdmission({
    schemaVersion: "modelica-admitted-observation-evaluation-admission/1.0",
    methodSchemaVersion: method.schemaVersion,
    projectId: PROJECT_ID,
    subjectId: SUBJECT_ID,
    basis: {
      snapshotId: basisSnapshot.id,
      revision: basisSnapshot.revision,
      fingerprint: basisFingerprint,
    },
    sheet: { id: sheet.id, fingerprint: sheetFingerprint },
    evidence: {
      artifactId: `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
      fingerprint: evidenceFingerprint,
    },
    methodFingerprint,
    profileId: method.profile.id,
    unitPolicy: {
      id: method.unitPolicy.id,
      fingerprint: method.unitPolicy.fingerprint,
    },
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    ...VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const summary = "Evaluate admitted Modelica observations.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary, parameters: admission },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    schemaVersion: "3.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: SUBJECT_ID,
      objective: { title: "Evaluate", statement: summary },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.verify",
      name: "Verify",
      order: 1,
      description: "Evaluate observations.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      phaseId: "phase.verify",
      title: "Evaluate observations",
      description: summary,
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
      summary,
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.verify",
      title: "Approve evaluation",
      question: "Evaluate the exact admitted observations?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters: admission,
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
      rationale: "Reviewed identities.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new ExecuteMemorySnapshots(basisSnapshot);
  const captures = new ExecuteMemoryCaptures();
  const sheets = new MemorySheetStore(sheet, sheetFingerprint);
  const evidence = new MemoryEvidenceReader();
  const syson = new RecordingSysonClient({
    results: [{
      constraintId: "placeholder-requirement",
      status: "unresolved",
    }],
  });
  const attempts = new FileAdmittedObservationEvaluationAttemptStore(
    `${directory}/attempts`,
  );
  const commands = new ExecuteCommands(project, {
    losePublishAck: options.losePublishAck === true,
  });
  if (options.runStatus === "running") {
    await commands.claimRun(AGENT, {
      commandId: `${COMMAND_ID}:verify-evaluate-admitted-modelica-observations:claim`,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
      summary: CLAIM_SUMMARY,
    });
  }
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: (_projectId, revision) =>
      Promise.resolve(commands.reopenRevision(revision)),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    executor: new VerifyEvaluateAdmittedModelicaObservationsRunExecutor({
      projects,
      commands,
      snapshots,
      sheets,
      evidence,
      captures,
      sheetCaptures,
      attempts,
      syson,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    project,
    snapshots,
    captures,
    attempts,
    syson,
    sheetSealDigest: sheetSeal.fingerprint.digest,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  id: string;
  revision: number;
  generatedAt: string;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};

class ExecuteMemorySnapshots {
  readonly #items = new Map<string, ThreadSnapshot>();
  saveCalls = 0;
  constructor(basis: ThreadSnapshot) {
    this.#items.set(basis.id, structuredClone(basis));
  }
  get(id: string): Promise<ThreadSnapshot | undefined> {
    const value = this.#items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }
  getFresh(id: string): Promise<ThreadSnapshot | undefined> {
    return this.get(id);
  }
  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const result =
      [...this.#items.values()].filter((item) => item.subject.id === subjectId).sort((
        left,
        right,
      ) => right.revision - left.revision)[0];
    return Promise.resolve(result && structuredClone(result));
  }
  save(snapshot: ThreadSnapshot): Promise<void> {
    this.saveCalls += 1;
    const attempted = structuredClone(snapshot);
    const existing = this.#items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(attempted)) {
      return Promise.reject(
        new Error(`immutable snapshot ${snapshot.id} was rewritten`),
      );
    }
    if (!existing) this.#items.set(snapshot.id, attempted);
    return Promise.resolve();
  }
}

class ExecuteMemoryCaptures {
  readonly #items = new Map<string, string>();
  save(fingerprint: ContentFingerprint, text: string) {
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve({ fingerprint, uri: `casys://x/${fingerprint.digest}` });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class MemorySheetStore implements ThermalMethodSheetStore {
  constructor(
    readonly sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
    readonly fingerprint: ContentFingerprint,
  ) {}
  save() {
    return Promise.reject(new Error("unused"));
  }
  read(fingerprint: ContentFingerprint) {
    if (fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.sheet);
  }
}

class MemoryEvidenceReader implements AdmittedObservationEvidenceReader {
  read() {
    return Promise.resolve({
      modelName: "placeholder-module",
      outputs: [{ name: "placeholder-output", unit: "unit-pending-source" }],
      metrics: [{
        outputName: "placeholder-output",
        statistic: "final" as const,
        unit: "unit-pending-source",
        value: 0,
      }],
    });
  }
}

class RecordingSysonClient {
  readonly calls: McpToolCall[] = [];
  constructor(private readonly content: Record<string, unknown>) {}
  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(call);
    return Promise.resolve({
      structuredContent: structuredClone(this.content),
      text: "",
    });
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("unused"));
  }
}

class ExecuteCommands {
  #losePublishAck: boolean;
  readonly #revisions = new Map<number, MutableProject>();

  constructor(
    readonly project: MutableProject,
    options: { readonly losePublishAck?: boolean } = {},
  ) {
    this.#losePublishAck = options.losePublishAck === true;
    this.#revisions.set(project.revision, structuredClone(project));
  }

  reopenRevision(revision: number): EngineeringProjectSnapshot | undefined {
    const snapshot = this.#revisions.get(revision);
    return snapshot && structuredClone(snapshot);
  }

  claimRun(origin: typeof AGENT, command: RunCommand) {
    return this.#transition(
      "agent-run.claim",
      origin,
      command,
      ["queued"],
      "running",
      (run) => {
        run.startedAt = AT;
        run.claimedAt = AT;
        run.claimedBy = { id: origin.actorId, origin: origin.kind };
      },
    );
  }

  async publishRun(origin: typeof AGENT, command: RunCommand) {
    const project = await this.#transition(
      "agent-run.publish",
      origin,
      command,
      ["running"],
      "publishing",
    );
    if (this.#losePublishAck) {
      this.#losePublishAck = false;
      throw new Error("publish acknowledgement lost after commit");
    }
    return project;
  }

  completeRun(origin: typeof AGENT, command: CompleteRunCommand) {
    return this.#transition(
      "agent-run.complete",
      origin,
      command,
      ["publishing"],
      "completed",
      (run) => {
        run.completedAt = AT;
        run.resultSnapshot = command.resultSnapshot;
        run.evidenceRefs = [...command.evidenceRefs];
        const work = this.project.workItems[0] as MutableWork;
        work.status = "completed";
        work.evidenceRefs = [...command.evidenceRefs];
        if (
          !this.project.threadSnapshots.some((item) =>
            item.snapshotId === command.resultSnapshot.snapshotId
          )
        ) {
          this.project.threadSnapshots.push(command.resultSnapshot);
        }
      },
    );
  }

  failRun(_origin: typeof AGENT, command: FailRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    run.status = "failed";
    run.failure = { code: command.code, message: command.message };
    this.project.revision += 1;
    this.project.id = `${PROJECT_ID}:r${this.project.revision}`;
    this.project.generatedAt = AT;
    this.#revisions.set(this.project.revision, structuredClone(this.project));
    return Promise.resolve(this.project);
  }

  async #transition(
    type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
    origin: typeof AGENT,
    command: RunCommand | CompleteRunCommand,
    allowed: readonly string[],
    status: "running" | "publishing" | "completed",
    update?: (run: MutableRun) => void,
  ) {
    const requestFingerprint = await sha256Fingerprint({
      type,
      origin,
      command,
    });
    const existing = this.project.commandReceipts.find((receipt) =>
      receipt.commandId === command.commandId
    );
    if (existing) {
      if (!fingerprintsEqual(existing.requestFingerprint, requestFingerprint)) {
        throw new EngineeringProjectCommandError(
          "command_id_conflict",
          `Command id ${command.commandId} was already used for a different request.`,
        );
      }
      const historical = this.#revisions.get(existing.resultingSnapshot.revision);
      if (
        !historical || historical.id !== existing.resultingSnapshot.snapshotId
      ) {
        throw new EngineeringProjectCommandError(
          "command_id_conflict",
          `Command id ${command.commandId} has an invalid immutable result receipt.`,
        );
      }
      return structuredClone(historical);
    }
    if (this.project.revision !== command.expectedRevision) {
      throw new EngineeringProjectCommandError(
        "stale_revision",
        `Engineering project ${command.projectId} expected revision ${command.expectedRevision} but is at ${this.project.revision}.`,
      );
    }
    const run = this.project.agentRuns[0] as MutableRun;
    if (!allowed.includes(run.status)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Agent run ${run.id} cannot transition from ${run.status} to ${status}.`,
      );
    }
    update?.(run);
    run.status = status;
    run.summary = command.summary;
    run.statusHistory = [...(run.statusHistory ?? []), {
      commandId: command.commandId,
      status,
      at: AT,
      actor: { id: origin.actorId, origin: origin.kind },
      summary: command.summary,
    }];
    this.project.revision += 1;
    this.project.id = `${PROJECT_ID}:r${this.project.revision}`;
    this.project.generatedAt = AT;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint,
      resultingSnapshot: {
        snapshotId: this.project.id,
        revision: this.project.revision,
      },
    });
    this.#revisions.set(this.project.revision, structuredClone(this.project));
    return this.project;
  }
}

type MutableRun = {
  -readonly [Key in keyof EngineeringProjectSnapshot["agentRuns"][number]]:
    EngineeringProjectSnapshot["agentRuns"][number][Key];
};
type MutableWork = {
  -readonly [Key in keyof EngineeringProjectSnapshot["workItems"][number]]:
    EngineeringProjectSnapshot["workItems"][number][Key];
};

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}

function retryCommand(expectedRevision: number) {
  return {
    commandId: COMMAND_ID,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: RETRY_AT,
    runId: RUN_ID,
  };
}

async function seedCompletedWal(
  fixture: {
    readonly captures: ExecuteMemoryCaptures;
    readonly attempts: FileAdmittedObservationEvaluationAttemptStore;
  },
  captureText: string,
  captureFingerprint: ContentFingerprint,
): Promise<void> {
  await fixture.captures.save(captureFingerprint, captureText);
  await fixture.attempts.begin({
    projectId: PROJECT_ID,
    runId: RUN_ID,
    dispatchedAt: AT,
  });
  await fixture.attempts.complete({
    projectId: PROJECT_ID,
    runId: RUN_ID,
    completedAt: AT,
    captureDigest: captureFingerprint.digest,
  });
}

async function persistMethodSheetSeal(
  captures: ExecuteMemoryCaptures,
  sheet: ModelicaThermalMethodSheet,
  sheetFingerprint: ContentFingerprint,
) {
  const capture = validateModelicaThermalMethodSheetSealCapture({
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    kind: "modelica-thermal-method-sheet-seal",
    operation: {
      id: "verify.seal-modelica-thermal-method-sheet",
      version: "1",
    },
    trustedRunId: "run.seal-sheet",
    decisionId: "placeholder-seal-decision",
    sealedAt: AT,
    admission: {
      schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
      sheetSchemaVersion: MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
      sheetId: sheet.id,
      sheetFingerprint,
      projectId: sheet.project.id,
      subjectId: sheet.subject.id,
      basis: sheet.basis,
      model: sheet.model,
      sealDecisionId: sheet.review.sealDecisionId,
    },
    sheet: {
      id: sheet.id,
      fingerprint: sheetFingerprint,
      uri: thermalMethodSheetUri(sheetFingerprint),
    },
    recross: {
      sourceCapture: {
        fingerprint: sheet.model.sourceCaptureFingerprint,
        role: "modelica-model",
        language: "modelica",
      },
      attributeUsageIds: sheet.bindings.parameterizes.map((item) =>
        item.attributeUsageId
      ),
      requirementElementIds: sheet.bindings.outputRequirements.map((item) =>
        item.requirementElementId
      ),
    },
  });
  const text = deterministicJson(capture);
  const fingerprint = await sha256Fingerprint(capture);
  await captures.save(fingerprint, text);
  return { capture, fingerprint, text };
}
