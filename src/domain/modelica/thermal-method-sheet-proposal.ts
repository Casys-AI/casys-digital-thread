/**
 * Closed MRTR grammar for `verify.seal-modelica-thermal-method-sheet@1`.
 *
 * Signed parameters name identities and fingerprints only. They grant no OMC
 * dispatch, no Modelica source bytes, no provider tool, and no L4 verdict.
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
  fingerprintModelicaThermalMethodSheet,
  MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
  type ModelicaThermalMethodSheet,
} from "./thermal-method-sheet.ts";

export const VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION = {
  id: "verify.seal-modelica-thermal-method-sheet",
  version: "1",
} as const;

export const MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA =
  "modelica-thermal-method-sheet-seal/1.0" as const;

export interface ModelicaThermalMethodSheetSealAdmission {
  readonly schemaVersion: typeof MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA;
  readonly sheetSchemaVersion: typeof MODELICA_THERMAL_METHOD_SHEET_SCHEMA;
  readonly sheetId: string;
  readonly sheetFingerprint: ContentFingerprint;
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly model: {
    readonly moduleName: string;
    readonly sourceCaptureFingerprint: ContentFingerprint;
  };
  readonly sealDecisionId: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const PARAMETER_KEYS = [
  "thermal.methodSheet.schemaVersion",
  "thermal.methodSheet.id",
  "thermal.methodSheet.fingerprint.digest",
  "thermal.methodSheet.project.id",
  "thermal.methodSheet.subject.id",
  "thermal.methodSheet.basis.snapshotId",
  "thermal.methodSheet.basis.revision",
  "thermal.methodSheet.basis.fingerprint.digest",
  "thermal.methodSheet.model.moduleName",
  "thermal.methodSheet.model.sourceCaptureFingerprint.digest",
  "thermal.methodSheet.review.sealDecisionId",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "thermal.methodSheet.schemaVersion": "Thermal method sheet schema",
  "thermal.methodSheet.id": "Thermal method sheet id",
  "thermal.methodSheet.fingerprint.digest": "Thermal method sheet fingerprint",
  "thermal.methodSheet.project.id": "Project",
  "thermal.methodSheet.subject.id": "Subject",
  "thermal.methodSheet.basis.snapshotId": "Thread snapshot",
  "thermal.methodSheet.basis.revision": "Thread revision",
  "thermal.methodSheet.basis.fingerprint.digest": "Thread fingerprint",
  "thermal.methodSheet.model.moduleName": "Modelica module name",
  "thermal.methodSheet.model.sourceCaptureFingerprint.digest":
    "Admitted Modelica source fingerprint",
  "thermal.methodSheet.review.sealDecisionId": "Seal decision",
};

export function sealModelicaThermalMethodSheetWorkItemOperation(): EngineeringOperationRef {
  return {
    id: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id,
    version: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  };
}

export async function encodeThermalMethodSheetSealParameters(
  sheet: ModelicaThermalMethodSheet,
): Promise<readonly EngineeringDecisionProposalParameter[]> {
  const fingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  return encodeThermalMethodSheetSealAdmission({
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    sheetSchemaVersion: MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
    sheetId: sheet.id,
    sheetFingerprint: fingerprint,
    projectId: sheet.project.id,
    subjectId: sheet.subject.id,
    basis: sheet.basis,
    model: sheet.model,
    sealDecisionId: sheet.review.sealDecisionId,
  });
}

export function encodeThermalMethodSheetSealAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateThermalMethodSheetSealAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

export function parseThermalMethodSheetSealParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ModelicaThermalMethodSheetSealAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Thermal method sheet seal proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected) {
      throw new TypeError(
        `Thermal method sheet seal parameter ${index} must be ${expected}.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  return validateThermalMethodSheetSealAdmission({
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    sheetSchemaVersion: values.get("thermal.methodSheet.schemaVersion"),
    sheetId: values.get("thermal.methodSheet.id"),
    sheetFingerprint: {
      algorithm: "sha256",
      digest: values.get("thermal.methodSheet.fingerprint.digest"),
    },
    projectId: values.get("thermal.methodSheet.project.id"),
    subjectId: values.get("thermal.methodSheet.subject.id"),
    basis: {
      snapshotId: values.get("thermal.methodSheet.basis.snapshotId"),
      revision: integerValue(
        values.get("thermal.methodSheet.basis.revision"),
        "thermal.methodSheet.basis.revision",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("thermal.methodSheet.basis.fingerprint.digest"),
      },
    },
    model: {
      moduleName: values.get("thermal.methodSheet.model.moduleName"),
      sourceCaptureFingerprint: {
        algorithm: "sha256",
        digest: values.get(
          "thermal.methodSheet.model.sourceCaptureFingerprint.digest",
        ),
      },
    },
    sealDecisionId: values.get("thermal.methodSheet.review.sealDecisionId"),
  });
}

function validateThermalMethodSheetSealAdmission(
  value: unknown,
): ModelicaThermalMethodSheetSealAdmission {
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
      "model",
      "sealDecisionId",
    ],
    "$thermalMethodSheetSeal",
  );
  literalValue(
    root.schemaVersion,
    MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    "$thermalMethodSheetSeal.schemaVersion",
  );
  literalValue(
    root.sheetSchemaVersion,
    MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
    "$thermalMethodSheetSeal.sheetSchemaVersion",
  );
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$thermalMethodSheetSeal.basis",
  );
  const model = exactRecord(
    root.model,
    ["moduleName", "sourceCaptureFingerprint"],
    "$thermalMethodSheetSeal.model",
  );
  const moduleName = safeId(
    model.moduleName,
    "$thermalMethodSheetSeal.model.moduleName",
  );
  if (moduleName.includes(".") || moduleName.toLowerCase().endsWith("mo")) {
    throw new TypeError(
      "$thermalMethodSheetSeal.model.moduleName must not be a Modelica source path.",
    );
  }
  return deepFreeze({
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
    sheetSchemaVersion: MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
    sheetId: safeId(root.sheetId, "$thermalMethodSheetSeal.sheetId"),
    sheetFingerprint: parseFingerprint(
      root.sheetFingerprint,
      "$thermalMethodSheetSeal.sheetFingerprint",
    ),
    projectId: safeId(root.projectId, "$thermalMethodSheetSeal.projectId"),
    subjectId: safeId(root.subjectId, "$thermalMethodSheetSeal.subjectId"),
    basis: {
      snapshotId: safeId(basis.snapshotId, "$thermalMethodSheetSeal.basis.snapshotId"),
      revision: positiveInteger(
        basis.revision,
        "$thermalMethodSheetSeal.basis.revision",
      ),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$thermalMethodSheetSeal.basis.fingerprint",
      ),
    },
    model: {
      moduleName,
      sourceCaptureFingerprint: parseFingerprint(
        model.sourceCaptureFingerprint,
        "$thermalMethodSheetSeal.model.sourceCaptureFingerprint",
      ),
    },
    sealDecisionId: safeId(
      root.sealDecisionId,
      "$thermalMethodSheetSeal.sealDecisionId",
    ),
  });
}

function parameterValue(
  admission: ModelicaThermalMethodSheetSealAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "thermal.methodSheet.schemaVersion":
      return admission.sheetSchemaVersion;
    case "thermal.methodSheet.id":
      return admission.sheetId;
    case "thermal.methodSheet.fingerprint.digest":
      return admission.sheetFingerprint.digest;
    case "thermal.methodSheet.project.id":
      return admission.projectId;
    case "thermal.methodSheet.subject.id":
      return admission.subjectId;
    case "thermal.methodSheet.basis.snapshotId":
      return admission.basis.snapshotId;
    case "thermal.methodSheet.basis.revision":
      return admission.basis.revision;
    case "thermal.methodSheet.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "thermal.methodSheet.model.moduleName":
      return admission.model.moduleName;
    case "thermal.methodSheet.model.sourceCaptureFingerprint.digest":
      return admission.model.sourceCaptureFingerprint.digest;
    case "thermal.methodSheet.review.sealDecisionId":
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
