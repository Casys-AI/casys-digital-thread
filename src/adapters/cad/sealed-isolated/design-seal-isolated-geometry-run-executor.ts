/**
 * Provider-free executor for `design.seal-isolated-geometry@1`.
 *
 * It reopens one documentary isolated Build123d execution capture, re-reads
 * the published STEP member only to verify sha256+byteCount, and writes a
 * Thread document. It never copies STEP bytes into thread-assets, never
 * creates a cad-model or step artifact, and never grants Product or FEA
 * authority. The isolation receipt and the first execute MRTR are not this
 * approval.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { Build123dExecutionCaptureStore } from "../../../application/ports/out/cad/isolated/build123d-execution-evidence-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { IsolatedOutputPublicationReader } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { Build123dExecutionCapture } from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import type { IsolatedCodeOutputReceiptRecord } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  encodeIsolatedGeometrySealParameters,
  type IsolatedGeometrySealAdmission,
  parseIsolatedGeometrySealParameters,
} from "../../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
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
} from "../../../domain/project/engineering-project.ts";
import {
  type ThreadArtifact,
  type ThreadArtifactConsumption,
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

export { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION };

export const ISOLATED_GEOMETRY_SEAL_CAPTURE_SCHEMA =
  "isolated-geometry-seal-capture/1.0" as const;
export const ISOLATED_GEOMETRY_SEAL_CAPTURE_URI_PREFIX =
  "casys://isolated-geometry-seal-capture/sha256/" as const;

export interface IsolatedGeometrySealCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface IsolatedGeometryThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface DesignSealIsolatedGeometryRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface DesignSealIsolatedGeometryRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: IsolatedGeometryThreadSnapshotStore;
  readonly executionCaptures: Build123dExecutionCaptureStore;
  readonly publications: IsolatedOutputPublicationReader;
  readonly captures: IsolatedGeometrySealCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export interface IsolatedGeometrySealCapture {
  readonly schemaVersion: typeof ISOLATED_GEOMETRY_SEAL_CAPTURE_SCHEMA;
  readonly kind: "isolated-geometry-seal";
  readonly operation: typeof DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: IsolatedGeometrySealAdmission;
  readonly executionCapture: IsolatedGeometrySealAdmission["executionCapture"] & {
    readonly uri: string;
  };
  readonly sysmlBindings: "unresolved";
}

export class DesignSealIsolatedGeometryRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: DesignSealIsolatedGeometryRunExecutorDependencies["commands"];
  readonly #snapshots: IsolatedGeometryThreadSnapshotStore;
  readonly #executionCaptures: Build123dExecutionCaptureStore;
  readonly #publications: IsolatedOutputPublicationReader;
  readonly #captures: IsolatedGeometrySealCaptureStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(dependencies: DesignSealIsolatedGeometryRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#executionCaptures = dependencies.executionCaptures;
    this.#publications = dependencies.publications;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DesignSealIsolatedGeometryRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute an isolated geometry seal.",
      );
    }

    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters);

    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DesignSealIsolatedGeometryRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: IsolatedGeometrySealAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    let snapshotReadbackVerified = false;

    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
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

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free isolated geometry seal.",
        });
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free isolated geometry seal.",
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
          "The human-approved isolated geometry decision changed after the run was claimed.",
        );
      }
      const currentAdmission = parseAdmission(currentApproval.proposal.parameters);
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed isolated geometry parameters changed after the run was claimed.",
        );
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);
      await this.#assertAdmissionMatchesBasis(
        currentBasisSnapshot,
        currentBasis,
        currentAdmission,
      );

      const reopened = await this.#reopenVerifiedExecution(
        project,
        currentAdmission,
        currentBasisSnapshot,
      );

      const sealedAt = requiredStart(run);
      const capture: IsolatedGeometrySealCapture = {
        schemaVersion: ISOLATED_GEOMETRY_SEAL_CAPTURE_SCHEMA,
        kind: "isolated-geometry-seal",
        operation: DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
        trustedRunId: run.id,
        decisionId: currentApproval.decision.id,
        sealedAt,
        admission: currentAdmission,
        executionCapture: {
          id: currentAdmission.executionCapture.id,
          fingerprint: currentAdmission.executionCapture.fingerprint,
          uri: this.#executionCaptures.uriFor(
            currentAdmission.executionCapture.fingerprint,
          ),
        },
        sysmlBindings: "unresolved",
      };
      const validatedCapture = validateIsolatedGeometrySealCapture(capture);
      const captureText = deterministicJson(validatedCapture);
      const captureFingerprint = await sha256Fingerprint(validatedCapture);
      await this.#captures.save(captureFingerprint, captureText);
      const captureReadback = await this.#captures.read(captureFingerprint);
      if (captureReadback === undefined) {
        throw new Error(
          "Isolated geometry seal capture was not durably readable after save.",
        );
      }
      const reopenedCapture = validateIsolatedGeometrySealCapture(
        JSON.parse(captureReadback),
      );
      if (
        captureReadback !== captureText ||
        deterministicJson(reopenedCapture) !== captureText
      ) {
        throw new Error(
          "Isolated geometry seal capture changed during exact readback.",
        );
      }

      const expectedSuccessor = buildIsolatedGeometrySealSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: reopenedCapture,
        captureFingerprint,
        executionCaptureArtifact: reopened.artifact,
      });
      assertDocumentOnlySuccessor(
        expectedSuccessor.snapshot,
        expectedSuccessor.artifact,
      );
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
          "Isolated geometry seal ThreadSnapshot was not durably readable after save.",
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
          summary: "Publishing the sealed isolated geometry document.",
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
          `Isolated geometry seal Thread write may have been dispatched${
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
    command: DesignSealIsolatedGeometryRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: IsolatedGeometrySealAdmission,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#commands.claimRun(origin, {
      ...command,
      commandId: commandStep(command.commandId, "claim"),
      summary: "Started the provider-free isolated geometry seal.",
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
    command: DesignSealIsolatedGeometryRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: IsolatedGeometrySealAdmission,
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
        "The completed isolated geometry seal does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    await assertThreadSnapshotLineageIntact(validatedSnapshot, this.#snapshots);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
    const resultEvidence = exactCompletedEvidence(project, run, validatedSnapshot);
    const observedArtifact = validatedSnapshot.artifacts.find((item) =>
      item.id === resultEvidence.id
    );
    if (!observedArtifact || observedArtifact.kind !== "document") {
      throw invalidTransition(
        "The completed isolated geometry seal evidence is not a Thread document.",
      );
    }
    assertDocumentOnlySuccessor(validatedSnapshot, observedArtifact);
    const captureText = await this.#captures.read(observedArtifact.fingerprint);
    if (captureText === undefined) {
      throw invalidTransition(
        "The completed isolated geometry seal capture is no longer content-addressably readable.",
      );
    }
    const capture = validateIsolatedGeometrySealCapture(JSON.parse(captureText));
    const observedCaptureFingerprint = await sha256Fingerprint(capture);
    if (
      captureText !== deterministicJson(capture) ||
      !fingerprintsEqual(observedCaptureFingerprint, observedArtifact.fingerprint) ||
      capture.trustedRunId !== run.id ||
      capture.decisionId !== approvedDecision.id ||
      capture.sealedAt !== requiredStart(run) ||
      deterministicJson(capture.admission) !== deterministicJson(admission)
    ) {
      throw invalidTransition(
        "The completed isolated geometry seal capture no longer equals the exact reviewed run and decision.",
      );
    }
    const reopened = await this.#reopenVerifiedExecution(
      project,
      admission,
      basisSnapshot,
    );
    const expectedSuccessor = buildIsolatedGeometrySealSuccessor({
      basisSnapshot,
      basis,
      run,
      capture,
      captureFingerprint: observedCaptureFingerprint,
      executionCaptureArtifact: reopened.artifact,
    });
    if (
      resultEvidence.id !== expectedSuccessor.artifact.id ||
      deterministicJson(validatedSnapshot) !==
        deterministicJson(expectedSuccessor.snapshot)
    ) {
      throw invalidTransition(
        "The completed isolated geometry Thread successor no longer equals the exact deterministic snapshot produced from its reviewed basis and capture.",
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

  async #assertAdmissionMatchesBasis(
    snapshot: ThreadSnapshot,
    basis: ReturnType<typeof requireBasis>,
    admission: IsolatedGeometrySealAdmission,
  ): Promise<void> {
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    if (
      admission.basis.snapshotId !== basis.snapshotId ||
      admission.basis.revision !== basis.revision ||
      admission.basis.subjectId !== basis.subjectId ||
      !fingerprintsEqual(admission.basis.fingerprint, snapshotFingerprint)
    ) {
      throw invalidTransition(
        "The reviewed isolated geometry basis is not the exact current Thread snapshot.",
      );
    }
  }

  async #reopenVerifiedExecution(
    project: EngineeringProjectSnapshot,
    admission: IsolatedGeometrySealAdmission,
    basisSnapshot: ThreadSnapshot,
  ): Promise<{
    readonly capture: Build123dExecutionCapture;
    readonly artifact: ThreadArtifact;
    readonly stepOutput: IsolatedCodeOutputReceiptRecord;
  }> {
    const artifact = exactExecutionCaptureArtifact(
      basisSnapshot,
      admission.executionCapture.id,
      admission.executionCapture.fingerprint,
    );
    let capture: Build123dExecutionCapture | undefined;
    try {
      capture = await this.#executionCaptures.read(
        admission.executionCapture.fingerprint,
      );
    } catch {
      throw invalidTransition(
        "The exact Build123d execution capture could not be reopened.",
      );
    }
    if (!capture) {
      throw invalidTransition(
        "The exact Build123d execution capture is no longer content-addressably readable.",
      );
    }
    const observedFingerprint = await sha256Fingerprint(capture);
    const stepOutput = exactGeometryOutput(capture);
    if (
      !fingerprintsEqual(observedFingerprint, admission.executionCapture.fingerprint) ||
      capture.projectId !== project.project.id ||
      capture.noncanonicalDraft.draftId !== admission.draft.draftId ||
      !fingerprintsEqual(
        capture.noncanonicalDraft.fingerprint,
        admission.draft.fingerprint,
      ) ||
      !fingerprintsEqual(
        capture.publicationRef.fingerprint,
        admission.publication.fingerprint,
      ) ||
      stepOutput.role !== admission.step.role ||
      stepOutput.basename !== admission.step.basename ||
      stepOutput.mediaType !== admission.step.mediaType ||
      stepOutput.format !== admission.step.format ||
      stepOutput.sha256 !== admission.step.sha256 ||
      stepOutput.byteCount !== admission.step.byteCount
    ) {
      throw invalidTransition(
        "The reopened isolated execution capture does not match the signed seal identities.",
      );
    }

    let published: Uint8Array | undefined;
    try {
      published = await this.#publications.readPublishedObject(
        capture.publicationRef,
        stepOutput,
      );
    } catch {
      throw invalidTransition(
        "The published isolated STEP member could not be reopened behind its publication gate.",
      );
    }
    if (published === undefined) {
      throw invalidTransition(
        "The published isolated STEP member is not available behind its publication gate.",
      );
    }
    const observedSha256 = await fingerprintResourceBytes(published);
    if (
      observedSha256 !== admission.step.sha256 ||
      published.byteLength !== admission.step.byteCount
    ) {
      throw invalidTransition(
        "The reopened published STEP bytes do not match the signed sha256 and byteCount.",
      );
    }
    return { capture, artifact, stepOutput };
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: DesignSealIsolatedGeometryRunExecutorCommand,
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
        summary:
          "Isolated geometry seal stopped before a ThreadSnapshot write was dispatched.",
        code: "design-seal-isolated-geometry-not-published",
        message:
          "The provider-free isolated geometry seal stopped before its document was published.",
      });
    } catch {
      // Preserve the original failure.
    }
  }
}

export function validateIsolatedGeometrySealCapture(
  value: unknown,
): IsolatedGeometrySealCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "admission",
    "executionCapture",
    "sysmlBindings",
  ], "$isolatedGeometrySealCapture");
  literalValue(
    root.schemaVersion,
    ISOLATED_GEOMETRY_SEAL_CAPTURE_SCHEMA,
    "$isolatedGeometrySealCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "isolated-geometry-seal",
    "$isolatedGeometrySealCapture.kind",
  );
  literalValue(
    root.sysmlBindings,
    "unresolved",
    "$isolatedGeometrySealCapture.sysmlBindings",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$isolatedGeometrySealCapture.operation",
  );
  literalValue(
    operation.id,
    DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id,
    "$isolatedGeometrySealCapture.operation.id",
  );
  literalValue(
    operation.version,
    DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version,
    "$isolatedGeometrySealCapture.operation.version",
  );
  if (typeof root.sealedAt !== "string" || Number.isNaN(Date.parse(root.sealedAt))) {
    throw new TypeError("$isolatedGeometrySealCapture.sealedAt must be ISO-8601.");
  }
  const admission = parseIsolatedGeometrySealParameters(
    encodeIsolatedGeometrySealParameters(root.admission),
  );
  const executionCapture = exactRecord(
    root.executionCapture,
    ["id", "fingerprint", "uri"],
    "$isolatedGeometrySealCapture.executionCapture",
  );
  const executionCaptureId = safeId(
    executionCapture.id,
    "$isolatedGeometrySealCapture.executionCapture.id",
  );
  if (
    executionCaptureId !== admission.executionCapture.id ||
    deterministicJson(executionCapture.fingerprint) !==
      deterministicJson(admission.executionCapture.fingerprint)
  ) {
    throw new TypeError(
      "$isolatedGeometrySealCapture.executionCapture does not match the signed admission.",
    );
  }
  const expectedUri =
    `casys://build123d-execution-capture/sha256/${admission.executionCapture.fingerprint.digest}`;
  if (executionCapture.uri !== expectedUri) {
    throw new TypeError(
      "$isolatedGeometrySealCapture.executionCapture.uri must be the documentary execution-capture CAS URI.",
    );
  }
  return {
    schemaVersion: ISOLATED_GEOMETRY_SEAL_CAPTURE_SCHEMA,
    kind: "isolated-geometry-seal",
    operation: DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$isolatedGeometrySealCapture.trustedRunId",
    ),
    decisionId: safeId(root.decisionId, "$isolatedGeometrySealCapture.decisionId"),
    sealedAt: root.sealedAt,
    admission,
    executionCapture: {
      id: executionCaptureId,
      fingerprint: admission.executionCapture.fingerprint,
      uri: expectedUri,
    },
    sysmlBindings: "unresolved",
  };
}

function buildIsolatedGeometrySealSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly capture: IsolatedGeometrySealCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly executionCaptureArtifact: ThreadArtifact;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = `isolated-geometry-seal-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id}@${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Isolated geometry seal",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${ISOLATED_GEOMETRY_SEAL_CAPTURE_URI_PREFIX}${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.executionCaptureArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${input.executionCaptureArtifact.id}-by-${artifact.id}`,
    artifactId: input.executionCaptureArtifact.id,
    consumer: operationRef,
    observedFingerprint: input.executionCaptureArtifact.fingerprint,
    verifiedAt: sealedAt,
    status: "verified",
  };
  const extension: ThreadSnapshotExtension = {
    id: `design-seal-isolated-geometry-${input.run.id}`,
    name: "Seal the reviewed isolated geometry document",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `derived-from-${input.executionCaptureArtifact.id}-by-${artifact.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: input.executionCaptureArtifact.id },
      rationale:
        "The isolated geometry seal reopens the exact documentary Build123d execution capture.",
    }, {
      id: `uses-${consumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: input.executionCaptureArtifact.id },
      rationale:
        "The executor verified the exact execution capture fingerprint and published STEP identities.",
    }],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact isolated geometry seal document is already present in the basis snapshot.",
    );
  }
  const snapshot = validateThreadSnapshot(applied.snapshot);
  assertDocumentOnlySuccessor(snapshot, artifact);
  return { snapshot, artifact };
}

function assertDocumentOnlySuccessor(
  snapshot: ThreadSnapshot,
  sealed: ThreadArtifact,
): void {
  const added = snapshot.artifacts.filter((artifact) => artifact.id === sealed.id);
  if (
    added.length !== 1 || added[0]!.kind !== "document" ||
    added[0]!.mediaType !== "application/json"
  ) {
    throw invalidTransition(
      "The isolated geometry seal successor must add exactly one JSON document.",
    );
  }
  if (
    snapshot.artifacts.some((artifact) =>
      artifact.id === sealed.id &&
      (artifact.kind === "step" || artifact.kind === "cad-model")
    )
  ) {
    throw invalidTransition(
      "The isolated geometry seal must not write a step or cad-model Thread artifact.",
    );
  }
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
    !workItem ||
    operation?.id !== DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id ||
    operation.version !== DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version ||
    operation.bindings.length !== 1 || binding?.name !== "executionCapture" ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id}@${DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version} with the sole executionCapture Thread artifact binding.`,
    );
  }
  const basis = requireBasis(run);
  if (
    binding.source.reference.snapshotId !== basis.snapshotId ||
    binding.source.reference.snapshotRevision !== basis.revision
  ) {
    throw invalidTransition(
      "The executionCapture binding must name an artifact in the run's exact Thread basis revision.",
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
      "This executor may continue only the exact isolated geometry seal run it claimed.",
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
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      candidates.length === 0
        ? "No exact human-approved isolated geometry seal decision is bound to this run basis."
        : "Ambiguous isolated geometry seal: exactly one human-approved decision is required.",
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
    !fingerprintsEqual(expectedDecisionFingerprint, selected.decision.inputFingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The isolated geometry decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
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
      "The isolated geometry run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  const admission = parseAdmission(selected.proposal.parameters);
  const evidence = exactExecutionCaptureEvidenceRef(selected.decision);
  const binding = workItem.operation!.bindings[0]!;
  if (
    evidence.snapshotId !== basis.snapshotId ||
    evidence.snapshotRevision !== basis.revision ||
    evidence.id !== admission.executionCapture.id ||
    binding.source.kind !== "thread-entity" ||
    deterministicJson(binding.source.reference) !== deterministicJson(evidence)
  ) {
    throw invalidTransition(
      "The operation binding, MRTR evidence, and reviewed execution capture are not the same exact Thread entity.",
    );
  }
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): IsolatedGeometrySealAdmission {
  try {
    return parseIsolatedGeometrySealParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Isolated geometry seal parameters are invalid: ${errorMessage(error)}`,
    );
  }
}

function exactExecutionCaptureArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === id && artifact.kind === "document" &&
    fingerprintsEqual(artifact.fingerprint, fingerprint) &&
    artifact.freshness.status === "fresh" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool ===
      `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}` &&
    artifact.id === `build123d-execution-capture-${fingerprint.digest}`
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      `Build123d execution capture ${id} is absent, stale, ambiguous, not a document, or not produced by ${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}.`,
    );
  }
  if (matches[0]!.kind === "step" || matches[0]!.kind === "cad-model") {
    throw invalidTransition(
      "The isolated geometry seal cannot bind a step or cad-model artifact.",
    );
  }
  return matches[0]!;
}

function exactGeometryOutput(
  capture: Build123dExecutionCapture,
): IsolatedCodeOutputReceiptRecord {
  const matches = capture.receiptRecord.outputs.filter((output) =>
    output.role === "geometry"
  );
  if (matches.length !== 1) {
    throw invalidTransition(
      "The reopened execution receipt must contain one geometry output.",
    );
  }
  return matches[0]!;
}

async function exactBasisSnapshot(
  snapshots: IsolatedGeometryThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the isolated geometry seal.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: DesignSealIsolatedGeometryRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Sealed the exact human-reviewed isolated geometry document.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [artifactEvidence(snapshot, artifact)],
  };
}

function artifactEvidence(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): EngineeringThreadEntityRef {
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

function exactCompletionReceipt(
  project: EngineeringProjectSnapshot,
  command: DesignSealIsolatedGeometryRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
  run: EngineeringAgentRun,
): EngineeringProjectCommandReceipt {
  const completeCommandId = commandStep(command.commandId, "complete");
  const matches =
    project.commandReceipts?.filter((receipt) =>
      receipt.commandId === completeCommandId
    ) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.complete" ||
    receipt.actor.id !== origin.actorId || receipt.actor.origin !== origin.kind ||
    receipt.issuedAt !== command.issuedAt || !run.resultSnapshot
  ) {
    throw invalidTransition(
      "The completed isolated geometry seal has no exact complete-run receipt.",
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
      "The completed isolated geometry seal is not attached to exactly one declared snapshot and document artifact.",
    );
  }
  const evidence = run.evidenceRefs[0]!;
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.snapshotRevision !== snapshot.revision ||
    evidence.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The completed isolated geometry evidence reference is not the sealed document.",
    );
  }
  return evidence;
}

function exactExecutionCaptureEvidenceRef(
  decision: EngineeringDecision,
): EngineeringThreadEntityRef {
  if (
    decision.inputEvidenceRefs.length !== 1 ||
    decision.inputEvidenceRefs[0]?.kind !== "artifact"
  ) {
    throw invalidTransition(
      "The isolated geometry seal MRTR must name exactly one execution-capture artifact.",
    );
  }
  return decision.inputEvidenceRefs[0];
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:design-seal-isolated-geometry:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: DesignSealIsolatedGeometryRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      `Isolated geometry seal run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: ReturnType<typeof requireBasis>,
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
  const leftKeys = [...left.map(key)].sort();
  const rightKeys = [...right.map(key)].sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((value, index) => value === rightKeys[index]);
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
