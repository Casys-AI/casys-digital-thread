/**
 * Capture-backed compilation of a closed `model.recapture-requirements@1` review.
 *
 * The inbound port stays in application. This adapter reopens sealed captures
 * and the unique current Thread tip. It does not call SysON.
 */

import type {
  ProjectRequirementsRecaptureReviewCommand,
  ProjectRequirementsRecaptureReviewResult,
  ProjectRequirementsRecaptureReviewUseCase,
  RequirementsRecaptureDiagnostic,
  RequirementsRecaptureDiagnosticCode,
} from "../../../application/ports/in/architecture/requirements/project-requirements-recapture-review.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  closedRecord,
  deepFreeze,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  listRequirementsCaptureContainers,
  selectRequirementsTip,
} from "../../../domain/thread/requirements-tip.ts";
import {
  encodeRequirementsRecaptureParameters,
  fingerprintRequirementsRecaptureEnvelope,
  MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
  parseRequirementsRecaptureParameters,
  REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
} from "../../../domain/architecture/requirements/requirements-recapture-proposal.ts";
import {
  encodeTracedRequirementsRecaptureParameters,
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
  parseTracedRequirementsRecaptureProposalParameters,
  REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA,
} from "../../../domain/architecture/requirements/requirements-traced-recapture-proposal.ts";
import { derivePartDefName } from "../../../domain/architecture/requirements/requirements-proposal.ts";
import type { ExactArchitectureCapture } from "../renderer/architecture-capture.ts";
import { findArchitectureArtifact } from "../renderer/model-write-architecture-run-executor.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  requireCurrentArchitectureSourceAnalyses,
  type SysmlSourceAnalysisReader,
} from "../renderer/sysml-source-analysis-capture.ts";
import {
  assertArchitectureCaptureSeedAndInputs,
  proveMonotoneArchitectureLineage,
  reopenExactArchitectureCapture,
  reopenExactSysonSeedCapture,
} from "../renderer/exact-architecture-capture-inputs.ts";
import {
  type ExactRequirementsCapture,
  parseExactRequirementsCapture,
} from "./requirements-capture.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../../domain/architecture/requirements/requirements-proposal.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import { EngineeringProjectCommandError } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { readExactRequirementsPredecessor } from "./exact-requirements-predecessor.ts";

export type ProjectRequirementsRecaptureReviewErrorCode =
  | "invalid_request"
  | "project_not_found";

export class ProjectRequirementsRecaptureReviewError extends Error {
  constructor(
    readonly code: ProjectRequirementsRecaptureReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectRequirementsRecaptureReviewError";
  }
}

interface CaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

interface RequirementsAttemptReader {
  isQuarantined(projectId: string, runId: string): Promise<boolean>;
  readRun(
    projectId: string,
    runId: string,
  ): Promise<{ readonly status: string } | undefined>;
}

export interface PrepareProjectRequirementsRecaptureReviewDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly architectureCaptures: CaptureReader;
  readonly requirementsCaptures: CaptureReader;
  readonly seedCaptures: CaptureReader;
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
  readonly attempts?: RequirementsAttemptReader;
}

