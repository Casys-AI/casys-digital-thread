/**
 * Bounded outer-fail replay for one known isolated output-validation terminal.
 *
 * Asserts the already-failed project run, its evidence-free binding, and the
 * exact claim/fail receipts. It has no WAL, runner, CAS, clock, or Thread I/O.
 * Each consumer still owns its command ids, fail summary, and journal phase.
 */

import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import {
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../project/engineering-project-command-service.ts";

export const ISOLATED_OUTPUT_VALIDATION_FAILED_CODE =
  "isolated_output_validation_failed" as const;

export type IsolatedOutputValidationLifecycleReceiptType =
  | "agent-run.claim"
  | "agent-run.fail";

export interface FailedIsolatedOutputValidationReplayInput {
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly origin: EngineeringProjectCommandOrigin;
  readonly originalStartedAt: string | undefined;
  readonly failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  };
  readonly claimCommandId: string;
  readonly failCommandId: string;
  readonly buildClaimCommand: (
    expectedRevision: number,
    issuedAt: string,
  ) => RunCommand;
  readonly buildFailCommand: (
    expectedRevision: number,
    issuedAt: string,
  ) => FailRunCommand;
}

/**
 * Exact evidence-free reconciliation for an isolated execution which has a
 * domain-owned terminal failure other than output validation.  The caller
 * still owns the allowed failure code and the WAL fact which authorizes it;
 * this helper owns only the project claim/fail receipt shape.
 */
export interface FailedIsolatedExecutionReplayInput {
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly origin: EngineeringProjectCommandOrigin;
  readonly originalStartedAt: string | undefined;
  readonly failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  };
  readonly claimCommandId: string;
  readonly failCommandId: string;
  readonly buildClaimCommand: (
    expectedRevision: number,
    issuedAt: string,
  ) => RunCommand;
  readonly buildFailCommand: (
    expectedRevision: number,
    issuedAt: string,
  ) => FailRunCommand;
}

export function isolatedOutputValidationFailedMessage(observation: {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}): string {
  const text =
    `Isolated output validation rejected registered role ${observation.role} ` +
    `(${observation.byteCount} bytes, sha256 ${observation.sha256}).`;
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function assertFailedIsolatedOutputValidationBinding(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly originalStartedAt: string | undefined;
  readonly failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  };
}): void {
  if (input.failure.code !== ISOLATED_OUTPUT_VALIDATION_FAILED_CODE) {
    throw invalidTransition(
      "The failed isolated output-validation project state does not exactly bind its evidence-free terminal failure.",
    );
  }
  assertFailedIsolatedExecutionBinding(input);
}

export function assertFailedIsolatedExecutionBinding(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly originalStartedAt: string | undefined;
  readonly failure: {
    readonly summary: string;
    readonly code: string;
    readonly message: string;
  };
}): void {
  const workItem = input.project.workItems.find((item) =>
    item.id === input.run.workItemId
  );
  if (
    input.run.status !== "failed" || !input.run.failure || !workItem ||
    input.run.resultSnapshot !== undefined ||
    input.run.evidenceRefs.length !== 0 ||
    workItem.evidenceRefs.length !== 0 ||
    input.run.failure.code !== input.failure.code ||
    input.run.failure.message !== input.failure.message ||
    input.run.summary !== input.failure.summary ||
    input.run.startedAt !== input.originalStartedAt ||
    !input.run.completedAt
  ) {
    throw invalidTransition(
      "The failed isolated output-validation project state does not exactly bind its evidence-free terminal failure.",
    );
  }
}

export function requireFailedIsolatedOutputValidationReceipts(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly origin: EngineeringProjectCommandOrigin;
  readonly run: EngineeringAgentRun;
  readonly claimCommandId: string;
  readonly failCommandId: string;
}): {
  readonly claim: EngineeringProjectCommandReceipt;
  readonly fail: EngineeringProjectCommandReceipt;
} {
  const claim = requireCommandReceipt(
    input.project,
    input.claimCommandId,
    "agent-run.claim",
    input.origin,
  );
  const fail = requireCommandReceipt(
    input.project,
    input.failCommandId,
    "agent-run.fail",
    input.origin,
  );
  if (
    input.run.claimedAt !== claim.appliedAt ||
    input.run.startedAt !== claim.appliedAt ||
    input.run.completedAt !== fail.appliedAt
  ) {
    throw invalidTransition(
      "The failed isolated output-validation run timeline differs from its exact claim and fail receipts.",
    );
  }
  return { claim, fail };
}

export async function assertIsolatedOutputValidationCommandReceiptExact(
  run: EngineeringAgentRun,
  receipt: EngineeringProjectCommandReceipt,
  type: IsolatedOutputValidationLifecycleReceiptType,
  origin: EngineeringProjectCommandOrigin,
  command: RunCommand | FailRunCommand,
  status: "running" | "failed",
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
      `The isolated output-validation ${type} receipt does not seal its exact command, revision, issuance, and status transition.`,
    );
  }
}

export async function assertFailedIsolatedOutputValidationReplay(
  input: FailedIsolatedOutputValidationReplayInput,
): Promise<void> {
  assertFailedIsolatedOutputValidationBinding(input);
  await assertFailedIsolatedExecutionReplay(input);
}

export async function assertFailedIsolatedExecutionReplay(
  input: FailedIsolatedExecutionReplayInput,
): Promise<void> {
  assertFailedIsolatedExecutionBinding(input);
  const receipts = requireFailedIsolatedOutputValidationReceipts(input);
  await assertIsolatedOutputValidationCommandReceiptExact(
    input.run,
    receipts.claim,
    "agent-run.claim",
    input.origin,
    input.buildClaimCommand(
      receipts.claim.resultingSnapshot.revision - 1,
      receipts.claim.issuedAt,
    ),
    "running",
  );
  await assertIsolatedOutputValidationCommandReceiptExact(
    input.run,
    receipts.fail,
    "agent-run.fail",
    input.origin,
    input.buildFailCommand(
      receipts.fail.resultingSnapshot.revision - 1,
      receipts.fail.issuedAt,
    ),
    "failed",
  );
}

function requireCommandReceipt(
  project: EngineeringProjectSnapshot,
  commandId: string,
  type: IsolatedOutputValidationLifecycleReceiptType,
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
      `The failed isolated output-validation run has no unique exact ${type} receipt.`,
    );
  }
  return receipt;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
