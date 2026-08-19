/**
 * Ports around the immutable plan captured when a registered recorded run is
 * queued.  The command service owns the queue transition; adapters own CAS
 * persistence and resolution of qualified, code-owned operation details.
 */

import type { ContentFingerprint } from "../kernel/primitives.ts";
import type {
  ResolvedOperationPlanRef,
  ResolvedOperationPlanV2,
} from "../compile/rop/resolved-operation-plan-v2.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectPreviousSnapshot,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "./engineering-project.ts";

/** Immutable pre-commit view. A sealer cannot mutate project or run state. */
export interface RegisteredRunPlanSealInput {
  readonly project: EngineeringProjectSnapshot;
  readonly workItem: EngineeringWorkItem;
  /** Candidate already has its ordinary, plan-independent input fingerprint. */
  readonly run: EngineeringAgentRun;
  /** Exact immutable project revision from which this queue candidate was derived. */
  readonly queueBasisProject: EngineeringProjectPreviousSnapshot & {
    readonly fingerprint: ContentFingerprint;
  };
}

/**
 * The only writer authority for a resolved plan. It must save and reread the
 * canonical bytes before returning a reference; a failed seal aborts queueing.
 */
export interface RegisteredRunPlanSealer {
  seal(input: RegisteredRunPlanSealInput): Promise<ResolvedOperationPlanRef>;
}

/** Read-only plan retrieval. Callers may only follow an existing stamped ref. */
export interface ResolvedRunPlanReader {
  read(ref: ResolvedOperationPlanRef): Promise<ResolvedOperationPlanV2>;
}
