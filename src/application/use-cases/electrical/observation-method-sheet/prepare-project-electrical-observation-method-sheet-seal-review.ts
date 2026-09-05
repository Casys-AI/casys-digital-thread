/**
 * Provider-free preparation of an electrical observation method-sheet seal
 * review. This use case does not execute ngspice, call SysON, or grant an L4
 * verdict.
 */

import type {
  ProjectElectricalObservationMethodSheetSealReviewCommand,
  ProjectElectricalObservationMethodSheetSealReviewResult,
  ProjectElectricalObservationMethodSheetSealReviewUseCase,
} from "../../../ports/in/electrical/observation-method-sheet/project-electrical-observation-method-sheet-seal-review.ts";
import type { ElectricalObservationMethodSheetStore } from "../../../ports/out/electrical/observation-method-sheet-store.ts";
import type { ElectricalObservationMethodSheetBriefGateReader } from "../../../ports/out/electrical/observation-method-sheet-brief-gate-reader.ts";
import type { AdmittedSpiceObservationEvidenceReader } from "../../../ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import {
  encodeElectricalObservationMethodSheetSealAdmission,
  encodeElectricalObservationMethodSheetSealParameters,
  parseElectricalObservationMethodSheetSealParameters,
} from "../../../../domain/electrical/observation-method-sheet-proposal.ts";
import {
  ElectricalObservationMethodSheetRecrossError,
  recrossElectricalObservationMethodSheet,
} from "../../../../domain/electrical/observation-method-sheet-recross.ts";
import { ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA } from "../../../../domain/electrical/observation-method-sheet.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../../../../domain/electrical/spice/admitted/run-proposal.ts";
import { SPICE_ISOLATED_EVIDENCE_LIMITATIONS } from "../../../../domain/electrical/spice/admitted/contract.ts";
import { uniqueFreshAdmittedSpiceL3Lineage } from "../../../../domain/electrical/spice/evaluation/lineage.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { selectCurrentThreadTip } from "../../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import { selectUniqueCompletedOperationLeaf } from "../../project/resolve-exact-completed-dependency-artifact.ts";
import { threadSnapshotDescendsFrom } from "../../../../domain/thread/thread-snapshot-ancestry.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";

export type ProjectElectricalObservationMethodSheetSealReviewErrorCode =
  | "invalid_request"
  | "sheet_not_found"
  | "sheet_resolution_failed"
  | "project_not_found"
  | "thread_tip_unavailable"
  | "snapshot_not_found"
  | "l3_unavailable"
  | "evidence_not_found"
  | "recross_failed";

export class ProjectElectricalObservationMethodSheetSealReviewError extends Error {
  constructor(
    readonly code: ProjectElectricalObservationMethodSheetSealReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectElectricalObservationMethodSheetSealReviewError";
  }
}

export interface PrepareProjectElectricalObservationMethodSheetSealReviewDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly sheets: ElectricalObservationMethodSheetStore;
  readonly briefGates: ElectricalObservationMethodSheetBriefGateReader;
  readonly evidence: AdmittedSpiceObservationEvidenceReader;
}

