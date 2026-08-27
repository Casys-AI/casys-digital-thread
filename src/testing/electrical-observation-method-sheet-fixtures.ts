/**
 * Generic fixtures for `electrical-observation-method-sheet/1.0`.
 *
 * Placeholder identities and closed-subset native names only. No product
 * circuit, threshold catalogue, or server-owned numbers.
 */

import type { ContentFingerprint } from "../domain/kernel/primitives.ts";

export const ELECTRICAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT: ContentFingerprint = {
  algorithm: "sha256",
  digest: "0".repeat(64),
};

const SOURCE = {
  id: "source-reviewed-brief",
  kind: "human" as const,
  reference: "brief.gate.reviewed",
  justification: "Reviewed brief gate for the closed electrical comparator.",
};

const L3_DIGEST = ELECTRICAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT.digest;

export function placeholderAdmittedSpiceBranch(): Record<string, unknown> {
  return {
    producer: {
      serverId: "digital-thread",
      tool: "simulate.run-admitted-spice@1",
      runId: "placeholder-admitted-spice-run",
    },
    capture: {
      id: `spice-admitted-capture-${L3_DIGEST}`,
      fingerprint: { ...ELECTRICAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT },
    },
    evidence: {
      id: `spice-admitted-evidence-${L3_DIGEST}`,
      fingerprint: { ...ELECTRICAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT },
    },
    result: {
      id: `spice-admitted-result-${L3_DIGEST}`,
      fingerprint: { ...ELECTRICAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT },
    },
  };
}

export function validElectricalObservationMethodSheet(): Record<string, unknown> {
  return {
    schemaVersion: "electrical-observation-method-sheet/1.0",
    id: "placeholder-electrical-observation-method-sheet",
    project: {
      id: "project.electrical-method",
      subjectId: "subject.electrical-method",
    },
    subject: { id: "subject.electrical-method" },
    basis: {
      snapshotId: "placeholder-thread-snapshot",
      revision: 1,
      fingerprint: { ...ELECTRICAL_METHOD_SHEET_PLACEHOLDER_FINGERPRINT },
    },
    spice: placeholderAdmittedSpiceBranch(),
    scope:
      "Bounded digital-thread comparator over exact native ngspice L3 observations.",
    limitations:
      "Not physical, vendor, safety, certification, or ngspice-as-oracle proof. SysON decimal requirements stay unavailable.",
    sources: [{ ...SOURCE }],
    criteria: [
      {
        id: "criterion-node-voltage",
        sourceId: SOURCE.id,
        briefItem: {
          id: "success-criterion-node-voltage",
          kind: "success-criterion",
        },
        comparator: "<=",
        threshold: { value: 3, unit: "V" },
        expression: { kind: "native-observation", name: "v(n1)" },
      },
      {
        id: "criterion-source-current",
        sourceId: SOURCE.id,
        briefItem: {
          id: "success-criterion-source-current",
          kind: "success-criterion",
        },
        comparator: "between-inclusive",
        bounds: {
          min: { value: 1, unit: "A" },
          max: { value: 4, unit: "A" },
        },
        expression: {
          kind: "negate",
          operand: { kind: "native-observation", name: "i(vsrc)" },
        },
      },
      {
        id: "criterion-source-power",
        sourceId: SOURCE.id,
        briefItem: {
          id: "verification-activity-source-power",
          kind: "verification-activity",
        },
        comparator: ">=",
        threshold: { value: 1, unit: "W" },
        expression: {
          kind: "multiply",
          left: { kind: "native-observation", name: "v(n1)" },
          right: {
            kind: "negate",
            operand: { kind: "native-observation", name: "i(vsrc)" },
          },
        },
      },
    ],
    review: {
      authorId: "placeholder-reviewer",
      reviewedAt: "2026-08-21T12:00:00.000Z",
      sealDecisionId: "placeholder-seal-decision",
    },
  };
}

export function methodSheetWithInjectedField(): Record<string, unknown> {
  return {
    ...validElectricalObservationMethodSheet(),
    provider: "ngspice",
  };
}

export function methodSheetWithDuplicateCriterionIds(): Record<string, unknown> {
  const sheet = validElectricalObservationMethodSheet();
  const criteria = sheet.criteria as Array<Record<string, unknown>>;
  criteria[1] = { ...criteria[1]!, id: criteria[0]!.id };
  return sheet;
}

export function methodSheetWithNonFiniteThreshold(): Record<string, unknown> {
  const sheet = validElectricalObservationMethodSheet();
  const criteria = sheet.criteria as Array<Record<string, unknown>>;
  criteria[0] = {
    ...criteria[0]!,
    threshold: { value: Number.POSITIVE_INFINITY, unit: "V" },
  };
  return sheet;
}

export function methodSheetWithUnitMismatch(): Record<string, unknown> {
  const sheet = validElectricalObservationMethodSheet();
  const criteria = sheet.criteria as Array<Record<string, unknown>>;
  criteria[0] = {
    ...criteria[0]!,
    threshold: { value: 3, unit: "A" },
  };
  return sheet;
}

export function methodSheetWithUnknownNative(): Record<string, unknown> {
  const sheet = validElectricalObservationMethodSheet();
  const criteria = sheet.criteria as Array<Record<string, unknown>>;
  criteria[0] = {
    ...criteria[0]!,
    expression: { kind: "native-observation", name: "p(n1)" },
  };
  return sheet;
}

export function methodSheetWithSharedBriefGate(): Record<string, unknown> {
  const sheet = validElectricalObservationMethodSheet();
  const criteria = sheet.criteria as Array<Record<string, unknown>>;
  criteria[1] = {
    ...criteria[1]!,
    briefItem: { ...(criteria[0]!.briefItem as Record<string, unknown>) },
  };
  criteria[2] = {
    ...criteria[2]!,
    briefItem: { ...(criteria[0]!.briefItem as Record<string, unknown>) },
  };
  return sheet;
}

export function methodSheetWithNonHexFingerprint(): Record<string, unknown> {
  const sheet = validElectricalObservationMethodSheet();
  const spice = sheet.spice as Record<string, unknown>;
  const capture = spice.capture as Record<string, unknown>;
  capture.fingerprint = { algorithm: "sha256", digest: "not-a-digest" };
  capture.id = "spice-admitted-capture-not-a-digest";
  return sheet;
}
