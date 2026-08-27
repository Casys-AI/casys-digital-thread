/**
 * Pure completed-replay verification for one admitted Modelica isolated run.
 *
 * Asserts already-reopened project, capture, journal receipt, documentary
 * successor, and claim/publish/complete receipts. It has no snapshot store,
 * project revision store, CAS, clock, runner, or WAL mutation. The adapter
 * reopens Thread and historical project revisions after these checks.
 */

import type { IsolatedCodeExecutionReceiptRecord } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { DocumentarySuccessor } from "../../../../domain/modelica/admitted/documentary-thread-evidence.ts";
import type { ModelicaAdmittedExecutionCapture } from "../../../../domain/modelica/admitted/execution-evidence.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../ports/in/project-run-executor.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../project/engineering-project-command-service.ts";

export const ADMITTED_MODELICA_ISOLATED_OUTPUT_VALIDATION_FAILED = {
  summary:
    "Isolated admitted Modelica output validation was rejected before Thread publication.",
  code: "isolated_output_validation_failed",
} as const;

export interface CompletedAdmittedModelicaBindingInput {
  readonly project: EngineeringProjectSnapshot;
  readonly command: RegisteredProjectRunExecutorCommand;
  readonly run: EngineeringAgentRun;
  readonly originalStartedAt: string | undefined;
  readonly expected: DocumentarySuccessor;
  readonly capture: ModelicaAdmittedExecutionCapture;
  readonly executionRunId: string;
  readonly journalReceipt: IsolatedCodeExecutionReceiptRecord;
}

export interface AdmittedModelicaTransitionReceipts {
  readonly claim: EngineeringProjectCommandReceipt;
  readonly publish: EngineeringProjectCommandReceipt;
  readonly complete: EngineeringProjectCommandReceipt;
}

export function assertCompletedAdmittedModelicaBinding(
  input: CompletedAdmittedModelicaBindingInput,
): void {
  const workItem = input.project.workItems.find((item) =>
    item.id === input.run.workItemId
  );
  const phase = workItem &&
    input.project.phases.find((item) => item.id === workItem.phaseId);
  const expectedRefs = input.expected.artifacts.map((artifact) =>
    artifactEvidence(input.expected.snapshot, artifact)
  );
  const projectSnapshotMatches = input.project.threadSnapshots.filter(
    (reference) =>
      deterministicJson(reference) ===
        deterministicJson(snapshotRef(input.expected.snapshot)),
  );
  const expectedCompletionSummary = completionCommand(
    input.command,
    input.project.revision,
    input.expected,
  ).summary;
  if (
    input.run.status !== "completed" || !input.run.resultSnapshot || !workItem ||
    !phase ||
    workItem.status !== "completed" ||
    input.run.summary !== expectedCompletionSummary ||
    deterministicJson(input.run.resultSnapshot) !==
      deterministicJson(snapshotRef(input.expected.snapshot)) ||
    deterministicJson(input.run.evidenceRefs) !== deterministicJson(expectedRefs) ||
    deterministicJson(workItem.evidenceRefs) !== deterministicJson(expectedRefs) ||
    !expectedRefs.every((expectedRef) =>
      phase.evidenceRefs.filter((actualRef) =>
        deterministicJson(actualRef) === deterministicJson(expectedRef)
      ).length === 1
    ) ||
    projectSnapshotMatches.length !== 1 ||
    input.run.startedAt !== input.originalStartedAt ||
    deterministicJson(input.journalReceipt) !==
      deterministicJson(input.capture.receipt) ||
    input.capture.executionRunId !== input.executionRunId ||
    input.capture.agentRunId !== input.run.id ||
    input.capture.projectId !== input.project.project.id
  ) {
    throw invalidTransition(
      "The completed admitted Modelica project state does not exactly bind its journal, capture, Thread successor and three evidence references.",
    );
  }
}

