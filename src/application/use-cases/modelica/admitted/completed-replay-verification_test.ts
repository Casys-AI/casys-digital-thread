import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { IsolatedCodeExecutionReceiptRecord } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { ModelicaAdmittedExecutionCapture } from "../../../../domain/modelica/admitted/execution-evidence.ts";
import type { DocumentarySuccessor } from "../../../../domain/modelica/admitted/documentary-thread-evidence.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../ports/in/project-run-executor.ts";
import { EngineeringProjectCommandError } from "../../project/engineering-project-command-service.ts";
import {
  artifactEvidence,
  assertAdmittedModelicaCommandReceiptExact,
  assertCompletedAdmittedModelicaBinding,
  claimCommand,
  commandStep,
  completionCommand,
  publishCommand,
  requireAdmittedModelicaCommandReceipt,
  requireAdmittedModelicaCompletedReceipts,
} from "./completed-replay-verification.ts";

const PROJECT_ID = "project.ramp";
const RUN_ID = "run.admitted";
const WORK_ID = "work.modelica.admitted";
const PHASE_ID = "phase.simulate";
const EXECUTION_RUN_ID = "admitted-modelica-run";
const APPLIED_AT = "2026-08-20T05:00:00.000Z";
const ORIGIN: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent.modelica",
};
const COMMAND: RegisteredProjectRunExecutorCommand = {
  commandId: "cmd.admitted",
  projectId: PROJECT_ID,
  expectedRevision: 4,
  issuedAt: APPLIED_AT,
  runId: RUN_ID,
};

function fingerprint(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function successor(): DocumentarySuccessor {
  const snapshot = {
    id: "snapshot.admitted.8",
    revision: 8,
    subject: { id: "subject.ramp" },
  };
  return {
    snapshot,
    artifacts: [
      { id: "modelica-admitted-capture-c", fingerprint: fingerprint("c".repeat(64)) },
      { id: "modelica-admitted-evidence-e", fingerprint: fingerprint("e".repeat(64)) },
      { id: "modelica-admitted-result-f", fingerprint: fingerprint("f".repeat(64)) },
    ],
    observations: [],
  } as unknown as DocumentarySuccessor;
}

function journalReceipt(): IsolatedCodeExecutionReceiptRecord {
  return { runId: EXECUTION_RUN_ID } as IsolatedCodeExecutionReceiptRecord;
}

function actor() {
  return { id: ORIGIN.actorId, origin: ORIGIN.kind };
}

async function sealedCompleted() {
  const expected = successor();
  const receiptRecord = journalReceipt();
  const capture = {
    projectId: PROJECT_ID,
    agentRunId: RUN_ID,
    executionRunId: EXECUTION_RUN_ID,
    receipt: receiptRecord,
  } as ModelicaAdmittedExecutionCapture;
  const claim = claimCommand(COMMAND);
  const publish = publishCommand(COMMAND, 5);
  const complete = completionCommand(COMMAND, 6, expected);
  const [claimFp, publishFp, completeFp] = await Promise.all([
    sha256Fingerprint({ type: "agent-run.claim", origin: ORIGIN, command: claim }),
    sha256Fingerprint({
      type: "agent-run.publish",
      origin: ORIGIN,
      command: publish,
    }),
    sha256Fingerprint({
      type: "agent-run.complete",
      origin: ORIGIN,
      command: complete,
    }),
  ]);
  const refs = expected.artifacts.map((artifact) =>
    artifactEvidence(expected.snapshot, artifact)
  );
  const resultSnapshot = {
    snapshotId: expected.snapshot.id,
    revision: expected.snapshot.revision,
    subjectId: expected.snapshot.subject.id,
  };
  const run = {
    id: RUN_ID,
    workItemId: WORK_ID,
    status: "completed",
    summary: complete.summary,
    startedAt: APPLIED_AT,
    claimedAt: APPLIED_AT,
    completedAt: APPLIED_AT,
    resultSnapshot,
    evidenceRefs: refs,
    statusHistory: [
      {
        commandId: claim.commandId,
        status: "running",
        at: APPLIED_AT,
        actor: actor(),
        summary: claim.summary,
      },
      {
        commandId: publish.commandId,
        status: "publishing",
        at: APPLIED_AT,
        actor: actor(),
        summary: publish.summary,
      },
      {
        commandId: complete.commandId,
        status: "completed",
        at: APPLIED_AT,
        actor: actor(),
        summary: complete.summary,
      },
    ],
  } as unknown as EngineeringAgentRun;
  const commandReceipt = (
    type: EngineeringProjectCommandReceipt["type"],
    command: { readonly commandId: string; readonly issuedAt: string },
    requestFingerprint: Awaited<ReturnType<typeof sha256Fingerprint>>,
    resultingRevision: number,
  ): EngineeringProjectCommandReceipt => ({
    commandId: command.commandId,
    type,
    actor: actor(),
    issuedAt: command.issuedAt,
    appliedAt: APPLIED_AT,
    requestFingerprint,
    resultingSnapshot: {
      snapshotId: `${PROJECT_ID}:r${resultingRevision}`,
      revision: resultingRevision,
    },
  });
  const project = {
    project: { id: PROJECT_ID },
    revision: 7,
    threadSnapshots: [resultSnapshot],
    phases: [{ id: PHASE_ID, evidenceRefs: refs }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: PHASE_ID,
      status: "completed",
      evidenceRefs: refs,
    }],
    agentRuns: [run],
    commandReceipts: [
      commandReceipt("agent-run.claim", claim, claimFp, 5),
      commandReceipt("agent-run.publish", publish, publishFp, 6),
      commandReceipt("agent-run.complete", complete, completeFp, 7),
    ],
  } as unknown as EngineeringProjectSnapshot;
  return {
    expected,
    capture,
    run,
    project,
    claim,
    publish,
    complete,
    receiptRecord,
    refs,
  };
}

