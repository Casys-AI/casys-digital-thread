/**
 * Closed MRTR grammar for `verify.seal-electrical-observation-method-sheet@1`.
 *
 * Signed parameters name identities and fingerprints only. They grant no
 * ngspice dispatch, no SysON, no provider tool, and no L4 verdict.
 */

import type { ContentFingerprint } from "../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../project/engineering-project.ts";
import type { EngineeringOperationRef } from "../project/engineering-project.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
  type ElectricalObservationMethodSheet,
  fingerprintElectricalObservationMethodSheet,
} from "./observation-method-sheet.ts";

export const VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION = {
  id: "verify.seal-electrical-observation-method-sheet",
  version: "1",
} as const;

export const ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA =
  "electrical-observation-method-sheet-seal/1.0" as const;

export interface ElectricalObservationMethodSheetSealAdmission {
  readonly schemaVersion:
    typeof ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA;
  readonly sheetSchemaVersion: typeof ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA;
  readonly sheetId: string;
  readonly sheetFingerprint: ContentFingerprint;
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly sealDecisionId: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const PARAMETER_KEYS = [
  "electrical.methodSheet.schemaVersion",
  "electrical.methodSheet.id",
  "electrical.methodSheet.fingerprint.digest",
  "electrical.methodSheet.project.id",
  "electrical.methodSheet.subject.id",
  "electrical.methodSheet.basis.snapshotId",
  "electrical.methodSheet.basis.revision",
  "electrical.methodSheet.basis.fingerprint.digest",
  "electrical.methodSheet.review.sealDecisionId",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "electrical.methodSheet.schemaVersion": "Electrical observation method sheet schema",
  "electrical.methodSheet.id": "Electrical observation method sheet id",
  "electrical.methodSheet.fingerprint.digest":
    "Electrical observation method sheet fingerprint",
  "electrical.methodSheet.project.id": "Project",
  "electrical.methodSheet.subject.id": "Subject",
  "electrical.methodSheet.basis.snapshotId": "Thread snapshot",
  "electrical.methodSheet.basis.revision": "Thread revision",
  "electrical.methodSheet.basis.fingerprint.digest": "Thread fingerprint",
  "electrical.methodSheet.review.sealDecisionId": "Seal decision",
};

export function sealElectricalObservationMethodSheetWorkItemOperation(): EngineeringOperationRef {
  return {
    id: VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id,
    version: VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  };
}

export async function encodeElectricalObservationMethodSheetSealParameters(
  sheet: ElectricalObservationMethodSheet,
): Promise<readonly EngineeringDecisionProposalParameter[]> {
  const fingerprint = await fingerprintElectricalObservationMethodSheet(sheet);
  return encodeElectricalObservationMethodSheetSealAdmission({
    schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    sheetSchemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
    sheetId: sheet.id,
    sheetFingerprint: fingerprint,
    projectId: sheet.project.id,
    subjectId: sheet.subject.id,
    basis: sheet.basis,
    sealDecisionId: sheet.review.sealDecisionId,
  });
}

export function encodeElectricalObservationMethodSheetSealAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateElectricalObservationMethodSheetSealAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

export function parseElectricalObservationMethodSheetSealParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ElectricalObservationMethodSheetSealAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Electrical observation method sheet seal proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected) {
      throw new TypeError(
        `Electrical observation method sheet seal parameter ${index} must be ${expected}.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  return validateElectricalObservationMethodSheetSealAdmission({
    schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    sheetSchemaVersion: values.get("electrical.methodSheet.schemaVersion"),
    sheetId: values.get("electrical.methodSheet.id"),
    sheetFingerprint: {
      algorithm: "sha256",
      digest: values.get("electrical.methodSheet.fingerprint.digest"),
    },
    projectId: values.get("electrical.methodSheet.project.id"),
    subjectId: values.get("electrical.methodSheet.subject.id"),
    basis: {
      snapshotId: values.get("electrical.methodSheet.basis.snapshotId"),
      revision: integerValue(
        values.get("electrical.methodSheet.basis.revision"),
        "electrical.methodSheet.basis.revision",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("electrical.methodSheet.basis.fingerprint.digest"),
      },
    },
    sealDecisionId: values.get("electrical.methodSheet.review.sealDecisionId"),
  });
}

export function validateElectricalObservationMethodSheetSealAdmission(
  value: unknown,
): ElectricalObservationMethodSheetSealAdmission {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "sheetSchemaVersion",
      "sheetId",
      "sheetFingerprint",
      "projectId",
      "subjectId",
      "basis",
      "sealDecisionId",
    ],
    "$electricalMethodSheetSeal",
  );
  literalValue(
    root.schemaVersion,
    ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    "$electricalMethodSheetSeal.schemaVersion",
  );
  literalValue(
    root.sheetSchemaVersion,
    ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
    "$electricalMethodSheetSeal.sheetSchemaVersion",
  );
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$electricalMethodSheetSeal.basis",
  );
  return deepFreeze({
    schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    sheetSchemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
    sheetId: safeId(root.sheetId, "$electricalMethodSheetSeal.sheetId"),
    sheetFingerprint: parseFingerprint(
      root.sheetFingerprint,
      "$electricalMethodSheetSeal.sheetFingerprint",
    ),
    projectId: safeId(root.projectId, "$electricalMethodSheetSeal.projectId"),
    subjectId: safeId(root.subjectId, "$electricalMethodSheetSeal.subjectId"),
    basis: {
      snapshotId: safeId(
        basis.snapshotId,
        "$electricalMethodSheetSeal.basis.snapshotId",
      ),
      revision: positiveInteger(
        basis.revision,
        "$electricalMethodSheetSeal.basis.revision",
      ),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$electricalMethodSheetSeal.basis.fingerprint",
      ),
    },
    sealDecisionId: safeId(
      root.sealDecisionId,
      "$electricalMethodSheetSeal.sealDecisionId",
    ),
  });
}

function parameterValue(
  admission: ElectricalObservationMethodSheetSealAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "electrical.methodSheet.schemaVersion":
      return admission.sheetSchemaVersion;
    case "electrical.methodSheet.id":
      return admission.sheetId;
    case "electrical.methodSheet.fingerprint.digest":
      return admission.sheetFingerprint.digest;
    case "electrical.methodSheet.project.id":
      return admission.projectId;
    case "electrical.methodSheet.subject.id":
      return admission.subjectId;
    case "electrical.methodSheet.basis.snapshotId":
      return admission.basis.snapshotId;
    case "electrical.methodSheet.basis.revision":
      return admission.basis.revision;
    case "electrical.methodSheet.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "electrical.methodSheet.review.sealDecisionId":
      return admission.sealDecisionId;
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof input.digest === "string" ? input.digest : "";
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}

function integerValue(value: unknown, path: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  throw new TypeError(`${path} must be an integer.`);
}
