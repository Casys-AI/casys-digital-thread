/**
 * Trusted executor for provider-read-only `model.recapture-requirements@1`.
 *
 * It never inserts, deletes or renders SysML. A durable publication record
 * bridges capture persistence to project attachment so a crash resumes without
 * a second provider read.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  proveMonotoneArchitectureLineage,
  reopenExactArchitectureCapture,
} from "../renderer/exact-architecture-capture-inputs.ts";
import {
  MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
  MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL,
  parseRequirementsRecaptureParameters,
  REQUIREMENTS_RECAPTURE_CAPTURE_SCHEMA,
  type RequirementsRecaptureAdmission,
} from "../../../domain/architecture/requirements/requirements-recapture-proposal.ts";
import {
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL,
  parseTracedRequirementsRecaptureProposalParameters,
  REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA,
  type RequirementsTracedRecaptureAdmission,
} from "../../../domain/architecture/requirements/requirements-traced-recapture-proposal.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  TracedRequirement,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  assertThreadSnapshotLineageIntact,
  ThreadSnapshotLineageIntegrityError,
} from "../../shared/stores/thread-snapshot-lineage.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { CapabilityRuntimeBoundMcpClient } from "../../../application/ports/out/capability/capability-runtime-connection.ts";
import { CapabilityRuntimeConnectionError } from "../../../application/ports/out/capability/capability-runtime-connection.ts";
import { openLeaseBoundCapabilityRuntimeMcpClient } from "../../../application/control-plane/capability-runtime-bound-mcp-client.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  isDurableTerminalAgentRunStatus,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../../application/control-plane/capability-runtime-execution-admission.ts";
import type {
  CapabilityRuntimeExecutionSession,
  CapabilityRuntimeExecutionSessionCoordinator,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import { CapabilityRuntimeSessionUnavailableError } from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

import type { ExactArchitectureCapture } from "../renderer/architecture-capture.ts";
import {
  extractAndVerifyOracleRequirements,
  RequirementExtractionError,
} from "../../extractors/syson-requirements-extractor.ts";
import type { ProjectRequirementsRecaptureReviewUseCase } from "../../../application/ports/in/architecture/requirements/project-requirements-recapture-review.ts";
import {
  isRecaptureRequirementsCapture,
  parseExactRequirementsCapture,
} from "./requirements-capture.ts";
import { readExactRequirementsPredecessor } from "./exact-requirements-predecessor.ts";
import {
  architectureUsesRationale,
  predecessorUsesRationale,
} from "./requirements-thread-projection.ts";
import type { SysmlSourceAnalysisReader } from "../renderer/sysml-source-analysis-capture.ts";
import {
  requirementsArtifactId,
  requirementsUriFor,
} from "./requirements-identities.ts";
import {
  assertCapturedConstraintUsageBijection,
  assertConstraintUsageChildBijection,
  assertPairwiseDisjointNativeIdentities,
  findOwnedRequirementUsage,
  verifyTargetedRequirementUsage,
} from "./requirements-native-readback.ts";
import { computePriorRequirementsArchiveCascade } from "./model-write-requirements-run-executor.ts";
import type { FileRequirementsRecapturePublicationStore } from "./file-requirements-recapture-publication-store.ts";
import type { FileRequirementsAttemptStore } from "./file-requirements-attempt-store.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../../domain/architecture/requirements/requirements-proposal.ts";

export { MODEL_RECAPTURE_REQUIREMENTS_OPERATION };

type ExactRecaptureAdmission =
  | RequirementsRecaptureAdmission
  | RequirementsTracedRecaptureAdmission;

type ExclusiveSysonRuntimeClient =
  | { readonly kind: "injected"; readonly syson: McpToolClient }
  | {
    readonly kind: "bound";
    readonly connection: CapabilityRuntimeBoundMcpClient;
  };

export interface ModelRecaptureRequirementsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ModelRecaptureRequirementsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly architectureCaptures: FileCaptureStore<"architecture-capture">;
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly captures: FileCaptureStore<"requirements-capture">;
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
  readonly review: ProjectRequirementsRecaptureReviewUseCase;
  readonly syson?: McpToolClient;
  readonly capabilityRuntimeConnection?: CapabilityRuntimeBoundMcpClient;
  readonly lease: EngineeringProjectRunLease;
  readonly publications: FileRequirementsRecapturePublicationStore;
  readonly attempts?: FileRequirementsAttemptStore;
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin" | "releaseRecorded"
  >;
}

export class ModelRecaptureRequirementsRunExecutor {
  private readonly sysonClient: ExclusiveSysonRuntimeClient;

  constructor(
    private readonly d: ModelRecaptureRequirementsRunExecutorDependencies,
  ) {
    this.sysonClient = exclusiveSysonRuntimeClient(
      d.syson,
      d.capabilityRuntimeConnection,
      "Generic requirements recapture",
    );
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ModelRecaptureRequirementsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw denied("Only an authenticated agent can recapture requirements.");
    }
    const initial = await this.project(command.projectId);
    const initialRun = requireRun(initial, command.runId);
    shape(initial, initialRun);
    const admission = await requireRecaptureAdmission(initial, initialRun);
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(initialRun),
      async () => {
        let claimed = false;
        let persisted = false;
        let publicationPersisted = false;
        let publicationAttempted = false;
        let capabilitySession: CapabilityRuntimeExecutionSession | undefined;
        try {
          let project = await this.project(command.projectId);
          let run = requireRun(project, command.runId);
          if (run.status === "completed") {
            const durable = await this.d.publications.read(
              project.project.id,
              run.id,
            );
            if (!durable) {
              throw denied(
                "A completed requirements recapture run has no durable publication record to verify or repair.",
              );
            }
            const completed = await this.resumePublication(
              origin,
              command,
              project,
              run,
            );
            await this.releaseRecordedRuntimeBestEffort(completed, command.runId);
            return completed;
          }
          await assertThreadWriteBasisAvailable(project, run);
          if (run.status === "publishing" || run.status === "running") {
            let durable;
            try {
              durable = await this.d.publications.read(
                project.project.id,
                run.id,
              );
            } catch (error) {
              throw denied(
                `The requirements recapture publication record is not durably readable yet; it will not re-query SysON: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
            if (durable) {
              const resumed = await this.resumePublication(
                origin,
                command,
                project,
                run,
              );
              await this.releaseRecordedRuntimeBestEffort(
                resumed,
                command.runId,
              );
              return resumed;
            }
            throw denied(
              "The running requirements recapture has no durable publication record; it will not re-query SysON.",
            );
          }
          await this.proveFreshCurrentAdmission(project, run, admission);
          const operationalCapability = await this.requireOperationalCapability(
            project,
            run,
          );
          capabilitySession = await beginConfiguredCapabilityRuntimeSession({
            session: this.d.capabilityRuntimeSession!,
            project,
            runId: command.runId,
            operationalCapability,
            recheck: async () => {
              const fresh = await this.project(command.projectId);
              const freshRun = requireRun(fresh, command.runId);
              shape(fresh, freshRun);
              return await this.requireOperationalCapability(fresh, freshRun);
            },
          });
          let syson: McpToolClient;
          try {
            syson = await this.openSysonClient(
              capabilitySession,
              operationalCapability,
            );
          } catch (error) {
            await settleCapabilityRuntimeSession({
              session: capabilitySession,
              policy: { kind: "release" },
            });
            capabilitySession = undefined;
            if (error instanceof CapabilityRuntimeConnectionError) {
              throw new EngineeringProjectCommandError(
                "invalid_transition",
                error.message,
              );
            }
            throw error;
          }
          await this.d.commands.claimRun(origin, {
            ...command,
            commandId: step(command.commandId, "claim"),
            summary: "Started the read-only generic requirements recapture.",
          });
          claimed = true;
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          claim(project, run, origin);
          const derived = await this.reconstructSignedRunBasis(project, run, admission);
          const live = await this.readNative(syson, derived);
          const capturedAt = requiredStart(run);
          const record = buildCaptureRecord(derived, run, capturedAt, live.subjectId);
          const fingerprint = await sha256Fingerprint(record);
          const text = deterministicJson(record);
          const snapshot = materialize(
            derived.base,
            fingerprint,
            run.id,
            capturedAt,
            derived,
            requirementsUriFor(
              derived.admission.containerComponent,
              fingerprint,
            ),
            live.subjectId,
          );
          publicationAttempted = true;
          await this.d.publications.save({
            schemaVersion: "requirements-recapture-publication/1.0",
            projectId: command.projectId,
            runId: run.id,
            fingerprint,
            snapshot,
            capture: text,
          });
          publicationPersisted = true;
          await ensureCaptureCas(this.d.captures, fingerprint, text);
          await this.d.snapshots.save(snapshot);
          persisted = true;
          const readback = await freshSnapshot(this.d.snapshots, snapshot.id);
          if (
            !readback ||
            deterministicJson(readback) !== deterministicJson(snapshot)
          ) {
            throw new Error(
              "The persisted requirements recapture snapshot did not read back exactly.",
            );
          }
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          if (run.status === "running") {
            await this.d.commands.publishRun(origin, {
              ...command,
              commandId: step(command.commandId, "publish"),
              expectedRevision: project.revision,
              summary: "Publishing the verified generic requirements recapture.",
            });
          }
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          if (run.status === "publishing") {
            const artifactId = requirementsArtifactId(
              derived.admission.containerComponent,
              fingerprint.digest,
            );
            await this.d.commands.completeRun(origin, {
              ...command,
              commandId: step(command.commandId, "complete"),
              expectedRevision: project.revision,
              summary:
                "Recorded the exact generic requirements recapture of unchanged native identities.",
              resultSnapshot: snapshotRef(snapshot),
              evidenceRefs: [{
                snapshotId: snapshot.id,
                snapshotRevision: snapshot.revision,
                kind: "artifact",
                id: artifactId,
              }],
            });
          }
          const completed = complete(
            await this.project(command.projectId),
            command,
          );
          await settleCapabilityRuntimeSession({
            session: capabilitySession,
            policy: { kind: "release" },
          });
          capabilitySession = undefined;
          await this.releaseRecordedRuntimeBestEffort(completed, command.runId);
          return completed;
        } catch (error) {
          let recoveredPublication;
          let publicationUnknown = false;
          if (publicationAttempted && !publicationPersisted) {
            try {
              recoveredPublication = await this.d.publications.read(
                command.projectId,
                command.runId,
              );
            } catch {
              publicationUnknown = true;
            }
          }
          if (
            claimed && !persisted && !publicationPersisted &&
            !recoveredPublication && !publicationUnknown
          ) {
            await this.fail(origin, command);
          }
          if (
            publicationPersisted || recoveredPublication || publicationUnknown
          ) {
            const finished = await this.project(command.projectId).catch(
              () => undefined,
            );
            const finishedRun = finished?.agentRuns.find((candidate) =>
              candidate.id === command.runId
            );
            await settleCapabilityRuntimeSession({
              session: capabilitySession,
              policy: finishedRun?.status === "completed"
                ? { kind: "release" }
                : { kind: "retain" },
            });
          } else {
            await settleCapabilityRuntimeSession({
              session: capabilitySession,
              policy: {
                kind: "release-if-terminal",
                run: await this.currentRun(command.projectId, command.runId),
              },
            });
          }
          throw error;
        }
      },
    );
  }

  private async resumePublication(
    origin: EngineeringProjectCommandOrigin,
    command: ModelRecaptureRequirementsRunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<EngineeringProjectSnapshot> {
    shape(project, run);
    const publication = await this.d.publications.read(
      project.project.id,
      run.id,
    );
    if (!publication) {
      throw denied(
        "The publishing requirements recapture run has no durable exact publication record; it will not re-query SysON.",
      );
    }
    const admission = await requireRecaptureAdmission(project, run);
    const derived = await this.reconstructSignedRunBasis(project, run, admission);
    await this.restorePublicationEvidence(publication);
    const basis = requireBasis(run);
    if (
      basis.kind !== "thread-snapshot" ||
      publication.snapshot.subject.id !== basis.subjectId ||
      publication.snapshot.revision !== basis.revision + 1 ||
      publication.snapshot.previous?.snapshotId !== basis.snapshotId ||
      publication.snapshot.previous.revision !== basis.revision
    ) {
      throw denied(
        "The durable requirements recapture publication does not advance the exact run basis.",
      );
    }
    const capture = publication.capture;
    const expected = await reconstructPublication(derived, run, capture);
    if (
      deterministicJson(expected.fingerprint) !==
        deterministicJson(publication.fingerprint) ||
      deterministicJson(expected.snapshot) !==
        deterministicJson(publication.snapshot)
    ) {
      throw denied(
        "The durable requirements recapture publication does not reconstruct from the exact capture and run.",
      );
    }
    let persisted = await freshSnapshot(
      this.d.snapshots,
      publication.snapshot.id,
    );
    if (!persisted) {
      await this.d.snapshots.save(publication.snapshot);
      persisted = await freshSnapshot(
        this.d.snapshots,
        publication.snapshot.id,
      );
    }
    if (
      !persisted ||
      deterministicJson(persisted) !== deterministicJson(publication.snapshot)
    ) {
      throw denied(
        "The publishing requirements recapture run has no exact durable capture and snapshot pair; it will not re-query SysON.",
      );
    }
    const artifactId = requirementsArtifactId(
      derived.admission.containerComponent,
      publication.fingerprint.digest,
    );
    if (run.status === "completed") {
      const expectedResult = snapshotRef(publication.snapshot);
      const expectedEvidence = [{
        snapshotId: publication.snapshot.id,
        snapshotRevision: publication.snapshot.revision,
        kind: "artifact" as const,
        id: artifactId,
      }];
      if (
        deterministicJson(run.resultSnapshot) !==
          deterministicJson(expectedResult) ||
        deterministicJson(run.evidenceRefs) !==
          deterministicJson(expectedEvidence)
      ) {
        throw denied(
          "The completed requirements recapture run does not attach the exact durable publication evidence.",
        );
      }
      return complete(project, command);
    }
    if (run.status === "running") {
      await this.d.commands.publishRun(origin, {
        ...command,
        commandId: step(command.commandId, "publish"),
        expectedRevision: project.revision,
        summary: "Publishing the verified generic requirements recapture.",
      });
      project = await this.project(command.projectId);
      run = requireRun(project, command.runId);
    }
    if (run.status !== "publishing") throw unexpectedStatus(run, "publishing");
    await this.d.commands.completeRun(origin, {
      ...command,
      commandId: step(command.commandId, "complete"),
      expectedRevision: project.revision,
      summary:
        "Recorded the exact generic requirements recapture of unchanged native identities.",
      resultSnapshot: snapshotRef(publication.snapshot),
      evidenceRefs: [{
        snapshotId: publication.snapshot.id,
        snapshotRevision: publication.snapshot.revision,
        kind: "artifact",
        id: artifactId,
      }],
    });
    return complete(await this.project(command.projectId), command);
  }

  private async proveFreshCurrentAdmission(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    admission: ExactRecaptureAdmission,
  ): Promise<void> {
    const reviewed = await this.d.review.execute({
      projectId: project.project.id,
      targetElementId: admission.target.elementId,
    });
    if (reviewed.status !== "resolved") {
      throw denied(
        `The queued requirements recapture review is no longer exact: ${
          reviewed.diagnostics.map((item) => item.message).join(" ")
        }`,
      );
    }
    if (
      deterministicJson(reviewed.decisionParameters) !==
        deterministicJson(
          (await requireRecaptureProposal(project, run)).parameters,
        )
    ) {
      throw denied(
        "The signed requirements recapture review no longer matches the current Thread basis.",
      );
    }
    const basis = requireBasis(run);
    if (
      reviewed.admission.basis.snapshotId !== basis.snapshotId ||
      reviewed.admission.basis.revision !== basis.revision ||
      reviewed.admission.basis.subjectId !== basis.subjectId
    ) {
      throw denied(
        "The signed requirements recapture review is not the exact run Thread basis.",
      );
    }
  }

  private async reconstructSignedRunBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    admission: ExactRecaptureAdmission,
  ): Promise<DerivedRecapture> {
    const basis = requireBasis(run);
    if (
      admission.basis.snapshotId !== basis.snapshotId ||
      admission.basis.revision !== basis.revision ||
      admission.basis.subjectId !== basis.subjectId
    ) {
      throw denied(
        "The signed requirements recapture review is not the exact run Thread basis.",
      );
    }
    const base = await exactSnapshot(this.d.snapshots, basis);
    const snapshotFingerprint = await sha256Fingerprint(base);
    if (!fingerprintsEqual(snapshotFingerprint, admission.basis.fingerprint)) {
      throw denied(
        "The sealed requirements recapture snapshot fingerprint does not match the original run basis.",
      );
    }
    try {
      await assertThreadSnapshotLineageIntact(base, this.d.snapshots);
    } catch (error) {
      if (error instanceof ThreadSnapshotLineageIntegrityError) {
        throw denied(
          `The requirements recapture basis ThreadSnapshot has an invalid predecessor lineage: ${error.message}`,
        );
      }
      throw error;
    }
    const architecture = one(
      base.artifacts.filter((artifact) =>
        artifact.id === admission.architecture.artifactId
      ),
      "signed architecture artifact",
    );
    if (
      !fingerprintsEqual(
        architecture.fingerprint,
        admission.architecture.fingerprint,
      ) ||
      architecture.producer.runId !== admission.architecture.producerRunId
    ) {
      throw denied(
        "The signed architecture identity is not present on the original run basis.",
      );
    }
    const predecessor = one(
      base.artifacts.filter((artifact) =>
        artifact.id === admission.predecessor.artifactId
      ),
      "predecessor requirements artifact",
    );
    if (
      !fingerprintsEqual(
        predecessor.fingerprint,
        admission.predecessor.fingerprint,
      ) ||
      predecessor.producer.runId !== admission.predecessor.producerRunId
    ) {
      throw denied(
        "The signed predecessor identity is not present on the original run basis.",
      );
    }
    assertBindings(project, run, architecture, predecessor);
    const prior = await readExactRequirementsPredecessor(
      base,
      predecessor,
      {
        containerComponent: admission.containerComponent,
        partDefName: admission.partDefName,
        target: admission.target,
      },
      {
        captures: this.d.captures,
        architectureCaptures: this.d.architectureCaptures,
        snapshots: this.d.snapshots,
        sysmlSourceAnalysis: this.d.sysmlSourceAnalysis,
      },
    );
    if (
      prior.capture.schemaVersion !== admission.predecessor.schemaVersion ||
      ("briefProvenance" in prior.capture) !== (admission.operation.version === "2")
    ) {
      throw denied(
        "The signed recapture version must preserve the exact predecessor provenance; legacy and traced captures cannot be relabelled.",
      );
    }
    const architectureText = await this.d.architectureCaptures.read(
      architecture.fingerprint,
    );
    if (!architectureText) {
      throw denied("The exact content-addressed architecture capture is not readable.");
    }
    const architectureCapture = await reopenExactArchitectureCapture(
      architectureText,
      architecture,
      "current",
    );
    const lineage = await proveMonotoneArchitectureLineage({
      snapshot: base,
      currentArtifact: architecture,
      currentCapture: architectureCapture,
      historicalArtifact: prior.historicalArchitecture,
      historicalSeed: prior.capture.seed,
      target: admission.target,
      architectureCaptures: this.d.architectureCaptures,
      seedCaptures: this.d.seedCaptures,
      sysmlSourceAnalysis: this.d.sysmlSourceAnalysis,
    });
    const seedArtifact = lineage.seedArtifact;
    const seedCapture = lineage.seedCapture;
    if (this.d.attempts) {
      await assertNoBlockedWriterSibling(
        project,
        run,
        admission.containerComponent,
        this.d.attempts,
      );
    }
    return {
      base,
      architecture,
      architectureCapture,
      predecessor,
      predecessorCapture: prior.capture,
      seedArtifact,
      editingContextId: seedCapture.normalizedResults.project.editingContextId,
      admission,
    };
  }

  private async readNative(
    syson: McpToolClient,
    derived: DerivedRecapture,
  ): Promise<{ readonly subjectId: string }> {
    const target = derived.admission.target;
    const requirementsElementId = derived.admission.requirementsElementId;
    await findOwnedRequirementUsage(
      syson,
      derived.editingContextId,
      target,
      requirementsElementId,
      derived.admission.partDefName,
    );
    const targeted = await verifyTargetedRequirementUsage(
      syson,
      derived.editingContextId,
      requirementsElementId,
      derived.admission.partDefName,
      target,
    );
    let verified;
    try {
      verified = await extractAndVerifyOracleRequirements(
        syson,
        derived.editingContextId,
        requirementsElementId,
        derived.predecessorCapture.requirements,
      );
    } catch (error) {
      if (error instanceof RequirementExtractionError) {
        throw denied(
          `Requirements recapture fidelity check failed (${error.code}): ${error.message}`,
        );
      }
      throw error;
    }
    assertConstraintUsageChildBijection(
      targeted.constraintUsageIds,
      verified.constraintUsages,
      "recaptured RequirementUsage",
    );
    assertCapturedConstraintUsageBijection(
      derived.predecessorCapture.constraintUsages,
      verified.constraintUsages,
    );
    if (
      derived.predecessorCapture.requirementUsage.id !== requirementsElementId ||
      derived.predecessorCapture.target.elementId !== target.elementId ||
      derived.predecessorCapture.target.label !== target.label
    ) {
      throw denied(
        "Live native identities diverged from the unchanged predecessor envelope.",
      );
    }
    assertPairwiseDisjointNativeIdentities({
      targetElementId: target.elementId,
      requirementsElementId,
      subjectId: targeted.subjectId,
      constraintUsageIds: targeted.constraintUsageIds,
    });
    if (
      isRecaptureRequirementsCapture(derived.predecessorCapture) &&
      derived.predecessorCapture.subject.id !== targeted.subjectId
    ) {
      throw denied(
        "The recaptured subject identity replaced the sealed v4 subject.",
      );
    }
    return { subjectId: targeted.subjectId };
  }

  private async project(id: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.d.projects.get(id);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${id} does not exist.`,
      );
    }
    return project;
  }

  private async fail(
    origin: EngineeringProjectCommandOrigin,
    command: ModelRecaptureRequirementsRunExecutorCommand,
  ): Promise<void> {
    try {
      const p = await this.project(command.projectId);
      const r = requireRun(p, command.runId);
      if (
        r.status === "running" && r.claimedBy?.origin === origin.kind &&
        r.claimedBy.id === origin.actorId
      ) {
        await this.d.commands.failRun(origin, {
          ...command,
          commandId: step(command.commandId, "fail"),
          expectedRevision: p.revision,
          summary: "Requirements recapture stopped before publication.",
          code: "model-recapture-requirements-not-published",
          message:
            "The read-only requirements recapture did not publish technical evidence.",
        });
      }
    } catch { /* original refusal wins */ }
  }

  private async openSysonClient(
    session: CapabilityRuntimeExecutionSession,
    operationalCapability: ResolvedCapabilityRuntimeOperation,
  ): Promise<McpToolClient> {
    if (this.sysonClient.kind === "injected") return this.sysonClient.syson;
    try {
      return await openLeaseBoundCapabilityRuntimeMcpClient({
        connection: this.sysonClient.connection,
        session,
        operationalCapability,
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw denied(error.message);
      }
      throw error;
    }
  }

  private async requireOperationalCapability(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ) {
    shape(project, run);
    const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
    try {
      return await requireConfiguredOperationalCapability({
        runtime: this.d.capabilityRuntime,
        session: this.d.capabilityRuntimeSession,
        project,
        run,
        workItem,
        unavailableMessage:
          "Generic requirements recapture requires the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Generic requirements recapture requires the sealed model.inspect-system@1 operational capability before a run can be claimed.",
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw denied(error.message);
      }
      throw error;
    }
  }

  private async currentRun(projectId: string, runId: string) {
    try {
      return requireRun(await this.project(projectId), runId);
    } catch {
      return undefined;
    }
  }

  private async restorePublicationEvidence(
    publication: {
      readonly fingerprint: ContentFingerprint;
      readonly snapshot: ThreadSnapshot;
      readonly capture: string;
    },
  ): Promise<void> {
    await ensureCaptureCas(
      this.d.captures,
      publication.fingerprint,
      publication.capture,
    );
    const persisted = await freshSnapshot(
      this.d.snapshots,
      publication.snapshot.id,
    );
    if (!persisted) {
      await this.d.snapshots.save(publication.snapshot);
    }
  }

  private async lookupOperationalCapabilityCold(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ResolvedCapabilityRuntimeOperation | undefined> {
    try {
      return await this.requireOperationalCapability(project, run);
    } catch {
      return undefined;
    }
  }

  private async releaseRecordedRuntimeBestEffort(
    project: EngineeringProjectSnapshot,
    runId: string,
  ): Promise<void> {
    const run = requireRun(project, runId);
    if (!isDurableTerminalAgentRunStatus(run.status)) return;
    const operationalCapability = await this.lookupOperationalCapabilityCold(
      project,
      run,
    );
    if (!operationalCapability) return;
    const session = this.d.capabilityRuntimeSession;
    if (!session?.releaseRecorded) return;
    try {
      await session.releaseRecorded({
        project,
        runId,
        operationalCapability,
      });
    } catch {
      // Host-stop or scope failure must not hide the completed engineering
      // result. The exact lease remains for administrative recovery.
    }
  }
}

async function ensureCaptureCas(
  captures: FileCaptureStore<"requirements-capture">,
  fingerprint: ContentFingerprint,
  text: string,
): Promise<void> {
  const existing = await captures.read(fingerprint);
  if (existing === text) return;
  if (existing !== undefined) {
    throw denied(
      "The durable requirements recapture CAS bytes diverge from the publication record.",
    );
  }
  let parsed;
  try {
    parsed = parseExactRequirementsCapture(JSON.parse(text));
  } catch (error) {
    throw denied(
      `The durable requirements recapture is not exact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (deterministicJson(parsed) !== text) {
    throw denied(
      "The durable requirements recapture is not canonical JSON.",
    );
  }
  const observed = await sha256Fingerprint(parsed);
  if (!fingerprintsEqual(observed, fingerprint)) {
    throw denied(
      "The durable requirements recapture fingerprint does not match its staged bytes.",
    );
  }
  await captures.save(fingerprint, text);
  if (await captures.read(fingerprint) !== text) {
    throw denied(
      "The persisted requirements recapture did not read back exactly.",
    );
  }
}

interface DerivedRecapture {
  readonly base: ThreadSnapshot;
  readonly architecture: ThreadArtifact;
  readonly architectureCapture: ExactArchitectureCapture;
  readonly predecessor: ThreadArtifact;
  readonly predecessorCapture: ReturnType<typeof parseExactRequirementsCapture>;
  readonly seedArtifact: ThreadArtifact;
  readonly editingContextId: string;
  readonly admission: ExactRecaptureAdmission;
}

async function reconstructPublication(
  derived: DerivedRecapture,
  run: EngineeringAgentRun,
  text: string,
): Promise<
  Readonly<{ fingerprint: ContentFingerprint; snapshot: ThreadSnapshot }>
> {
  let parsed;
  try {
    parsed = parseExactRequirementsCapture(JSON.parse(text));
  } catch (error) {
    throw denied(
      `The durable requirements recapture is not exact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !isRecaptureRequirementsCapture(parsed)
  ) {
    throw denied(
      "The durable requirements recapture is not an exact recapture schema.",
    );
  }
  const expected = buildCaptureRecord(
    derived,
    run,
    requiredStart(run),
    parsed.subject.id,
  );
  if (deterministicJson(parsed) !== deterministicJson(expected)) {
    throw denied(
      "The durable requirements recapture does not attest this exact operation and run.",
    );
  }
  const fingerprint = await sha256Fingerprint(expected);
  return {
    fingerprint,
    snapshot: materialize(
      derived.base,
      fingerprint,
      run.id,
      requiredStart(run),
      derived,
      requirementsUriFor(derived.admission.containerComponent, fingerprint),
      parsed.subject.id,
    ),
  };
}

function buildCaptureRecord(
  derived: DerivedRecapture,
  run: EngineeringAgentRun,
  capturedAt: string,
  subjectId: string,
) {
  const predecessor = derived.predecessorCapture;
  const traced = derived.admission.operation.version === "2";
  if (traced !== ("briefProvenance" in predecessor)) {
    throw denied("Requirements recapture cannot add or discard brief provenance.");
  }
  const record = {
    schemaVersion: traced
      ? REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA
      : REQUIREMENTS_RECAPTURE_CAPTURE_SCHEMA,
    operation: derived.admission.operation,
    ...("briefProvenance" in predecessor
      ? { briefProvenance: predecessor.briefProvenance }
      : {}),
    trustedRunId: run.id,
    containerComponent: derived.admission.containerComponent,
    partDefName: derived.admission.partDefName,
    target: derived.admission.target,
    architectureBasis: {
      snapshotId: derived.base.id,
      revision: derived.base.revision,
      fingerprint: derived.architecture.fingerprint.digest,
    },
    requirements: predecessor.requirements,
    seed: {
      artifactId: derived.seedArtifact.id,
      fingerprint: derived.architectureCapture.seed.fingerprint,
      producerRunId: derived.seedArtifact.producer.runId,
    },
    architecture: {
      artifactId: derived.architecture.id,
      fingerprint: derived.architecture.fingerprint,
      producerRunId: derived.architecture.producer.runId,
    },
    predecessor: {
      artifactId: derived.predecessor.id,
      fingerprint: derived.predecessor.fingerprint,
      producerRunId: derived.predecessor.producer.runId,
    },
    requirementsElementId: derived.admission.requirementsElementId,
    capturedAt,
    requirementUsage: predecessor.requirementUsage,
    constraintUsages: predecessor.constraintUsages,
    subject: {
      id: subjectId,
      kind: "ReferenceUsage" as const,
      name: "target" as const,
    },
  };
  const parsed = parseExactRequirementsCapture(record);
  if (!isRecaptureRequirementsCapture(parsed)) {
    throw new Error("The recapture builder did not produce an exact recapture schema.");
  }
  return parsed;
}

function materialize(
  base: ThreadSnapshot,
  fingerprint: ContentFingerprint,
  runId: string,
  capturedAt: string,
  derived: DerivedRecapture,
  uri: string,
  subjectId: string,
): ThreadSnapshot {
  const artifactId = requirementsArtifactId(
    derived.admission.containerComponent,
    fingerprint.digest,
  );
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const producer: ThreadOperationRef = {
    serverId: "syson",
    tool: derived.admission.operation.version === "2"
      ? MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL
      : MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL,
    runId,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Requirements: ${derived.admission.containerComponent}`,
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [derived.architecture.id, derived.predecessor.id],
    freshness,
  };
  const archConsumption: ThreadArtifactConsumption = {
    id: `consume-${derived.architecture.id}-by-${artifactId}`,
    artifactId: derived.architecture.id,
    consumer: producer,
    observedFingerprint: derived.architecture.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const priorConsumption: ThreadArtifactConsumption = {
    id: `consume-${derived.predecessor.id}-by-${artifactId}`,
    artifactId: derived.predecessor.id,
    consumer: producer,
    observedFingerprint: derived.predecessor.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const tracedRequirements: TracedRequirement[] = derived.predecessorCapture
    .requirements.map((requirement) => ({
      id: `requirement-${fingerprint.digest}-${requirement.id}`,
      name: requirement.name,
      statement: `${requirement.name}: ${requirement.metric} ${requirement.operator} ` +
        `${requirement.limit.value} ${requirement.limit.unit}.`,
      version: fingerprint.digest,
      criterion: {
        metric: requirement.metric,
        operator: requirement.operator,
        limit: {
          value: requirement.limit.value,
          unit: requirement.limit.unit,
        },
      },
      trace: {
        sourceArtifactId: artifactId,
        elementId: derived.admission.requirementsElementId,
        targetArtifactIds: [derived.architecture.id],
      },
      freshness,
    }));
  const priorRequirements = derived.base.requirements.filter((requirement) =>
    requirement.trace.sourceArtifactId === derived.predecessor.id
  );
  const priorByMetric = new Map(
    priorRequirements.map((requirement) => [requirement.criterion.metric, requirement]),
  );
  const priorArchiveCascade = computePriorRequirementsArchiveCascade(
    derived.base,
    derived.predecessor,
  );
  const provenance: ThreadProvenanceLink[] = [
    {
      id: `derived-from-architecture-${fingerprint.digest}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifactId },
      to: { kind: "artifact", id: derived.architecture.id },
      rationale:
        `The native RequirementUsage is owned by PartDefinition "${derived.admission.target.label}" ` +
        `(${derived.admission.target.elementId}) from the current architecture capture.`,
    },
    {
      id: `uses-${archConsumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: archConsumption.id },
      to: { kind: "artifact", id: derived.architecture.id },
      rationale: architectureUsesRationale("recapture"),
    },
    {
      id: `derived-from-requirements-${fingerprint.digest}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifactId },
      to: { kind: "artifact", id: derived.predecessor.id },
      rationale:
        "The prior requirements capture was read as the unchanged predecessor of this recapture.",
    },
    {
      id: `uses-consume-prior-requirements-${fingerprint.digest}`,
      relation: "uses",
      from: { kind: "consumption", id: priorConsumption.id },
      to: { kind: "artifact", id: derived.predecessor.id },
      rationale: predecessorUsesRationale("recapture"),
    },
    ...tracedRequirements.map((requirement) => ({
      id: `traces-to-target-${requirement.id}`,
      relation: "traces_to" as const,
      from: { kind: "requirement" as const, id: requirement.id },
      to: { kind: "artifact" as const, id: derived.architecture.id },
      rationale:
        `The requirement constrains PartDefinition "${derived.admission.target.label}" ` +
        `(${derived.admission.target.elementId}) inside this architecture artifact.`,
    })),
    ...tracedRequirements.flatMap((requirement) => {
      const prior = priorByMetric.get(requirement.criterion.metric);
      return prior
        ? [{
          id: `supersedes-${prior.id}-by-${requirement.id}`,
          relation: "supersedes" as const,
          from: { kind: "requirement" as const, id: requirement.id },
          to: { kind: "requirement" as const, id: prior.id },
          rationale:
            "This recapture projection replaces the prior capture version of the same unchanged metric.",
        }]
        : [];
    }),
  ];
  const applied = applyThreadSnapshotExtensionIfNew(base, {
    id:
      `model-recapture-requirements-${derived.admission.containerComponent}-${fingerprint.digest}`,
    name: `Recapture requirements: ${derived.admission.containerComponent}`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [artifact],
    consumptions: [archConsumption, priorConsumption],
    observations: [],
    requirements: tracedRequirements,
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
    ...(priorArchiveCascade.length > 0
      ? {
        archived: priorArchiveCascade.map((target) => ({
          target,
          summary: `Requirements recapture retired prior ${target.kind} ${target.id}.`,
        })),
      }
      : {}),
    bindingProofs: [
      {
        provider: "syson",
        kind: "element",
        id: derived.admission.requirementsElementId,
      },
      {
        provider: "syson",
        kind: "part-definition",
        id: derived.admission.target.elementId,
      },
      {
        provider: "syson",
        kind: "element",
        id: subjectId,
      },
    ],
  });
  if (!applied.applied) {
    throw denied("The requirements recapture snapshot extension was not new.");
  }
  validateThreadSnapshot(applied.snapshot);
  return applied.snapshot;
}

