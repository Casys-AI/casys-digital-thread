/**
 * Provider-free executor for `buy.seal-configuration-cost@1`.
 *
 * Reopens the signed candidate, refuses a stale geometry/configuration, and
 * seals the same bundle bytes. No ERP refresh.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { buyGeometryApplicability } from "../../domain/buy/buy-applicability.ts";
import {
  recrossBuyCandidateSealAuthority,
  resolveBuyCandidateCaptureRun,
} from "../../domain/buy/buy-candidate-seal-authority.ts";
import {
  BUY_SEAL_CONFIGURATION_COST_OPERATION,
  BUY_SEAL_CONFIGURATION_COST_TOOL,
} from "../../domain/buy/buy-operations.ts";
import {
  type BuySealDecisionParameters,
  parseBuySealDecisionParameters,
} from "../../domain/buy/buy-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadEntityKind,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../shared/thread-write-basis-guard.ts";
import {
  type BuyCandidateCapture,
  canonicalBuyCandidateCaptureText,
  validateBuyCandidateCapture,
} from "../../domain/buy/buy-candidate-capture.ts";
import {
  BUY_SEAL_CAPTURE_SCHEMA,
  type BuyReviewStatus,
  type BuySealCapture,
  canonicalBuySealCaptureText,
  validateBuySealCapture,
} from "./buy-seal-capture.ts";
import {
  assertBuyCompleted,
  buyCommandStep,
  buyErrorMessage,
  exactBuyBasisSnapshot,
  requireBuyMrtrApproval,
  requireBuyOperationShape,
} from "./buy-executor-support.ts";

export { BUY_SEAL_CONFIGURATION_COST_OPERATION };

export const BUY_SEAL_THREAD_WRITE_OUTCOME_UNKNOWN =
  "buy-seal-configuration-cost-thread-write-outcome-unknown";

export interface BuySealThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface BuySealConfigurationCostRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: BuySealThreadSnapshotStore;
  readonly candidates: Pick<
    FileCaptureStore<"buy-configuration-cost-candidate">,
    "read"
  >;
  readonly captures: Pick<
    FileCaptureStore<"buy-configuration-cost-seal">,
    "save" | "read" | "uriFor"
  >;
  readonly lease: EngineeringProjectRunLease;
}

export class BuySealConfigurationCostRunExecutor {
  constructor(
    private readonly deps: BuySealConfigurationCostRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the buy-seal-configuration-cost run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireBuyOperationShape(
      project,
      run,
      BUY_SEAL_CONFIGURATION_COST_OPERATION.id,
      BUY_SEAL_CONFIGURATION_COST_OPERATION.version,
      BUY_SEAL_CONFIGURATION_COST_TOOL,
    );
    const { proposal } = requireBuyMrtrApproval(project, run, "Buy seal");
    try {
      parseBuySealDecisionParameters(proposal.parameters);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Buy seal decision parameters are invalid: ${buyErrorMessage(error)}`,
      );
    }
    return await this.deps.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      requireBuyOperationShape(
        preClaim,
        requireRun(preClaim, command.runId),
        BUY_SEAL_CONFIGURATION_COST_OPERATION.id,
        BUY_SEAL_CONFIGURATION_COST_OPERATION.version,
        BUY_SEAL_CONFIGURATION_COST_TOOL,
      );
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;
      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );
      const preClaimRun = requireRun(preClaim, command.runId);
      if (
        preClaimRun.status === "queued" ||
        preClaimRun.status === "running" ||
        preClaimRun.status === "publishing"
      ) {
        await this.deps.commands.claimRun(origin, {
          ...command,
          commandId: buyCommandStep(command.commandId, "claim"),
          summary: "Started the provider-free Buy cost seal.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(
          preClaimRun,
          "queued or this agent's running/publishing",
        );
      }
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      if (run.status === "completed") {
        assertBuyCompleted(project, command);
        return project;
      }
      const { decision, proposal } = requireBuyMrtrApproval(
        project,
        run,
        "Buy seal",
      );
      const decisionParams = parseBuySealDecisionParameters(
        proposal.parameters,
      );
      const basis = requireBasis(run);
      const basisSnapshot = await exactBuyBasisSnapshot(
        this.deps.snapshots,
        basis,
      );
      await assertThreadSnapshotLineageIntact(
        basisSnapshot,
        this.deps.snapshots,
      );
      const candidate = await this.#reopenCandidate(
        decisionParams,
        basisSnapshot,
        project,
        command.projectId,
        basis,
      );
      const applicability = buyGeometryApplicability(
        basisSnapshot,
        candidate.configuration,
      );
      if (applicability.status !== "current") {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          applicability.status === "historical"
            ? applicability.reason
            : applicability.reason,
        );
      }
      const reviewStatus = reviewStatusFor(candidate.bundle.coverage.status);
      const sealedAt = requiredStart(run);
      const capture: BuySealCapture = {
        schemaVersion: BUY_SEAL_CAPTURE_SCHEMA,
        kind: "buy.configuration-cost-sealed",
        operation: BUY_SEAL_CONFIGURATION_COST_OPERATION,
        trustedRunId: run.id,
        decisionId: decision.id,
        candidateDigest: decisionParams.candidateDigest,
        bundleDigest: candidate.bundleDigest,
        configurationDigest: candidate.configurationDigest,
        configuration: candidate.configuration,
        bundle: candidate.bundle,
        sourceCaptures: candidate.sourceCaptures,
        coverageStatus: candidate.bundle.coverage.status,
        reviewStatus,
        sealedAt,
      };
      const validated = await validateBuySealCapture(capture);
      if (validated.bundleDigest !== decisionParams.bundleDigest) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "Sealed bundle digest does not match the signed candidate bundle digest.",
        );
      }
      const captureText = canonicalBuySealCaptureText(validated);
      const captureFingerprint = await sha256Fingerprint(validated);
      await this.deps.captures.save(captureFingerprint, captureText);
      const readBack = await this.deps.captures.read(captureFingerprint);
      if (readBack !== captureText) {
        throw new Error(
          "Buy seal capture was not durably readable after save.",
        );
      }
      const successor = buildSealSuccessor({
        basisSnapshot,
        basis,
        run,
        capture: validated,
        captureFingerprint,
        captureUri: this.deps.captures.uriFor(captureFingerprint),
        candidate,
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.deps.snapshots.save(successor.snapshot);
      const snapshotReadback = await this.deps.snapshots.getFresh(
        successor.snapshot.id,
      );
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !==
          deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Buy seal ThreadSnapshot was not durably readable after save.",
        );
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.deps.commands.publishRun(origin, {
          ...command,
          commandId: buyCommandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed Buy configuration-cost bundle.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.deps.commands.completeRun(origin, {
          ...command,
          commandId: buyCommandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            `Sealed Buy cost bundle ${validated.bundleDigest} with reviewed ${validated.reviewStatus} status.`,
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact" as ThreadEntityKind,
            id: successor.artifact.id,
          }],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const complete = await this.#requiredProject(command.projectId);
      assertBuyCompleted(complete, command);
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Buy seal evidence may be durable but project attachment " +
            `did not finish (${BUY_SEAL_THREAD_WRITE_OUTCOME_UNKNOWN}). ` +
            `Cause: ${buyErrorMessage(error)}`,
        );
      }
      if (claimed) {
        try {
          await this.deps.commands.failRun(origin, {
            ...command,
            commandId: buyCommandStep(command.commandId, "fail"),
            expectedRevision: (await this.#requiredProject(command.projectId)).revision,
            summary:
              "Buy configuration-cost seal failed before a durable Thread write.",
            code: "buy-seal-configuration-cost-failed",
            message: buyErrorMessage(error),
          });
        } catch {
          // The original error is the one to surface.
        }
      }
      throw error;
    }
  }

  async #reopenCandidate(
    decisionParams: BuySealDecisionParameters,
    snapshot: ThreadSnapshot,
    project: EngineeringProjectSnapshot,
    projectId: string,
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<BuyCandidateCapture> {
    const artifact = snapshot.artifacts.find((item) =>
      item.fingerprint.digest === decisionParams.candidateDigest
    );
    if (!artifact) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Signed Buy candidate is absent from the basis snapshot.",
      );
    }
    const text = await this.deps.candidates.read(artifact.fingerprint);
    if (text === undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The signed Buy candidate capture is not readable.",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The signed Buy candidate capture is not JSON.",
      );
    }
    const candidate = await validateBuyCandidateCapture(value);
    if (canonicalBuyCandidateCaptureText(candidate) !== text) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Buy candidate capture bytes are not canonical.",
      );
    }
    const fingerprint = await sha256Fingerprint(candidate);
    if (fingerprint.digest !== decisionParams.candidateDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Reopened candidate digest does not match the signed digest.",
      );
    }
    if (candidate.bundleDigest !== decisionParams.bundleDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Candidate bundle digest diverged from the signed seal parameters.",
      );
    }
    if (candidate.configurationDigest !== decisionParams.configurationDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Candidate configuration digest diverged from the signed seal parameters.",
      );
    }
    if (
      candidate.configuration.geometry.stepFingerprint !==
        decisionParams.stepFingerprint
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Candidate STEP fingerprint diverged from the signed seal parameters.",
      );
    }
    if (candidate.bundle.coverage.status !== decisionParams.coverageStatus) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Candidate coverage status diverged from the signed seal parameters.",
      );
    }
    const authority = recrossBuyCandidateSealAuthority({
      projectId,
      sealBasis: basis,
      configuration: candidate.configuration,
      trustedRunId: candidate.trustedRunId,
      producerRunId: artifact.producer.runId,
      captureRun: resolveBuyCandidateCaptureRun(
        project,
        candidate.trustedRunId,
      ),
    });
    if (authority.status !== "current") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        authority.reason,
      );
    }
    return candidate;
  }

  async #requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.deps.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #completedFor(
    command: { readonly projectId: string; readonly runId: string },
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = project.agentRuns.find((item) => item.id === command.runId);
    if (run?.status === "completed") {
      assertBuyCompleted(project, command);
      return project;
    }
    return undefined;
  }
}

function reviewStatusFor(
  coverage: BuySealCapture["coverageStatus"],
): BuyReviewStatus {
  if (coverage === "complete") return "complete";
  if (coverage === "partial") return "partial";
  return "documentary";
}

function buildSealSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: BuySealCapture;
  readonly captureFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly captureUri: string;
  readonly candidate: BuyCandidateCapture;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = `buy-cost-bundle-${input.capture.bundleDigest}`;
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Buy cost bundle ${input.capture.bundleDigest.slice(0, 12)}`,
    kind: "document",
    version: input.capture.bundleDigest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: BUY_SEAL_CONFIGURATION_COST_TOOL,
      runId: input.run.id,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const extension: ThreadSnapshotExtension = {
    id: `buy-seal-configuration-cost-${input.run.id}`,
    name: "Seal the reviewed Buy configuration-cost bundle",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This exact Buy cost bundle is already present in the basis snapshot.",
    );
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, artifact };
}
