/** Server-owned admission, exact lookup and source-health recross. */

import type { Build123dExecutionProfile } from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../domain/project/engineering-project.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  compileSensitivityExperienceTarget,
  compileSensitivityExperienceTargetWithMethod,
  createSensitivityExperienceOriginBinding,
  deriveSensitivityExperienceRecord,
  makeSensitivityExperienceReuseReceipt,
  SENSITIVITY_EXPERIENCE_AUDIENCE,
  SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION,
  SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE,
  SENSITIVITY_EXPERIENCE_REUSE_REVIEW_SCHEMA,
  sensitivityExperienceExecutionPlanDigest,
  type SensitivityExperienceOriginBinding,
  type SensitivityExperienceRecord,
  type SensitivityExperienceReuseReason,
  type SensitivityExperienceReuseReceipt,
  type SensitivityExperienceReuseReview,
  type SensitivityExperienceSolverRuntimeIdentity,
  type SensitivityExperienceTarget,
} from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import type { SensitivityStudyCapture } from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import { validateSensitivityStudyCapture } from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import { liveSolverObservationForMetric } from "../../../domain/sensitivity/study/sensitivity-live-method.ts";
import type { SensitivityStudyCaseV3 } from "../../../domain/sensitivity/study/sensitivity-study-v3.ts";
import { SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL } from "../../../domain/sensitivity/study/sensitivity-study-seal-bindings.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  assertThreadSnapshotLineageIntact,
  threadSnapshotDescendsFrom,
} from "../../shared/stores/thread-snapshot-lineage.ts";
import { validateSensitivityStudyCaseCapture } from "../study/sensitivity-study-case-capture.ts";
import type {
  FeaSensitivityAttempt,
  FileFeaSensitivityAttemptStore,
} from "../live-fea/file-fea-sensitivity-attempt-store.ts";
import { FileSensitivityExperienceRepository } from "./file-sensitivity-experience-repository.ts";

export interface SensitivityExperienceCoordinatorDependencies {
  readonly repository: FileSensitivityExperienceRepository;
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly caseCaptures: Pick<FileCaptureStore<"sensitivity-study-case">, "read">;
  readonly studyCaptures: Pick<FileCaptureStore<"sensitivity-study">, "read">;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly executionAttempts: Pick<FileFeaSensitivityAttemptStore, "read">;
  readonly solverRuntime: SensitivityExperienceSolverRuntimeIdentity;
  readonly solverRuntimeAuthority: SensitivityExperienceSolverRuntimeAuthority;
}

export interface SensitivityExperienceSolverRuntimeAuthority {
  attest(expected: SensitivityExperienceSolverRuntimeIdentity): Promise<boolean>;
}

export interface SensitivityExperienceLookupResult {
  readonly review: SensitivityExperienceReuseReview;
  readonly reviewFingerprint: ContentFingerprint;
  readonly reviewUri: string;
  readonly selected?: {
    readonly record: SensitivityExperienceRecord;
    readonly origin: SensitivityExperienceOriginBinding;
  };
}

export class SensitivityExperienceCoordinator {
  constructor(
    private readonly dependencies: SensitivityExperienceCoordinatorDependencies,
  ) {}

  async compileTarget(input: {
    readonly studyCase: SensitivityStudyCaseV3;
    readonly admission: NonNullable<
      Awaited<ReturnType<TechnicalCompilationAdmissionReader["read"]>>
    >;
    readonly build123dProfile: Build123dExecutionProfile;
  }): Promise<SensitivityExperienceTarget> {
    if (
      !await this.dependencies.solverRuntimeAuthority.attest(
        this.dependencies.solverRuntime,
      )
    ) throw new Error("CalculiX runtime identity is unavailable or divergent.");
    return await compileSensitivityExperienceTarget({
      ...input,
      solverRuntime: this.dependencies.solverRuntime,
    });
  }