async function requireRecaptureAdmission(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<ExactRecaptureAdmission> {
  const proposal = await requireRecaptureProposal(project, run);
  try {
    const operation = project.workItems.find((item) => item.id === run.workItemId)
      ?.operation;
    return operation?.version === MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION.version
      ? parseTracedRequirementsRecaptureProposalParameters(proposal.parameters)
      : parseRequirementsRecaptureParameters(proposal.parameters);
  } catch (error) {
    throw denied(
      `Requirements recapture proposal parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function requireRecaptureProposal(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<NonNullable<EngineeringDecision["proposal"]>> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Work item for run ${run.id} not found.`,
    );
  }
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find(
      (d) => d.id === decisionId && d.status === "approved",
    );
    if (!decision?.proposal || decision.proposal.parameters.length === 0) {
      continue;
    }
    const exactHumanApprovals = project.approvals.filter(
      (a: EngineeringApproval) =>
        a.decisionId === decision.id &&
        a.status === "approved" &&
        a.decidedByOrigin === "human" &&
        sameSnapshotBasis(a.baseSnapshot, basis) &&
        fingerprintsEqual(a.inputFingerprint, decision.inputFingerprint),
    );
    if (
      exactHumanApprovals.length === 1 &&
      sameSnapshotBasis(decision.baseSnapshot, basis) &&
      decision.inputFingerprint
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw denied(
      candidates.length === 0
        ? "No exact human-approved requirements recapture MRTR decision is bound to this run basis."
        : "Ambiguous requirements recapture MRTR: exactly one human-approved decision must be bound to this run basis.",
    );
  }
  const selected = candidates[0]!;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (
    !fingerprintsEqual(
      expectedDecisionFingerprint,
      selected.decision.inputFingerprint,
    )
  ) {
    throw denied(
      "The recapture decision fingerprint no longer seals its exact base snapshot, evidence references, and proposal.",
    );
  }
  return selected.proposal;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: ReturnType<typeof requireBasis>,
): boolean {
  if (!value || !("snapshotId" in value)) return false;
  return value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function shape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const operation = project.workItems.find((item) => item.id === run.workItemId)
    ?.operation;
  if (
    operation?.id !== MODEL_RECAPTURE_REQUIREMENTS_OPERATION.id ||
    (operation.version !== "1" && operation.version !== "2") ||
    operation.bindings.length !== 2 ||
    operation.bindings[0]?.name !== "architecture" ||
    operation.bindings[1]?.name !== "predecessor"
  ) {
    throw denied(
      "This executor may run only an exact generic model.recapture-requirements@1 or @2 operation.",
    );
  }
}

function assertBindings(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  architecture: ThreadArtifact,
  predecessor: ThreadArtifact,
): void {
  const item = project.workItems.find((candidate) => candidate.id === run.workItemId);
  const bindings = item?.operation?.bindings ?? [];
  const architectureBinding = bindings.find((binding) =>
    binding.name === "architecture"
  );
  const predecessorBinding = bindings.find((binding) => binding.name === "predecessor");
  const basis = requireBasis(run);
  const expectedArchitecture = {
    snapshotId: basis.snapshotId,
    snapshotRevision: basis.revision,
    kind: "artifact",
    id: architecture.id,
  };
  const expectedPredecessor = {
    snapshotId: basis.snapshotId,
    snapshotRevision: basis.revision,
    kind: "artifact",
    id: predecessor.id,
  };
  if (
    architectureBinding?.source.kind !== "thread-entity" ||
    deterministicJson(architectureBinding.source.reference) !==
      deterministicJson(expectedArchitecture) ||
    predecessorBinding?.source.kind !== "thread-entity" ||
    deterministicJson(predecessorBinding.source.reference) !==
      deterministicJson(expectedPredecessor)
  ) {
    throw denied(
      "The run does not bind the exact current architecture tip and predecessor requirements artifact.",
    );
  }
}

function claim(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  shape(project, run);
  if (
    run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
    run.claimedBy.id !== origin.actorId
  ) throw unexpectedStatus(run, "running");
}

function complete(
  project: EngineeringProjectSnapshot,
  command: ModelRecaptureRequirementsRunExecutorCommand,
): EngineeringProjectSnapshot {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === step(command.commandId, "complete")
    )
  ) {
    throw denied(
      "The requirements recapture run did not complete through this exact command.",
    );
  }
  return project;
}