function bindingInput(
  sealed: Awaited<ReturnType<typeof sealedCompleted>>,
  overrides: {
    readonly project?: EngineeringProjectSnapshot;
    readonly run?: EngineeringAgentRun;
    readonly capture?: ModelicaAdmittedExecutionCapture;
    readonly journalReceipt?: IsolatedCodeExecutionReceiptRecord;
    readonly originalStartedAt?: string;
  } = {},
) {
  return {
    project: overrides.project ?? sealed.project,
    command: COMMAND,
    run: overrides.run ?? sealed.run,
    originalStartedAt: overrides.originalStartedAt ?? sealed.run.startedAt,
    expected: sealed.expected,
    capture: overrides.capture ?? sealed.capture,
    executionRunId: EXECUTION_RUN_ID,
    journalReceipt: overrides.journalReceipt ?? sealed.receiptRecord,
  };
}

Deno.test("completed binding accepts the exact journal, capture, Thread successor and three evidence refs", async () => {
  const sealed = await sealedCompleted();
  assertCompletedAdmittedModelicaBinding(bindingInput(sealed));
  assertEquals(
    sealed.refs.map((reference) => reference.id),
    sealed.expected.artifacts.map((artifact) => artifact.id),
  );
});

Deno.test("completed binding rejects work-status, phase, capture, or successor drift", async () => {
  const sealed = await sealedCompleted();
  const driftedWork = structuredClone(sealed.project) as typeof sealed.project & {
    workItems: Array<{ status: string }>;
  };
  driftedWork.workItems[0]!.status = "in-progress";
  assertThrows(
    () =>
      assertCompletedAdmittedModelicaBinding(
        bindingInput(sealed, { project: driftedWork, run: sealed.run }),
      ),
    EngineeringProjectCommandError,
    "does not exactly bind its journal, capture, Thread successor and three evidence references",
  );
  const driftedPhase = structuredClone(sealed.project) as typeof sealed.project & {
    phases: Array<{ evidenceRefs: unknown[] }>;
  };
  driftedPhase.phases[0]!.evidenceRefs = sealed.refs.slice(1);
  assertThrows(
    () =>
      assertCompletedAdmittedModelicaBinding(
        bindingInput(sealed, { project: driftedPhase }),
      ),
    EngineeringProjectCommandError,
    "three evidence references",
  );
  assertThrows(
    () =>
      assertCompletedAdmittedModelicaBinding(bindingInput(sealed, {
        journalReceipt: { runId: "foreign-run" } as IsolatedCodeExecutionReceiptRecord,
      })),
    EngineeringProjectCommandError,
    "three evidence references",
  );
  const driftedRun = {
    ...sealed.run,
    resultSnapshot: {
      ...sealed.run.resultSnapshot!,
      snapshotId: "snapshot.foreign",
    },
  };
  assertThrows(
    () =>
      assertCompletedAdmittedModelicaBinding(
        bindingInput(sealed, { run: driftedRun }),
      ),
    EngineeringProjectCommandError,
    "three evidence references",
  );
});