  async review(input: {
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly basisSnapshot: ThreadSnapshot;
    readonly target: SensitivityExperienceTarget;
    readonly reviewedAt: string;
  }): Promise<SensitivityExperienceLookupResult> {
    assertExactBasis(input.basisSnapshot, input.basis);
    const basisFingerprint = await sha256Fingerprint(input.basisSnapshot);
    let outcome: SensitivityExperienceReuseReview["outcome"] = "incompatible";
    let reasons: SensitivityExperienceReuseReason[] = ["scientific-key-miss"];
    let selection:
      | {
        readonly recordFingerprint: ContentFingerprint;
        readonly originBindingFingerprint: ContentFingerprint;
      }
      | undefined;
    let selected:
      | {
        readonly record: SensitivityExperienceRecord;
        readonly origin: SensitivityExperienceOriginBinding;
      }
      | undefined;
    try {
      const indexed = await this.dependencies.repository.lookup(
        input.target.scientificKey,
      );
      if (indexed) {
        const healthy: Array<{
          record: SensitivityExperienceRecord;
          recordFingerprint: ContentFingerprint;
          origin: SensitivityExperienceOriginBinding;
          originBindingFingerprint: ContentFingerprint;
        }> = [];
        let invalidOrUnhealthy = false;
        for (const indexedRecord of indexed.records) {
          for (
            const originBindingFingerprint of indexedRecord.originBindingFingerprints
          ) {
            const candidate = await this.#healthyCandidate({
              targetProjectId: input.projectId,
              target: input.target,
              recordFingerprint: indexedRecord.recordFingerprint,
              originBindingFingerprint,
            });
            if (candidate) healthy.push(candidate);
            else invalidOrUnhealthy = true;
          }
        }
        const recordDigests = new Set(
          healthy.map((candidate) => candidate.recordFingerprint.digest),
        );
        if (recordDigests.size > 1) {
          outcome = "unresolved";
          reasons = ["divergent-results"];
        } else if (healthy.length > 0) {
          healthy.sort((left, right) =>
            left.originBindingFingerprint.digest.localeCompare(
              right.originBindingFingerprint.digest,
            )
          );
          const canonical = healthy[0]!;
          outcome = "exact";
          reasons = ["exact-match"];
          selection = {
            recordFingerprint: canonical.recordFingerprint,
            originBindingFingerprint: canonical.originBindingFingerprint,
          };
          selected = { record: canonical.record, origin: canonical.origin };
        } else if (invalidOrUnhealthy) {
          outcome = "unavailable";
          reasons = ["source-unhealthy"];
        }
      }
    } catch {
      outcome = "unavailable";
      reasons = ["index-unavailable"];
    }
    const review: SensitivityExperienceReuseReview = {
      schemaVersion: SENSITIVITY_EXPERIENCE_REUSE_REVIEW_SCHEMA,
      audience: SENSITIVITY_EXPERIENCE_AUDIENCE,
      target: {
        projectId: input.projectId,
        basis: input.basis,
        basisFingerprint,
      },
      scientificKey: input.target.scientificKey,
      derivationProfile: SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE,
      compatibilityVersion: SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION,
      outcome,
      reasons,
      ...(selection ? { selection } : {}),
      freshExecutionRequired: outcome !== "exact",
      reviewedAt: input.reviewedAt,
    };
    const saved = await this.dependencies.repository.saveReview(review);
    return {
      review: saved.review,
      reviewFingerprint: saved.fingerprint,
      reviewUri: saved.uri,
      ...(selected ? { selected } : {}),
    };
  }

  async reopenReview(
    input: {
      readonly fingerprint: ContentFingerprint;
      readonly projectId: string;
      readonly basis: EngineeringThreadSnapshotBasis;
      readonly basisSnapshot: ThreadSnapshot;
      readonly target: SensitivityExperienceTarget;
    },
  ): Promise<SensitivityExperienceLookupResult> {
    const review = await this.dependencies.repository.readReview(input.fingerprint);
    if (!review) throw new Error("Sensitivity experience reuse review is absent.");
    assertExactBasis(input.basisSnapshot, input.basis);
    const basisFingerprint = await sha256Fingerprint(input.basisSnapshot);
    if (
      review.target.projectId !== input.projectId ||
      deterministicJson(review.target.basis) !== deterministicJson(input.basis) ||
      !fingerprintsEqual(review.target.basisFingerprint, basisFingerprint) ||
      !fingerprintsEqual(review.scientificKey, input.target.scientificKey)
    ) throw new Error("Sensitivity experience reuse review target basis is stale.");
    if (review.outcome !== "exact" || !review.selection) {
      return {
        review,
        reviewFingerprint: input.fingerprint,
        reviewUri:
          `casys://sensitivity-experience-reuse-review/sha256/${input.fingerprint.digest}`,
      };
    }
    const candidate = await this.#healthyCandidate({
      targetProjectId: review.target.projectId,
      target: {
        scientificKey: review.scientificKey,
        identity: input.target.identity,
      },
      recordFingerprint: review.selection.recordFingerprint,
      originBindingFingerprint: review.selection.originBindingFingerprint,
    });
    if (!candidate) {
      throw new Error("Recorded exact sensitivity experience is no longer healthy.");
    }
    return {
      review,
      reviewFingerprint: input.fingerprint,
      reviewUri:
        `casys://sensitivity-experience-reuse-review/sha256/${input.fingerprint.digest}`,
      selected: { record: candidate.record, origin: candidate.origin },
    };
  }

  async recordUnavailableReview(input: {
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly basisSnapshot: ThreadSnapshot;
    readonly target: SensitivityExperienceTarget;
    readonly reviewedAt: string;
  }): Promise<SensitivityExperienceLookupResult> {
    assertExactBasis(input.basisSnapshot, input.basis);
    const review: SensitivityExperienceReuseReview = {
      schemaVersion: SENSITIVITY_EXPERIENCE_REUSE_REVIEW_SCHEMA,
      audience: SENSITIVITY_EXPERIENCE_AUDIENCE,
      target: {
        projectId: input.projectId,
        basis: input.basis,
        basisFingerprint: await sha256Fingerprint(input.basisSnapshot),
      },
      scientificKey: input.target.scientificKey,
      derivationProfile: SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE,
      compatibilityVersion: SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION,
      outcome: "unavailable",
      reasons: ["source-unhealthy"],
      freshExecutionRequired: true,
      reviewedAt: input.reviewedAt,
    };
    const saved = await this.dependencies.repository.saveReview(review);
    return {
      review: saved.review,
      reviewFingerprint: saved.fingerprint,
      reviewUri: saved.uri,
    };
  }

  async createReceipt(input: {
    readonly review: SensitivityExperienceReuseReview;
    readonly reviewFingerprint: ContentFingerprint;
    readonly issuedAt: string;
  }): Promise<{
    readonly receipt: SensitivityExperienceReuseReceipt;
    readonly receiptFingerprint: ContentFingerprint;
    readonly receiptUri: string;
  }> {
    const receipt = await makeSensitivityExperienceReuseReceipt(input);
    const saved = await this.dependencies.repository.saveReceipt(receipt);
    return {
      receipt: saved.receipt,
      receiptFingerprint: saved.fingerprint,
      receiptUri: saved.uri,
    };
  }

  async reopenReceipt(fingerprint: ContentFingerprint): Promise<{
    readonly receipt: SensitivityExperienceReuseReceipt;
    readonly receiptFingerprint: ContentFingerprint;
    readonly receiptUri: string;
  }> {
    const receipt = await this.dependencies.repository.readReceipt(fingerprint);
    if (!receipt) throw new Error("Sensitivity experience reuse receipt is absent.");
    return {
      receipt,
      receiptFingerprint: fingerprint,
      receiptUri:
        `casys://sensitivity-experience-reuse-receipt/sha256/${fingerprint.digest}`,
    };
  }

  async admitFresh(input: {
    readonly target: SensitivityExperienceTarget;
    readonly capture: SensitivityStudyCapture;
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly studyArtifact: ThreadArtifact;
    readonly caseArtifact: ThreadArtifact;
    readonly admissionArtifact: ThreadArtifact;
    readonly trustedRunId: string;
    readonly executionPlanDigest: string;
    readonly admittedAt: string;
  }): Promise<void> {
    if (
      !await this.dependencies.solverRuntimeAuthority.attest(
        input.target.identity.method.solver.runtime,
      )
    ) throw new Error("CalculiX runtime identity changed during sensitivity run.");
    const record = await deriveSensitivityExperienceRecord(
      input.target,
      input.capture,
    );
    const recordFingerprint = await sha256Fingerprint(record);
    const origin = await createSensitivityExperienceOriginBinding({
      recordFingerprint,
      projectId: input.projectId,
      basis: input.basis,
      studyArtifact: input.studyArtifact,
      caseArtifact: input.caseArtifact,
      admissionArtifact: input.admissionArtifact,
      trustedRunId: input.trustedRunId,
      executionPlanDigest: input.executionPlanDigest,
      admittedAt: input.admittedAt,
    });
    await this.dependencies.repository.saveExperience(record, origin);
  }

  async #healthyCandidate(input: {
    readonly targetProjectId: string;
    readonly target: SensitivityExperienceTarget;
    readonly recordFingerprint: ContentFingerprint;
    readonly originBindingFingerprint: ContentFingerprint;
  }): Promise<
    {
      record: SensitivityExperienceRecord;
      recordFingerprint: ContentFingerprint;
      origin: SensitivityExperienceOriginBinding;
      originBindingFingerprint: ContentFingerprint;
    } | undefined
  > {
    try {
      const record = await this.dependencies.repository.readRecord(
        input.recordFingerprint,
      );
      const origin = await this.dependencies.repository.readOrigin(
        input.originBindingFingerprint,
      );
      if (
        !record || !origin || origin.source.projectId === input.targetProjectId ||
        !fingerprintsEqual(record.scientificKey, input.target.scientificKey) ||
        !fingerprintsEqual(origin.recordFingerprint, input.recordFingerprint)
      ) return undefined;
      if (
        !await this.dependencies.solverRuntimeAuthority.attest(
          record.identity.method.solver.runtime,
        )
      ) return undefined;
      const sourceSnapshotValue = await this.dependencies.snapshots.get(
        origin.source.basis.snapshotId,
      );
      if (!sourceSnapshotValue) return undefined;
      const sourceSnapshot = validateThreadSnapshot(sourceSnapshotValue);
      assertExactBasis(sourceSnapshot, origin.source.basis);
      await assertThreadSnapshotLineageIntact(
        sourceSnapshot,
        this.dependencies.snapshots,
      );
      const currentProject = await this.dependencies.projects.get(
        origin.source.projectId,
      );
      if (!currentProject) return undefined;
      const currentTip = selectCurrentThreadTip(currentProject.threadSnapshots);
      if (currentTip.status !== "ok") return undefined;
      const currentSnapshotValue = await this.dependencies.snapshots.get(
        currentTip.basis.snapshotId,
      );
      if (!currentSnapshotValue) return undefined;
      const currentSnapshot = validateThreadSnapshot(currentSnapshotValue);
      assertExactBasis(currentSnapshot, currentTip.basis);
      await assertThreadSnapshotLineageIntact(
        currentSnapshot,
        this.dependencies.snapshots,
      );
      if (
        !await threadSnapshotDescendsFrom(
          currentSnapshot,
          sourceSnapshot,
          this.dependencies.snapshots,
        )
      ) return undefined;
      const studyArtifact = requireHealthyArtifact(
        sourceSnapshot,
        origin.source.studyArtifact,
      );
      const caseArtifact = requireHealthyArtifact(
        sourceSnapshot,
        origin.source.caseArtifact,
      );
      const admissionArtifact = requireHealthyArtifact(
        sourceSnapshot,
        origin.source.admissionArtifact,
      );
      requireHealthyArtifact(currentSnapshot, origin.source.studyArtifact);
      requireHealthyArtifact(currentSnapshot, origin.source.caseArtifact);
      requireHealthyArtifact(currentSnapshot, origin.source.admissionArtifact);
      if (
        studyArtifact.producer.tool !== "analyze.run-fea-sensitivity@1" ||
        studyArtifact.producer.runId !== origin.source.trustedRunId ||
        caseArtifact.producer.tool !== "analyze.seal-sensitivity-study@1" ||
        admissionArtifact.producer.tool !== SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL
      ) return undefined;
      const studyText = await this.dependencies.studyCaptures.read(
        studyArtifact.fingerprint,
      );
      const caseText = await this.dependencies.caseCaptures.read(
        caseArtifact.fingerprint,
      );
      if (!studyText || !caseText) return undefined;
      const capture = await validateSensitivityStudyCapture(JSON.parse(studyText));
      const caseCapture = await validateSensitivityStudyCaseCapture(
        JSON.parse(caseText),
      );
      if (
        studyText !== deterministicJson(capture) ||
        caseText !== deterministicJson(caseCapture) ||
        capture.trustedRunId !== origin.source.trustedRunId ||
        capture.caseDigest !== caseCapture.caseDigest ||
        caseCapture.admissionArtifact.id !== admissionArtifact.id ||
        !fingerprintsEqual(
          caseCapture.admissionArtifact.fingerprint,
          admissionArtifact.fingerprint,
        )
      ) return undefined;
      const reopened = await this.dependencies.admissions.read({
        projectId: origin.source.projectId,
        basis: origin.source.basis,
        artifactId: admissionArtifact.id,
        artifactFingerprint: admissionArtifact.fingerprint,
      });
      if (!reopened) return undefined;
      const attempt = await this.dependencies.executionAttempts.read(
        origin.source.projectId,
        origin.source.trustedRunId,
      );
      if (
        !attempt || attempt.status !== "completed" ||
        attempt.planDigest !== origin.source.executionPlanDigest ||
        attempt.snapshot?.snapshotId !== origin.source.basis.snapshotId ||
        attempt.snapshot.revision !== origin.source.basis.revision ||
        attempt.snapshot.subjectId !== origin.source.basis.subjectId
      ) return undefined;
      if (!await attemptMatchesCapture(attempt, capture)) return undefined;
      const expectedPlanDigest = await sensitivityExperienceExecutionPlanDigest({
        caseDigest: caseCapture.caseDigest,
        cadSource: caseCapture.studyCase.cadSource,
        step: caseCapture.studyCase.step,
        scientificKey: record.scientificKey,
      });
      if (expectedPlanDigest !== attempt.planDigest) return undefined;
      const recompiledTarget = await compileSensitivityExperienceTargetWithMethod({
        studyCase: caseCapture.studyCase,
        admission: reopened,
        method: record.identity.method,
      });
      if (
        !fingerprintsEqual(recompiledTarget.scientificKey, record.scientificKey) ||
        deterministicJson(recompiledTarget.identity) !==
          deterministicJson(record.identity)
      ) return undefined;
      const rederived = await deriveSensitivityExperienceRecord(
        recompiledTarget,
        capture,
      );
      if (deterministicJson(rederived) !== deterministicJson(record)) return undefined;
      return {
        record,
        recordFingerprint: input.recordFingerprint,
        origin,
        originBindingFingerprint: input.originBindingFingerprint,
      };
    } catch {
      return undefined;
    }
  }
}

