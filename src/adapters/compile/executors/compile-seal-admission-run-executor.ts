/**
 * Provider-free executor for `compile.seal-admission@3`.
 *
 * A preview is not authority. This executor reopens the exact human-reviewed
 * draft, Thread/SysML basis, source captures, and code-owned profiles before it
 * seals one canonical admission document into the Thread. It never calls a
 * provider and never grants execution authority to the admitted source.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { TechnicalCompilationBasisResolver } from "../../../application/ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import type {
  TechnicalCompilationDraft,
  TechnicalCompilationDraftReference,
  TechnicalCompilationDraftStore,
} from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
} from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import type { TechnicalCompilationProfileCatalogProvider } from "../../../application/ports/out/compile/admission/technical-compilation-profile-catalog-provider.ts";
import type { TechnicalCompilationSourceReader } from "../../../application/ports/out/compile/admission/technical-compilation-source-reader.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  fingerprintSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalCompilationDocument,
  fingerprintTechnicalSourceText,
  type TechnicalCompilationDocument,
  type TechnicalCompilationProfile,
  type TechnicalSysmlAnchor,
  validateTechnicalCompilationDocument,
  validateTechnicalCompilationProfileCatalog,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  COMPILE_SEAL_ADMISSION_PRODUCER_TOOL,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
  type TechnicalCompilationAdmission,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  assertTechnicalSourceAnalysisCaptureLocatorsEqual,
  assertTechnicalSourceProvenanceIdentitiesEqual,
  technicalSourceEffectiveUnitsEqual,
  type TechnicalSourceProvenanceIdentity,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadArtifactConsumption,
  type ThreadEntityKind,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
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

export { COMPILE_SEAL_ADMISSION_OPERATION, COMPILE_SEAL_ADMISSION_PRODUCER_TOOL };

export { TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA };
export const TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX =
  "casys://technical-compilation-admission-capture/sha256/" as const;

export interface TechnicalCompilationAdmissionCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

/** A sealing readback must bypass any in-process snapshot convenience cache. */
export interface TechnicalCompilationThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface CompileSealAdmissionRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CompileSealAdmissionRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: TechnicalCompilationThreadSnapshotStore;
  readonly basisResolver: TechnicalCompilationBasisResolver;
  readonly drafts: TechnicalCompilationDraftStore;
  readonly sources: TechnicalCompilationSourceReader;
  readonly profiles: TechnicalCompilationProfileCatalogProvider;
  readonly captures: TechnicalCompilationAdmissionCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export interface TechnicalCompilationAdmissionCapture {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA;
  readonly operation: typeof COMPILE_SEAL_ADMISSION_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly draftReference: TechnicalCompilationDraftReference;
  readonly sourceCaptures: TechnicalCompilationDraft["sourceCaptures"];
  readonly admission: TechnicalCompilationAdmission;
  readonly document: TechnicalCompilationDocument;
}

export interface TechnicalCompilationAnchorArtifactReference {
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

/**
 * Exact, unique Thread-artifact closure carried by one validated SysML anchor.
 *
 * The architecture root remains an input even when no other element repeats
 * its provenance. Element-level V3 captures (for example requirements) are
 * equally authoritative inputs. Ordering is deterministic ASCII/codepoint
 * order because stable identifiers are bounded ASCII.
 */
export function technicalCompilationAnchorArtifactReferences(
  anchor: TechnicalSysmlAnchor,
): readonly TechnicalCompilationAnchorArtifactReference[] {
  const references = new Map<string, TechnicalCompilationAnchorArtifactReference>();
  const candidates = [
    {
      artifactId: anchor.artifactId,
      artifactFingerprint: anchor.artifactFingerprint,
    },
    ...anchor.elements.map((element) => ({
      artifactId: element.provenance.artifactId,
      artifactFingerprint: element.provenance.artifactFingerprint,
    })),
  ];

  for (const candidate of candidates) {
    const previous = references.get(candidate.artifactId);
    if (
      previous &&
      !fingerprintsEqual(
        previous.artifactFingerprint,
        candidate.artifactFingerprint,
      )
    ) {
      throw invalidTransition(
        `SysML anchor artifact ${candidate.artifactId} carries divergent provenance fingerprints.`,
      );
    }
    if (!previous) {
      references.set(candidate.artifactId, {
        artifactId: candidate.artifactId,
        artifactFingerprint: { ...candidate.artifactFingerprint },
      });
    }
  }

  return deepFreeze(
    [...references.values()].sort((left, right) =>
      compareText(left.artifactId, right.artifactId)
    ),
  );
}

/** Reopen a sealed capture as a closed, self-consistent evidence document. */
export async function validateTechnicalCompilationAdmissionCapture(
  value: unknown,
): Promise<TechnicalCompilationAdmissionCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "draftReference",
    "sourceCaptures",
    "admission",
    "document",
  ], "$technicalCompilationAdmissionCapture");
  literalValue(
    root.schemaVersion,
    TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
    "$technicalCompilationAdmissionCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$technicalCompilationAdmissionCapture.operation",
  );
  literalValue(
    operation.id,
    COMPILE_SEAL_ADMISSION_OPERATION.id,
    "$technicalCompilationAdmissionCapture.operation.id",
  );
  literalValue(
    operation.version,
    COMPILE_SEAL_ADMISSION_OPERATION.version,
    "$technicalCompilationAdmissionCapture.operation.version",
  );
  const sealedAt = root.sealedAt;
  if (typeof sealedAt !== "string" || Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError(
      "$technicalCompilationAdmissionCapture.sealedAt must be ISO-8601.",
    );
  }
  const admission = parseTechnicalCompilationAdmissionParameters(
    encodeTechnicalCompilationAdmissionParameters(root.admission),
  );
  const expectedReference = draftReferenceFrom(admission);
  if (deterministicJson(root.draftReference) !== deterministicJson(expectedReference)) {
    throw new TypeError(
      "$technicalCompilationAdmissionCapture.draftReference must equal the exact reviewed draft reference.",
    );
  }
  const sourceCaptures = await Promise.all(
    arrayOf(
      root.sourceCaptures,
      "$technicalCompilationAdmissionCapture.sourceCaptures",
    ).map(async (value, index) => {
      const path = `$technicalCompilationAdmissionCapture.sourceCaptures[${index}]`;
      const capture = exactRecord(
        value,
        ["sourceId", "reference", "referenceFingerprint"],
        path,
      );
      const locator = validateTechnicalSourceAnalysisCaptureLocator(
        capture.reference,
        `${path}.reference`,
      );
      const referenceFingerprint = parseFingerprint(
        capture.referenceFingerprint,
        `${path}.referenceFingerprint`,
      );
      const observed = await sha256Fingerprint(locator);
      if (!fingerprintsEqual(observed, referenceFingerprint)) {
        throw new TypeError(`${path}.reference fingerprint does not match.`);
      }
      return {
        sourceId: safeId(capture.sourceId, `${path}.sourceId`),
        reference: locator,
        referenceFingerprint,
      };
    }),
  );
  sourceCaptures.sort((left, right) => compareText(left.sourceId, right.sourceId));
  const document = await validateTechnicalCompilationDocument(root.document);
  assertCaptureSourceCoverage(admission, sourceCaptures, document);
  const draft: TechnicalCompilationDraft = {
    projectId: admission.draft.projectId,
    document,
    fingerprint: admission.draft.documentFingerprint,
    sourceCaptures,
  };
  await verifyDraft(admission, draft);
  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
    operation: COMPILE_SEAL_ADMISSION_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$technicalCompilationAdmissionCapture.trustedRunId",
    ),
    decisionId: safeId(
      root.decisionId,
      "$technicalCompilationAdmissionCapture.decisionId",
    ),
    sealedAt,
    draftReference: expectedReference,
    sourceCaptures,
    admission,
    document,
  });
}