async function assertNoBlockedWriterSibling(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  containerComponent: string,
  attempts: FileRequirementsAttemptStore,
): Promise<void> {
  const basis = requireBasis(run);
  for (const candidate of project.agentRuns) {
    if (candidate.id === run.id || !sameSnapshotBasis(candidate.basis, basis)) {
      continue;
    }
    const operation = project.workItems.find((item) => item.id === candidate.workItemId)
      ?.operation;
    if (
      operation?.id !== MODEL_WRITE_REQUIREMENTS_OPERATION.id ||
      (operation.version !== "1" && operation.version !== "2")
    ) {
      continue;
    }
    if (
      candidate.status === "completed" || candidate.status === "running" ||
      candidate.status === "publishing" ||
      (candidate.status === "failed" &&
        (candidate.failure?.code ===
            "model-write-requirements-provider-outcome-unknown" ||
          candidate.failure?.code ===
            "model-write-requirements-post-acknowledgement-quarantined" ||
          candidate.failure?.code ===
            "model-write-requirements-quarantine-write-failed"))
    ) {
      throw denied(
        "A prior requirements writer for this target on the exact same basis has an active execution, published result, unresolved provider outcome, or durable WAL.",
      );
    }
    try {
      if (
        await attempts.isQuarantined(project.project.id, candidate.id) ||
        await attempts.readRun(project.project.id, candidate.id)
      ) {
        throw denied(
          "A prior requirements writer for this target on the exact same basis has a dispatched or quarantined WAL.",
        );
      }
    } catch (error) {
      if (error instanceof EngineeringProjectCommandError) throw error;
      throw denied(
        "A prior requirements writer for this target on the exact same basis has an unreadable WAL.",
      );
    }
    void containerComponent;
  }
}