export class PrepareProjectElectricalObservationMethodSheetSealReview
  implements ProjectElectricalObservationMethodSheetSealReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectElectricalObservationMethodSheetSealReviewDependencies,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectElectricalObservationMethodSheetSealReviewResult> {
    let command: ProjectElectricalObservationMethodSheetSealReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The electrical observation method-sheet seal-review request failed exact validation.",
      );
    }
    const project = await this.dependencies.projects.get(command.projectId);
    if (!project) {
      throw reviewError(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }
    let validatedProject;
    try {
      validatedProject = validateEngineeringProjectSnapshot(project);
    } catch {
      throw reviewError(
        "recross_failed",
        "The current engineering project failed closed validation.",
      );
    }
    if (validatedProject.project.id !== command.projectId) {
      throw reviewError(
        "recross_failed",
        "The project reader returned a foreign engineering project.",
      );
    }
    const tip = selectCurrentThreadTip(validatedProject.threadSnapshots);
    if (tip.status !== "ok") {
      throw reviewError(
        "thread_tip_unavailable",
        tip.diagnostic.code === "basis-absent"
          ? "The engineering project has no current Thread tip."
          : "The engineering project declares more than one current Thread tip; the server will not choose one.",
      );
    }
    const snapshot = await readSnapshot(
      this.dependencies.snapshots,
      tip.basis.snapshotId,
    );
    if (
      snapshot.id !== tip.basis.snapshotId ||
      snapshot.revision !== tip.basis.revision ||
      snapshot.subject.id !== tip.basis.subjectId ||
      validatedProject.project.subjectId !== tip.basis.subjectId
    ) {
      throw reviewError(
        "recross_failed",
        "The reopened Thread snapshot is not the exact current project tip.",
      );
    }
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    const brief = await this.dependencies.briefGates.read(command.projectId);
    if (!("sheetFingerprint" in command)) {
      if (!brief || brief.projectId !== command.projectId) {
        throw reviewError(
          "recross_failed",
          "The exact approved brief gates are unavailable for electrical method-sheet authoring.",
        );
      }
      return await prepareMethodSheetAuthoring({
        project: validatedProject,
        basis: tip.basis,
        snapshot,
        snapshotFingerprint,
        briefItems: brief.gates,
        snapshots: this.dependencies.snapshots,
        evidence: this.dependencies.evidence,
      });
    }
    let sheet;
    try {
      sheet = await this.dependencies.sheets.read(command.sheetFingerprint);
    } catch {
      throw reviewError(
        "sheet_resolution_failed",
        "The exact electrical observation method sheet could not be reopened.",
      );
    }
    if (!sheet) {
      throw reviewError(
        "sheet_not_found",
        "The exact electrical observation method sheet is unavailable.",
      );
    }
    if (sheet.project.id !== command.projectId) {
      throw reviewError(
        "recross_failed",
        "The reopened electrical observation method sheet belongs to another project.",
      );
    }
    if (
      snapshot.id !== sheet.basis.snapshotId ||
      snapshot.revision !== sheet.basis.revision ||
      snapshot.subject.id !== sheet.subject.id ||
      !fingerprintsEqual(snapshotFingerprint, sheet.basis.fingerprint)
    ) {
      throw reviewError(
        "recross_failed",
        "The reopened electrical observation method sheet is not the exact current Thread basis.",
      );
    }
    try {
      recrossElectricalObservationMethodSheet(
        sheet,
        brief?.gates,
        {
          projectId: command.projectId,
          subjectId: sheet.subject.id,
          snapshotId: snapshot.id,
          revision: snapshot.revision,
          fingerprint: snapshotFingerprint,
        },
        snapshot,
      );
      const decisionParameters =
        await encodeElectricalObservationMethodSheetSealParameters(sheet);
      const admission = parseElectricalObservationMethodSheetSealParameters(
        decisionParameters,
      );
      const reencoded = encodeElectricalObservationMethodSheetSealAdmission(
        admission,
      );
      if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
        throw new TypeError(
          "Electrical observation method sheet seal MRTR replay is not canonical.",
        );
      }
      return deepFreeze({
        mode: "review" as const,
        admission,
        decisionParameters: reencoded,
      });
    } catch (error) {
      if (error instanceof ElectricalObservationMethodSheetRecrossError) {
        throw reviewError("recross_failed", error.message);
      }
      if (error instanceof ProjectElectricalObservationMethodSheetSealReviewError) {
        throw error;
      }
      throw reviewError(
        "recross_failed",
        "The reopened electrical observation method sheet is not an exact recross of brief gates.",
      );
    }
  }
}