export class CompileSealAdmissionRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly #snapshots: TechnicalCompilationThreadSnapshotStore;
  readonly #basisResolver: TechnicalCompilationBasisResolver;
  readonly #drafts: TechnicalCompilationDraftStore;
  readonly #sources: TechnicalCompilationSourceReader;
  readonly #profiles: TechnicalCompilationProfileCatalogProvider;
  readonly #captures: TechnicalCompilationAdmissionCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(dependencies: CompileSealAdmissionRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#basisResolver = dependencies.basisResolver;
    this.#drafts = dependencies.drafts;
    this.#sources = dependencies.sources;
    this.#profiles = dependencies.profiles;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CompileSealAdmissionRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a technical-compilation admission seal.",
      );
    }

    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters);
    assertAdmissionScope(project, run, approval.decision, admission);

    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CompileSealAdmissionRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: TechnicalCompilationAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    let snapshotReadbackVerified = false;

    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      // A resumed claimed run has no durable pre-save intent marker. Treat it
      // conservatively as if a prior process may have dispatched the
      // deterministic successor write, even when it crashed before advancing
      // the project status to publishing. This prevents a retry-time source or
      // profile outage from falsely releasing a basis that may already own an
      // orphan successor.
      snapshotSaveMayHaveBeenDispatched = run.status === "running" ||
        run.status === "publishing";
      const completed = await this.#completedFor(
        origin,
        command,
        approvedDecision,
        admission,
      );
      if (completed) return completed;

      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      await assertBasisAndSysmlEvidence(
        project,
        run,
        approvedDecision,
        admission,
        basisSnapshot,
      );
      await verifyResolvedBasis(
        this.#basisResolver,
        command.projectId,
        basis,
        admission,
      );

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free technical-compilation admission seal.",
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        // Replay the immutable claim command before any resumed work. The
        // command service proves that command id, actor, issued time, expected
        // revision and summary are the exact original request; same-actor is
        // not sufficient authority to adopt another execution command.
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free technical-compilation admission seal.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const currentApproval = await requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The human-approved admission decision changed after the run was claimed.",
        );
      }
      const currentAdmission = parseAdmission(currentApproval.proposal.parameters);
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed admission parameters changed after the run was claimed.",
        );
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertBasisAndSysmlEvidence(
        project,
        run,
        currentApproval.decision,
        admission,
        currentBasisSnapshot,
      );
      await verifyResolvedBasis(
        this.#basisResolver,
        command.projectId,
        currentBasis,
        admission,
      );

      const draftReference = draftReferenceFrom(admission);
      const draft = await this.#drafts.read(draftReference);
      if (!draft) {
        throw invalidTransition(
          `Technical-compilation draft ${admission.draft.draftId} is not exactly available.`,
        );
      }
      const document = await verifyDraft(admission, draft);
      await verifySources(
        this.#sources,
        command.projectId,
        document.basis,
        admission,
        draft,
        document,
      );
      await verifyProfiles(this.#profiles, admission, document);

      const sealedAt = requiredStart(run);
      const capture: TechnicalCompilationAdmissionCapture = {
        schemaVersion: TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
        operation: COMPILE_SEAL_ADMISSION_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt,
        draftReference,
        sourceCaptures: draft.sourceCaptures,
        admission,
        document,
      };
      const validatedCapture = await validateTechnicalCompilationAdmissionCapture(
        capture,
      );
      const captureText = deterministicJson(validatedCapture);
      const captureFingerprint = await sha256Fingerprint(validatedCapture);
      await this.#captures.save(captureFingerprint, captureText);
      const captureReadback = await this.#captures.read(captureFingerprint);
      if (captureReadback === undefined) {
        throw new Error(
          "Technical-compilation admission capture was not durably readable after save.",
        );
      }
      let reopenedCapture: TechnicalCompilationAdmissionCapture;
      try {
        reopenedCapture = await validateTechnicalCompilationAdmissionCapture(
          JSON.parse(captureReadback),
        );
      } catch (error) {
        throw new Error(
          `Technical-compilation admission capture failed exact readback: ${
            errorMessage(error)
          }`,
        );
      }
      if (
        captureReadback !== captureText ||
        deterministicJson(reopenedCapture) !== captureText
      ) {
        throw new Error(
          "Technical-compilation admission capture changed during exact readback.",
        );
      }

      const expectedSuccessor = buildTechnicalCompilationAdmissionSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: reopenedCapture,
        captureFingerprint,
      });
      const artifact = expectedSuccessor.artifact;
      snapshotSaveMayHaveBeenDispatched = true;
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
          "Technical-compilation admission ThreadSnapshot was not durably readable after save.",
        );
      }
      snapshotReadbackVerified = true;

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed technical-compilation admission.",
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
            artifact,
          ),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      await this.#assertCompletedEvidence(
        origin,
        complete,
        command,
        currentApproval.decision,
        admission,
      );
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(
          origin,
          command,
          approvedDecision,
          admission,
        );
        if (completed) return completed;
        throw invalidTransition(
          `Technical-compilation admission Thread write may have been dispatched${
            snapshotReadbackVerified ? " and exactly read back" : ""
          }, but project attachment did not finish. Retry this exact command; it will reconstruct and reopen the same deterministic successor without creating another revision. Cause: ${
            errorMessage(error)
          }`,
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
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: CompileSealAdmissionRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: TechnicalCompilationAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    // Delegate exact command-id replay/conflict detection to the command
    // service that authored the immutable claim receipt. Calling claim on a
    // completed run is safe because a matching receipt returns before any
    // transition, while a changed actor/time/revision is rejected.
    await this.#commands.claimRun(origin, {
      ...command,
      commandId: commandStep(command.commandId, "claim"),
      summary: "Started the provider-free technical-compilation admission seal.",
    });
    const replayed = await this.#requiredProject(command.projectId);
    await this.#assertCompletedEvidence(
      origin,
      replayed,
      command,
      approvedDecision,
      admission,
    );
    return replayed;
  }

  async #assertCompletedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: CompileSealAdmissionRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: TechnicalCompilationAdmission,
  ): Promise<void> {
    assertCompleted(project, command);
    const run = requireRun(project, command.runId);
    const basis = requireBasis(run);
    const result = run.resultSnapshot!;
    const snapshot = await this.#snapshots.getFresh(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      result.subjectId !== basis.subjectId || result.revision !== basis.revision + 1 ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed admission run does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    await assertThreadSnapshotLineageIntact(validatedSnapshot, this.#snapshots);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
    await assertBasisAndSysmlEvidence(
      project,
      run,
      approvedDecision,
      admission,
      basisSnapshot,
    );
    await verifyResolvedBasis(
      this.#basisResolver,
      command.projectId,
      basis,
      admission,
    );
    const resultEvidence = exactCompletedEvidence(project, run, validatedSnapshot);
    const observedArtifact = validatedSnapshot.artifacts.find((item) =>
      item.id === resultEvidence.id
    );
    if (!observedArtifact) {
      throw invalidTransition(
        "The completed admission evidence artifact is absent from its result snapshot.",
      );
    }
    const captureText = await this.#captures.read(observedArtifact.fingerprint);
    if (captureText === undefined) {
      throw invalidTransition(
        "The completed admission capture is no longer content-addressably readable.",
      );
    }
    let capture: TechnicalCompilationAdmissionCapture;
    try {
      capture = await validateTechnicalCompilationAdmissionCapture(
        JSON.parse(captureText),
      );
    } catch (error) {
      throw invalidTransition(
        `The completed admission capture failed exact replay validation: ${
          errorMessage(error)
        }`,
      );
    }
    const observedCaptureFingerprint = await sha256Fingerprint(capture);
    if (
      captureText !== deterministicJson(capture) ||
      !fingerprintsEqual(
        observedCaptureFingerprint,
        observedArtifact.fingerprint,
      ) ||
      capture.trustedRunId !== run.id ||
      capture.decisionId !== approvedDecision.id ||
      capture.sealedAt !== requiredStart(run) ||
      deterministicJson(capture.admission) !== deterministicJson(admission)
    ) {
      throw invalidTransition(
        "The completed admission capture no longer equals the exact reviewed run and decision.",
      );
    }
    const expectedSuccessor = buildTechnicalCompilationAdmissionSuccessor({
      basisSnapshot,
      basis,
      run,
      capture,
      captureFingerprint: observedCaptureFingerprint,
    });
    if (
      resultEvidence.id !== expectedSuccessor.artifact.id ||
      deterministicJson(validatedSnapshot) !==
        deterministicJson(expectedSuccessor.snapshot)
    ) {
      throw invalidTransition(
        "The completed admission Thread successor no longer equals the exact deterministic snapshot produced from its reviewed basis and capture.",
      );
    }
    const receipt = exactCompletionReceipt(project, command, origin, run);
    await this.#commands.completeRun(
      origin,
      completionCommand(
        command,
        receipt.resultingSnapshot.revision - 1,
        expectedSuccessor.snapshot,
        expectedSuccessor.artifact,
      ),
    );
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CompileSealAdmissionRunExecutorCommand,
    failure: {
      readonly summary: string;
      readonly code: string;
      readonly message: string;
    } = {
      summary:
        "Technical-compilation admission stopped before a ThreadSnapshot write was dispatched.",
      code: "compile-seal-admission-not-published",
      message:
        "The provider-free admission seal stopped before its evidence was published.",
    },
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        (run.status !== "running" && run.status !== "publishing") ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: failure.summary,
        code: failure.code,
        message: failure.message,
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

function buildTechnicalCompilationAdmissionSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: TechnicalCompilationAdmissionCapture;
  readonly captureFingerprint: ContentFingerprint;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const sysmlArtifacts = technicalCompilationAnchorArtifactReferences(
    input.capture.document.basis.sysmlAnchor,
  ).map((reference) =>
    exactArtifact(
      input.basisSnapshot,
      reference.artifactId,
      reference.artifactFingerprint,
    )
  );
  const artifactId =
    `technical-compilation-admission-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool: COMPILE_SEAL_ADMISSION_PRODUCER_TOOL,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name:
      `Technical compilation admission ${input.capture.document.basis.thread.subjectId}`,
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX}${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: sysmlArtifacts.map((artifact) => artifact.id),
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumptions: ThreadArtifactConsumption[] = sysmlArtifacts.map(
    (sysmlArtifact) => ({
      id: `consume-${sysmlArtifact.id}-by-${artifact.id}`,
      artifactId: sysmlArtifact.id,
      consumer: operationRef,
      observedFingerprint: sysmlArtifact.fingerprint,
      verifiedAt: sealedAt,
      status: "verified",
    }),
  );
  const extension: ThreadSnapshotExtension = {
    id: `compile-seal-admission-${input.run.id}`,
    name: "Seal the reviewed technical-compilation admission",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: sysmlArtifacts.flatMap((sysmlArtifact) => {
      const consumptionId = `consume-${sysmlArtifact.id}-by-${artifact.id}`;
      const derivedFromId = sysmlArtifact.id ===
          input.capture.admission.basis.sysml.artifactId
        ? `derived-from-sysml-${input.captureFingerprint.digest}`
        : `derived-from-sysml-${input.captureFingerprint.digest}-${sysmlArtifact.id}`;
      return [{
        id: derivedFromId,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifact.id },
        to: { kind: "artifact" as const, id: sysmlArtifact.id },
        rationale:
          "The sealed admission is anchored to this exact reviewed SysML provenance artifact.",
      }, {
        id: `uses-${consumptionId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumptionId },
        to: { kind: "artifact" as const, id: sysmlArtifact.id },
        rationale:
          "The executor re-opened this exact Thread/SysML provenance artifact and verified its fingerprint before sealing.",
      }];
    }),
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact technical-compilation admission is already present in the basis snapshot.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifact,
  };
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings[0];
  if (
    run.basis?.kind !== "thread-snapshot" ||
    !workItem || operation?.id !== COMPILE_SEAL_ADMISSION_OPERATION.id ||
    operation.version !== COMPILE_SEAL_ADMISSION_OPERATION.version ||
    operation.bindings.length !== 1 || binding?.name !== "sysmlModel" ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version} with the sole sysmlModel Thread artifact binding.`,
    );
  }
  const basis = requireBasis(run);
  const reference = binding.source.reference;
  if (
    reference.snapshotId !== basis.snapshotId ||
    reference.snapshotRevision !== basis.revision
  ) {
    throw invalidTransition(
      "The sysmlModel binding must name an artifact in the run's exact Thread basis revision.",
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw invalidTransition(
      "This executor may continue only the exact admission-seal run it claimed.",
    );
  }
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];

  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal || !decision.inputFingerprint) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id && approval.status === "approved" &&
      decision.approvalIds.includes(approval.id) &&
      approval.decidedByOrigin === "human" &&
      typeof approval.decidedBy === "string" &&
      approval.decidedBy.trim().length > 0 &&
      typeof approval.decidedAt === "string" &&
      !Number.isNaN(Date.parse(approval.decidedAt)) &&
      sameSnapshotBasis(approval.baseSnapshot, basis) &&
      sameEvidenceRefs(approval.inputEvidenceRefs, decision.inputEvidenceRefs) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    );
    if (
      approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      candidates.length === 0
        ? "No exact human-approved technical-compilation admission decision is bound to this run basis."
        : "Ambiguous technical-compilation admission: exactly one human-approved decision is required.",
    );
  }
  const selected = candidates[0];
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
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The technical-compilation decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((item) => item.id === id);
    if (!decision?.inputFingerprint) {
      throw invalidTransition(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation?.id,
      version: workItem.operation?.version,
      bindings: workItem.operation?.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admission run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): TechnicalCompilationAdmission {
  try {
    return parseTechnicalCompilationAdmissionParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Technical-compilation admission parameters are invalid: ${errorMessage(error)}`,
    );
  }
}

