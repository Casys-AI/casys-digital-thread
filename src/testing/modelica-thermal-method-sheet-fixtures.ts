/**
 * T01 fixtures for `modelica-thermal-method-sheet/1.0`.
 *
 * Explicit human placeholders only. No temperature, power, material, .mo
 * source, path, image or invented capture bytes.
 */

import type { ContentFingerprint } from "../domain/kernel/primitives.ts";

export const THERMAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT: ContentFingerprint = {
  algorithm: "sha256",
  digest: "0".repeat(64),
};

const G4_SOURCE = {
  id: "source-g4-pending",
  kind: "human" as const,
  reference: "private-history:articulated-led-desk-lamp-demo/human-input-gates",
  justification:
    "G4 thermal method is unresolved. This fixture holds the empty sheet, not a thermal result.",
};

export function validThermalMethodSheetPlaceholder(): Record<string, unknown> {
  return {
    schemaVersion: "modelica-thermal-method-sheet/1.0",
    id: "placeholder-thermal-method-sheet",
    project: {
      id: "articulated-led-desk-lamp",
      subjectId: "articulated-led-desk-lamp",
    },
    subject: { id: "articulated-led-desk-lamp" },
    basis: {
      snapshotId: "placeholder-thread-snapshot",
      revision: 1,
      fingerprint: { ...THERMAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT },
    },
    scope:
      "Isolated lamp-head scalar thermal question. Coupled FEA and general Modelica stay excluded.",
    limitations:
      "No temperature, power, material or equation is declared. G4 remains unanswered.",
    sources: [{ ...G4_SOURCE }],
    model: {
      moduleName: "placeholder-module",
      sourceCaptureFingerprint: { ...THERMAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT },
    },
    parameters: [{
      modelSymbolId: "placeholder-parameter",
      role: "thermal-parameter",
      attributeUsageId: "placeholder-attribute-usage",
      sourceId: G4_SOURCE.id,
    }],
    outputs: [{
      modelSymbolId: "placeholder-output",
      role: "final",
      quantityMeaning: "named-thermal-observation",
      declaredUnit: "unit-pending-source",
      requirementElementId: "placeholder-requirement",
      requirementMetric: "placeholder-output",
      limitation: "Observation role only. Not a verdict.",
    }],
    bindings: {
      parameterizes: [{
        modelSymbolId: "placeholder-parameter",
        attributeUsageId: "placeholder-attribute-usage",
      }],
      outputRequirements: [{
        modelSymbolId: "placeholder-output",
        role: "final",
        requirementElementId: "placeholder-requirement",
        requirementMetric: "placeholder-output",
      }],
    },
    review: {
      authorId: "placeholder-reviewer",
      reviewedAt: "2026-08-21T12:00:00.000Z",
      sealDecisionId: "placeholder-seal-decision",
    },
  };
}

export function duplicateSourceThermalMethodSheet(): Record<string, unknown> {
  const sheet = validThermalMethodSheetPlaceholder();
  sheet.sources = [{ ...G4_SOURCE }, { ...G4_SOURCE }];
  return sheet;
}

export function missingSourceThermalMethodSheet(): Record<string, unknown> {
  const sheet = validThermalMethodSheetPlaceholder();
  sheet.sources = [];
  return sheet;
}

export function missingBindingThermalMethodSheet(): Record<string, unknown> {
  const sheet = validThermalMethodSheetPlaceholder();
  sheet.bindings = {
    parameterizes: [],
    outputRequirements: [{
      modelSymbolId: "placeholder-output",
      role: "final",
      requirementElementId: "placeholder-requirement",
      requirementMetric: "placeholder-output",
    }],
  };
  return sheet;
}

export function modelicaTextThermalMethodSheet(): Record<string, unknown> {
  const sheet = validThermalMethodSheetPlaceholder();
  sheet.modelicaText = "model Forbidden\nend Forbidden;";
  return sheet;
}