Deno.test("completed receipts are unique, actor-exact, and seal the claim/complete timeline", async () => {
  const sealed = await sealedCompleted();
  const receipts = requireAdmittedModelicaCompletedReceipts({
    project: sealed.project,
    command: COMMAND,
    origin: ORIGIN,
    run: sealed.run,
  });
  assertEquals(receipts.claim.type, "agent-run.claim");
  assertEquals(receipts.publish.type, "agent-run.publish");
  assertEquals(receipts.complete.type, "agent-run.complete");
  assertEquals(
    receipts.claim.commandId,
    commandStep(COMMAND.commandId, "claim"),
  );
  const missing = structuredClone(sealed.project) as unknown as {
    commandReceipts: EngineeringProjectCommandReceipt[];
  };
  missing.commandReceipts = sealed.project.commandReceipts!.slice(0, 2);
  assertThrows(
    () =>
      requireAdmittedModelicaCompletedReceipts({
        project: missing as unknown as EngineeringProjectSnapshot,
        command: COMMAND,
        origin: ORIGIN,
        run: sealed.run,
      }),
    EngineeringProjectCommandError,
    "no unique exact agent-run.complete receipt",
  );
  const duplicate = structuredClone(sealed.project) as unknown as {
    commandReceipts: EngineeringProjectCommandReceipt[];
  };
  duplicate.commandReceipts = [
    ...sealed.project.commandReceipts!,
    sealed.project.commandReceipts![0]!,
  ];
  assertThrows(
    () =>
      requireAdmittedModelicaCommandReceipt(
        duplicate as unknown as EngineeringProjectSnapshot,
        commandStep(COMMAND.commandId, "claim"),
        "agent-run.claim",
        ORIGIN,
      ),
    EngineeringProjectCommandError,
    "no unique exact agent-run.claim receipt",
  );
  const driftedTimeline = { ...sealed.run, claimedAt: "2026-08-20T05:00:01.000Z" };
  assertThrows(
    () =>
      requireAdmittedModelicaCompletedReceipts({
        project: sealed.project,
        command: COMMAND,
        origin: ORIGIN,
        run: driftedTimeline,
      }),
    EngineeringProjectCommandError,
    "timeline differs from its exact claim and completion receipts",
  );
});

Deno.test("command receipts recompute fingerprints from the canonical claim/publish/complete preimages", async () => {
  const sealed = await sealedCompleted();
  const receipts = requireAdmittedModelicaCompletedReceipts({
    project: sealed.project,
    command: COMMAND,
    origin: ORIGIN,
    run: sealed.run,
  });
  await assertAdmittedModelicaCommandReceiptExact(
    sealed.run,
    receipts.claim,
    "agent-run.claim",
    ORIGIN,
    claimCommand(
      COMMAND,
      receipts.claim.resultingSnapshot.revision - 1,
      receipts.claim.issuedAt,
    ),
    "running",
  );
  await assertAdmittedModelicaCommandReceiptExact(
    sealed.run,
    receipts.publish,
    "agent-run.publish",
    ORIGIN,
    publishCommand(
      COMMAND,
      receipts.publish.resultingSnapshot.revision - 1,
      receipts.publish.issuedAt,
    ),
    "publishing",
  );
  await assertAdmittedModelicaCommandReceiptExact(
    sealed.run,
    receipts.complete,
    "agent-run.complete",
    ORIGIN,
    completionCommand(
      COMMAND,
      receipts.complete.resultingSnapshot.revision - 1,
      sealed.expected,
      receipts.complete.issuedAt,
    ),
    "completed",
  );
  const driftedFingerprint = {
    ...receipts.complete,
    requestFingerprint: fingerprint("5".repeat(64)),
  };
  await assertRejects(
    () =>
      assertAdmittedModelicaCommandReceiptExact(
        sealed.run,
        driftedFingerprint,
        "agent-run.complete",
        ORIGIN,
        completionCommand(
          COMMAND,
          driftedFingerprint.resultingSnapshot.revision - 1,
          sealed.expected,
          driftedFingerprint.issuedAt,
        ),
        "completed",
      ),
    EngineeringProjectCommandError,
    "does not seal its exact command, revision, issuance, and status transition",
  );
  const driftedHistory = {
    ...sealed.run,
    statusHistory: sealed.run.statusHistory?.map((transition) =>
      transition.status === "completed"
        ? { ...transition, summary: "Transplanted completion" }
        : transition
    ),
  };
  await assertRejects(
    () =>
      assertAdmittedModelicaCommandReceiptExact(
        driftedHistory,
        receipts.complete,
        "agent-run.complete",
        ORIGIN,
        completionCommand(
          COMMAND,
          receipts.complete.resultingSnapshot.revision - 1,
          sealed.expected,
          receipts.complete.issuedAt,
        ),
        "completed",
      ),
    EngineeringProjectCommandError,
    "status transition",
  );
});

Deno.test("completed replay verification never names a runner, WAL mutation, CAS, or clock", async () => {
  const source = await Deno.readTextFile(
    new URL("./completed-replay-verification.ts", import.meta.url),
  );
  assertEquals(source.includes("IsolatedCodeRunner"), false);
  assertEquals(source.includes("markDispatching"), false);
  assertEquals(source.includes("markCompleted"), false);
  assertEquals(source.includes("snapshots.save"), false);
  assertEquals(source.includes("captures.save"), false);
  assertEquals(source.includes("Date.now"), false);
  assertEquals(source.includes("new Date"), false);
  assertEquals(
    commandStep("cmd.admitted", "complete"),
    "cmd.admitted:simulate-run-admitted-modelica:complete",
  );
  assertEquals(
    claimCommand(COMMAND).summary,
    "Started the exact reviewed admitted Modelica run.",
  );
  assertEquals(
    publishCommand(COMMAND, 5).summary,
    "Publishing the admitted Modelica documentary evidence.",
  );
  assertEquals(
    completionCommand(COMMAND, 6, successor()).summary,
    "Recorded the exact admitted Modelica isolated run.",
  );
});