function assertAdmissionScope(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  decision: EngineeringDecision,
  admission: TechnicalCompilationAdmission,
): void {
  const basis = requireBasis(run);
  if (
    admission.draft.projectId !== project.project.id ||
    admission.basis.thread.projectId !== project.project.id ||
    admission.basis.thread.subjectId !== basis.subjectId ||
    admission.basis.thread.snapshotId !== basis.snapshotId ||
    admission.basis.thread.revision !== basis.revision
  ) {
    throw invalidTransition(
      "The reviewed admission draft and Thread identity are foreign or stale for this run.",
    );
  }
  const sysmlEvidence = exactSysmlEvidenceRef(decision);
  if (
    sysmlEvidence.snapshotId !== basis.snapshotId ||
    sysmlEvidence.snapshotRevision !== basis.revision ||
    sysmlEvidence.id !== admission.basis.sysml.artifactId
  ) {
    throw invalidTransition(
      "The MRTR inputEvidenceRefs do not name the exact admitted SysML artifact in the run basis.",
    );
  }
  const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
  const binding = workItem.operation!.bindings[0];
  if (
    binding.source.kind !== "thread-entity" ||
    deterministicJson(binding.source.reference) !== deterministicJson(sysmlEvidence)
  ) {
    throw invalidTransition(
      "The sysmlModel operation binding and MRTR evidence reference must be identical.",
    );
  }
}