function parseCommand(
  value: unknown,
): ProjectElectricalObservationMethodSheetSealReviewCommand {
  const includesSheet = value !== null && typeof value === "object" &&
    !Array.isArray(value) && "sheetFingerprint" in value;
  const command = exactRecord(
    value,
    includesSheet ? ["projectId", "sheetFingerprint"] : ["projectId"],
    "$electricalMethodSheetSealReview",
  );
  const projectId = safeId(
    command.projectId,
    "$electricalMethodSheetSealReview.projectId",
  );
  return includesSheet
    ? deepFreeze({
      projectId,
      sheetFingerprint: validateContentFingerprint(
        command.sheetFingerprint,
        "$electricalMethodSheetSealReview.sheetFingerprint",
      ),
    })
    : deepFreeze({ projectId });
}

async function prepareMethodSheetAuthoring(input: {
  readonly project: ReturnType<typeof validateEngineeringProjectSnapshot>;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
  readonly snapshot: ThreadSnapshot;
  readonly snapshotFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly briefItems: readonly {
    readonly id: string;
    readonly kind: "success-criterion" | "verification-activity";
  }[];
  readonly snapshots:
    PrepareProjectElectricalObservationMethodSheetSealReviewDependencies[
      "snapshots"
    ];
  readonly evidence: AdmittedSpiceObservationEvidenceReader;
}): Promise<ProjectElectricalObservationMethodSheetSealReviewResult> {
  const selected = selectUniqueCompletedOperationLeaf(
    input.project.workItems,
    SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  );
  if (selected.status !== "resolved") {
    throw reviewError("l3_unavailable", selected.reason);
  }
  const producerRuns = input.project.agentRuns.filter((run) =>
    run.workItemId === selected.work.id && run.status === "completed"
  );
  if (producerRuns.length !== 1) {
    throw reviewError(
      "l3_unavailable",
      "The current admitted SPICE work revision has no unique completed producer run.",
    );
  }
  const producerRun = producerRuns[0]!;
  let lineage;
  try {
    lineage = uniqueFreshAdmittedSpiceL3Lineage(input.snapshot);
  } catch (error) {
    throw reviewError(
      "l3_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (lineage.result.producer.runId !== producerRun.id) {
    throw reviewError(
      "recross_failed",
      "The current admitted SPICE L3 branch is not produced by the unique completed work revision.",
    );
  }
  const resultRef = producerRun.resultSnapshot;
  if (!resultRef || producerRun.basis?.kind !== "thread-snapshot") {
    throw reviewError(
      "recross_failed",
      "The admitted SPICE producer run does not retain exact Thread basis and result identities.",
    );
  }
  if (
    input.project.threadSnapshots.filter((candidate) =>
      candidate.snapshotId === resultRef.snapshotId &&
      candidate.revision === resultRef.revision &&
      candidate.subjectId === resultRef.subjectId
    ).length !== 1
  ) {
    throw reviewError(
      "recross_failed",
      "The admitted SPICE result snapshot is not declared exactly once by the project.",
    );
  }
  const resultSnapshot = await readStoredSnapshot(
    input.snapshots,
    resultRef.snapshotId,
  );
  if (
    resultSnapshot.revision !== resultRef.revision ||
    resultSnapshot.subject.id !== resultRef.subjectId ||
    !resultSnapshot.previous ||
    resultSnapshot.previous.snapshotId !== producerRun.basis.snapshotId ||
    resultSnapshot.previous.revision !== producerRun.basis.revision ||
    producerRun.basis.subjectId !== resultRef.subjectId ||
    !await threadSnapshotDescendsFrom(
      input.snapshot,
      resultSnapshot,
      input.snapshots,
    )
  ) {
    throw reviewError(
      "recross_failed",
      "The current Thread tip does not retain the exact admitted SPICE result lineage.",
    );
  }
  const artifacts = [lineage.spiceCapture, lineage.evidence, lineage.result];
  for (const artifact of artifacts) {
    const produced = resultSnapshot.artifacts.filter((candidate) =>
      candidate.id === artifact.id
    );
    if (
      produced.length !== 1 ||
      deterministicJson(produced[0]) !== deterministicJson(artifact)
    ) {
      throw reviewError(
        "recross_failed",
        "The admitted SPICE L3 artifacts are not byte-identical on their producer result and current Thread tip.",
      );
    }
  }
  const expectedEvidenceRefs = artifacts.map((artifact) => ({
    snapshotId: resultSnapshot.id,
    snapshotRevision: resultSnapshot.revision,
    kind: "artifact" as const,
    id: artifact.id,
  }));
  if (
    deterministicJson(producerRun.evidenceRefs) !==
      deterministicJson(expectedEvidenceRefs) ||
    deterministicJson(selected.work.evidenceRefs) !==
      deterministicJson(expectedEvidenceRefs)
  ) {
    throw reviewError(
      "recross_failed",
      "The admitted SPICE producer run and work item do not name the exact capture, evidence and result artifacts.",
    );
  }
  let reopened;
  try {
    reopened = await input.evidence.read(lineage.result.fingerprint);
  } catch {
    throw reviewError(
      "evidence_not_found",
      "The exact admitted SPICE operating-point result could not be reopened.",
    );
  }
  if (!reopened) {
    throw reviewError(
      "evidence_not_found",
      "The exact admitted SPICE operating-point result is unavailable.",
    );
  }
  const projected = lineage.observations.map((observation) => ({
    name: observation.metric,
    value: observation.quantity.value,
    unit: observation.quantity.unit,
  }));
  if (deterministicJson(projected) !== deterministicJson(reopened.observables)) {
    throw reviewError(
      "recross_failed",
      "The admitted SPICE result bytes and current Thread observations diverge.",
    );
  }
  const tool =
    `${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}` as const;
  return deepFreeze({
    mode: "preparation" as const,
    methodSheet: {
      schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
      project: {
        id: input.project.project.id,
        subjectId: input.basis.subjectId,
      },
      subject: { id: input.basis.subjectId },
      basis: {
        snapshotId: input.basis.snapshotId,
        revision: input.basis.revision,
        fingerprint: input.snapshotFingerprint,
      },
      spice: {
        producer: {
          serverId: "digital-thread" as const,
          tool,
          runId: producerRun.id,
        },
        capture: {
          id: lineage.spiceCapture.id,
          fingerprint: lineage.spiceCapture.fingerprint,
        },
        evidence: {
          id: lineage.evidence.id,
          fingerprint: lineage.evidence.fingerprint,
        },
        result: {
          id: lineage.result.id,
          fingerprint: lineage.result.fingerprint,
        },
      },
    },
    l3: {
      observations: reopened.observables,
      limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
    },
    briefItems: input.briefItems,
  });
}

async function readSnapshot(
  snapshots: PrepareProjectElectricalObservationMethodSheetSealReviewDependencies[
    "snapshots"
  ],
  snapshotId: string,
): Promise<ThreadSnapshot> {
  const raw = snapshots.getFresh
    ? await snapshots.getFresh(snapshotId)
    : await snapshots.get(snapshotId);
  if (!raw) {
    throw reviewError(
      "snapshot_not_found",
      "The current Thread tip is unavailable.",
    );
  }
  return validateThreadSnapshot(raw);
}

async function readStoredSnapshot(
  snapshots: PrepareProjectElectricalObservationMethodSheetSealReviewDependencies[
    "snapshots"
  ],
  snapshotId: string,
): Promise<ThreadSnapshot> {
  const raw = await snapshots.get(snapshotId);
  if (!raw) {
    throw reviewError(
      "snapshot_not_found",
      "The admitted SPICE result Thread snapshot is unavailable.",
    );
  }
  return validateThreadSnapshot(raw);
}

function reviewError(
  code: ProjectElectricalObservationMethodSheetSealReviewErrorCode,
  message: string,
): ProjectElectricalObservationMethodSheetSealReviewError {
  return new ProjectElectricalObservationMethodSheetSealReviewError(
    code,
    message,
  );
}