async function attemptMatchesCapture(
  attempt: FeaSensitivityAttempt,
  capture: SensitivityStudyCapture,
): Promise<boolean> {
  for (const phase of ["base", "stepped"] as const) {
    const cad = attempt.cad[phase];
    const solve = attempt.solves[phase];
    const capturedCad = capture.cad[phase];
    if (
      cad.status !== "published" || solve.status !== "captured" ||
      cad.executionRunId !== capturedCad.executionRunId ||
      cad.sourceSha256 !== capturedCad.sourceSha256 ||
      cad.stepSha256 !== capturedCad.stepSha256 ||
      cad.stepBytes !== capturedCad.stepBytes ||
      solve.stepSha256 !== cad.stepSha256 || solve.stepBytes !== cad.stepBytes
    ) return false;
    let envelope: unknown;
    try {
      envelope = JSON.parse(solve.canonicalSolveCaptureText);
    } catch {
      return false;
    }
    if (
      deterministicJson(envelope) !== solve.canonicalSolveCaptureText ||
      solve.captureFp !== (await sha256Fingerprint(envelope)).digest ||
      !recordedSolveMatchesMeasurements(
        envelope,
        phase,
        cad,
        capture.measurements[phase],
      )
    ) return false;
  }
  return true;
}

/**
 * Legacy private-reuse records stay a derived read model, but their health
 * recross now reads the V3 recorded-run capture rather than the retired
 * synthetic solver envelope. No provider status is promoted to a verdict.
 */