async function assertBasisAndSysmlEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  decision: EngineeringDecision,
  admission: TechnicalCompilationAdmission,
  snapshot: ThreadSnapshot,
): Promise<void> {
  assertAdmissionScope(project, run, decision, admission);
  const observedSnapshotFingerprint = await sha256Fingerprint(snapshot);
  if (
    !fingerprintsEqual(
      observedSnapshotFingerprint,
      admission.basis.thread.fingerprint,
    )
  ) {
    throw invalidTransition(
      "The reviewed Thread snapshot fingerprint no longer matches the exact basis bytes.",
    );
  }
  exactArtifact(
    snapshot,
    admission.basis.sysml.artifactId,
    admission.basis.sysml.artifactFingerprint,
  );
}

async function verifyDraft(
  admission: TechnicalCompilationAdmission,
  draft: TechnicalCompilationDraft,
): Promise<TechnicalCompilationDocument> {
  if (draft.projectId !== admission.draft.projectId) {
    throw invalidTransition(
      "The reopened compilation draft belongs to another project.",
    );
  }
  const document = await validateTechnicalCompilationDocument(draft.document);
  const documentFingerprint = await fingerprintTechnicalCompilationDocument(document);
  const envelopeFingerprint = await sha256Fingerprint(draft);
  const basisFingerprint = await fingerprintTechnicalCompilationBasis(document.basis);
  if (
    document.status !== "ready-for-review" ||
    !fingerprintsEqual(documentFingerprint, draft.fingerprint) ||
    !fingerprintsEqual(documentFingerprint, admission.draft.documentFingerprint) ||
    !fingerprintsEqual(documentFingerprint, admission.compilation.fingerprint) ||
    !fingerprintsEqual(envelopeFingerprint, admission.draft.envelopeFingerprint) ||
    !fingerprintsEqual(basisFingerprint, admission.basis.fingerprint) ||
    !fingerprintsEqual(document.basisFingerprint, admission.basis.fingerprint) ||
    !fingerprintsEqual(
      document.basis.thread.snapshotFingerprint,
      admission.basis.thread.fingerprint,
    ) ||
    document.basis.thread.projectId !== admission.basis.thread.projectId ||
    document.basis.thread.subjectId !== admission.basis.thread.subjectId ||
    document.basis.thread.snapshotId !== admission.basis.thread.snapshotId ||
    document.basis.thread.revision !== admission.basis.thread.revision ||
    document.basis.sysmlAnchor.artifactId !== admission.basis.sysml.artifactId ||
    !fingerprintsEqual(
      document.basis.sysmlAnchor.artifactFingerprint,
      admission.basis.sysml.artifactFingerprint,
    ) ||
    document.basis.sysmlAnchor.captureId !== admission.basis.sysml.captureId ||
    document.basis.sysmlAnchor.editingContextId !==
      admission.basis.sysml.editingContextId ||
    document.basis.sysmlAnchor.rootElementId !==
      admission.basis.sysml.rootElementId ||
    document.basis.sysmlAnchor.rootElementKind !==
      admission.basis.sysml.rootElementKind ||
    !fingerprintsEqual(
      document.basis.sysmlAnchorFingerprint,
      admission.basis.sysml.anchorFingerprint,
    ) || deterministicJson(document.inputManifest.bindings) !==
      deterministicJson(admission.bindings) ||
    deterministicJson(document.inputManifest.profileRequests) !==
      deterministicJson(admission.compilationProfileRequests.map((request) => ({
        profileId: request.profileId,
        profileVersion: request.profileVersion,
        sourceIds: request.sourceIds,
      })))
  ) {
    throw invalidTransition(
      "The reopened compilation draft does not exactly match the human-reviewed admission.",
    );
  }
  assertEmbeddedProfileRequests(admission, document);
  return document;
}