export class PrepareProjectRequirementsRecaptureReview
  implements ProjectRequirementsRecaptureReviewUseCase {
  constructor(
    private readonly d: PrepareProjectRequirementsRecaptureReviewDependencies,
  ) {}

  async execute(value: unknown): Promise<ProjectRequirementsRecaptureReviewResult> {
    let command: ProjectRequirementsRecaptureReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw new ProjectRequirementsRecaptureReviewError(
        "invalid_request",
        "The requirements recapture review request failed exact validation.",
      );
    }
    const project = await this.d.projects.get(command.projectId);
    if (!project) {
      throw new ProjectRequirementsRecaptureReviewError(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      return unresolved(
        tip.diagnostic.code === "basis-absent" ? "basis-absent" : "basis-ambiguous",
        tip.diagnostic.message,
      );
    }
    const snapshot = await this.d.snapshots.get(tip.basis.snapshotId);
    if (
      !snapshot || snapshot.id !== tip.basis.snapshotId ||
      snapshot.revision !== tip.basis.revision ||
      snapshot.subject.id !== tip.basis.subjectId
    ) {
      return unresolved(
        "snapshot-invalid",
        "The unique current Thread snapshot could not be reopened exactly.",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
      await assertThreadSnapshotLineageIntact(snapshot, this.d.snapshots);
    } catch (error) {
      return unresolved(
        "snapshot-invalid",
        `The current Thread snapshot or its lineage is invalid: ${message(error)}`,
      );
    }

    let architectureArtifact: ThreadArtifact;
    try {
      const found = findArchitectureArtifact(snapshot);
      if (!found) {
        return unresolved(
          "architecture-absent",
          "The current Thread has no unique generic architecture capture tip.",
        );
      }
      architectureArtifact = found;
    } catch (error) {
      return unresolved("architecture-invalid", message(error));
    }
    const architectureText = await this.d.architectureCaptures.read(
      architectureArtifact.fingerprint,
    );
    if (!architectureText) {
      return unresolved(
        "architecture-invalid",
        "The current architecture capture is not durably readable.",
      );
    }
    let architectureCapture: ExactArchitectureCapture;
    try {
      architectureCapture = await reopenExactArchitectureCapture(
        architectureText,
        architectureArtifact,
        "current",
      );
    } catch (error) {
      return unresolved(
        "architecture-invalid",
        `The current architecture capture is not exact: ${message(error)}`,
      );
    }
    const currentArchitectureProof = await proveCurrentArchitecture(
      snapshot,
      architectureArtifact,
      architectureCapture,
      this.d.seedCaptures,
      this.d.sysmlSourceAnalysis,
    );
    if (currentArchitectureProof) return currentArchitectureProof;

    const families = await this.#activeFamilies(snapshot);
    if (families.status !== "ok") return families.result;
    const selected = selectFamily(families.families, command.targetElementId);
    if (selected.status !== "ok") return selected.result;

    const capture = selected.family.capture;
    const predecessor = selected.family.artifact;
    let historicalArchitecture;
    try {
      const prior = await readExactRequirementsPredecessor(
        snapshot,
        predecessor,
        {
          containerComponent: capture.containerComponent,
          partDefName: capture.partDefName,
          target: capture.target,
        },
        {
          captures: this.d.requirementsCaptures,
          architectureCaptures: this.d.architectureCaptures,
          snapshots: this.d.snapshots,
          sysmlSourceAnalysis: this.d.sysmlSourceAnalysis,
        },
      );
      historicalArchitecture = prior.historicalArchitecture;
      await proveMonotoneArchitectureLineage({
        snapshot,
        currentArtifact: architectureArtifact,
        currentCapture: architectureCapture,
        historicalArtifact: historicalArchitecture,
        historicalSeed: capture.seed,
        target: capture.target,
        architectureCaptures: this.d.architectureCaptures,
        seedCaptures: this.d.seedCaptures,
        sysmlSourceAnalysis: this.d.sysmlSourceAnalysis,
      });
    } catch (error) {
      if (error instanceof EngineeringProjectCommandError) {
        if (
          error.message.includes("targets a different SysON PartDefinition") ||
          error.message.includes("does not survive unchanged") ||
          error.message.includes("absent from its historical architecture")
        ) {
          return unresolved("target-changed", error.message);
        }
        if (
          error.message.includes("The current architecture") ||
          error.message.includes("architecture capture") ||
          error.message.includes("monotone architecture chain") ||
          error.message.includes("architecture predecessor chain") ||
          error.message.includes("SysON seed") ||
          error.message.includes("source-analysis") ||
          error.message.includes("source analysis")
        ) {
          return unresolved("architecture-invalid", error.message);
        }
        return unresolved("predecessor-invalid", error.message);
      }
      return unresolved("predecessor-invalid", message(error));
    }
    if (
      capture.architecture.artifactId === architectureArtifact.id ||
      fingerprintsEqual(
        capture.architecture.fingerprint,
        architectureArtifact.fingerprint,
      )
    ) {
      return unresolved(
        "same-architecture-noop",
        "The active requirements capture already binds the current architecture. Recapture is not a no-op.",
      );
    }

    const blocked = await this.#writerSibling(
      project,
      snapshot,
      capture.containerComponent,
    );
    if (blocked) return blocked;

    const envelope = {
      target: capture.target,
      architectureBasis: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        fingerprint: architectureArtifact.fingerprint.digest,
      },
      containerComponent: capture.containerComponent,
      partDefName: capture.partDefName,
      requirementsElementId: capture.requirementsElementId,
      requirementUsage: capture.requirementUsage,
      constraintUsages: capture.constraintUsages,
      requirements: capture.requirements,
    };
    if (derivePartDefName(capture.containerComponent) !== capture.partDefName) {
      return unresolved(
        "predecessor-invalid",
        "The predecessor RequirementUsage name is not the server-derived identity.",
      );
    }
    const envelopeFingerprint = await fingerprintRequirementsRecaptureEnvelope(
      envelope,
    );
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    const traced = "briefProvenance" in capture;
    const operation = traced
      ? MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION
      : MODEL_RECAPTURE_REQUIREMENTS_OPERATION;
    const rawAdmission = {
      schemaVersion: traced
        ? REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA
        : REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
      operation,
      basis: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
        fingerprint: snapshotFingerprint,
      },
      architecture: {
        artifactId: architectureArtifact.id,
        fingerprint: architectureArtifact.fingerprint,
        producerRunId: architectureArtifact.producer.runId,
      },
      predecessor: {
        artifactId: predecessor.id,
        fingerprint: predecessor.fingerprint,
        producerRunId: predecessor.producer.runId,
        schemaVersion: capture.schemaVersion,
      },
      target: capture.target,
      containerComponent: capture.containerComponent,
      partDefName: capture.partDefName,
      requirementsElementId: capture.requirementsElementId,
      envelope: { fingerprint: envelopeFingerprint },
    };
    const decisionParameters = traced
      ? encodeTracedRequirementsRecaptureParameters(rawAdmission)
      : encodeRequirementsRecaptureParameters(rawAdmission);
    const admission = traced
      ? parseTracedRequirementsRecaptureProposalParameters(decisionParameters)
      : parseRequirementsRecaptureParameters(decisionParameters);
    return deepFreeze({
      status: "resolved" as const,
      operation,
      admission,
      decisionParameters,
    });
  }

  async #activeFamilies(snapshot: ThreadSnapshot): Promise<
    | {
      readonly status: "ok";
      readonly families: readonly ActiveFamily[];
    }
    | {
      readonly status: "unresolved";
      readonly result: ProjectRequirementsRecaptureReviewResult;
    }
  > {
    const families: ActiveFamily[] = [];
    for (const container of listRequirementsCaptureContainers(snapshot)) {
      const selected = selectRequirementsTip(snapshot, container);
      if (selected.kind === "ambiguous") {
        return {
          status: "unresolved",
          result: unresolved(
            "predecessor-ambiguous",
            `Requirements lineage for "${container}" has no unique active tip.`,
          ),
        };
      }
      if (selected.kind !== "one") continue;
      const text = await this.d.requirementsCaptures.read(
        selected.artifact.fingerprint,
      );
      if (!text) {
        return {
          status: "unresolved",
          result: unresolved(
            "predecessor-invalid",
            `Requirements capture "${selected.artifact.id}" is not durably readable.`,
          ),
        };
      }
      let capture: ExactRequirementsCapture;
      try {
        capture = parseExactRequirementsCapture(JSON.parse(text));
      } catch (error) {
        return {
          status: "unresolved",
          result: unresolved(
            "predecessor-invalid",
            `Requirements capture "${selected.artifact.id}" failed exact validation: ${
              message(error)
            }.`,
          ),
        };
      }
      if (capture.containerComponent !== container) {
        return {
          status: "unresolved",
          result: unresolved(
            "predecessor-invalid",
            `Requirements capture "${selected.artifact.id}" does not match its family container.`,
          ),
        };
      }
      families.push({ artifact: selected.artifact, capture });
    }
    if (families.length === 0) {
      return {
        status: "unresolved",
        result: unresolved(
          "predecessor-absent",
          "The current Thread has no unique active requirements capture to recapture.",
        ),
      };
    }
    return { status: "ok", families };
  }

  async #writerSibling(
    project: EngineeringProjectSnapshot,
    snapshot: ThreadSnapshot,
    containerComponent: string,
  ): Promise<ProjectRequirementsRecaptureReviewResult | undefined> {
    const archived = archivedRefKeys(snapshot);
    for (const run of project.agentRuns) {
      if (
        run.basis?.kind !== "thread-snapshot" ||
        run.basis.snapshotId !== snapshot.id ||
        run.basis.revision !== snapshot.revision
      ) {
        continue;
      }
      const operation = project.workItems.find((item) => item.id === run.workItemId)
        ?.operation;
      if (
        operation?.id !== MODEL_WRITE_REQUIREMENTS_OPERATION.id ||
        (operation.version !== "1" && operation.version !== "2")
      ) {
        continue;
      }
      const siblingContainer = writerContainer(project, run.id);
      if (
        siblingContainer !== undefined && siblingContainer !== containerComponent
      ) {
        continue;
      }
      if (
        run.status === "running" || run.status === "publishing" ||
        run.status === "completed" ||
        (run.status === "failed" && isTerminalWriterFailure(run.failure?.code))
      ) {
        return unresolved(
          "writer-sibling-uncertain",
          "A requirements writer sibling on this exact basis is running, published, quarantined, or has an unknown provider outcome.",
        );
      }
      if (this.d.attempts) {
        try {
          if (
            await this.d.attempts.isQuarantined(project.project.id, run.id) ||
            await this.d.attempts.readRun(project.project.id, run.id)
          ) {
            return unresolved(
              "writer-sibling-uncertain",
              "A requirements writer sibling on this exact basis has a dispatched or quarantined WAL.",
            );
          }
        } catch {
          return unresolved(
            "writer-sibling-uncertain",
            "A requirements writer sibling on this exact basis has an unreadable WAL.",
          );
        }
      }
      if (archived.has(`artifact:${run.id}`)) continue;
    }
    return undefined;
  }
}

