import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../domain/fea/seal-case/fea-proof-proposal.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/architecture/renderer/architecture-proposal.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "../../domain/architecture/part-definitions/part-definitions-capture.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../domain/cad/canonical/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-proposal.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/architecture/seed/syson-model-seed.ts";
import {
  EngineeringProjectCommandError,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import { assertApprovedUncertainWriterBasisRelease } from "../../domain/record/uncertain-writer-basis-release.ts";
import {
  assertApprovedUncertainWriterReconciliation,
  TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES,
} from "../../domain/record/reconcile-uncertain-writer-proposal.ts";
import {
  closedUncertainWriterLifecycleQualifier,
  type UncertainWriterLifecycleQualifier,
} from "../../application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../orchestration/operations/fea-isolated-static-proof.ts";
import { COMPILE_SEAL_ADMISSION_PRODUCER_TOOL } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../domain/cad/isolated/build123d-execution-proposal.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../domain/modelica/admitted/run-proposal.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "../../domain/modelica/thermal-method-sheet-proposal.ts";
import { VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION } from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-decision-proposal.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../domain/thread/thread-retirement.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { DESIGN_APPLY_VECTOR_CORRECTION_OPERATION } from "../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
} from "../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import { PRESCRIBED_KINEMATICS_OPERATIONS } from "../../domain/mechanism/prescribed-kinematics/operations.ts";

const THREAD_WRITE_OPERATIONS = new Set([
  `${MODEL_WRITE_ARCHITECTURE_OPERATION.id}@${MODEL_WRITE_ARCHITECTURE_OPERATION.version}`,
  `${MODEL_WRITE_REQUIREMENTS_OPERATION.id}@${MODEL_WRITE_REQUIREMENTS_OPERATION.version}`,
  `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`,
  `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version}`,
  `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
  `${VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION.version}`,
  `${VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.version}`,
  COMPILE_SEAL_ADMISSION_PRODUCER_TOOL,
  `${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id}@${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version}`,
  `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}`,
  `${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id}@${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version}`,
  `${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version}`,
  `${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version}`,
  `${SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id}@${SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version}`,
  `${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id}@${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version}`,
  `${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version}`,
  `${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id}@${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version}`,
  `${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id}@${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version}`,
  `${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id}@${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version}`,
  `${ARCHIVE_LINEAGE_OPERATION.id}@${ARCHIVE_LINEAGE_OPERATION.version}`,
  `${SYSON_MODEL_SEED_OPERATION.id}@${SYSON_MODEL_SEED_OPERATION.version}`,
  `${MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.id}@${MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.version}`,
  `${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id}@${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version}`,
  `${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id}@${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version}`,
  `${MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id}@${MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version}`,
  `${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id}@${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version}`,
  `${VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id}@${VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version}`,
  `${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version}`,
  `${DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id}@${DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.version}`,
  `${DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.id}@${DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.version}`,
  `${DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id}@${DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version}`,
  `${DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id}@${DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version}`,
  `${DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id}@${DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.version}`,
  `${DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.id}@${DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.version}`,
  ...PRESCRIBED_KINEMATICS_OPERATIONS.map((operation) =>
    `${operation.id}@${operation.version}`
  ),
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
  "verify-seal-modelica-thermal-method-sheet-thread-write-outcome-unknown",
  "verify-evaluate-admitted-modelica-observations-thread-write-outcome-unknown",
  "decide-accept-admitted-modelica-evaluation-thread-write-outcome-unknown",
  "decide-accept-cross-domain-impact-thread-write-outcome-unknown",
  "decide-reject-admitted-modelica-evaluation-thread-write-outcome-unknown",
  "decide-accept-assembly-integrity-evaluation-not-published",
  "decide-reject-assembly-integrity-evaluation-not-published",
  "decide-accept-evaluation-closeout-thread-write-outcome-unknown",
  "decide-reject-evaluation-closeout-thread-write-outcome-unknown",
  "analyze-seal-sensitivity-study-thread-write-outcome-unknown",
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
  lifecycle: UncertainWriterLifecycleQualifier =
    closedUncertainWriterLifecycleQualifier,
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
    if (sibling.status === "failed" && sibling.uncertainWriterReconciliation) {
      try {
        await assertApprovedUncertainWriterReconciliation(project, sibling);
      } catch {
        throw unavailableBasis(
          `uncertain write in sibling run ${sibling.id} has no exact approved human reconciliation`,
        );
      }
      if (
        sibling.uncertainWriterReconciliation.outcome === "write-effect-accepted"
      ) {
        try {
          await assertApprovedUncertainWriterBasisRelease(project, sibling);
        } catch {
          throw unavailableBasis(
            `accepted uncertain write in sibling run ${sibling.id} still requires an approved human basis release`,
          );
        }
      }
      continue;
    }
    const dedicatedUncertainFailure = sibling.status === "failed" &&
      !!sibling.failure &&
      (operationKey === GEOMETRY_WRITE_OPERATION ||
        TERMINAL_THREAD_WRITE_FAILURES.has(sibling.failure.code));
    const lifecycleQualified = !dedicatedUncertainFailure &&
      sibling.status === "failed" &&
      !!sibling.failure &&
      (await lifecycle.qualify({
          project,
          failedRunId: sibling.id,
        })).status === "qualified-uncertain-write";
    const isTerminalUncertainFailure = dedicatedUncertainFailure ||
      lifecycleQualified;
    if (isTerminalUncertainFailure) {
      throw unavailableBasis(
        `sibling run ${sibling.id} has an active, completed, or uncertain durable write`,
      );
    }
  }
}

/**
 * Smallest claim-run injection: only Thread writers on a ThreadSnapshot basis
 * re-enter the shared guard. Non-writers and approved-brief claims pass through.
 */
export async function assertThreadWriteClaimAllowed(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  lifecycle: UncertainWriterLifecycleQualifier =
    closedUncertainWriterLifecycleQualifier,
): Promise<void> {
  if (run.basis?.kind !== "thread-snapshot") return;
  const operation = project.workItems.find((item) => item.id === run.workItemId)
    ?.operation;
  const operationKey = operation ? `${operation.id}@${operation.version}` : undefined;
  if (!operationKey || !THREAD_WRITE_OPERATIONS.has(operationKey)) return;
  await assertThreadWriteBasisAvailable(project, run, lifecycle);
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