async function verifyResolvedBasis(
  resolver: TechnicalCompilationBasisResolver,
  projectId: string,
  basis: EngineeringThreadSnapshotBasis,
  admission: TechnicalCompilationAdmission,
): Promise<void> {
  let resolved;
  try {
    resolved = await resolver.resolve({ projectId, basis });
  } catch (error) {
    throw invalidTransition(
      `The exact capture-backed Thread/SysML basis could not be reopened: ${
        errorMessage(error)
      }`,
    );
  }
  if (!resolved) {
    throw invalidTransition(
      "The exact capture-backed Thread/SysML basis is no longer available.",
    );
  }
  const resolvedFingerprint = await fingerprintTechnicalCompilationBasis(resolved);
  const admittedBasis = {
    thread: {
      projectId: admission.basis.thread.projectId,
      subjectId: admission.basis.thread.subjectId,
      snapshotId: admission.basis.thread.snapshotId,
      revision: admission.basis.thread.revision,
      snapshotFingerprint: admission.basis.thread.fingerprint,
    },
    sysmlAnchor: {
      artifactId: admission.basis.sysml.artifactId,
      artifactFingerprint: admission.basis.sysml.artifactFingerprint,
      captureId: admission.basis.sysml.captureId,
      editingContextId: admission.basis.sysml.editingContextId,
      rootElementId: admission.basis.sysml.rootElementId,
      rootElementKind: admission.basis.sysml.rootElementKind,
      elements: resolved.sysmlAnchor.elements,
    },
    sysmlAnchorFingerprint: admission.basis.sysml.anchorFingerprint,
  };
  if (
    !fingerprintsEqual(resolvedFingerprint, admission.basis.fingerprint) ||
    deterministicJson(resolved) !== deterministicJson(admittedBasis)
  ) {
    throw invalidTransition(
      "The capture-backed Thread/SysML basis differs from the exact human-reviewed admission.",
    );
  }
}

function assertEmbeddedProfileRequests(
  admission: TechnicalCompilationAdmission,
  document: TechnicalCompilationDocument,
): void {
  const projections = new Map(
    document.projections.map((projection) => [
      `${projection.profile.id}@${projection.profile.version}`,
      projection,
    ]),
  );
  if (projections.size !== admission.compilationProfileRequests.length) {
    throw invalidTransition(
      "The compilation document does not exactly cover every human-reviewed profile request.",
    );
  }
  for (const request of admission.compilationProfileRequests) {
    const reference = `${request.profileId}@${request.profileVersion}`;
    const projection = projections.get(reference);
    if (
      !projection || projection.target !== request.target ||
      projection.profile.target !== request.target ||
      !fingerprintsEqual(
        projection.profileFingerprint,
        request.profileFingerprint,
      ) || projection.status !== "ready-for-review"
    ) {
      throw invalidTransition(
        `The embedded compilation projection ${reference} differs from its reviewed identity.`,
      );
    }
  }
}

function assertCaptureSourceCoverage(
  admission: TechnicalCompilationAdmission,
  sourceCaptures: TechnicalCompilationDraft["sourceCaptures"],
  document: TechnicalCompilationDocument,
): void {
  const sourceIds = sourceCaptures.map((capture) => capture.sourceId);
  const referenceDigests = sourceCaptures.map((capture) =>
    capture.referenceFingerprint.digest
  );
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    new Set(referenceDigests).size !== referenceDigests.length ||
    sourceCaptures.length !== admission.sources.length ||
    sourceCaptures.length !== document.inputManifest.sources.length
  ) {
    throw new TypeError(
      "$technicalCompilationAdmissionCapture.sourceCaptures must uniquely and exactly cover every admitted source.",
    );
  }
  const captureById = new Map(
    sourceCaptures.map((capture) => [capture.sourceId, capture]),
  );
  const documentSourceById = new Map(
    document.inputManifest.sources.map((source) => [
      source.analysis.source.id,
      source,
    ]),
  );
  for (const expected of admission.sources) {
    const capture = captureById.get(expected.id);
    const documentSource = documentSourceById.get(expected.id);
    if (!capture || !documentSource) {
      throw new TypeError(
        `$technicalCompilationAdmissionCapture source ${expected.id} is not exactly covered.`,
      );
    }
    const locator = validateTechnicalSourceAnalysisCaptureLocator(
      capture.reference,
      `$technicalCompilationAdmissionCapture.sourceCaptures.${expected.id}.reference`,
    );
    assertTechnicalSourceAnalysisCaptureLocatorsEqual(
      expected.locator,
      locator,
      `$technicalCompilationAdmissionCapture.sourceCaptures.${expected.id}.locator`,
    );
    if (
      !fingerprintsEqual(
        capture.referenceFingerprint,
        expected.captureFingerprint,
      ) ||
      expected.attachment.fileId !== expected.sourceClosure.root.fileId ||
      expected.id !== documentSource.analysis.source.id ||
      !technicalSourceEffectiveUnitsEqual(
        expected.effectiveUnit,
        documentSource.effectiveUnit,
      ) ||
      documentSource.analysis.source.role !== expected.role ||
      documentSource.analysis.source.language !== expected.language ||
      !fingerprintsEqual(
        documentSource.analysis.source.fingerprint,
        expected.sourceFingerprint,
      ) ||
      !fingerprintsEqual(
        documentSource.analysisFingerprint,
        expected.analysisFingerprint,
      ) ||
      documentSource.analysis.analyzer.id !== expected.analyzer.id ||
      documentSource.analysis.analyzer.version !== expected.analyzer.version
    ) {
      throw new TypeError(
        `$technicalCompilationAdmissionCapture source ${expected.id} disagrees with its exact admission, capture, or document identity.`,
      );
    }
  }
}

