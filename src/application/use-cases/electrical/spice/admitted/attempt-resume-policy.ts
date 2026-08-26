/**
 * Pure resume choice for one admitted SPICE WAL.
 *
 * Decides the next closed action from the journal phase and an already-observed
 * publication resolution. It has no runner, attempt store, CAS, recovery,
 * clock, or dispatch capability. Only the adapter may mark, resolve, destroy,
 * advance, or call the runner after a local `transitioned-now`.
 */

import { deterministicJson } from "../../../../../domain/kernel/deterministic-json.ts";
import type { IsolatedCodeExecutionReceiptRecord } from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { IsolatedOutputRunPublicationResolution } from "../../../../ports/out/compile/isolation/isolated-code-runner.ts";
import { ADMITTED_SPICE_RETRY_GENERATION_CLOSED } from "./completed-replay-verification.ts";

export type AdmittedSpiceAttemptPhase =
  | "prepared"
  | "dispatching"
  | "generation-zero-cleaned"
  | "output-published"
  | "completed"
  | "execution-rejected"
  | "output-validation-rejected"
  | "retry-generation-closed";

export interface AdmittedSpiceAttemptResumeInput {
  readonly phase: AdmittedSpiceAttemptPhase;
  readonly executionRunId: string;
  readonly producerGeneration?: 0 | 1;
  readonly resolution?: IsolatedOutputRunPublicationResolution;
}

export type AdmittedSpiceAttemptResumeAction =
  | { readonly action: "transition-g0" }
  | { readonly action: "read-publication" }
  | {
    readonly action: "adopt-publication";
    readonly receipt: IsolatedCodeExecutionReceiptRecord;
  }
  | { readonly action: "cleanup-g0" }
  | { readonly action: "advance-g1" }
  | {
    readonly action: "close-g1";
    readonly message: string;
  }
  | { readonly action: "already-published" }
  | { readonly action: "already-rejected" }
  | { readonly action: "already-output-validation-rejected" }
  | {
    readonly action: "already-closed";
    readonly message: string;
  }
  | { readonly action: "quarantine"; readonly message: string };

export type AdmittedSpiceTerminalJournalRecoveryAction =
  | { readonly action: "already-rejected" }
  | { readonly action: "already-output-validation-rejected" }
  | {
    readonly action: "already-closed";
    readonly message: string;
  }
  | { readonly action: "read-publication" }
  | {
    readonly action: "close-g1";
    readonly message: string;
  }
  | { readonly action: "quarantine"; readonly message: string }
  | { readonly action: "not-eligible" };

export function isAdmittedSpiceTerminalJournalRecoveryEligible(input: {
  readonly runStatus: string;
  readonly phase: AdmittedSpiceAttemptPhase;
  readonly producerGeneration?: 0 | 1;
}): boolean {
  if (input.runStatus !== "running" && input.runStatus !== "failed") {
    return false;
  }
  if (
    input.phase === "execution-rejected" ||
    input.phase === "output-validation-rejected" ||
    input.phase === "retry-generation-closed"
  ) {
    return true;
  }
  return input.phase === "dispatching" && input.producerGeneration === 1;
}

export function decideAdmittedSpiceAttemptResume(
  input: AdmittedSpiceAttemptResumeInput,
): AdmittedSpiceAttemptResumeAction {
  switch (input.phase) {
    case "completed":
      return quarantine(
        "The project run is active but its admitted SPICE journal is already completed.",
      );
    case "execution-rejected":
      return { action: "already-rejected" };
    case "output-validation-rejected":
      return { action: "already-output-validation-rejected" };
    case "retry-generation-closed":
      return {
        action: "already-closed",
        message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
      };
    case "output-published":
      return { action: "already-published" };
    case "prepared":
      return { action: "transition-g0" };
    case "generation-zero-cleaned":
      return { action: "advance-g1" };
    case "dispatching":
      return decideDispatchingResume(input);
    default:
      return quarantine(
        "The admitted SPICE journal phase is not recoverable.",
      );
  }
}

/**
 * Evidence-free terminal recovery from a sealed WAL. Generation-one
 * publication is quarantine, never Thread adoption, and never a catalog
 * reinterpretation of a retired runtime.
 */
export function decideAdmittedSpiceTerminalJournalRecovery(
  input: AdmittedSpiceAttemptResumeInput,
): AdmittedSpiceTerminalJournalRecoveryAction {
  switch (input.phase) {
    case "execution-rejected":
      return { action: "already-rejected" };
    case "output-validation-rejected":
      return { action: "already-output-validation-rejected" };
    case "retry-generation-closed":
      return {
        action: "already-closed",
        message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
      };
    case "dispatching":
      if (input.producerGeneration !== 1) return { action: "not-eligible" };
      return decideTerminalDispatchingGenerationOne(input);
    default:
      return { action: "not-eligible" };
  }
}

function decideTerminalDispatchingGenerationOne(
  input: AdmittedSpiceAttemptResumeInput,
): AdmittedSpiceTerminalJournalRecoveryAction {
  if (input.resolution === undefined) {
    return { action: "read-publication" };
  }
  if (
    input.resolution.runId !== input.executionRunId ||
    input.resolution.producerGeneration !== 1
  ) {
    return quarantine(
      "The admitted SPICE publication resolution names another producer generation.",
    );
  }
  if (input.resolution.status === "not-published") {
    return {
      action: "close-g1",
      message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
    };
  }
  if (input.resolution.status === "outcome-unknown") {
    return quarantine(
      "The admitted SPICE isolated-output outcome remains unknown; no redispatch is authorized.",
    );
  }
  return quarantine(
    "The admitted SPICE generation-one publication is already present; evidence-free terminal recovery is not authorized.",
  );
}

function decideDispatchingResume(
  input: AdmittedSpiceAttemptResumeInput,
): AdmittedSpiceAttemptResumeAction {
  if (input.producerGeneration !== 0 && input.producerGeneration !== 1) {
    return quarantine(
      "The admitted SPICE journal phase is not recoverable.",
    );
  }
  if (input.resolution === undefined) {
    return { action: "read-publication" };
  }
  if (
    input.resolution.runId !== input.executionRunId ||
    input.resolution.producerGeneration !== input.producerGeneration
  ) {
    return quarantine(
      "The admitted SPICE publication resolution names another producer generation.",
    );
  }
  if (input.resolution.status === "published") {
    if (
      deterministicJson(input.resolution.ref) !==
        deterministicJson(input.resolution.receipt.publication.ref)
    ) {
      return quarantine(
        "The admitted SPICE publication resolution reference differs from its receipt record.",
      );
    }
    return {
      action: "adopt-publication",
      receipt: input.resolution.receipt,
    };
  }
  if (input.resolution.status === "outcome-unknown") {
    return quarantine(
      "The admitted SPICE isolated-output outcome remains unknown; no redispatch is authorized.",
    );
  }
  if (input.producerGeneration === 1) {
    return {
      action: "close-g1",
      message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
    };
  }
  return { action: "cleanup-g0" };
}

function quarantine(
  message: string,
): Extract<AdmittedSpiceAttemptResumeAction, { action: "quarantine" }> {
  return { action: "quarantine", message };
}
