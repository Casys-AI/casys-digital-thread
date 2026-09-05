/**
 * CAS-backed implementation of the resolved run-plan ports.
 *
 * The plan is inert until a queued EngineeringAgentRun references it. A crash
 * after CAS publication but before the project commit can leave an orphaned
 * object, but no public API accepts an arbitrary CAS URI or digest to adopt it.
 */

import {
  canonicalResolvedOperationPlanV2Text,
  fingerprintResolvedOperationPlanV2,
  RESOLVED_OPERATION_PLAN_REF_SCHEMA,
  RESOLVED_OPERATION_PLAN_URI_NAMESPACE,
  resolvedOperationPlanIdForRun,
  type ResolvedOperationPlanRef,
  type ResolvedOperationPlanV2,
  sameResolvedOperationPlanRef,
  validateResolvedOperationPlanRef,
  validateResolvedOperationPlanV2,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type {
  RegisteredRunPlanSealer,
  RegisteredRunPlanSealInput,
  ResolvedRunPlanReader,
} from "../../../domain/project/resolved-run-plan-sealer.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  canonicalResolvedCapabilityRuntimeOperationText,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";

export const RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR = {
  kind: "resolved-operation-plan",
  directory: "state/local/resolved-operation-plans",
  uriNamespace: RESOLVED_OPERATION_PLAN_URI_NAMESPACE,
  label: "Resolved operation plan",
} as const;

/** Code-owned resolver; no agent/tool payload can furnish this plan. */
export interface RegisteredResolvedOperationPlanResolver {
  resolve(input: RegisteredRunPlanSealInput): Promise<unknown>;
}

export interface CaptureBackedRunPlanSealerOptions {
  readonly store: FileByteStore<"resolved-operation-plan">;
  readonly resolver: RegisteredResolvedOperationPlanResolver;
}

/**
 * Writes canonical plan text to FileByteStore, then proves the reread bytes
 * before returning the only reference a project snapshot is allowed to retain.
 */
export class CaptureBackedRunPlanSealer
  implements RegisteredRunPlanSealer, ResolvedRunPlanReader {
  constructor(private readonly options: CaptureBackedRunPlanSealerOptions) {}

  async seal(input: RegisteredRunPlanSealInput): Promise<ResolvedOperationPlanRef> {
    // The resolver is code-owned but still cannot be allowed to mutate the
    // value we later use to prove queue-time operational authority.
    const queuedOperationalCapability = input.operationalCapability === undefined
      ? undefined
      : canonicalResolvedCapabilityRuntimeOperationText(input.operationalCapability);
    const candidate = validateResolvedOperationPlanV2(
      await this.options.resolver.resolve(input),
    );
    await assertPlanBindsQueuedRun(candidate, {
      ...input,
      ...(queuedOperationalCapability === undefined
        ? {}
        : { operationalCapability: JSON.parse(queuedOperationalCapability) }),
    });
    const text = canonicalResolvedOperationPlanV2Text(candidate);
    const bytes = new TextEncoder().encode(text);
    const fingerprint = await fingerprintResolvedOperationPlanV2(candidate);
    const receipt = await this.options.store.save(fingerprint, bytes);
    if (
      receipt.byteCount !== bytes.byteLength ||
      !fingerprintsEqual(receipt.fingerprint, fingerprint) ||
      receipt.uri !==
        `casys://${RESOLVED_OPERATION_PLAN_URI_NAMESPACE}/sha256/${fingerprint.digest}`
    ) {
      throw new Error(
        "Resolved operation plan CAS receipt does not match sealed bytes.",
      );
    }
    const reread = await this.read({
      schemaVersion: RESOLVED_OPERATION_PLAN_REF_SCHEMA,
      planId: candidate.id,
      fingerprint,
      byteCount: bytes.byteLength,
      casUri: receipt.uri,
    });
    if (canonicalResolvedOperationPlanV2Text(reread) !== text) {
      throw new Error("Resolved operation plan CAS reread does not match sealed text.");
    }
    return validateResolvedOperationPlanRef({
      schemaVersion: RESOLVED_OPERATION_PLAN_REF_SCHEMA,
      planId: candidate.id,
      fingerprint,
      byteCount: bytes.byteLength,
      casUri: receipt.uri,
    });
  }

  async read(refInput: ResolvedOperationPlanRef): Promise<ResolvedOperationPlanV2> {
    const ref = validateResolvedOperationPlanRef(refInput);
    const bytes = await this.options.store.read(ref.fingerprint);
    if (!bytes) {
      throw new Error(`Resolved operation plan ${ref.planId} is absent from CAS.`);
    }
    const copied = bytes.copy();
    if (copied.byteLength !== ref.byteCount) {
      throw new Error(
        `Resolved operation plan ${ref.planId} has a mismatched byte count.`,
      );
    }
    const digest = await fingerprintResourceBytes(copied);
    if (digest !== ref.fingerprint.digest) {
      throw new Error(
        `Resolved operation plan ${ref.planId} has a mismatched fingerprint.`,
      );
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(copied);
    } catch {
      throw new Error(`Resolved operation plan ${ref.planId} is not valid UTF-8.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Resolved operation plan ${ref.planId} is not JSON.`);
    }
    const plan = validateResolvedOperationPlanV2(parsed);
    if (plan.id !== ref.planId) {
      throw new Error(
        `Resolved operation plan ${ref.planId} has a mismatched plan id.`,
      );
    }
    if (canonicalResolvedOperationPlanV2Text(plan) !== text) {
      throw new Error(`Resolved operation plan ${ref.planId} is not canonical JSON.`);
    }
    const actual = await fingerprintResolvedOperationPlanV2(plan);
    if (!fingerprintsEqual(actual, ref.fingerprint)) {
      throw new Error(
        `Resolved operation plan ${ref.planId} changed after CAS publication.`,
      );
    }
    return plan;
  }
}

/** Check all identities that can be known before project queue commit. */
async function assertPlanBindsQueuedRun(
  plan: ResolvedOperationPlanV2,
  input: RegisteredRunPlanSealInput,
): Promise<void> {
  if (plan.id !== resolvedOperationPlanIdForRun(input.run.id)) {
    throw new TypeError(
      "Resolved operation plan id does not belong to the candidate run.",
    );
  }
  if (
    plan.run.projectId !== input.project.project.id ||
    plan.run.runId !== input.run.id ||
    plan.run.workItemId !== input.workItem.id ||
    !input.run.inputFingerprint ||
    !fingerprintsEqual(plan.run.inputFingerprint, input.run.inputFingerprint)
  ) {
    throw new TypeError("Resolved operation plan does not bind the exact queued run.");
  }
  if (
    plan.run.queueBasisProject.snapshotId !== input.queueBasisProject.snapshotId ||
    plan.run.queueBasisProject.revision !== input.queueBasisProject.revision ||
    !fingerprintsEqual(
      plan.run.queueBasisProject.fingerprint,
      input.queueBasisProject.fingerprint,
    )
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the exact pre-queue project snapshot.",
    );
  }
  if (!input.operationalCapability) {
    throw new TypeError(
      "A resolved-operation-plan/2.0 candidate requires the queue-resolved operational capability.",
    );
  }
  if (
    canonicalResolvedCapabilityRuntimeOperationText(plan.operationalCapability) !==
      canonicalResolvedCapabilityRuntimeOperationText(input.operationalCapability)
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the exact queue-resolved operational capability.",
    );
  }
  const operation = input.workItem.operation;
  if (
    !operation || plan.workItem.id !== input.workItem.id ||
    plan.workItem.operation.id !== operation.id ||
    plan.workItem.operation.version !== operation.version ||
    !fingerprintsEqual(
      plan.workItem.operationFingerprint,
      await sha256Fingerprint(operation),
    )
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the registered work item.",
    );
  }
  if (
    input.run.basis?.kind !== "thread-snapshot" ||
    plan.basis.snapshotId !== input.run.basis.snapshotId ||
    plan.basis.revision !== input.run.basis.revision ||
    plan.basis.subjectId !== input.run.basis.subjectId
  ) {
    throw new TypeError(
      "Resolved operation plan must bind the exact candidate ThreadSnapshot basis.",
    );
  }
  await assertExactRecordedOperationMrtr(plan, input);
}

