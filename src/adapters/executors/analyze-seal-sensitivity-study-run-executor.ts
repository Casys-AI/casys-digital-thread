/**
 * Provider-free executor for `analyze.seal-sensitivity-study@1`.
 *
 * Seals a reviewed sensitivity-study-case/2.0 into the Thread. The catalog
 * holds the scientific template; the signed MRTR binds cadSource. No CAD or
 * CalculiX call is made.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../application/ports/out/technical-compilation-admission-reader.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { assertSensitivityLiveMethod } from "../../domain/analysis/sensitivity-live-method.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  canonicalSensitivityStudyCaseText,
  parseSensitivityStudyDecisionParameters,
  type SensitivityStudyDecisionParameters,
  verifySensitivityStudyParametersMatchCase,
} from "../../domain/analysis/sensitivity-study-proposal.ts";
import { locateModuleLevelNumericBinding } from "../../domain/analysis/sensitivity-source-substitution.ts";
import {
  assembleSensitivityStudyCaseV2,
  validateSensitivityStudyCaseTemplate,
} from "../../domain/analysis/sensitivity-study-template.ts";
import {
  parseSensitivityCadSourceUri,
  type SensitivityStudyCaseV2,
} from "../../domain/analysis/sensitivity-study-v2.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
  type SensitivityStudyCaseCapture,
  validateSensitivityStudyCaseCapture,
} from "../captures/sensitivity-study-case-capture.ts";
import type { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";

export { ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION };
export {
  SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
};

export const SENSITIVITY_STUDY_CASE_SOURCES: ReadonlyMap<string, string> = new Map([
  [
    "dl04-size-z-sensitivity",
    "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
  ],
  [
    "dl05-arm-thickness-sensitivity",
    "config/sensitivity-study-cases/dl05-arm-thickness-sensitivity.json",
  ],
  [
    "dl05-arm-thickness-isolated",
    "config/sensitivity-study-cases/dl05-arm-thickness-isolated.json",
  ],
]);

export const SENSITIVITY_SEAL_THREAD_WRITE_OUTCOME_UNKNOWN =
  "analyze-seal-sensitivity-study-thread-write-outcome-unknown";

export interface SensitivitySealThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AnalyzeSealSensitivityStudyRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: SensitivitySealThreadSnapshotStore;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly captures: FileCaptureStore<"sensitivity-study-case">;
  readonly lease: EngineeringProjectRunLease;
  readonly readTextFile?: (path: string) => Promise<string>;
}

export class AnalyzeSealSensitivityStudyRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: AnalyzeSealSensitivityStudyRunExecutorDependencies["commands"];
  readonly #snapshots: SensitivitySealThreadSnapshotStore;
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #captures: FileCaptureStore<"sensitivity-study-case">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #readTextFile: (path: string) => Promise<string>;

  constructor(deps: AnalyzeSealSensitivityStudyRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#admissions = deps.admissions;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#readTextFile = deps.readTextFile ?? Deno.readTextFile.bind(Deno);
  }

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
        "Only an authenticated agent can execute the analyze-seal-sensitivity-study run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const { decision, proposal } = await requireMrtrApproval(project, run);
    let decisionParams: SensitivityStudyDecisionParameters;
    try {
      decisionParams = parseSensitivityStudyDecisionParameters(proposal.parameters);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity decision parameters are invalid: ${errorMessage(error)}`,
      );
    }
    const { studyCase, caseDigest } = await this.#loadAndVerifyCase(decisionParams);
    const basis = requireBasis(run);
    if (studyCase.project.id !== command.projectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity case project.id "${studyCase.project.id}" does not match ` +
          `command projectId "${command.projectId}".`,
      );
    }
    if (studyCase.project.subjectId !== basis.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity case project.subjectId "${studyCase.project.subjectId}" ` +
          `does not match run basis subjectId "${basis.subjectId}".`,
      );
    }
    try {
      assertSensitivityLiveMethod(studyCase);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        errorMessage(error),
      );
    }
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () =>
        this.#executeLeased(
          origin,
          command,
          decision,
          decisionParams,
          studyCase,
          caseDigest,
        ),
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
    approvedDecision: EngineeringDecision,
    decisionParams: SensitivityStudyDecisionParameters,
    studyCase: SensitivityStudyCaseV2,
    caseDigest: string,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotSaveMayHaveBeenDispatched = false;
    let claimed = false;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;

      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );
      const preClaimRun = requireRun(preClaim, command.runId);
      const basis = requireBasis(preClaimRun);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      assertSensitivityCaseArtifactNotRemoved(basisSnapshot, caseDigest);

      if (preClaimRun.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free sensitivity-study seal.",
        });
        claimed = true;
      } else if (
        preClaimRun.status === "running" || preClaimRun.status === "publishing"
      ) {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free sensitivity-study seal.",
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
          "The human-approved sensitivity-study decision changed after the run was claimed.",
        );
      }
      const currentParams = parseSensitivityStudyDecisionParameters(
        currentApproval.proposal.parameters,
      );
      if (deterministicJson(currentParams) !== deterministicJson(decisionParams)) {
        throw invalidTransition(
          "The human-reviewed sensitivity parameters changed after the run was claimed.",
        );
      }

      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);
      const admissionArtifact = findAdmissionArtifact(
        currentBasisSnapshot,
        studyCase,
        command.projectId,
      );
      const reopened = await this.#admissions.read({
        projectId: command.projectId,
        basis: currentBasis,
        artifactId: admissionArtifact.id,
        artifactFingerprint: admissionArtifact.fingerprint,
      });
      if (!reopened) {
        throw invalidTransition(
          "The exact compilation admission named by cadSource could not be reopened.",
        );
      }
      assertAdmittedParameterMatchesCase(reopened, studyCase);

      const sealedAt = requiredStart(run);
      const capture: SensitivityStudyCaseCapture = {
        schemaVersion: SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
        operation: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
        trustedRunId: run.id,
        caseDigest,
        canonicalCaseText: canonicalSensitivityStudyCaseText(studyCase),
        studyCase,
        admissionArtifact: {
          id: admissionArtifact.id,
          fingerprint: admissionArtifact.fingerprint,
        },
        sealedAt,
      };
      const validatedCapture = await validateSensitivityStudyCaseCapture(capture);
      const captureText = deterministicJson(validatedCapture);
      const captureFingerprint = await sha256Fingerprint(validatedCapture);
      await this.#captures.save(captureFingerprint, captureText);
      const readBack = await this.#captures.read(captureFingerprint);
      if (readBack !== captureText) {
        throw new Error(
          "Sensitivity study case capture was not durably readable after save.",
        );
      }

      const successor = buildSensitivityCaseSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: validatedCapture,
        captureFingerprint,
        captureUri: this.#captures.uriFor(captureFingerprint),
        admissionArtifact,
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.#snapshots.save(successor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Sensitivity study case ThreadSnapshot was not durably readable after save.",
        );
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed sensitivity-study case.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            `Sealed sensitivity study ${studyCase.id} r${studyCase.revision} into the evidence thread.`,
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
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Sensitivity study case evidence may be durable but project attachment " +
            `did not finish (${SENSITIVITY_SEAL_THREAD_WRITE_OUTCOME_UNKNOWN}). ` +
            `Cause: ${errorMessage(error)}`,
        );
      }
      if (claimed) {
        try {
          await this.#commands.failRun(origin, {
            ...command,
            commandId: commandStep(command.commandId, "fail"),
            expectedRevision: (await this.#requiredProject(command.projectId)).revision,
            summary: "Sensitivity study seal failed before a durable Thread write.",
            code: "analyze-seal-sensitivity-study-failed",
            message: errorMessage(error),
          });
        } catch {
          // The original error is the one to surface.
        }
      }
      throw error;
    }
  }

  async #loadAndVerifyCase(
    decisionParams: SensitivityStudyDecisionParameters,
  ): Promise<
    { readonly studyCase: SensitivityStudyCaseV2; readonly caseDigest: string }
  > {
    const casePath = SENSITIVITY_STUDY_CASE_SOURCES.get(decisionParams.id);
    if (!casePath) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity case "${decisionParams.id}" is not in the server-side catalog.`,
      );
    }
    let raw: string;
    try {
      raw = await this.#readTextFile(casePath);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity case file "${casePath}" is not readable: ${errorMessage(error)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity case file "${casePath}" is not valid JSON.`,
      );
    }
    let template;
    try {
      template = validateSensitivityStudyCaseTemplate(parsed);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity case template failed validation: ${errorMessage(error)}`,
      );
    }
    const studyCase = assembleSensitivityStudyCaseV2(
      template,
      decisionParams.cadSource,
    );
    const caseDigest = (await sha256Fingerprint(studyCase)).digest;
    if (decisionParams.caseDigest !== caseDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Sensitivity case digest divergence: the MRTR signed digest does not match the assembled case.",
      );
    }
    try {
      verifySensitivityStudyParametersMatchCase(decisionParams, studyCase);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sensitivity MRTR parameters diverge from the assembled case: ${
          errorMessage(error)
        }`,
      );
    }
    return { studyCase, caseDigest };
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
    command: { readonly projectId: string; readonly runId: string },
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = project.agentRuns.find((item) => item.id === command.runId);
    if (run?.status === "completed") {
      assertCompleted(project, command);
      return project;
    }
    return undefined;
  }
}

function findAdmissionArtifact(
  snapshot: ThreadSnapshot,
  studyCase: SensitivityStudyCaseV2,
  projectId: string,
): ThreadArtifact {
  const parsed = parseSensitivityCadSourceUri(studyCase.cadSource.artifactUri);
  if (parsed.projectId !== projectId) {
    throw invalidTransition(
      "cadSource artifact URI project id does not match the current project.",
    );
  }
  const artifact = snapshot.artifacts.find((item) => item.id === parsed.artifactId);
  if (!artifact) {
    throw invalidTransition(
      `cadSource artifact "${parsed.artifactId}" is not present on the current Thread head.`,
    );
  }
  if (artifact.fingerprint.digest !== studyCase.cadSource.sha256) {
    throw invalidTransition(
      "cadSource sha256 does not match the Thread artifact fingerprint.",
    );
  }
  if (
    artifact.kind !== "document" ||
    artifact.producer.tool !== "compile.seal-admission@1"
  ) {
    throw invalidTransition(
      "cadSource is not a compile.seal-admission@1 admission document.",
    );
  }
  return artifact;
}

function assertAdmittedParameterMatchesCase(
  reopened: ReopenedTechnicalCompilationAdmission,
  studyCase: SensitivityStudyCaseV2,
): void {
  const sources = reopened.document.inputManifest.sources;
  if (sources.length !== 1) {
    throw invalidTransition(
      "The sealed compilation admission must carry exactly one Build123d source.",
    );
  }
  const source = sources[0]!;
  const matches = source.analysis.symbols.filter((symbol) =>
    symbol.name === studyCase.target.semanticKey && symbol.kind === "parameter"
  );
  if (matches.length !== 1 || matches[0]!.span === undefined) {
    throw invalidTransition(
      `The admitted source has no unique parameter binding named ${studyCase.target.semanticKey}.`,
    );
  }
  const binding = locateModuleLevelNumericBinding(
    source.sourceText,
    matches[0]!.span,
    studyCase.target.semanticKey,
  );
  if (binding.value !== studyCase.baseValue.value) {
    throw invalidTransition(
      "The admitted source parameter does not equal the sealed case baseValue.",
    );
  }
}

function assertSensitivityCaseArtifactNotRemoved(
  snapshot: ThreadSnapshot,
  caseDigest: string,
): void {
  const expectedId = `sensitivity-case-${caseDigest}`;
  const present = snapshot.artifacts.some((artifact) =>
    artifact.id === expectedId || artifact.version === caseDigest &&
      artifact.uri?.startsWith(SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX)
  );
  if (!present && snapshot.revision > 0) {
    const ancestorHad = snapshot.changeSet.changes.some((change) =>
      change.summary.includes("sensitivity-case-") ||
      change.summary.includes("sensitivity study")
    );
    if (ancestorHad) {
      throw invalidTransition(
        `A sealed sensitivity-case artifact for digest ${caseDigest} was removed from the successor basis.`,
      );
    }
  }
}

function buildSensitivityCaseSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: SensitivityStudyCaseCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly admissionArtifact: ThreadArtifact;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = `sensitivity-case-${input.capture.caseDigest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id}@${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Sensitivity study case ${input.capture.studyCase.id}`,
    kind: "document",
    version: input.capture.caseDigest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.admissionArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${input.admissionArtifact.id}-by-${artifact.id}`,
    artifactId: input.admissionArtifact.id,
    consumer: operationRef,
    observedFingerprint: input.admissionArtifact.fingerprint,
    verifiedAt: sealedAt,
    status: "verified",
  };
  const extension: ThreadSnapshotExtension = {
    id: `analyze-seal-sensitivity-study-${input.run.id}`,
    name: "Seal the reviewed FEA sensitivity study case",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `derived-from-${input.admissionArtifact.id}-by-${artifact.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: input.admissionArtifact.id },
      rationale:
        "The sensitivity-study seal reopens the exact compilation admission named by cadSource.",
    }, {
      id: `uses-${consumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: input.admissionArtifact.id },
      rationale:
        "The executor verified the admission fingerprint and the admitted parameter binding.",
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
      "This exact sensitivity-study case document is already present in the basis snapshot.",
    );
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, artifact };
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const approvedBriefBinding = operation?.bindings.find(
    (binding) =>
      binding.name === "approvedBrief" && binding.source.kind === "approved-brief",
  );
  if (
    project.schemaVersion !== "3.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id ||
    operation.version !== ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version ||
    !approvedBriefBinding ||
    operation.bindings.length !== 1
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to analyze.seal-sensitivity-study@1.`,
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
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact sensitivity-study seal run it claimed.",
    );
  }
}

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
} {
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
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal || decision.proposal.parameters.length === 0) continue;
    const exactHumanApprovals = project.approvals.filter((
      approval: EngineeringApproval,
    ) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human" &&
      sameSnapshotBasis(approval.baseSnapshot, basis) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
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
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      candidates.length === 0
        ? "No exact human-approved sensitivity-study MRTR decision is bound to this run basis."
        : "Ambiguous sensitivity-study MRTR: exactly one human-approved decision must be bound.",
    );
  }
  return candidates[0]!;
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
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The queued Thread basis snapshot is not the exact declared snapshot.",
    );
  }
  return snapshot;
}

function sameSnapshotBasis(
  left: { readonly snapshotId: string; readonly revision: number } | undefined,
  right: EngineeringThreadSnapshotBasis,
): boolean {
  return left?.snapshotId === right.snapshotId && left.revision === right.revision;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: { readonly runId: string },
): void {
  const run = requireRun(project, command.runId);
  if (run.status !== "completed") {
    throw unexpectedStatus(run, "completed");
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