async function verifySources(
  reader: TechnicalCompilationSourceReader,
  projectId: string,
  basis: TechnicalCompilationDocument["basis"],
  admission: TechnicalCompilationAdmission,
  draft: TechnicalCompilationDraft,
  document: TechnicalCompilationDocument,
): Promise<void> {
  const sourceById = new Map(
    document.inputManifest.sources.map((source) => [source.analysis.source.id, source]),
  );
  const captureById = new Map(
    draft.sourceCaptures.map((capture) => [capture.sourceId, capture]),
  );
  if (
    sourceById.size !== admission.sources.length ||
    captureById.size !== admission.sources.length
  ) throw invalidTransition("The admission source set is incomplete or ambiguous.");

  for (const expected of admission.sources) {
    const stored = sourceById.get(expected.id);
    const capture = captureById.get(expected.id);
    if (!stored || !capture) {
      throw invalidTransition(
        `Admission source ${expected.id} is not exactly reopenable.`,
      );
    }
    const reopened = await reader.read({
      projectId,
      basis,
      reference: capture.reference,
      referenceFingerprint: capture.referenceFingerprint,
    });
    if (!reopened) {
      throw invalidTransition(`Admission source ${expected.id} was not found.`);
    }
    if (reopened.provenance.attachmentAlignment !== "exact") {
      throw invalidTransition(
        `Admission source ${expected.id} is not exact against the reviewed compilation basis.`,
      );
    }
    if (reopened.source.effectiveUnit.closureKind === "unlowered-closure") {
      throw invalidTransition(
        `Admission source ${expected.id} has no language-specific dependency lowering.`,
      );
    }
    const sourceFingerprint = await fingerprintTechnicalSourceText(
      reopened.source.sourceText,
    );
    const analysisFingerprint = await fingerprintSourceAnalysisBundle(
      reopened.source.analysis,
    );
    try {
      assertTechnicalSourceProvenanceIdentitiesEqual(
        admissionSourceProvenance(expected),
        reopenedSourceProvenance(reopened),
        `$admission.sources.${expected.id}`,
      );
    } catch {
      throw invalidTransition(
        `Admission source ${expected.id} differs from its reviewed capture identity.`,
      );
    }
    if (
      !fingerprintsEqual(reopened.referenceFingerprint, capture.referenceFingerprint) ||
      !fingerprintsEqual(sourceFingerprint, expected.sourceFingerprint) ||
      !fingerprintsEqual(
        reopened.source.analysis.source.fingerprint,
        sourceFingerprint,
      ) ||
      !fingerprintsEqual(analysisFingerprint, expected.analysisFingerprint) ||
      !fingerprintsEqual(reopened.source.analysisFingerprint, analysisFingerprint) ||
      deterministicJson(reopened.source) !== deterministicJson(stored)
    ) {
      throw invalidTransition(
        `Admission source ${expected.id} differs from its reviewed capture identity.`,
      );
    }
  }
}

async function verifyProfiles(
  provider: TechnicalCompilationProfileCatalogProvider,
  admission: TechnicalCompilationAdmission,
  document: TechnicalCompilationDocument,
): Promise<void> {
  const catalog = validateTechnicalCompilationProfileCatalog(await provider.get());
  const profiles = new Map(
    catalog.profiles.map((profile) => [profileRef(profile), profile]),
  );
  const sourceById = new Map(admission.sources.map((source) => [source.id, source]));
  const projectionByRef = new Map(
    document.projections.map((
      projection,
    ) => [profileRef(projection.profile), projection]),
  );
  for (const request of admission.compilationProfileRequests) {
    const reference = `${request.profileId}@${request.profileVersion}`;
    const profile = profiles.get(reference);
    const projection = projectionByRef.get(reference);
    if (!profile || !projection) {
      throw invalidTransition(
        `Reviewed compilation profile ${reference} is unavailable.`,
      );
    }
    const fingerprint = await sha256Fingerprint(profile);
    if (
      !fingerprintsEqual(fingerprint, request.profileFingerprint) ||
      !fingerprintsEqual(fingerprint, projection.profileFingerprint) ||
      deterministicJson(profile) !== deterministicJson(projection.profile) ||
      profile.target !== request.target || projection.target !== request.target ||
      projection.status !== "ready-for-review"
    ) {
      throw invalidTransition(`Reviewed compilation profile ${reference} drifted.`);
    }
    for (const sourceId of request.sourceIds) {
      const source = sourceById.get(sourceId);
      if (!source) {
        throw invalidTransition(
          `Reviewed compilation profile ${reference} names foreign source ${sourceId}.`,
        );
      }
    }
  }
}

async function exactBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      `Basis snapshot ${basis.snapshotId}@${basis.revision} is not exactly available.`,
    );
  }
  return validateThreadSnapshot(snapshot);
}

function exactArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === id && artifact.kind === "sysml-model" &&
    fingerprintsEqual(artifact.fingerprint, fingerprint) &&
    artifact.freshness.status === "fresh" &&
    !archivedRefKeys(snapshot).has(`artifact:${artifact.id}`)
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      `SysML artifact ${id} is absent, stale, archived, ambiguous, or fingerprint-divergent in the exact Thread basis.`,
    );
  }
  return matches[0];
}

function exactSysmlEvidenceRef(
  decision: EngineeringDecision,
): EngineeringThreadEntityRef {
  if (
    decision.inputEvidenceRefs.length !== 1 ||
    decision.inputEvidenceRefs[0].kind !== "artifact"
  ) {
    throw invalidTransition(
      "The admission decision must carry exactly one SysML artifact inputEvidenceRef.",
    );
  }
  return decision.inputEvidenceRefs[0];
}

