import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../domain/analysis/fea-proof-proposal.ts";
import {
  SIMULATE_RUN_MODELICA_SCENARIO_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
} from "../../domain/analysis/simulation-case-proposal.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/engineering/architecture-proposal.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/engineering/architecture-sysml-seal-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../domain/engineering/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/engineering/requirements-proposal.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/engineering/syson-model-seed.ts";
import {
  EngineeringProjectCommandError,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import { assertApprovedUncertainWriterBasisRelease } from "../../domain/project/uncertain-writer-basis-release.ts";
import { assertApprovedUncertainWriterReconciliation } from "../../domain/project/reconcile-uncertain-writer-proposal.ts";
import { TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES } from "../../domain/project/reconcile-uncertain-writer-proposal.ts";
import {
  SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../orchestration/operations/recorded-analysis.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../domain/analysis/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../domain/analysis/build123d-execution-proposal.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "../../domain/analysis/isolated-geometry-seal-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../domain/analysis/modelica-qualified-kit-run-proposal.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../domain/thread/thread-retirement.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
} from "../../orchestration/operations/inspection-drone-v4.ts";

const THREAD_WRITE_OPERATIONS = new Set([
  `${MODEL_WRITE_ARCHITECTURE_OPERATION.id}@${MODEL_WRITE_ARCHITECTURE_OPERATION.version}`,
  `${MODEL_WRITE_REQUIREMENTS_OPERATION.id}@${MODEL_WRITE_REQUIREMENTS_OPERATION.version}`,
  `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`,
  `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version}`,
  `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
  `${SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id}@${SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version}`,
  `${SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.id}@${SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.version}`,
  `${SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.id}@${SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.version}`,
  `${SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION.id}@${SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION.version}`,
  `${VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION.version}`,
  `${VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.version}`,
  `${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version}`,
  `${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id}@${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version}`,
  `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}`,
  `${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id}@${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version}`,
  `${SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id}@${SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version}`,
  `${ARCHIVE_LINEAGE_OPERATION.id}@${ARCHIVE_LINEAGE_OPERATION.version}`,
  `${SYSON_MODEL_SEED_OPERATION.id}@${SYSON_MODEL_SEED_OPERATION.version}`,
  `${INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION.id}@${INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION.version}`,
  `${INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION.id}@${INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION.version}`,
]);

/**
 * Provider-free Thread writes cannot use the generic provider reconciliation.
 * A dispatched local snapshot may already be durable and must be reopened and
 * attached as the exact successor before this basis can ever be released.
 */
const NON_RECONCILIABLE_THREAD_WRITE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "compile-seal-admission-thread-write-outcome-unknown",
  "model-seal-architecture-sysml-thread-write-outcome-unknown",
  "design-seal-isolated-geometry-thread-write-outcome-unknown",
]);
/**
 * Exported alongside TERMINAL_THREAD_WRITE_FAILURES so the reconcile executor
 * can determine whether a geometry failure is eligible for reconciliation.
 * Geometry writes are conservatively terminal even without a quarantine code.
 */
export const GEOMETRY_WRITE_OPERATION =
  `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`;

/**
 * Exported so the reconcile-uncertain-writer executor can check eligibility
 * (only runs whose failure code is terminal-uncertain — or the geometry write
 * which is always conservatively terminal — can be reconciled).  The guard
 * itself is the canonical reader; this export exists solely to avoid duplicating
 * the constant in the executor.
 */
export const TERMINAL_THREAD_WRITE_FAILURES = TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES;

/**
 * One linear Thread subject has only one legal `basis.revision + 1` successor.
 * Every trusted generic Thread writer therefore shares this exact lease key,
 * regardless of operation, work item, target component, or run id.
 */
export function threadWriteBasisLeaseScope(run: EngineeringAgentRun): string {
  const basis = requireThreadBasis(run);
  return deterministicJson({
    threadWriteBasis: {
      subjectId: basis.subjectId,
      snapshotId: basis.snapshotId,
      revision: basis.revision,
    },
  });
}

/**
 * Re-check the append boundary while the shared basis lease is held.
 *
 * Queued siblings do not block: one is allowed to win the lease. Once that
 * writer attaches its successor, every other queued sibling becomes stale at
 * this gate before capture, provider, asset, or ThreadSnapshot writes. A live
 * or terminal-uncertain sibling remains blocking after process death.
 */
export async function assertThreadWriteBasisAvailable(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<void> {
  const basis = requireThreadBasis(run);
  const subjectReferences = project.threadSnapshots.filter((reference) =>
    reference.subjectId === basis.subjectId
  );
  const highestRevision = subjectReferences.reduce(
    (highest, reference) => Math.max(highest, reference.revision),
    -1,
  );
  const declaredHeads = subjectReferences.filter((reference) =>
    reference.revision === highestRevision
  );
  if (
    project.project.subjectId !== basis.subjectId ||
    declaredHeads.length !== 1 ||
    declaredHeads[0]!.snapshotId !== basis.snapshotId ||
    declaredHeads[0]!.revision !== basis.revision
  ) {
    throw unavailableBasis(
      "its queued basis is no longer the unique declared project Thread head",
    );
  }

  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  for (const sibling of project.agentRuns) {
    if (sibling.id === run.id || !sameThreadBasis(sibling.basis, basis)) continue;
    const operation = workItems.get(sibling.workItemId)?.operation;
    const operationKey = operation ? `${operation.id}@${operation.version}` : undefined;
    if (
      !operationKey ||
      !THREAD_WRITE_OPERATIONS.has(operationKey)
    ) continue;
    if (
      sibling.status === "running" || sibling.status === "publishing" ||
      sibling.status === "completed"
    ) {
      throw unavailableBasis(
        `sibling run ${sibling.id} has an active, completed, or uncertain durable write`,
      );
    }
    const isNonReconciliableThreadWriteFailure = sibling.status === "failed" &&
      !!sibling.failure &&
      NON_RECONCILIABLE_THREAD_WRITE_FAILURE_CODES.has(sibling.failure.code);
    if (isNonReconciliableThreadWriteFailure) {
      throw unavailableBasis(
        `sibling run ${sibling.id} has a local ThreadSnapshot write whose outcome requires exact recovery attachment`,
      );
    }
    const isTerminalUncertainFailure = sibling.status === "failed" &&
      !!sibling.failure &&
      (operationKey === GEOMETRY_WRITE_OPERATION ||
        TERMINAL_THREAD_WRITE_FAILURES.has(sibling.failure.code));
    if (isTerminalUncertainFailure && !sibling.uncertainWriterReconciliation) {
      throw unavailableBasis(
        `sibling run ${sibling.id} has an active, completed, or uncertain durable write`,
      );
    }
    if (isTerminalUncertainFailure) {
      try {
        await assertApprovedUncertainWriterReconciliation(project, sibling);
      } catch {
        throw unavailableBasis(
          `uncertain write in sibling run ${sibling.id} has no exact approved human reconciliation`,
        );
      }
      if (sibling.uncertainWriterReconciliation!.outcome === "write-effect-accepted") {
        try {
          await assertApprovedUncertainWriterBasisRelease(project, sibling);
        } catch {
          throw unavailableBasis(
            `accepted uncertain write in sibling run ${sibling.id} still requires an approved human basis release`,
          );
        }
      }
    }
  }
}

function requireThreadBasis(run: EngineeringAgentRun): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} does not have a ThreadSnapshot write basis.`,
    );
  }
  return run.basis;
}

function sameThreadBasis(
  candidate: EngineeringAgentRun["basis"],
  expected: EngineeringThreadSnapshotBasis,
): boolean {
  return candidate?.kind === "thread-snapshot" &&
    candidate.snapshotId === expected.snapshotId &&
    candidate.revision === expected.revision &&
    candidate.subjectId === expected.subjectId;
}

function unavailableBasis(reason: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `Thread write basis is unavailable because ${reason}. Requeue the work from ` +
      "the current declared Thread head after resolving any uncertain writer.",
  );
}
