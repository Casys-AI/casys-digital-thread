/**
 * One-shot L3 dispatch/recovery.  The only call to `run` follows a durable
 * WAL transition that this local continuation just made. Any later invocation
 * reads `readRun`/`readReceipt` only, so a crash cannot redispatch Chrono.
 */

import type {
  RunPrescribedKinematicsObservationCommand,
  RunPrescribedKinematicsObservationResult,
  RunPrescribedKinematicsObservationUseCase,
} from "../../../ports/in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";
import type { PrescribedKinematicsObservationAttemptStore } from "../../../ports/out/mechanics/prescribed-kinematics-observation-attempt-store.ts";
import type {
  PrescribedKinematicsCaseLowerer,
  PrescribedKinematicsLoweredCase,
} from "../../../ports/out/mechanics/prescribed-kinematics-case-lowerer.ts";
import type {
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsObserver,
} from "../../../ports/out/mechanics/prescribed-kinematics-observer.ts";
import {
  fingerprintsEqual,
  sha256Hex,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  parsePrescribedKinematicsObservation,
  prescribedKinematicsObservationMethod,
} from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import { fingerprintPrescribedKinematicsCaseSource } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import { validatePrescribedKinematicsCase } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";

export interface RunPrescribedKinematicsObservationDependencies {
  readonly attempts: PrescribedKinematicsObservationAttemptStore;
  readonly observer: PrescribedKinematicsObserver;
  readonly lowerer: PrescribedKinematicsCaseLowerer;
}

