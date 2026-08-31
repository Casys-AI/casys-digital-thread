/**
 * First Chrono adapter of the provider-neutral uncertain-writer lifecycle
 * qualifier. It may qualify a historical generic
 * `prescribed-kinematics-execution-failed` run only after an exact ROP and
 * L3 WAL recross. Dedicated Chrono terminal-uncertain codes stay in the
 * existing catalogue and are not granted here.
 *
 * A quarantined WAL is lifecycle evidence that a write outcome needs
 * reconciliation. It is not L3 observation evidence and not a verdict.
 */

import type {
  UncertainWriterLifecycleEligibility,
  UncertainWriterLifecycleQualificationInput,
  UncertainWriterLifecycleQualifier,
} from "../../../application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts";
import {
  UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED,
  UNCERTAIN_WRITER_LIFECYCLE_QUALIFIED,
} from "../../../domain/record/uncertain-writer-lifecycle-eligibility.ts";
import type {
  PrescribedKinematicsCaptureStore,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-capture-store.ts";
import type {
  PrescribedKinematicsCaseLowerer,
  PrescribedKinematicsLoweredCase,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-case-lowerer.ts";
import type {
  PrescribedKinematicsObservationAttempt,
  PrescribedKinematicsObservationAttemptStore,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-observation-attempt-store.ts";
import { assertPrescribedKinematicsLoweredCase } from "../../../application/use-cases/mechanics/prescribed-kinematics/prescribed-kinematics-receipt-readback.ts";
import type {
  PrescribedKinematicsRuntimeProvenance,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";
import type { ResolvedRunPlanReader } from "../../../domain/project/resolved-run-plan-sealer.ts";
import {
  fingerprintResolvedOperationPlanV2,
  type ResolvedOperationPlanV2,
  type ResolvedPrescribedKinematicsObservationAction,
  sameResolvedOperationPlanRef,
  validateResolvedOperationPlanRef,
  validateResolvedOperationPlanV2,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  fingerprintResolvedCapabilityRuntimeOperation,
  type ResolvedCapabilityRuntimeOperation,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  fingerprintChronoPrescribedKinematicsLowering,
} from "./chrono-prescribed-kinematics-case-lowerer.ts";
import {
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import { PrescribedKinematicsObservationAttemptIntegrityError } from "./file-prescribed-kinematics-observation-attempt-store.ts";

/** Historical generic Chrono failure. Not a TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES member. */
const GENERIC_PRESCRIBED_KINEMATICS_FAILURE =
  "prescribed-kinematics-execution-failed" as const;

const KINEMATICS_CAPABILITY = {
  id: "mechanics.observe-prescribed-kinematics",
  version: "1",
  use: "execution",
} as const;

export interface ChronoUncertainWriterLifecycleQualifierDependencies {
  readonly attempts: PrescribedKinematicsObservationAttemptStore;
  readonly plans: ResolvedRunPlanReader;
  readonly captures: Pick<PrescribedKinematicsCaptureStore, "readCase">;
  readonly lowerer: PrescribedKinematicsCaseLowerer;
}

export class ChronoUncertainWriterLifecycleQualifier
  implements UncertainWriterLifecycleQualifier {
  readonly #attempts: PrescribedKinematicsObservationAttemptStore;
  readonly #plans: ResolvedRunPlanReader;
  readonly #captures: Pick<PrescribedKinematicsCaptureStore, "readCase">;
  readonly #lowerer: PrescribedKinematicsCaseLowerer;

  constructor(dependencies: ChronoUncertainWriterLifecycleQualifierDependencies) {
    this.#attempts = dependencies.attempts;
    this.#plans = dependencies.plans;
    this.#captures = dependencies.captures;
    this.#lowerer = dependencies.lowerer;
  }

  async qualify(
    input: UncertainWriterLifecycleQualificationInput,
  ): Promise<UncertainWriterLifecycleEligibility> {
    try {
      return await this.#qualify(input);
    } catch (error) {
      if (
        error instanceof PrescribedKinematicsObservationAttemptIntegrityError ||
        error instanceof TypeError
      ) {
        return UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED;
      }
      throw error;
    }
  }

  async #qualify(
    input: UncertainWriterLifecycleQualificationInput,
  ): Promise<UncertainWriterLifecycleEligibility> {
    const run = input.project.agentRuns.find((candidate) =>
      candidate.id === input.failedRunId
    );
    const workItem = run
      ? input.project.workItems.find((item) => item.id === run.workItemId)
      : undefined;
    if (
      !run || !workItem ||
      !isGenericPrescribedKinematicsFailure(run, workItem)
    ) {
      return UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED;
    }
    const recrossed = await this.#recrossSealedPlan(input.project, run, workItem);
    if (!recrossed) return UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED;
    const attempt = await this.#attempts.read({
      projectId: input.project.project.id,
      agentRunId: run.id,
      requestId: recrossed.action.requestId,
    });
    if (!attempt || attempt.phase !== "quarantined") {
      return UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED;
    }
    if (
      !await this.#walMatchesSealedIdentities(
        input.project,
        run,
        recrossed.plan,
        recrossed.action,
        recrossed.runtime,
        attempt,
      )
    ) {
      return UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED;
    }
    return UNCERTAIN_WRITER_LIFECYCLE_QUALIFIED;
  }

  async #recrossSealedPlan(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    workItem: EngineeringWorkItem,
  ): Promise<
    | {
      readonly plan: ResolvedOperationPlanV2;
      readonly action: ResolvedPrescribedKinematicsObservationAction;
      readonly runtime: PrescribedKinematicsRuntimeProvenance;
    }
    | undefined
  > {
    if (
      !run.resolvedOperationPlan || run.basis?.kind !== "thread-snapshot" ||
      !workItem.operation
    ) {
      return undefined;
    }
    const ref = validateResolvedOperationPlanRef(run.resolvedOperationPlan);
    const plan = validateResolvedOperationPlanV2(await this.#plans.read(ref));
    const expectedFingerprint = await fingerprintResolvedOperationPlanV2(plan);
    if (
      plan.id !== ref.planId ||
      !fingerprintsEqual(expectedFingerprint, ref.fingerprint) ||
      !sameResolvedOperationPlanRef(run.resolvedOperationPlan, ref)
    ) {
      return undefined;
    }
    if (
      plan.run.projectId !== project.project.id ||
      plan.run.runId !== run.id ||
      plan.run.workItemId !== run.workItemId ||
      plan.workItem.id !== workItem.id ||
      !run.inputFingerprint ||
      !fingerprintsEqual(plan.run.inputFingerprint, run.inputFingerprint) ||
      plan.workItem.operation.id !==
        VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.id ||
      plan.workItem.operation.version !==
        VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.version ||
      !fingerprintsEqual(
        plan.workItem.operationFingerprint,
        await sha256Fingerprint(workItem.operation),
      ) ||
      plan.basis.snapshotId !== run.basis.snapshotId ||
      plan.basis.revision !== run.basis.revision ||
      plan.basis.subjectId !== run.basis.subjectId
    ) {
      return undefined;
    }
    if (plan.action.kind !== "prescribed-kinematics-observation") {
      return undefined;
    }
    const action = plan.action;
    if (
      plan.recovery.policy !== "prescribed-kinematics.observation-recovery@1.0" ||
      !("requestId" in plan.recovery) ||
      plan.recovery.requestId !== action.requestId ||
      action.lowering.id !== "prescribed-kinematics.case-json" ||
      action.lowering.version !== "1.0"
    ) {
      return undefined;
    }
    const source = plan.sources.find((candidate) =>
      candidate.bindingName === action.input.prescribedKinematicsCase.sourceBinding
    );
    if (
      !source ||
      source.threadRef.id !== action.input.prescribedKinematicsCase.id ||
      !fingerprintsEqual(
        source.artifact.fingerprint,
        action.input.prescribedKinematicsCase.fingerprint,
      )
    ) {
      return undefined;
    }
    const runtime = await sealedPrescribedKinematicsRuntimeFromPlan(plan);
    if (!runtime) return undefined;
    return { plan, action, runtime };
  }

  async #walMatchesSealedIdentities(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    plan: ResolvedOperationPlanV2,
    action: ResolvedPrescribedKinematicsObservationAction,
    runtime: PrescribedKinematicsRuntimeProvenance,
    attempt: Extract<
      PrescribedKinematicsObservationAttempt,
      { readonly phase: "quarantined" }
    >,
  ): Promise<boolean> {
    if (
      attempt.projectId !== project.project.id ||
      attempt.agentRunId !== run.id ||
      attempt.requestId !== action.requestId ||
      attempt.startedAt !== run.startedAt ||
      deterministicJson(attempt.runtime) !== deterministicJson(runtime)
    ) {
      return false;
    }
    const sealedCase = await this.#captures.readCase(
      action.input.prescribedKinematicsCase.fingerprint,
    );
    if (!sealedCase) return false;
    const sourceFingerprint =
      sealedCase.sourceClosure.workspace.root.resourceFingerprint;
    let lowered: PrescribedKinematicsLoweredCase;
    let historicalLoweringFingerprint: ContentFingerprint;
    try {
      lowered = await this.#lowerer.lower({
        source: sealedCase.sourceClosure.source,
        sourceFingerprint,
      });
      await assertPrescribedKinematicsLoweredCase(lowered, sourceFingerprint);
      historicalLoweringFingerprint =
        await fingerprintChronoPrescribedKinematicsLowering({
          sourceFingerprint,
          binding: {
            unitId: runtime.material.unitId,
            adapterVersion: runtime.adapter.version,
          },
        });
    } catch {
      return false;
    }
    const reconstructedCaseSha256 = lowered.requestFingerprint.digest;
    return fingerprintsEqual(attempt.caseFingerprint, sealedCase.fingerprint) &&
      fingerprintsEqual(attempt.sourceFingerprint, sourceFingerprint) &&
      fingerprintsEqual(attempt.sourceFingerprint, lowered.sourceFingerprint) &&
      fingerprintsEqual(
        attempt.loweringFingerprint,
        historicalLoweringFingerprint,
      ) &&
      fingerprintsEqual(attempt.requestFingerprint, lowered.requestFingerprint) &&
      attempt.caseSha256 === reconstructedCaseSha256 &&
      attempt.caseUri === `chrono-case:sha256:${reconstructedCaseSha256}` &&
      fingerprintsEqual(
        attempt.runtime.resolvedOperationPlanFingerprint,
        await fingerprintResolvedOperationPlanV2(plan),
      ) &&
      fingerprintsEqual(
        attempt.runtime.operationalCapabilityFingerprint,
        await fingerprintResolvedCapabilityRuntimeOperation(
          plan.operationalCapability,
        ),
      );
  }
}