interface ActiveFamily {
  readonly artifact: ThreadArtifact;
  readonly capture: ExactRequirementsCapture;
}

function selectFamily(
  families: readonly ActiveFamily[],
  targetElementId: string | undefined,
):
  | { readonly status: "ok"; readonly family: ActiveFamily }
  | {
    readonly status: "unresolved";
    readonly result: ProjectRequirementsRecaptureReviewResult;
  } {
  if (targetElementId === undefined) {
    const uniqueTargets = new Set(
      families.map((family) => family.capture.target.elementId),
    );
    if (uniqueTargets.size !== 1 || families.length !== 1) {
      return {
        status: "unresolved",
        result: unresolved(
          "target-required",
          "Several active requirements families exist. Name the exact product-navigation targetElementId.",
        ),
      };
    }
    return { status: "ok", family: families[0]! };
  }
  const matches = families.filter((family) =>
    family.capture.target.elementId === targetElementId
  );
  if (matches.length === 0) {
    return {
      status: "unresolved",
      result: unresolved(
        "target-unknown",
        `No active requirements family captures PartDefinition "${targetElementId}".`,
      ),
    };
  }
  if (matches.length !== 1) {
    return {
      status: "unresolved",
      result: unresolved(
        "predecessor-ambiguous",
        `Several active requirements families capture PartDefinition "${targetElementId}".`,
      ),
    };
  }
  return { status: "ok", family: matches[0]! };
}