function recordedSolveMatchesMeasurements(
  value: unknown,
  phase: "base" | "stepped",
  cad: Extract<FeaSensitivityAttempt["cad"]["base"], { readonly status: "published" }>,
  measurements: readonly {
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
  }[],
): boolean {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== "mcp-calculix-sensitivity-capture/1.0"
  ) {
    return false;
  }
  const readback = value.readback;
  const result = value.result;
  if (
    !isPlainRecord(readback) || !isPlainRecord(result) ||
    readback.phase !== phase || readback.stepSha256 !== cad.stepSha256 ||
    readback.stepBytes !== cad.stepBytes
  ) {
    return false;
  }
  const observations = isPlainRecord(result.observations)
    ? result.observations
    : undefined;
  if (!observations) return false;
  for (const measurement of measurements) {
    const field = liveSolverObservationForMetric(measurement.metric);
    const observation = field === undefined ? undefined : observations[field];
    const magnitude = isPlainRecord(observation) && isPlainRecord(observation.magnitude)
      ? observation.magnitude
      : undefined;
    if (
      !magnitude || magnitude.value !== measurement.value ||
      magnitude.unit !== measurement.unit
    ) return false;
  }
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireHealthyArtifact(
  snapshot: ThreadSnapshot,
  expected: { readonly id: string; readonly fingerprint: ContentFingerprint },
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === expected.id);
  if (
    matches.length !== 1 ||
    !fingerprintsEqual(matches[0]!.fingerprint, expected.fingerprint) ||
    matches[0]!.freshness.status !== "fresh" ||
    archivedRefKeys(snapshot).has(`artifact:${expected.id}`)
  ) throw new Error("Sensitivity experience source artifact is unhealthy.");
  return matches[0]!;
}

function assertExactBasis(
  snapshot: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): void {
  if (
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) throw new Error("Sensitivity experience basis is stale or foreign.");
}