function isGenericPrescribedKinematicsFailure(
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
): boolean {
  const operation = workItem.operation;
  return run.status === "failed" &&
    !!run.failure &&
    run.failure.code === GENERIC_PRESCRIBED_KINEMATICS_FAILURE &&
    run.evidenceRefs.length === 0 &&
    operation?.id === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.id &&
    operation.version === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.version;
}

/**
 * Runtime identity sealed on the recorded ROP. It recrosses historical WAL
 * provenance and must not consult the current enrolled Chrono publication.
 */
export async function sealedPrescribedKinematicsRuntimeFromPlan(
  plan: ResolvedOperationPlanV2,
): Promise<PrescribedKinematicsRuntimeProvenance | undefined> {
  const identities = runtimeIdentitiesFromOperationalCapability(
    plan.operationalCapability,
  );
  if (!identities) return undefined;
  return {
    ...identities,
    resolvedOperationPlanFingerprint: await fingerprintResolvedOperationPlanV2(plan),
    operationalCapabilityFingerprint:
      await fingerprintResolvedCapabilityRuntimeOperation(
        plan.operationalCapability,
      ),
  };
}

function runtimeIdentitiesFromOperationalCapability(
  operationalCapability: ResolvedCapabilityRuntimeOperation,
):
  | Omit<
    PrescribedKinematicsRuntimeProvenance,
    "resolvedOperationPlanFingerprint" | "operationalCapabilityFingerprint"
  >
  | undefined {
  const bindings = operationalCapability.bindings.filter((binding) =>
    binding.capability.id === KINEMATICS_CAPABILITY.id &&
    binding.capability.version === KINEMATICS_CAPABILITY.version &&
    binding.capability.use === KINEMATICS_CAPABILITY.use
  );
  if (bindings.length !== 1) return undefined;
  const binding = bindings[0]!;
  if (binding.materials.length !== 1 || binding.hostLifecycles.length !== 1) {
    return undefined;
  }
  const material = binding.materials[0]!;
  const lifecycle = binding.hostLifecycles[0]!;
  if (
    lifecycle.kind !== "persistent-compose" ||
    lifecycle.launchGroup === null ||
    !sameRuntimeMaterial(material, lifecycle.material)
  ) {
    return undefined;
  }
  const modes = binding.runtimeModes.filter((candidate) =>
    sameRuntimeMaterial(candidate.material, material)
  );
  if (modes.length !== 1) return undefined;
  const platformMode = modes[0]!.mode;
  if (
    platformMode !== "native" && platformMode !== "emulated" &&
    platformMode !== "unavailable"
  ) {
    return undefined;
  }
  return {
    binding: { ...binding.binding },
    adapter: { ...binding.adapter },
    profile: binding.profile === null ? null : { ...binding.profile },
    material: { ...material },
    launchGroup: structuredClone(lifecycle.launchGroup),
    platformMode,
  };
}

function sameRuntimeMaterial(
  left: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  },
  right: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  },
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
}
