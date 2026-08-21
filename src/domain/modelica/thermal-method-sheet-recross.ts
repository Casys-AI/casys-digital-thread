/**
 * Identity recross for a reviewed `modelica-thermal-method-sheet/1.0`.
 *
 * The sheet names source-capture and SysML identities. This module checks
 * those identities against reopened facts. It never infers a unit, value or
 * Modelica equation, and it never calls OMC.
 */

import { fingerprintsEqual } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { ModelicaThermalMethodSheet } from "./thermal-method-sheet.ts";

export type ThermalMethodSheetRecrossErrorCode =
  | "source_unavailable"
  | "source_mismatch"
  | "sysml_unavailable"
  | "sysml_unresolved"
  | "identity_mismatch";

export class ThermalMethodSheetRecrossError extends Error {
  constructor(
    readonly code: ThermalMethodSheetRecrossErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ThermalMethodSheetRecrossError";
  }
}

export interface ThermalMethodSheetSourceIdentity {
  readonly fingerprint: ContentFingerprint;
  readonly role: "modelica-model";
  readonly language: "modelica";
}

export interface ThermalMethodSheetSysmlElement {
  readonly id: string;
  readonly kind: string;
}

export interface ThermalMethodSheetRecross {
  readonly sourceCapture: "matched";
  readonly attributeUsageIds: readonly string[];
  readonly requirementElementIds: readonly string[];
}

export function recrossThermalMethodSheet(
  sheet: ModelicaThermalMethodSheet,
  source: ThermalMethodSheetSourceIdentity | undefined,
  sysmlElements: readonly ThermalMethodSheetSysmlElement[] | undefined,
): ThermalMethodSheetRecross {
  if (sheet.project.subjectId !== sheet.subject.id) {
    throw recrossError(
      "identity_mismatch",
      "The thermal method sheet project subject is unresolved against its subject identity.",
    );
  }
  if (!source) {
    throw recrossError(
      "source_unavailable",
      "The exact Modelica source capture is unavailable.",
    );
  }
  if (
    source.role !== "modelica-model" ||
    source.language !== "modelica" ||
    !fingerprintsEqual(source.fingerprint, sheet.model.sourceCaptureFingerprint)
  ) {
    throw recrossError(
      "source_mismatch",
      "The reopened source capture is not the exact modelica-model identity named by the sheet.",
    );
  }
  if (sysmlElements === undefined) {
    throw recrossError(
      "sysml_unavailable",
      "The exact SysML basis is unavailable.",
    );
  }

  const attributeUsageIds = sheet.parameters.map((parameter) =>
    uniqueElement(
      sysmlElements,
      parameter.attributeUsageId,
      "AttributeUsage",
    )
  );
  const requirementElementIds = sheet.outputs.map((output) =>
    uniqueElement(
      sysmlElements,
      output.requirementElementId,
      "RequirementUsage",
    )
  );
  return {
    sourceCapture: "matched",
    attributeUsageIds,
    requirementElementIds,
  };
}

function uniqueElement(
  elements: readonly ThermalMethodSheetSysmlElement[],
  id: string,
  kind: "AttributeUsage" | "RequirementUsage",
): string {
  const matches = elements.filter((element) => element.id === id);
  if (matches.length !== 1) {
    throw recrossError(
      "sysml_unresolved",
      `SysML ${kind} "${id}" is unresolved on the exact basis.`,
    );
  }
  if (matches[0]!.kind !== kind) {
    throw recrossError(
      "sysml_unresolved",
      `SysML identity "${id}" is unresolved: expected ${kind}, observed ${
        matches[0]!.kind
      }.`,
    );
  }
  return id;
}

function recrossError(
  code: ThermalMethodSheetRecrossErrorCode,
  message: string,
): ThermalMethodSheetRecrossError {
  return new ThermalMethodSheetRecrossError(code, message);
}