export function requireAdmittedModelicaCommandReceipt(
  project: EngineeringProjectSnapshot,
  commandId: string,
  type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
  origin: EngineeringProjectCommandOrigin,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) => receipt.commandId === commandId) ??
      [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== type ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId
  ) {
    throw invalidTransition(
      `The admitted Modelica run has no unique exact ${type} receipt.`,
    );
  }
  return receipt;
}

export function requireAdmittedModelicaCompletedReceipts(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly command: RegisteredProjectRunExecutorCommand;
  readonly origin: EngineeringProjectCommandOrigin;
  readonly run: EngineeringAgentRun;
}): AdmittedModelicaTransitionReceipts {
  const claim = requireAdmittedModelicaCommandReceipt(
    input.project,
    commandStep(input.command.commandId, "claim"),
    "agent-run.claim",
    input.origin,
  );
  const publish = requireAdmittedModelicaCommandReceipt(
    input.project,
    commandStep(input.command.commandId, "publish"),
    "agent-run.publish",
    input.origin,
  );
  const complete = requireAdmittedModelicaCommandReceipt(
    input.project,
    commandStep(input.command.commandId, "complete"),
    "agent-run.complete",
    input.origin,
  );
  if (
    input.run.claimedAt !== claim.appliedAt ||
    input.run.startedAt !== claim.appliedAt ||
    input.run.completedAt !== complete.appliedAt
  ) {
    throw invalidTransition(
      "The completed admitted Modelica run timeline differs from its exact claim and completion receipts.",
    );
  }
  return { claim, publish, complete };
}

export async function assertAdmittedModelicaCommandReceiptExact(
  run: EngineeringAgentRun,
  receipt: EngineeringProjectCommandReceipt,
  type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
  origin: EngineeringProjectCommandOrigin,
  command: RunCommand | CompleteRunCommand,
  status: "running" | "publishing" | "completed",
): Promise<void> {
  const expectedFingerprint = await sha256Fingerprint({ type, origin, command });
  const transitions =
    run.statusHistory?.filter((transition) =>
      transition.commandId === receipt.commandId &&
      transition.status === status &&
      transition.at === receipt.appliedAt &&
      transition.actor.origin === origin.kind &&
      transition.actor.id === origin.actorId &&
      transition.summary === command.summary
    ) ?? [];
  if (
    command.commandId !== receipt.commandId ||
    command.issuedAt !== receipt.issuedAt ||
    receipt.resultingSnapshot.revision !== command.expectedRevision + 1 ||
    !fingerprintsEqual(receipt.requestFingerprint, expectedFingerprint) ||
    transitions.length !== 1
  ) {
    throw invalidTransition(
      `The admitted Modelica ${type} receipt does not seal its exact command, revision, issuance, and status transition.`,
    );
  }
}

export function claimCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    expectedRevision,
    issuedAt,
    summary: "Started the exact reviewed admitted Modelica run.",
  };
}

export function publishCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  issuedAt = command.issuedAt,
): RunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "publish"),
    expectedRevision,
    issuedAt,
    summary: "Publishing the admitted Modelica documentary evidence.",
  };
}

export function failCommand(
  command: RegisteredProjectRunExecutorCommand,
  failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  },
  expectedRevision = command.expectedRevision,
  issuedAt = command.issuedAt,
): FailRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "fail"),
    expectedRevision,
    issuedAt,
    summary: failure.summary,
    code: failure.code,
    message: failure.message,
  };
}

export function completionCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  expected: DocumentarySuccessor,
  issuedAt = command.issuedAt,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    issuedAt,
    summary: "Recorded the exact admitted Modelica isolated run.",
    resultSnapshot: snapshotRef(expected.snapshot),
    evidenceRefs: expected.artifacts.map((artifact) =>
      artifactEvidence(expected.snapshot, artifact)
    ),
  };
}

export function commandStep(commandId: string, step: string): string {
  return `${commandId}:simulate-run-admitted-modelica:${step}`;
}

export function artifactEvidence(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): EngineeringThreadEntityRef {
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

function snapshotRef(
  snapshot: ThreadSnapshot,
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
