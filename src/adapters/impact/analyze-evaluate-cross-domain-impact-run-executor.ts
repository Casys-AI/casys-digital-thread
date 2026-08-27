/**
 * Provider-free executor for `analyze.evaluate-cross-domain-impact@2`.
 *
 * It persists a closed X07 recross and one documentary Thread artifact.  The
 * artifact records proposed branch/gate-claim states only: it never changes
 * those claims, invalidates a work item, proposes a rerun, or calls an
 * engineering provider.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../application/ports/in/project-run-executor.ts";
import type { EvaluateCrossDomainImpactUseCase } from "../../application/ports/in/impact/evaluate-cross-domain-impact.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactEvaluationCaptureStore } from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
} from "../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
} from "../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import type { CrossDomainImpactReference } from "../../domain/impact/cross-domain-impact-manifest.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
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

export interface CrossDomainImpactEvaluationThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AnalyzeEvaluateCrossDomainImpactRunExecutorDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: CrossDomainImpactEvaluationThreadSnapshotStore;
  readonly evaluation: EvaluateCrossDomainImpactUseCase;
  readonly captures: CrossDomainImpactEvaluationCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class AnalyzeEvaluateCrossDomainImpactRunExecutor {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #commands:
    AnalyzeEvaluateCrossDomainImpactRunExecutorDependencies["commands"];
  readonly #snapshots: CrossDomainImpactEvaluationThreadSnapshotStore;
  readonly #evaluation: EvaluateCrossDomainImpactUseCase;
  readonly #captures: CrossDomainImpactEvaluationCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(dependencies: AnalyzeEvaluateCrossDomainImpactRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#evaluation = dependencies.evaluation;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the provider-free cross-domain impact analysis.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotWriteMayHaveBeenDispatched = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      const completed = await this.#completedFor(command);
      if (completed) return completed;

      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free cross-domain impact analysis.",
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free cross-domain impact analysis.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      // A concurrent completion is only idempotent when its persisted result
      // still reconstructs this exact successor.  Never return a completed
      // project before that replay check.
      const completedAfterClaim = await this.#completedFor(command);
      if (completedAfterClaim) return completedAfterClaim;
      requireClaimedShape(project, run, origin);
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);
      const evaluated = await this.#evaluation.execute({
        projectId: command.projectId,
        trustedRunId: run.id,
        basis: currentBasis,
        evaluatedAt: requiredStart(run),
      });
      if (evaluated.status !== "resolved") {
        throw invalidTransition(
          `The provider-free cross-domain impact analysis is ${evaluated.status}: ` +
            evaluated.diagnostics.map((item) => item.code).join(", "),
        );
      }

      const receipt = await this.#captures.save(evaluated.capture);
      const reopenedCapture = await this.#captures.read(receipt.fingerprint);
      if (
        !reopenedCapture ||
        deterministicJson(reopenedCapture) !== deterministicJson(evaluated.capture)
      ) {
        throw new Error(
          "Cross-domain impact evaluation capture changed during exact readback.",
        );
      }

      const expectedSuccessor = buildSuccessor({
        basisSnapshot: currentBasisSnapshot,
        run,
        capture: reopenedCapture,
        artifactInputs: evaluated.artifactInputs,
        captureFingerprint: receipt.fingerprint,
        captureUri: receipt.uri,
        manifestSealArtifactId: evaluated.manifestSealArtifactId,
      });
      snapshotWriteMayHaveBeenDispatched = true;
      await this.#snapshots.save(expectedSuccessor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(
        expectedSuccessor.snapshot.id,
      );
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !==
          deterministicJson(expectedSuccessor.snapshot)
      ) {
        throw new Error(
          "Impact-evaluation ThreadSnapshot was not exactly readable after save.",
        );
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the provider-free cross-domain impact evaluation capture.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(
          origin,
          completionCommand(
            command,
            project.revision,
            expectedSuccessor.snapshot,
            expectedSuccessor.artifact,
          ),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      await this.#assertCompletedEvidence(complete, command);
      return complete;
    } catch (error) {
      if (snapshotWriteMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw invalidTransition(
          "Impact-evaluation Thread write may have been dispatched, but project attachment did not finish. Retry this exact command to reopen the deterministic successor.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Project ${projectId} was not found.`,
      );
    }
    return project;
  }

  async #completedFor(
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#assertCompletedEvidence(project, command);
    return project;
  }

  async #assertCompletedEvidence(
    project: EngineeringProjectSnapshot,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    const basis = requireBasis(run);
    if (run.status !== "completed" || !run.resultSnapshot) {
      throw invalidTransition(
        "The cross-domain impact analysis did not complete through this exact run.",
      );
    }
    const resultSnapshot = run.resultSnapshot;
    const snapshot = await this.#snapshots.getFresh(resultSnapshot.snapshotId);
    if (
      !snapshot || snapshot.id !== resultSnapshot.snapshotId ||
      snapshot.revision !== resultSnapshot.revision ||
      snapshot.subject.id !== resultSnapshot.subjectId ||
      snapshot.revision !== basis.revision + 1 ||
      snapshot.subject.id !== basis.subjectId ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed cross-domain impact analysis lacks its exact direct Thread successor.",
      );
    }
    const validated = validateThreadSnapshot(snapshot);
    const evidence = exactCompletedEvidence(project, run, validated);
    const artifact = validated.artifacts.find((candidate) =>
      candidate.id === evidence.id
    );
    if (!artifact || artifact.kind !== "document") {
      throw invalidTransition(
        "The completed cross-domain impact analysis evidence is not a Thread document.",
      );
    }
    const capture = await this.#captures.read(artifact.fingerprint);
    if (
      !capture || capture.trustedRunId !== run.id ||
      capture.evaluatedAt !== requiredStart(run)
    ) {
      throw invalidTransition(
        "The completed impact-evaluation capture no longer equals its exact run.",
      );
    }
    const observedFingerprint = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(observedFingerprint, artifact.fingerprint)) {
      throw invalidTransition(
        "The completed impact-evaluation capture fingerprint no longer matches its Thread artifact.",
      );
    }
    if (
      artifact.uri !== crossDomainImpactEvaluationCaptureUri(observedFingerprint.digest)
    ) {
      throw invalidTransition(
        "The completed impact-evaluation document does not retain its canonical capture URI.",
      );
    }
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    const expected = buildSuccessor({
      basisSnapshot,
      run,
      capture,
      artifactInputs: capture.artifactInputs,
      captureFingerprint: observedFingerprint,
      captureUri: artifact.uri ?? "",
      manifestSealArtifactId: capture.manifestSeal.artifact.id,
    });
    if (deterministicJson(expected.snapshot) !== deterministicJson(validated)) {
      throw invalidTransition(
        "The completed impact-evaluation successor is not the exact deterministic capture extension.",
      );
    }
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        (run.status !== "running" && run.status !== "publishing") ||
        run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Cross-domain impact analysis stopped before a ThreadSnapshot write was dispatched.",
        code: "analyze-evaluate-cross-domain-impact-not-published",
        message:
          "The provider-free cross-domain impact analysis stopped before its documentary capture was published.",
      });
    } catch {
      // Preserve the original error.
    }
  }
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly run: EngineeringAgentRun;
  readonly capture: CrossDomainImpactEvaluationCapture;
  readonly artifactInputs: readonly CrossDomainImpactReference[];
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly manifestSealArtifactId: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const evaluatedAt = requiredStart(input.run);
  if (
    input.capture.evaluatedAt !== evaluatedAt ||
    input.capture.trustedRunId !== input.run.id ||
    input.capture.manifestSeal.artifact.id !== input.manifestSealArtifactId ||
    deterministicJson(input.capture.artifactInputs) !==
      deterministicJson(input.artifactInputs) ||
    input.captureUri !==
      crossDomainImpactEvaluationCaptureUri(input.captureFingerprint.digest)
  ) {
    throw invalidTransition(
      "Impact-evaluation capture does not match its exact trusted run and server-derived artifact inputs.",
    );
  }
  const inputArtifacts = exactInputArtifacts(input.basisSnapshot, input.artifactInputs);
  const manifestSeal = inputArtifacts.filter((artifact) =>
    artifact.id === input.manifestSealArtifactId
  );
  if (manifestSeal.length !== 1 || manifestSeal[0]!.kind !== "document") {
    throw invalidTransition(
      "Impact-evaluation capture does not name one exact manifest-seal document on its basis.",
    );
  }
  const producer = {
    serverId: "digital-thread",
    tool:
      `${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id}@${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version}`,
    runId: input.run.id,
  } as const;
  const artifact: ThreadArtifact = {
    id: `cross-domain-impact-evaluation-${input.captureFingerprint.digest}`,
    name: "Cross-domain impact evaluation",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: inputArtifacts.map((item) => item.id),
    freshness: {
      status: "fresh",
      changedAt: evaluatedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumptions: ThreadArtifactConsumption[] = inputArtifacts.map((upstream) => ({
    id: `analyze-evaluate-cross-domain-impact-${input.run.id}:consume:${upstream.id}`,
    artifactId: upstream.id,
    consumer: producer,
    observedFingerprint: upstream.fingerprint,
    verifiedAt: evaluatedAt,
    status: "verified",
  }));
  const extension: ThreadSnapshotExtension = {
    id: `analyze-evaluate-cross-domain-impact-${input.run.id}`,
    name: "Capture the provider-free cross-domain impact evaluation",
    subjectId: input.basisSnapshot.subject.id,
    capturedAt: evaluatedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: inputArtifacts.flatMap((upstream) => {
      const consumptionId =
        `analyze-evaluate-cross-domain-impact-${input.run.id}:consume:${upstream.id}`;
      const role = upstream.id === manifestSeal[0]!.id
        ? "sealed manifest document"
        : "server-reread impact input";
      return [
        {
          id:
            `analyze-evaluate-cross-domain-impact-${input.run.id}:derived-from:${upstream.id}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifact.id },
          to: { kind: "artifact" as const, id: upstream.id },
          rationale: `The impact-evaluation capture reread this exact ${role}.`,
        },
        {
          id:
            `analyze-evaluate-cross-domain-impact-${input.run.id}:uses:${upstream.id}`,
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: consumptionId },
          to: { kind: "artifact" as const, id: upstream.id },
          rationale:
            `The provider-free evaluator verified this exact ${role} fingerprint.`,
        },
      ];
    }),
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(input.basisSnapshot, extension, {
    appliedAt: evaluatedAt,
  });
  if (!applied.applied) {
    throw invalidTransition(
      "This exact cross-domain impact evaluation document is already present in the basis snapshot.",
    );
  }
  return { snapshot: validateThreadSnapshot(applied.snapshot), artifact };
}

function exactInputArtifacts(
  basis: ThreadSnapshot,
  references: readonly CrossDomainImpactReference[],
): readonly ThreadArtifact[] {
  const artifactIds = new Set<string>();
  const artifacts = references.map((reference) => {
    if (artifactIds.has(reference.id)) {
      throw invalidTransition(
        "Impact-evaluation capture repeats one Thread artifact input.",
      );
    }
    artifactIds.add(reference.id);
    const matches = basis.artifacts.filter((artifact) => artifact.id === reference.id);
    if (
      matches.length !== 1 ||
      !fingerprintsEqual(matches[0]!.fingerprint, reference.fingerprint)
    ) {
      throw invalidTransition(
        "Impact-evaluation capture names an artifact input absent or inexact on its Thread basis.",
      );
    }
    return matches[0]!;
  });
  if (artifacts.length === 0) {
    throw invalidTransition(
      "Impact-evaluation capture has no exact Thread artifact inputs.",
    );
  }
  return artifacts;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    run.basis?.kind !== "thread-snapshot" || !workItem ||
    operation?.id !== ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id ||
    operation.version !== ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id}@${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version} with the sole approvedBrief binding.`,
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw invalidTransition(
      "This executor may continue only the exact impact-evaluation run it claimed.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: CrossDomainImpactEvaluationThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for cross-domain impact evaluation.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: RegisteredProjectRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Captured the provider-free cross-domain impact evaluation.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id && reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !workItem || declared.length !== 1 || run.evidenceRefs.length !== 1 ||
    workItem.evidenceRefs.length !== 1 ||
    !sameEvidenceRefs(run.evidenceRefs, workItem.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed impact-evaluation run is not attached to exactly one declared document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed impact-evaluation evidence reference is not the sealed document.",
    );
  }
  return evidence;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  const key = (reference: EngineeringThreadEntityRef) =>
    deterministicJson({
      snapshotId: reference.snapshotId,
      snapshotRevision: reference.snapshotRevision,
      kind: reference.kind,
      id: reference.id,
    });
  const leftKeys = [...left.map(key)].sort();
  const rightKeys = [...right.map(key)].sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((value, index) => value === rightKeys[index]);
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:analyze-evaluate-cross-domain-impact:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