export class RunPrescribedKinematicsObservation
  implements RunPrescribedKinematicsObservationUseCase {
  readonly #attempts: PrescribedKinematicsObservationAttemptStore;
  readonly #observer: PrescribedKinematicsObserver;
  readonly #lowerer: PrescribedKinematicsCaseLowerer;

  constructor(dependencies: RunPrescribedKinematicsObservationDependencies) {
    this.#attempts = dependencies.attempts;
    this.#observer = dependencies.observer;
    this.#lowerer = dependencies.lowerer;
  }

  async execute(
    command: RunPrescribedKinematicsObservationCommand,
  ): Promise<RunPrescribedKinematicsObservationResult> {
    const sealedCase = await validatePrescribedKinematicsCase(command.sealedCase);
    const source = sealedCase.sourceClosure.source;
    const sourceFingerprint = await fingerprintPrescribedKinematicsCaseSource(source);
    if (
      !fingerprintsEqual(
        sourceFingerprint,
        sealedCase.sourceClosure.workspace.root.resourceFingerprint,
      )
    ) {
      throw new TypeError(
        "The reopened prescribed-kinematics source does not match its sealed workspace resource fingerprint.",
      );
    }
    const lowered = await this.#lowerer.lower({ source, sourceFingerprint });
    await assertLoweredCase(lowered, sourceFingerprint);
    const identity = {
      projectId: command.projectId,
      agentRunId: command.agentRunId,
      requestId: command.requestId,
      planFingerprint: command.planFingerprint,
      caseFingerprint: sealedCase.fingerprint,
      bindingFingerprint: command.bindingFingerprint,
      sourceFingerprint,
      loweringFingerprint: lowered.loweringFingerprint,
      requestFingerprint: lowered.requestFingerprint,
      startedAt: command.startedAt,
    };
    let attempt = await this.#attempts.prepare(identity);
    if (attempt.phase === "recorded") {
      return await this.#readRecordedOnly(
        identity,
        sealedCase,
        lowered,
        attempt.receiptSha256!,
      );
    }
    if (attempt.phase === "rejected") {
      return { status: "rejected", code: attempt.rejectionCode };
    }
    if (attempt.phase === "quarantined" || attempt.phase === "dispatching") {
      return await this.#recoverOnly(identity, sealedCase, lowered, attempt);
    }
    if (attempt.phase === "prepared") {
      // Submission is idempotent by case SHA and does not carry a run request.
      const submitted = await this.#observer.submitCase({
        exactCaseText: lowered.exactRequestText,
        requestFingerprint: lowered.requestFingerprint,
      });
      if (
        submitted.caseSha256 !== lowered.requestFingerprint.digest ||
        submitted.caseUri !== `chrono-case:sha256:${lowered.requestFingerprint.digest}`
      ) {
        throw new TypeError(
          "The provider case-submission readback does not bind the exact server-owned case bytes.",
        );
      }
      attempt = await this.#attempts.markCaseSubmitted(identity, submitted);
    }
    const dispatch = await this.#attempts.markDispatching(identity);
    if (!dispatch.dispatchNow) {
      return await this.#recoverOnly(identity, sealedCase, lowered, dispatch.attempt);
    }
    try {
      const result = await this.#observer.run({
        requestId: identity.requestId,
        caseSha256: dispatch.attempt.caseSha256,
        caseUri: dispatch.attempt.caseUri,
        sampleOffset: 0,
        sampleLimit: PAGE_LIMIT,
      });
      if (result.state === "rejected") return await this.#reject(identity, result.code);
      // Every non-recorded response occurs after the local durable dispatch
      // intent. Immediately read that same request identity; do not classify
      // a runner/store incident until readback has had this one chance to
      // recover a factual receipt, and never call run again.
      if (result.state !== "recorded") {
        return await this.#recoverOnly(identity, sealedCase, lowered, dispatch.attempt);
      }
      return await this.#recordReadback(identity, sealedCase, lowered, result.record);
    } catch {
      // The request may have crossed the network; next invocation is read-only.
      return await this.#quarantine(identity, "uncertain");
    }
  }

  async #recoverOnly(
    identity: Parameters<PrescribedKinematicsObservationAttemptStore["prepare"]>[0],
    sealedCase: Awaited<ReturnType<typeof validatePrescribedKinematicsCase>>,
    lowered: PrescribedKinematicsLoweredCase,
    attempt: Awaited<
      ReturnType<PrescribedKinematicsObservationAttemptStore["prepare"]>
    >,
  ): Promise<RunPrescribedKinematicsObservationResult> {
    if (attempt.phase === "recorded") {
      return await this.#readRecordedOnly(
        identity,
        sealedCase,
        lowered,
        attempt.receiptSha256!,
      );
    }
    if (attempt.phase === "rejected") {
      return { status: "rejected", code: attempt.rejectionCode };
    }
    try {
      const result = await this.#observer.readRun(identity.requestId, {
        sampleOffset: 0,
        sampleLimit: PAGE_LIMIT,
      });
      if (result.state === "absent") {
        return await this.#retainQuarantine(identity, attempt, "absent");
      }
      if (result.state === "uncertain") {
        return await this.#retainQuarantine(identity, attempt, "uncertain");
      }
      if (result.state === "rejected") {
        // `readRun` must not retroactively turn a durable dispatch intent into
        // a pre-dispatch rejection. Preserve quarantine/recovery instead.
        return await this.#retainQuarantine(identity, attempt, "malformed");
      }
      return await this.#recordReadback(identity, sealedCase, lowered, result.record);
    } catch {
      return await this.#retainQuarantine(identity, attempt, "malformed");
    }
  }

  async #retainQuarantine(
    identity: Parameters<PrescribedKinematicsObservationAttemptStore["prepare"]>[0],
    attempt: Awaited<
      ReturnType<PrescribedKinematicsObservationAttemptStore["prepare"]>
    >,
    observed: "uncertain" | "absent" | "malformed",
  ): Promise<RunPrescribedKinematicsObservationResult> {
    // A prior quarantine is immutable.  A later readback may promote it to a
    // recorded fact, but an absent or malformed readback must not rewrite its
    // original factual state into a synthetic engineering failure.
    if (attempt.phase === "quarantined") {
      return { status: "quarantined", reason: attempt.quarantineReason! };
    }
    return await this.#quarantine(identity, observed);
  }

  async #readRecordedOnly(
    identity: Parameters<PrescribedKinematicsObservationAttemptStore["prepare"]>[0],
    sealedCase: Awaited<ReturnType<typeof validatePrescribedKinematicsCase>>,
    lowered: PrescribedKinematicsLoweredCase,
    receiptSha256: string,
  ): Promise<RunPrescribedKinematicsObservationResult> {
    try {
      const record = await this.#readCompleteReceipt(receiptSha256);
      assertRecordBoundToIdentity(record, identity);
      return await recordToResult(record, sealedCase, lowered);
    } catch {
      return await this.#quarantine(identity, "malformed");
    }
  }

  async #recordReadback(
    identity: Parameters<PrescribedKinematicsObservationAttemptStore["prepare"]>[0],
    sealedCase: Awaited<ReturnType<typeof validatePrescribedKinematicsCase>>,
    lowered: PrescribedKinematicsLoweredCase,
    record: PrescribedKinematicsObservationRecord,
  ): Promise<RunPrescribedKinematicsObservationResult> {
    try {
      // A receipt reread is mandatory even after a direct acknowledgement: the
      // persisted receipt, not an acknowledgement, is the factual provenance.
      const reread = await this.#readCompleteReceipt(record.receipt.receiptSha256);
      assertRecordBoundToIdentity(reread, identity);
      // Validate every fact and its literal boundary before advancing the WAL
      // to recorded. A malformed receipt is recoverable quarantine, never a
      // durable L3 observation merely because a provider named a receipt.
      const result = await recordToResult(reread, sealedCase, lowered);
      await this.#attempts.markRecorded(identity, reread.receipt.receiptSha256);
      return result;
    } catch {
      return await this.#quarantine(identity, "malformed");
    }
  }

  async #quarantine(
    identity: Parameters<PrescribedKinematicsObservationAttemptStore["prepare"]>[0],
    reason: "uncertain" | "absent" | "malformed",
  ): Promise<RunPrescribedKinematicsObservationResult> {
    const attempt = await this.#attempts.markQuarantined(identity, reason);
    return attempt.phase === "quarantined"
      ? { status: "quarantined", reason: attempt.quarantineReason! }
      : { status: "quarantined", reason: "malformed" };
  }

  async #readCompleteReceipt(
    receiptSha256: string,
  ): Promise<PrescribedKinematicsObservationRecord> {
    const first = await this.#observer.readReceipt(receiptSha256, {
      sampleOffset: 0,
      sampleLimit: PAGE_LIMIT,
    });
    const samples: Array<(typeof first.samplePage.samples)[number]> = [];
    assertReceiptPage(first, first, 0, samples, new Set<number>());
    samples.push(...first.samplePage.samples);
    let current = first;
    while (current.samplePage.hasMore) {
      const nextOffset = samples.length;
      const next = await this.#observer.readReceipt(receiptSha256, {
        sampleOffset: nextOffset,
        sampleLimit: PAGE_LIMIT,
      });
      assertSameReceipt(first, next);
      assertReceiptPage(
        next,
        first,
        nextOffset,
        samples,
        new Set(samples.map((sample) => sample.timeSeconds)),
      );
      samples.push(...next.samplePage.samples);
      current = next;
    }
    if (samples.length !== first.samplePage.total) {
      throw new TypeError(
        "The prescribed-kinematics receipt pages do not cover their declared total.",
      );
    }
    return {
      ...first,
      samplePage: {
        sampleOffset: 0,
        sampleLimit: PAGE_LIMIT,
        total: first.samplePage.total,
        returned: samples.length,
        hasMore: false,
        samples,
      },
    };
  }

  async #reject(
    identity: Parameters<PrescribedKinematicsObservationAttemptStore["prepare"]>[0],
    code: Extract<
      RunPrescribedKinematicsObservationResult,
      { readonly status: "rejected" }
    >["code"],
  ): Promise<RunPrescribedKinematicsObservationResult> {
    const attempt = await this.#attempts.markRejected(identity, code);
    return { status: "rejected", code: attempt.rejectionCode };
  }
}