function draftReferenceFrom(
  admission: TechnicalCompilationAdmission,
): TechnicalCompilationDraftReference {
  return {
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId: admission.draft.draftId,
    projectId: admission.draft.projectId,
    documentFingerprint: admission.draft.documentFingerprint,
    envelopeFingerprint: admission.draft.envelopeFingerprint,
  };
}

function artifactEvidence(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): EngineeringThreadEntityRef {
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as ThreadEntityKind,
    id: artifact.id,
  };
}

function completionCommand(
  command: CompileSealAdmissionRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Sealed the exact human-reviewed technical compilation.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [artifactEvidence(snapshot, artifact)],
  };
}

function exactCompletionReceipt(
  project: EngineeringProjectSnapshot,
  command: CompileSealAdmissionRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
  run: EngineeringAgentRun,
): EngineeringProjectCommandReceipt {
  const completeCommandId = commandStep(command.commandId, "complete");
  const matches =
    project.commandReceipts?.filter((receipt) =>
      receipt.commandId === completeCommandId
    ) ?? [];
  const receipt = matches[0];
  const normalizedIssuedAt = new Date(command.issuedAt).toISOString();
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.complete" ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId ||
    receipt.issuedAt !== normalizedIssuedAt ||
    receipt.appliedAt !== run.completedAt ||
    !Number.isSafeInteger(receipt.resultingSnapshot.revision) ||
    receipt.resultingSnapshot.revision < 1
  ) {
    throw invalidTransition(
      `Admission-seal run ${command.runId} has no unique exact completion receipt for this execution command and actor.`,
    );
  }
  return receipt;
}

function exactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): EngineeringThreadEntityRef {
  const result = run.resultSnapshot;
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !result || !workItem || declared.length !== 1 ||
    result.snapshotId !== snapshot.id || result.revision !== snapshot.revision ||
    result.subjectId !== snapshot.subject.id || run.evidenceRefs.length !== 1 ||
    workItem.evidenceRefs.length !== 1 ||
    !sameEvidenceRefs(run.evidenceRefs, workItem.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed admission run is not attached to exactly one declared snapshot and evidence artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed admission evidence does not name an artifact in its exact result snapshot.",
    );
  }
  return evidence;
}

function profileRef(profile: TechnicalCompilationProfile): string {
  return `${profile.id}@${profile.version}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:compile-seal-admission:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CompileSealAdmissionRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      `Admission-seal run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return !!value && "snapshotId" in value && value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision && value.subjectId === basis.subjectId;
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
  const leftKeys = left.map(key).sort(compareText);
  const rightKeys = right.map(key).sort(compareText);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((value, index) => value === rightKeys[index]);
}

/** Test seam for the injective set comparison used by exact MRTR evidence. */
export function technicalCompilationEvidenceRefsEqualForTest(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return sameEvidenceRefs(left, right);
}

function admissionSourceProvenance(
  source: TechnicalCompilationAdmission["sources"][number],
): TechnicalSourceProvenanceIdentity {
  return {
    sourceId: source.id,
    role: source.role,
    language: source.language,
    profileId: source.profileId,
    profileVersion: source.profileVersion,
    profileFingerprint: source.profileFingerprint,
    analyzer: source.analyzer,
    sourceFingerprint: source.sourceFingerprint,
    captureFingerprint: source.captureFingerprint,
    analysisFingerprint: source.analysisFingerprint,
    effectiveUnit: source.effectiveUnit,
    attachment: source.attachment,
    sourceClosure: source.sourceClosure,
    locator: source.locator,
  };
}

function reopenedSourceProvenance(
  reopened: {
    readonly source: {
      readonly analysis: {
        readonly source: {
          readonly id: string;
          readonly role: string;
          readonly language: string;
        };
      };
    };
    readonly provenance: {
      readonly profile: {
        readonly id: string;
        readonly version: string;
        readonly fingerprint: ContentFingerprint;
      };
      readonly analyzer: { readonly id: string; readonly version: string };
      readonly sourceFingerprint: ContentFingerprint;
      readonly captureFingerprint: ContentFingerprint;
      readonly analysisFingerprint: ContentFingerprint;
      readonly effectiveUnit: TechnicalSourceProvenanceIdentity["effectiveUnit"];
      readonly attachment: TechnicalSourceProvenanceIdentity["attachment"];
      readonly sourceClosure: TechnicalSourceProvenanceIdentity["sourceClosure"];
      readonly locator: TechnicalSourceProvenanceIdentity["locator"];
    };
  },
): TechnicalSourceProvenanceIdentity {
  return {
    sourceId: reopened.source.analysis.source.id,
    role: reopened.source.analysis.source.role,
    language: reopened.source.analysis.source.language,
    profileId: reopened.provenance.profile.id,
    profileVersion: reopened.provenance.profile.version,
    profileFingerprint: reopened.provenance.profile.fingerprint,
    analyzer: reopened.provenance.analyzer,
    sourceFingerprint: reopened.provenance.sourceFingerprint,
    captureFingerprint: reopened.provenance.captureFingerprint,
    analysisFingerprint: reopened.provenance.analysisFingerprint,
    effectiveUnit: reopened.provenance.effectiveUnit,
    attachment: reopened.provenance.attachment,
    sourceClosure: reopened.provenance.sourceClosure,
    locator: reopened.provenance.locator,
  };
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  const digest = safeId(fingerprint.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
