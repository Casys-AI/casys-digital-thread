/**
 * Shared run-executor helper primitives for all standard V3 executor runs.
 *
 * WHY THIS MODULE EXISTS — thirteen standard V3 executor files each carried
 * byte-identical private copies of these five guards.  One canonical copy
 * eliminates silent divergence and makes the contract explicit: any executor
 * that needs a run, a ThreadSnapshot basis, a start timestamp, a snapshot
 * reference, or an unexpected-status error calls these functions and relies on
 * the same invariants.
 *
 * Zero I/O: imports come exclusively from src/domain/.
 */

import {
  EngineeringProjectCommandError,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";

/**
 * Resolve a run by id from the project snapshot.
 * Throws entity_not_found if the run is absent.
 */
export function requireRun(
  project: EngineeringProjectSnapshot,
  runId: string,
): EngineeringAgentRun {
  const run = project.agentRuns.find((item) => item.id === runId);
  if (!run) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Agent run ${runId} does not exist in project ${project.project.id}.`,
    );
  }
  return run;
}

/**
 * Assert that the run has an exact ThreadSnapshot basis.
 * Throws invalid_transition otherwise.
 */
export function requireBasis(
  run: EngineeringAgentRun,
): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Agent run ${run.id} must have an exact ThreadSnapshot basis.`,
    );
  }
  return run.basis;
}

/**
 * Assert that the run has a durable start timestamp.
 * Throws invalid_transition otherwise.
 */
export function requiredStart(run: EngineeringAgentRun): string {
  if (!run.startedAt || Number.isNaN(Date.parse(run.startedAt))) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Agent run ${run.id} has no durable start timestamp.`,
    );
  }
  return run.startedAt;
}

/**
 * Build the canonical EngineeringThreadSnapshotRef from a published snapshot.
 * Canonical name: snapshotRef — replaces the earlier snapshotReference alias.
 */
export function snapshotRef(
  snapshot: ThreadSnapshot,
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

/**
 * Build an invalid_transition error for a run found in an unexpected state.
 * Canonical name: unexpectedStatus — replaces the earlier unexpected alias.
 */
export function unexpectedStatus(
  run: EngineeringAgentRun,
  expected: string,
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `Agent run ${run.id} is in state ${run.status}; expected ${expected}.`,
  );
}

/**
 * Surface the cause of a failure that a coarser wrapper is about to replace.
 *
 * A post-dispatch executor cannot rethrow the original error — it owes the
 * caller the terminal `invalid_transition` that forbids blind retry. Without
 * this, the structural reason vanishes and only the wrapper's generic sentence
 * survives, which is what made a quarantined FEA run undiagnosable from its
 * receipt alone. The message is bounded so an unexpected payload cannot turn a
 * receipt into a dump, and non-Error throws still name what arrived.
 */
export function describeCause(error: unknown, maxLength = 400): string {
  const described = error instanceof Error
    ? `${error.name}: ${error.message}`
    : `non-error throw: ${String(error)}`;
  return described.length <= maxLength
    ? described
    : `${described.slice(0, maxLength)}…`;
}