async function recordToResult(
  record: PrescribedKinematicsObservationRecord,
  sealedCase: Awaited<ReturnType<typeof validatePrescribedKinematicsCase>>,
  lowered: PrescribedKinematicsLoweredCase,
): Promise<RunPrescribedKinematicsObservationResult> {
  if (
    record.samplePage.hasMore || record.samplePage.returned !== record.samplePage.total
  ) {
    throw new TypeError(
      "The receipt did not return the complete bounded prescribed-kinematics sample page.",
    );
  }
  const method = await prescribedKinematicsObservationMethod();
  const observation = await parsePrescribedKinematicsObservation({
    schemaVersion: "prescribed-kinematics-observation/1.0",
    operation: { id: "verify.run-prescribed-kinematics", version: "1" },
    caseFingerprint: sealedCase.fingerprint,
    method,
    samples: record.samplePage.samples.map((sample) => ({
      timeS: sample.timeSeconds,
      poses: sample.bodies.map((body) => ({
        bodyId: body.bodyId,
        pose: {
          status: "observed",
          value: {
            positionM: body.positionMetres,
            orientationWxyz: body.rotationWxyz,
          },
        },
      })),
      jointAngles: sample.joints.map((joint) => ({
        jointId: joint.jointId,
        angleRad: { status: "observed", value: joint.motorAngleRadians },
      })),
      jointResiduals: sample.joints.map((joint) => ({
        jointId: joint.jointId,
        translationResidualM: {
          status: "observed",
          value: joint.translationResidualMetres,
        },
        rotationQuaternionImagResidual: {
          status: "observed",
          value: joint.rotationQuaternionImagResidual,
        },
      })),
    })),
    convergence: {
      status: "observed",
      value: record.receipt.executionState === "completed"
        ? "converged"
        : "not-converged",
    },
    limits: method.limits,
  }, sealedCase);
  return {
    status: "recorded",
    observation,
    request: {
      requestId: record.request.requestId,
      caseSha256: record.request.caseSha256,
    },
    receipt: record.receipt,
    notEvaluated: record.notEvaluated,
    lowering: {
      sourceFingerprint: lowered.sourceFingerprint,
      loweringFingerprint: lowered.loweringFingerprint,
      requestFingerprint: lowered.requestFingerprint,
    },
  };
}

