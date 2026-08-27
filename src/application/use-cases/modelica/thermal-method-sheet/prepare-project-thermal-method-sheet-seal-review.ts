/**
 * Provider-free preparation of a Modelica thermal method-sheet seal review.
 *
 * This use case does not execute OMC, admit source, or grant an L4 verdict.
 * It reopens one exact sheet, recrosses the Modelica source-analysis capture
 * and SysML identities, and derives the canonical MRTR parameters.
 */

import type {
  ProjectThermalMethodSheetSealReviewCommand,
  ProjectThermalMethodSheetSealReviewResult,
  ProjectThermalMethodSheetSealReviewUseCase,
} from "../../../ports/in/modelica/thermal-method-sheet/project-thermal-method-sheet-seal-review.ts";
import type { ThermalMethodSheetStore } from "../../../ports/out/modelica/thermal-method-sheet-store.ts";
import type { ThermalMethodSheetSourceCaptureReader } from "../../../ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { TechnicalCompilationBasisResolver } from "../../../ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import {
  encodeThermalMethodSheetSealAdmission,
  encodeThermalMethodSheetSealParameters,
  parseThermalMethodSheetSealParameters,
} from "../../../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  recrossThermalMethodSheet,
  ThermalMethodSheetRecrossError,
} from "../../../../domain/modelica/thermal-method-sheet-recross.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../../domain/kernel/deterministic-json.ts";

export type ProjectThermalMethodSheetSealReviewErrorCode =
  | "invalid_request"
  | "sheet_not_found"
  | "sheet_resolution_failed"
  | "capture_not_found"
  | "capture_resolution_failed"
  | "recross_failed";

/** Stable application error. Provider details, storage paths and causes stay internal. */
export class ProjectThermalMethodSheetSealReviewError extends Error {
  constructor(
    readonly code: ProjectThermalMethodSheetSealReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectThermalMethodSheetSealReviewError";
  }
}

export interface PrepareProjectThermalMethodSheetSealReviewDependencies {
  readonly sheets: ThermalMethodSheetStore;
  readonly sourceCaptures: ThermalMethodSheetSourceCaptureReader;
  readonly basisResolver: TechnicalCompilationBasisResolver;
}

export class PrepareProjectThermalMethodSheetSealReview
  implements ProjectThermalMethodSheetSealReviewUseCase {
  readonly #sheets: ThermalMethodSheetStore;
  readonly #sourceCaptures: ThermalMethodSheetSourceCaptureReader;
  readonly #basisResolver: TechnicalCompilationBasisResolver;

  constructor(
    dependencies: PrepareProjectThermalMethodSheetSealReviewDependencies,
  ) {
    this.#sheets = dependencies.sheets;
    this.#sourceCaptures = dependencies.sourceCaptures;
    this.#basisResolver = dependencies.basisResolver;
  }

  async execute(
    value: unknown,
  ): Promise<ProjectThermalMethodSheetSealReviewResult> {
    let command: ProjectThermalMethodSheetSealReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The thermal method-sheet seal-review request failed exact validation.",
      );
    }

    let sheet;
    try {
      sheet = await this.#sheets.read(command.sheetFingerprint);
    } catch {
      throw reviewError(
        "sheet_resolution_failed",
        "The exact thermal method sheet could not be reopened.",
      );
    }
    if (!sheet) {
      throw reviewError(
        "sheet_not_found",
        "The exact thermal method sheet is unavailable.",
      );
    }
    if (sheet.project.id !== command.projectId) {
      throw reviewError(
        "recross_failed",
        "The reopened thermal method sheet belongs to another project.",
      );
    }

    let source;
    try {
      source = await this.#sourceCaptures.read(
        sheet.model.sourceCaptureFingerprint,
      );
    } catch {
      throw reviewError(
        "recross_failed",
        "The reopened source capture is not an exact modelica-model identity.",
      );
    }

    let basis;
    try {
      basis = await this.#basisResolver.resolve({
        projectId: command.projectId,
        basis: {
          kind: "thread-snapshot",
          snapshotId: sheet.basis.snapshotId,
          revision: sheet.basis.revision,
          subjectId: sheet.subject.id,
        },
      });
    } catch {
      throw reviewError(
        "capture_resolution_failed",
        "The exact Thread/SysML basis could not be reopened.",
      );
    }
    if (!basis) {
      throw reviewError(
        "capture_not_found",
        "The exact Thread/SysML basis is unavailable.",
      );
    }
    if (
      basis.thread.projectId !== command.projectId ||
      basis.thread.subjectId !== sheet.subject.id ||
      basis.thread.snapshotId !== sheet.basis.snapshotId ||
      basis.thread.revision !== sheet.basis.revision ||
      !fingerprintsEqual(basis.thread.snapshotFingerprint, sheet.basis.fingerprint)
    ) {
      throw reviewError(
        "recross_failed",
        "The reopened Thread/SysML basis is not the exact identity named by the sheet.",
      );
    }

    try {
      recrossThermalMethodSheet(sheet, source, basis.sysmlAnchor.elements);
      const decisionParameters = await encodeThermalMethodSheetSealParameters(
        sheet,
      );
      const admission = parseThermalMethodSheetSealParameters(decisionParameters);
      const reencoded = encodeThermalMethodSheetSealAdmission(admission);
      if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
        throw new TypeError("Thermal method sheet seal MRTR replay is not canonical.");
      }
      return deepFreeze({ admission, decisionParameters: reencoded });
    } catch (error) {
      if (error instanceof ThermalMethodSheetRecrossError) {
        throw reviewError("recross_failed", error.message);
      }
      if (error instanceof ProjectThermalMethodSheetSealReviewError) throw error;
      throw reviewError(
        "recross_failed",
        "The reopened thermal method sheet is not an exact recross of source capture and SysML.",
      );
    }
  }
}

function parseCommand(value: unknown): ProjectThermalMethodSheetSealReviewCommand {
  const command = exactRecord(
    value,
    ["projectId", "sheetFingerprint"],
    "$thermalMethodSheetSealReview",
  );
  return deepFreeze({
    projectId: safeId(
      command.projectId,
      "$thermalMethodSheetSealReview.projectId",
    ),
    sheetFingerprint: validateContentFingerprint(
      command.sheetFingerprint,
      "$thermalMethodSheetSealReview.sheetFingerprint",
    ),
  });
}

function reviewError(
  code: ProjectThermalMethodSheetSealReviewErrorCode,
  message: string,
): ProjectThermalMethodSheetSealReviewError {
  return new ProjectThermalMethodSheetSealReviewError(code, message);
}
