/**
 * Trusted executor for `compile.capture-corrected-source@1`.
 *
 * Reopens one vector-correction document and the study admission it cites,
 * substitutes the signed z* into the admitted module-level literal, captures
 * those exact bytes, and writes a Thread document. It does not seal
 * compile.seal-admission@1 and does not execute Build123d.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  applyCorrectionToAdmittedSource,
  COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION,
} from "../../../domain/sensitivity/correction-source/apply-correction-source.ts";
import { fingerprintTechnicalSourceText } from "../../../domain/compile/admission/technical-compilation.ts";
import { parseSensitivityCadSourceUri } from "../../../domain/sensitivity/study/sensitivity-study-v2.ts";
import {
  validateSensitivityStudyResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import { validateVectorCorrectionCapture } from "../vector-correction/vector-correction-capture.ts";
import {
  canonicalCorrectedSourceCaptureText,
  CORRECTED_SOURCE_CAPTURE_SCHEMA,
  CORRECTED_SOURCE_CAPTURE_URI_PREFIX,
  type CorrectedSourceCapture,
  validateCorrectedSourceCapture,
} from "./corrected-source-capture.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
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

export { COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION };

export interface CorrectedSourceCaptureStore {
  save(fingerprint: ContentFingerprint, canonicalText: string): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface CorrectionProposalCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface StudyCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface TechnicalSourceCapturePort {
  capture(input: {
    readonly profileId: string;
    readonly sourceId: string;
    readonly sourceText: string;
  }): Promise<Readonly<object>>;
}

export interface CompileCaptureCorrectedSourceRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CompileCaptureCorrectedSourceRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ThreadSnapshotStore;
  readonly corrections: CorrectionProposalCaptureStore;
  readonly studyCaptures: StudyCaptureStore;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly sourceCaptures: TechnicalSourceCapturePort;
  readonly captures: CorrectedSourceCaptureStore;
  readonly lease: EngineeringProjectRunLease;
  readonly profileId: string;
}

export class CompileCaptureCorrectedSourceRunExecutor {
  readonly #projects: CompileCaptureCorrectedSourceRunExecutorDependencies["projects"];
  readonly #commands: CompileCaptureCorrectedSourceRunExecutorDependencies["commands"];
  readonly #snapshots: ThreadSnapshotStore;
  readonly #corrections: CorrectionProposalCaptureStore;
  readonly #studyCaptures: StudyCaptureStore;
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #sourceCaptures: TechnicalSourceCapturePort;
  readonly #captures: CorrectedSourceCaptureStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #profileId: string;

  constructor(dependencies: CompileCaptureCorrectedSourceRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#corrections = dependencies.corrections;
    this.#studyCaptures = dependencies.studyCaptures;
    this.#admissions = dependencies.admissions;
    this.#sourceCaptures = dependencies.sourceCaptures;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
    this.#profileId = dependencies.profileId;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CompileCaptureCorrectedSourceRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the compile-capture-corrected-source run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    requireMrtrApproval(project, run);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CompileCaptureCorrectedSourceRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      const preRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preRun);
      if (preRun.status === "completed") return preClaim;
      await assertThreadWriteBasisAvailable(preClaim, preRun);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: `${command.commandId}:claim`,
        summary: "Started the corrected-source capture.",
      });
      claimed = true;
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      if (run.status === "completed") return project;
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      const correctionArtifact = requireBoundArtifact(
        project,
        run,
        basisSnapshot,
        "correctionProposal",
      );
      const correctionText = await this.#corrections.read(
        correctionArtifact.fingerprint,
      );
      if (!correctionText) {
        throw invalidTransition("The vector-correction document is not readable.");
      }
      const correction = validateVectorCorrectionCapture(JSON.parse(correctionText));
      if (correction.grants !== "none") {
        throw invalidTransition(
          "The vector-correction document must declare grants: none.",
        );
      }
      const studyArtifact = requireArtifact(
        basisSnapshot,
        correction.studyCapture.id,
        correction.studyCapture.fingerprint,
        "study capture",
      );
      const studyText = await this.#studyCaptures.read(studyArtifact.fingerprint);
      if (!studyText) {
        throw invalidTransition("The sensitivity-study capture is not readable.");
      }
      const study = await validateSensitivityStudyResult(JSON.parse(studyText));
      const cad = parseSensitivityCadSourceUri(study.studyCase.cadSource.artifactUri);
      const parentAdmission = requireArtifact(
        basisSnapshot,
        cad.artifactId,
        { algorithm: "sha256", digest: study.studyCase.cadSource.sha256 },
        "parent admission",
      );
      const reopened = await this.#admissions.read({
        projectId: command.projectId,
        basis,
        artifactId: parentAdmission.id,
        artifactFingerprint: parentAdmission.fingerprint,
      });
      if (!reopened || reopened.document.inputManifest.sources.length !== 1) {
        throw invalidTransition(
          "The parent compilation admission could not be reopened.",
        );
      }
      const source = reopened.document.inputManifest.sources[0]!;
      const applied = applyCorrectionToAdmittedSource({
        sourceText: source.sourceText,
        analysis: source.analysis,
        semanticKey: study.studyCase.target.semanticKey,
        current: correction.proposal.driver.current.value,
        proposed: correction.proposal.driver.proposed.value,
      });
      if (applied.status !== "applied") {
        throw invalidTransition(applied.detail);
      }
      const sourceRef = await this.#sourceCaptures.capture({
        profileId: this.#profileId,
        sourceId: source.analysis.source.id,
        sourceText: applied.sourceText,
      });
      const sourceSha256 = (await fingerprintTechnicalSourceText(applied.sourceText))
        .digest;
      const envelope: CorrectedSourceCapture = {
        schemaVersion: CORRECTED_SOURCE_CAPTURE_SCHEMA,
        operation: COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION,
        trustedRunId: run.id,
        sealedAt: requiredStart(run),
        semanticKey: applied.bindingName,
        from: correction.proposal.driver.current,
        to: correction.proposal.driver.proposed,
        sourceText: applied.sourceText,
        sourceSha256,
        sourceRef: sourceRef as Readonly<Record<string, unknown>>,
        correction: {
          artifactId: correctionArtifact.id,
          fingerprint: correctionArtifact.fingerprint,
        },
        parentAdmission: {
          artifactId: parentAdmission.id,
          fingerprint: parentAdmission.fingerprint,
        },
        studyCapture: {
          artifactId: studyArtifact.id,
          fingerprint: studyArtifact.fingerprint,
        },
      };
      const canonical = canonicalCorrectedSourceCaptureText(envelope);
      const fingerprint = await sha256Fingerprint(
        validateCorrectedSourceCapture(JSON.parse(canonical)),
      );
      await this.#captures.save(fingerprint, canonical);
      const reread = await this.#captures.read(fingerprint);
      if (reread !== canonical) {
        throw invalidTransition("The corrected-source capture could not be reread.");
      }
      const successor = buildSuccessor({
        basisSnapshot,
        basis,
        run,
        correctionArtifact,
        fingerprint,
        uri: this.#captures.uriFor(fingerprint),
      });
      await this.#snapshots.save(successor.snapshot);
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: `${command.commandId}:publish`,
          expectedRevision: project.revision,
          summary: "Publishing the corrected source document.",
        });
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        return await this.#commands.completeRun(origin, {
          ...command,
          commandId: `${command.commandId}:complete`,
          expectedRevision: project.revision,
          summary: "Captured the corrected admitted source.",
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact",
            id: successor.artifact.id,
          }],
        });
      }
      if (run.status === "completed") return project;
      throw unexpectedStatus(run, "completed");
    } catch (error) {
      if (claimed) await this.#recordFailure(origin, command, error);
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "entity_not_found",
        `Project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CompileCaptureCorrectedSourceRunExecutorCommand,
    error: unknown,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (run.status !== "running" && run.status !== "publishing") return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: `${command.commandId}:fail`,
        expectedRevision: project.revision,
        summary: "Corrected-source capture stopped before a Thread write completed.",
        code: error instanceof EngineeringProjectCommandError
          ? error.code
          : "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly correctionArtifact: ThreadArtifact;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = `corrected-source-${input.fingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.id}@${COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Corrected admitted source",
    kind: "document",
    version: input.fingerprint.digest,
    fingerprint: input.fingerprint,
    uri: input.uri.startsWith(CORRECTED_SOURCE_CAPTURE_URI_PREFIX)
      ? input.uri
      : `${CORRECTED_SOURCE_CAPTURE_URI_PREFIX}${input.fingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.correctionArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumeId = `consume-${input.correctionArtifact.id}-by-${artifact.id}`;
  const applied = applyThreadSnapshotExtensionIfNew(input.basisSnapshot, {
    id: `compile-capture-corrected-source-${input.run.id}`,
    name: "Capture the corrected admitted source",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [{
      id: consumeId,
      artifactId: input.correctionArtifact.id,
      consumer: operationRef,
      observedFingerprint: input.correctionArtifact.fingerprint,
      verifiedAt: sealedAt,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `derived-from-${input.correctionArtifact.id}-by-${artifact.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: input.correctionArtifact.id },
      rationale: "The corrected source is derived from the sealed z* document.",
    }, {
      id: `uses-${consumeId}`,
      relation: "uses",
      from: { kind: "consumption", id: consumeId },
      to: { kind: "artifact", id: input.correctionArtifact.id },
      rationale: "The executor re-read the exact vector-correction document.",
    }],
    proposedActions: [],
  }, { appliedAt: sealedAt });
  if (!applied.applied) {
    throw invalidTransition("This exact corrected source is already present.");
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifact,
  };
}

function requireBoundArtifact(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  name: string,
): ThreadArtifact {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const binding = workItem?.operation?.bindings.find((item) => item.name === name);
  if (binding?.source.kind !== "thread-entity") {
    throw invalidTransition(`Run is not bound to a Thread ${name} artifact.`);
  }
  const reference = binding.source.reference as EngineeringThreadEntityRef;
  return requireArtifact(snapshot, reference.id, undefined, name);
}

function requireArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint | undefined,
  label: string,
): ThreadArtifact {
  const artifact = snapshot.artifacts.find((item) => item.id === id);
  if (!artifact || artifact.freshness.status !== "fresh") {
    throw invalidTransition(`Bound ${label} is absent or not fresh.`);
  }
  if (
    fingerprint &&
    artifact.fingerprint.digest !== fingerprint.digest
  ) {
    throw invalidTransition(`Bound ${label} fingerprint does not match.`);
  }
  return artifact;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings.find((item) =>
    item.name === "correctionProposal"
  );
  if (
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.id ||
    operation.version !== COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.version ||
    binding?.source.kind !== "thread-entity" ||
    operation.bindings.length !== 1
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to compile.capture-corrected-source@1 with a correctionProposal artifact.`,
    );
  }
}

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      "Work item not found.",
    );
  }
  const basis = requireBasis(run);
  const candidates = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human"
    );
    if (
      approvals.length === 1 &&
      decision.baseSnapshot?.snapshotId === basis.snapshotId &&
      decision.baseSnapshot.revision === basis.revision
    ) {
      candidates.push(decision);
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      "No exact human-approved corrected-source decision is bound to this run basis.",
    );
  }
}

async function exactBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition("The queued Thread basis snapshot is not exact.");
  }
  return validateThreadSnapshot(snapshot);
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