function assertRecordBoundToIdentity(
  record: PrescribedKinematicsObservationRecord,
  identity: Parameters<PrescribedKinematicsObservationAttemptStore["prepare"]>[0],
): void {
  if (
    record.request.requestId !== identity.requestId ||
    record.request.caseSha256 !== identity.requestFingerprint.digest ||
    record.request.caseUri !==
      `chrono-case:sha256:${identity.requestFingerprint.digest}` ||
    record.receipt.caseSha256 !== identity.requestFingerprint.digest ||
    record.receipt.requestId !== identity.requestId
  ) {
    throw new TypeError(
      "The prescribed-kinematics receipt does not bind the exact dispatched request identity.",
    );
  }
}

const PAGE_LIMIT = 64;

function assertSameReceipt(
  expected: PrescribedKinematicsObservationRecord,
  observed: PrescribedKinematicsObservationRecord,
): void {
  if (
    observed.receipt.receiptSha256 !== expected.receipt.receiptSha256 ||
    observed.receipt.caseSha256 !== expected.receipt.caseSha256 ||
    observed.receipt.requestId !== expected.receipt.requestId ||
    observed.request.requestId !== expected.request.requestId ||
    observed.request.caseSha256 !== expected.request.caseSha256 ||
    observed.request.caseUri !== expected.request.caseUri ||
    observed.samplePage.total !== expected.samplePage.total ||
    observed.sampleCount !== expected.sampleCount
  ) {
    throw new TypeError(
      "A prescribed-kinematics receipt page changed identity or total during readback.",
    );
  }
}

function assertReceiptPage(
  pageRecord: PrescribedKinematicsObservationRecord,
  first: PrescribedKinematicsObservationRecord,
  expectedOffset: number,
  accumulated: PrescribedKinematicsObservationRecord["samplePage"]["samples"],
  seenTimes: ReadonlySet<number>,
): void {
  const page = pageRecord.samplePage;
  if (
    page.sampleOffset !== expectedOffset || page.sampleLimit !== PAGE_LIMIT ||
    page.returned !== page.samples.length || page.total !== first.samplePage.total ||
    page.total > 512 || page.total !== pageRecord.sampleCount ||
    page.returned !== Math.min(PAGE_LIMIT, page.total - expectedOffset) ||
    page.hasMore !== (expectedOffset + page.returned < page.total) ||
    accumulated.length !== expectedOffset
  ) {
    throw new TypeError(
      "The prescribed-kinematics receipt page is incomplete, overlapping, or has invalid bounds.",
    );
  }
  for (const sample of page.samples) {
    if (seenTimes.has(sample.timeSeconds)) {
      throw new TypeError(
        "The prescribed-kinematics receipt pages contain a duplicate sample time.",
      );
    }
  }
}

async function assertLoweredCase(
  lowered: PrescribedKinematicsLoweredCase,
  sourceFingerprint: PrescribedKinematicsLoweredCase["sourceFingerprint"],
): Promise<void> {
  if (
    !fingerprintsEqual(lowered.sourceFingerprint, sourceFingerprint) ||
    lowered.requestFingerprint.algorithm !== "sha256" ||
    lowered.loweringFingerprint.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(lowered.requestFingerprint.digest) ||
    !/^[a-f0-9]{64}$/.test(lowered.loweringFingerprint.digest) ||
    typeof lowered.exactRequestText !== "string" ||
    lowered.exactRequestText.length === 0 ||
    lowered.exactRequestText.length > 524_288
  ) {
    throw new TypeError(
      "The server-owned prescribed-kinematics lowering is absent, unbound, or exceeds its fixed bound.",
    );
  }
  if (
    (await sha256Hex(new TextEncoder().encode(lowered.exactRequestText))) !==
      lowered.requestFingerprint.digest
  ) {
    throw new TypeError(
      "The server-owned prescribed-kinematics lowering request fingerprint does not bind its exact bytes.",
    );
  }
}