/**
 * A recorded vertical gets one direct, already approved MRTR decision. This
 * intentionally does not generalize into a decision-selection language.
 */
async function assertExactRecordedOperationMrtr(
  plan: ResolvedOperationPlanV2,
  input: RegisteredRunPlanSealInput,
): Promise<void> {
  const decisionIds = input.workItem.decisionIds;
  if (decisionIds.length !== 1) {
    throw new TypeError(
      "A resolved-operation-plan/2.0 run requires exactly one direct MRTR decision.",
    );
  }
  const decision = input.project.decisions.find((candidate) =>
    candidate.id === decisionIds[0]
  );
  if (
    !decision || decision.status !== "approved" || !decision.inputFingerprint ||
    decision.approvalIds.length === 0
  ) {
    throw new TypeError(
      "A resolved-operation-plan/2.0 run requires one directly approved MRTR decision with exact inputs.",
    );
  }
  const approvalId = decision.approvalIds.at(-1)!;
  const approval = input.project.approvals.find((candidate) =>
    candidate.id === approvalId
  );
  if (
    !approval || approval.decisionId !== decision.id || approval.status !== "approved"
  ) {
    throw new TypeError(
      "A resolved-operation-plan/2.0 run requires the current MRTR approval to be approved.",
    );
  }
  if (
    plan.authorization.mrtr.decisionId !== decision.id ||
    !fingerprintsEqual(
      plan.authorization.mrtr.decisionInputFingerprint,
      decision.inputFingerprint,
    ) ||
    plan.authorization.mrtr.approvalId !== approval.id ||
    !fingerprintsEqual(
      plan.authorization.mrtr.approvalFingerprint,
      await sha256Fingerprint(approval),
    )
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the exact direct MRTR decision and approval.",
    );
  }
}

/** Useful at the queue/receipt boundary without exposing a CAS selector. */
export function resolvedOperationPlanRefsAgree(
  left: ResolvedOperationPlanRef | undefined,
  right: ResolvedOperationPlanRef | undefined,
): boolean {
  return sameResolvedOperationPlanRef(left, right);
}
