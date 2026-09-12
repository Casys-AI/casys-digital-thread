/**
 * Recross a Buy candidate against the seal command without relabeling the
 * immutable configuration basis.
 *
 * Capture on Thread N publishes the candidate on N+1. Seal runs on N+1 while
 * configuration.basis remains N. Comparing that basis to the current seal
 * basis would refuse the valid successor path.
 */

import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../project/engineering-project.ts";
import { sameSnapshotRef } from "../project/validation/engineering-project-invariant-values.ts";
import type { BuyConfiguration } from "./buy-configuration.ts";
import { BUY_CAPTURE_CONFIGURATION_COST_OPERATION } from "./buy-operations.ts";

export type BuyCandidateSealAuthority =
  | { readonly status: "current" }
  | { readonly status: "refused"; readonly reason: string };

export interface BuyCandidateCaptureRunAuthority {
  readonly id: string;
  readonly status: string;
  readonly operationId: string;
  readonly basis?: EngineeringThreadSnapshotRef;
  readonly resultSnapshot?: EngineeringThreadSnapshotRef;
}

export function resolveBuyCandidateCaptureRun(
  project: Pick<EngineeringProjectSnapshot, "agentRuns" | "workItems">,
  trustedRunId: string,
): BuyCandidateCaptureRunAuthority | undefined {
  const run = project.agentRuns.find((item) => item.id === trustedRunId);
  if (!run) return undefined;
  return buyCandidateCaptureRunAuthority(project, run);
}

export function buyCandidateCaptureRunAuthority(
  project: Pick<EngineeringProjectSnapshot, "workItems">,
  run: Pick<
    EngineeringAgentRun,
    "id" | "status" | "workItemId" | "basis" | "resultSnapshot"
  >,
): BuyCandidateCaptureRunAuthority {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  return {
    id: run.id,
    status: run.status,
    operationId: workItem?.operation?.id ?? "",
    basis: run.basis?.kind === "thread-snapshot" ? run.basis : undefined,
    resultSnapshot: run.resultSnapshot,
  };
}

export function recrossBuyCandidateSealAuthority(input: {
  readonly projectId: string;
  readonly sealBasis: EngineeringThreadSnapshotRef;
  readonly configuration: BuyConfiguration;
  readonly trustedRunId: string;
  readonly producerRunId: string;
  readonly captureRun?: BuyCandidateCaptureRunAuthority;
}): BuyCandidateSealAuthority {
  if (input.configuration.projectId !== input.projectId) {
    return refused(
      "Buy candidate configuration projectId does not match the requested project.",
    );
  }
  if (
    input.configuration.subjectId !== input.sealBasis.subjectId ||
    input.configuration.basis.subjectId !== input.sealBasis.subjectId
  ) {
    return refused(
      "Buy candidate configuration subject does not match the seal Thread subject.",
    );
  }
  if (input.trustedRunId !== input.producerRunId) {
    return refused(
      "Buy candidate producer run does not match the captured trusted run.",
    );
  }
  const captureRun = input.captureRun;
  if (
    !captureRun ||
    captureRun.id !== input.trustedRunId ||
    captureRun.status !== "completed" ||
    captureRun.operationId !== BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id
  ) {
    return refused(
      "Buy candidate capture run is not the completed capture recorded on this project.",
    );
  }
  if (
    captureRun.basis === undefined ||
    !sameSnapshotRef(captureRun.basis, input.configuration.basis)
  ) {
    return refused(
      "Buy candidate capture run basis does not match the immutable configuration basis.",
    );
  }
  if (
    captureRun.resultSnapshot === undefined ||
    !sameSnapshotRef(captureRun.resultSnapshot, input.sealBasis)
  ) {
    return refused(
      "Buy candidate capture run result is not this exact seal Thread basis.",
    );
  }
  return { status: "current" };
}

function refused(reason: string): BuyCandidateSealAuthority {
  return { status: "refused", reason };
}
