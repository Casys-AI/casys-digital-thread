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
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
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
    const brief = await this.dependencies.briefGates.read(command.projectId);
    try {
      recrossElectricalObservationMethodSheet(sheet, brief?.gates, {
        projectId: command.projectId,
        subjectId: sheet.subject.id,
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        fingerprint: snapshotFingerprint,
      });
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
      return deepFreeze({ admission, decisionParameters: reencoded });
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
  const command = exactRecord(
    value,
    ["projectId", "sheetFingerprint"],
    "$electricalMethodSheetSealReview",
  );
  return deepFreeze({
    projectId: safeId(
      command.projectId,
      "$electricalMethodSheetSealReview.projectId",
    ),
    sheetFingerprint: validateContentFingerprint(
      command.sheetFingerprint,
      "$electricalMethodSheetSealReview.sheetFingerprint",
    ),
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

function reviewError(
  code: ProjectElectricalObservationMethodSheetSealReviewErrorCode,
  message: string,
): ProjectElectricalObservationMethodSheetSealReviewError {
  return new ProjectElectricalObservationMethodSheetSealReviewError(
    code,
    message,
  );
}
