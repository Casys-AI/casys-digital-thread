/**
 * Canonical `modelica-thermal-method-sheet-seal-capture/1.0`.
 *
 * Documentary Thread payload for `verify.seal-modelica-thermal-method-sheet@1`.
 * It names identities and recross results only. It never carries Modelica
 * text, provider tools, OMC arguments or an L4 verdict.
 */

import {
  encodeThermalMethodSheetSealAdmission,
  type ModelicaThermalMethodSheetSealAdmission,
  parseThermalMethodSheetSealParameters,
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
} from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import type { ThermalMethodSheetRecross } from "../../../domain/modelica/thermal-method-sheet-recross.ts";
import {
  arrayOf,
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { THERMAL_METHOD_SHEET_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";

export const MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA =
  "modelica-thermal-method-sheet-seal-capture/1.0" as const;
export const MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX =
  "casys://modelica-thermal-method-sheet-seal-capture/sha256/" as const;

export interface ModelicaThermalMethodSheetSealCapture {
  readonly schemaVersion: typeof MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA;
  readonly kind: "modelica-thermal-method-sheet-seal";
  readonly operation: typeof VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: ModelicaThermalMethodSheetSealAdmission;
  readonly sheet: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  };
  readonly recross: {
    readonly sourceCapture: {
      readonly fingerprint: ContentFingerprint;
      readonly role: "modelica-model";
      readonly language: "modelica";
    };
    readonly attributeUsageIds: readonly string[];
    readonly requirementElementIds: readonly string[];
  };
}

export function thermalMethodSheetUri(fingerprint: ContentFingerprint): string {
  return `${THERMAL_METHOD_SHEET_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`;
}

export function validateModelicaThermalMethodSheetSealCapture(
  value: unknown,
): ModelicaThermalMethodSheetSealCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "admission",
    "sheet",
    "recross",
  ], "$thermalMethodSheetSealCapture");
  literalValue(
    root.schemaVersion,
    MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    "$thermalMethodSheetSealCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "modelica-thermal-method-sheet-seal",
    "$thermalMethodSheetSealCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$thermalMethodSheetSealCapture.operation",
  );
  literalValue(
    operation.id,
    VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id,
    "$thermalMethodSheetSealCapture.operation.id",
  );
  literalValue(
    operation.version,
    VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version,
    "$thermalMethodSheetSealCapture.operation.version",
  );
  if (typeof root.sealedAt !== "string" || Number.isNaN(Date.parse(root.sealedAt))) {
    throw new TypeError(
      "$thermalMethodSheetSealCapture.sealedAt must be ISO-8601.",
    );
  }
  const admission = parseThermalMethodSheetSealParameters(
    encodeThermalMethodSheetSealAdmission(root.admission),
  );
  const sheet = exactRecord(
    root.sheet,
    ["id", "fingerprint", "uri"],
    "$thermalMethodSheetSealCapture.sheet",
  );
  const sheetId = safeId(sheet.id, "$thermalMethodSheetSealCapture.sheet.id");
  const sheetFingerprint = parseFingerprint(
    sheet.fingerprint,
    "$thermalMethodSheetSealCapture.sheet.fingerprint",
  );
  if (
    sheetId !== admission.sheetId ||
    !fingerprintsEqual(sheetFingerprint, admission.sheetFingerprint)
  ) {
    throw new TypeError(
      "$thermalMethodSheetSealCapture.sheet does not match the signed admission.",
    );
  }
  const expectedUri = thermalMethodSheetUri(admission.sheetFingerprint);
  if (sheet.uri !== expectedUri) {
    throw new TypeError(
      "$thermalMethodSheetSealCapture.sheet.uri must be the method-sheet CAS URI.",
    );
  }
  const recross = exactRecord(
    root.recross,
    ["sourceCapture", "attributeUsageIds", "requirementElementIds"],
    "$thermalMethodSheetSealCapture.recross",
  );
  const sourceCapture = exactRecord(
    recross.sourceCapture,
    ["fingerprint", "role", "language"],
    "$thermalMethodSheetSealCapture.recross.sourceCapture",
  );
  literalValue(
    sourceCapture.role,
    "modelica-model",
    "$thermalMethodSheetSealCapture.recross.sourceCapture.role",
  );
  literalValue(
    sourceCapture.language,
    "modelica",
    "$thermalMethodSheetSealCapture.recross.sourceCapture.language",
  );
  const sourceFingerprint = parseFingerprint(
    sourceCapture.fingerprint,
    "$thermalMethodSheetSealCapture.recross.sourceCapture.fingerprint",
  );
  if (
    !fingerprintsEqual(
      sourceFingerprint,
      admission.model.sourceCaptureFingerprint,
    )
  ) {
    throw new TypeError(
      "$thermalMethodSheetSealCapture.recross.sourceCapture does not match the signed admission.",
    );
  }
  const attributeUsageIds = arrayOf(
    recross.attributeUsageIds,
    "$thermalMethodSheetSealCapture.recross.attributeUsageIds",
  ).map((item, index) =>
    safeId(
      item,
      `$thermalMethodSheetSealCapture.recross.attributeUsageIds[${index}]`,
    )
  );
  const requirementElementIds = arrayOf(
    recross.requirementElementIds,
    "$thermalMethodSheetSealCapture.recross.requirementElementIds",
  ).map((item, index) =>
    safeId(
      item,
      `$thermalMethodSheetSealCapture.recross.requirementElementIds[${index}]`,
    )
  );
  return {
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    kind: "modelica-thermal-method-sheet-seal",
    operation: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$thermalMethodSheetSealCapture.trustedRunId",
    ),
    decisionId: safeId(
      root.decisionId,
      "$thermalMethodSheetSealCapture.decisionId",
    ),
    sealedAt: root.sealedAt,
    admission,
    sheet: {
      id: sheetId,
      fingerprint: admission.sheetFingerprint,
      uri: expectedUri,
    },
    recross: {
      sourceCapture: {
        fingerprint: admission.model.sourceCaptureFingerprint,
        role: "modelica-model",
        language: "modelica",
      },
      attributeUsageIds,
      requirementElementIds,
    },
  };
}

export function recrossFromCapture(
  recross: ThermalMethodSheetRecross,
  admission: ModelicaThermalMethodSheetSealAdmission,
): ModelicaThermalMethodSheetSealCapture["recross"] {
  if (recross.sourceCapture !== "matched") {
    throw new TypeError("Thermal method sheet source recross must be matched.");
  }
  return {
    sourceCapture: {
      fingerprint: admission.model.sourceCaptureFingerprint,
      role: "modelica-model",
      language: "modelica",
    },
    attributeUsageIds: recross.attributeUsageIds,
    requirementElementIds: recross.requirementElementIds,
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof input.digest === "string" ? input.digest : "";
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}