function exclusiveSysonRuntimeClient(
  syson: McpToolClient | undefined,
  connection: CapabilityRuntimeBoundMcpClient | undefined,
  operationLabel: string,
): ExclusiveSysonRuntimeClient {
  if (syson !== undefined && connection === undefined) {
    return { kind: "injected", syson };
  }
  if (syson === undefined && connection !== undefined) {
    return { kind: "bound", connection };
  }
  throw new Error(
    `${operationLabel} requires exactly one of a test SysON client or the lease-bound runtime connection.`,
  );
}

function denied(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_input", message);
}

function step(commandId: string, action: string): string {
  return `${commandId}:model-recapture-requirements:${action}`;
}

function one<T>(values: readonly T[], label: string): T {
  if (values.length !== 1) {
    throw denied(`Expected exactly one ${label}.`);
  }
  return values[0]!;
}

async function exactSnapshot(
  store: ThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw denied(
      `Basis thread snapshot ${basis.snapshotId} r${basis.revision} is not durably readable as an exact identity.`,
    );
  }
  validateThreadSnapshot(snapshot);
  return snapshot;
}

async function freshSnapshot(
  store: ThreadSnapshotStore,
  snapshotId: string,
): Promise<ThreadSnapshot | undefined> {
  const fresh = store as ThreadSnapshotStore & {
    getFresh?: (id: string) => Promise<ThreadSnapshot | undefined>;
  };
  return fresh.getFresh
    ? await fresh.getFresh(snapshotId)
    : await store.get(snapshotId);
}