async function proveCurrentArchitecture(
  snapshot: ThreadSnapshot,
  architectureArtifact: ThreadArtifact,
  architectureCapture: ExactArchitectureCapture,
  seedCaptures: CaptureReader,
  sysmlSourceAnalysis: SysmlSourceAnalysisReader,
): Promise<ProjectRequirementsRecaptureReviewResult | undefined> {
  try {
    const seedArtifact = snapshot.artifacts.find((artifact) =>
      artifact.id === architectureCapture.seed.artifactId
    );
    if (!seedArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The current architecture capture does not name the exact SysON seed consumed by its Thread artifact.",
      );
    }
    assertArchitectureCaptureSeedAndInputs(
      snapshot,
      architectureArtifact,
      architectureCapture,
      seedArtifact,
      "current",
    );
    await reopenExactSysonSeedCapture(
      await seedCaptures.read(seedArtifact.fingerprint),
      seedArtifact,
    );
    await requireCurrentArchitectureSourceAnalyses(
      architectureCapture.sourceAnalyses,
      sysmlSourceAnalysis,
      {
        runId: architectureArtifact.producer.runId,
        operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
        packageName: architectureCapture.packageName,
      },
    );
  } catch (error) {
    return unresolved("architecture-invalid", message(error));
  }
  return undefined;
}

function writerContainer(
  project: EngineeringProjectSnapshot,
  runId: string,
): string | undefined {
  const run = project.agentRuns.find((candidate) => candidate.id === runId);
  const workItem = project.workItems.find((item) => item.id === run?.workItemId);
  const values = (workItem?.decisionIds ?? []).flatMap((id) =>
    project.decisions.filter((decision) => decision.id === id)
      .flatMap((decision) =>
        decision.proposal?.parameters.filter((parameter) =>
          parameter.key === "requirements.containerComponent" &&
          typeof parameter.value === "string"
        ).map((parameter) => parameter.value as string) ?? []
      )
  );
  return values.length === 1 ? values[0] : undefined;
}

function isTerminalWriterFailure(code: string | undefined): boolean {
  return code === "model-write-requirements-provider-outcome-unknown" ||
    code === "model-write-requirements-post-acknowledgement-quarantined" ||
    code === "model-write-requirements-quarantine-write-failed";
}

function parseCommand(value: unknown): ProjectRequirementsRecaptureReviewCommand {
  const record = closedRecord(
    value,
    ["projectId", "targetElementId"],
    ["projectId"],
    "requirementsRecaptureReview",
  );
  const projectId = safeId(record.projectId, "projectId");
  if (projectId.toLowerCase() === "latest") {
    throw new TypeError("projectId must not be a latest alias.");
  }
  if (record.targetElementId === undefined) {
    return { projectId };
  }
  const targetElementId = safeId(record.targetElementId, "targetElementId");
  if (targetElementId.toLowerCase() === "latest") {
    throw new TypeError("targetElementId must not be a latest alias.");
  }
  return { projectId, targetElementId };
}

function unresolved(
  code: RequirementsRecaptureDiagnosticCode,
  message: string,
): ProjectRequirementsRecaptureReviewResult {
  const diagnostic: RequirementsRecaptureDiagnostic = { code, message };
  return { status: "unresolved", diagnostics: [diagnostic] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
