/**
 * Pure resume choice for one admitted Modelica WAL.
 *
 * Decides the next closed action from the journal phase and an already-observed
 * publication resolution. It has no runner, attempt store, CAS, recovery,
 * clock, or dispatch capability. Only the adapter may mark, resolve, destroy,
 * advance, or call the runner after a local `transitioned-now`.
 */

import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { IsolatedCodeExecutionReceiptRecord } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { IsolatedOutputRunPublicationResolution } from "../../../ports/out/compile/isolation/isolated-code-runner.ts";

export type AdmittedModelicaAttemptPhase =
  | "prepared"
  | "dispatching"
  | "generation-zero-cleaned"
  | "output-published"
  | "completed"
  | "output-validation-rejected";

export interface AdmittedModelicaAttemptResumeInput {
  readonly phase: AdmittedModelicaAttemptPhase;
  readonly executionRunId: string;
  readonly producerGeneration?: 0 | 1;
  readonly resolution?: IsolatedOutputRunPublicationResolution;
}

export type AdmittedModelicaAttemptResumeAction =
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
  | { readonly action: "already-output-validation-rejected" }
  | { readonly action: "quarantine"; readonly message: string };

export function decideAdmittedModelicaAttemptResume(
  input: AdmittedModelicaAttemptResumeInput,
): AdmittedModelicaAttemptResumeAction {
  switch (input.phase) {
    case "completed":
      return quarantine(
        "The project run is active but its admitted Modelica journal is already completed.",
      );
    case "output-published":
      return { action: "already-published" };
    case "output-validation-rejected":
      return { action: "already-output-validation-rejected" };
    case "prepared":
      return { action: "transition-g0" };
    case "generation-zero-cleaned":
      return { action: "advance-g1" };
    case "dispatching":
      return decideDispatchingResume(input);
    default:
      return quarantine(
        "The admitted Modelica journal phase is not recoverable.",
      );
  }
}

function decideDispatchingResume(
  input: AdmittedModelicaAttemptResumeInput,
): AdmittedModelicaAttemptResumeAction {
  if (input.producerGeneration !== 0 && input.producerGeneration !== 1) {
    return quarantine(
      "The admitted Modelica journal phase is not recoverable.",
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
      "The admitted Modelica publication resolution names another producer generation.",
    );
  }
  if (input.resolution.status === "published") {
    if (
      deterministicJson(input.resolution.ref) !==
        deterministicJson(input.resolution.receipt.publication.ref)
    ) {
      return quarantine(
        "The admitted Modelica publication resolution reference differs from its receipt record.",
      );
    }
    return {
      action: "adopt-publication",
      receipt: input.resolution.receipt,
    };
  }
  if (input.resolution.status === "outcome-unknown") {
    return quarantine(
      "The admitted Modelica isolated-output outcome remains unknown; no redispatch is authorized.",
    );
  }
  if (input.producerGeneration === 1) {
    return {
      action: "close-g1",
      message:
        "The sole admitted Modelica retry generation produced no publication and was closed; no third dispatch exists.",
    };
  }
  return { action: "cleanup-g0" };
}

function quarantine(
  message: string,
): Extract<AdmittedModelicaAttemptResumeAction, { action: "quarantine" }> {
  return { action: "quarantine", message };
}
