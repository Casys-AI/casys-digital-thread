/**
 * Canonical `electrical-observation-method-sheet-seal-capture/1.0`.
 *
 * Documentary Thread payload for
 * `verify.seal-electrical-observation-method-sheet@1`. Identities only.
 * CAS directories and byte stores stay in the electrical adapter.
 */

import {
  type ElectricalObservationMethodSheetSealAdmission,
  encodeElectricalObservationMethodSheetSealAdmission,
  parseElectricalObservationMethodSheetSealParameters,
  VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
} from "./observation-method-sheet-proposal.ts";
import type { ElectricalObservationMethodSheetRecross } from "./observation-method-sheet-recross.ts";
import {
  arrayOf,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../kernel/case-validation.ts";
import { fingerprintsEqual } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export const ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA =
  "electrical-observation-method-sheet-seal-capture/1.0" as const;
export const ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX =
  "casys://electrical-observation-method-sheet-seal-capture/sha256/" as const;

const ELECTRICAL_OBSERVATION_METHOD_SHEET_URI_PREFIX =
  "casys://electrical-observation-method-sheet-capture/sha256/" as const;

export interface ElectricalObservationMethodSheetSealCapture {
  readonly schemaVersion:
    typeof ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA;
  readonly kind: "electrical-observation-method-sheet-seal";
  readonly operation: typeof VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: ElectricalObservationMethodSheetSealAdmission;
  readonly sheet: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  };
  readonly recross: {
    readonly briefGates: "matched";
    readonly briefItemIds: readonly string[];
    readonly nativeObservationNames: readonly string[];
  };
}

export function electricalObservationMethodSheetUri(
  fingerprint: ContentFingerprint,
): string {
  return `${ELECTRICAL_OBSERVATION_METHOD_SHEET_URI_PREFIX}${fingerprint.digest}`;
}

export function recrossFromCapture(
  recross: ElectricalObservationMethodSheetRecross,
): ElectricalObservationMethodSheetSealCapture["recross"] {
  return {
    briefGates: recross.briefGates,
    briefItemIds: recross.briefItemIds,
    nativeObservationNames: recross.nativeObservationNames,
  };
}

export function validateElectricalObservationMethodSheetSealCapture(
  value: unknown,
): ElectricalObservationMethodSheetSealCapture {
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
  ], "$electricalMethodSheetSealCapture");
  literalValue(
    root.schemaVersion,
    ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    "$electricalMethodSheetSealCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "electrical-observation-method-sheet-seal",
    "$electricalMethodSheetSealCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$electricalMethodSheetSealCapture.operation",
  );
  literalValue(
    operation.id,
    VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id,
    "$electricalMethodSheetSealCapture.operation.id",
  );
  literalValue(
    operation.version,
    VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version,
    "$electricalMethodSheetSealCapture.operation.version",
  );
  if (typeof root.sealedAt !== "string" || Number.isNaN(Date.parse(root.sealedAt))) {
    throw new TypeError(
      "$electricalMethodSheetSealCapture.sealedAt must be ISO-8601.",
    );
  }
  const admission = parseElectricalObservationMethodSheetSealParameters(
    encodeElectricalObservationMethodSheetSealAdmission(root.admission),
  );
  const sheet = exactRecord(
    root.sheet,
    ["id", "fingerprint", "uri"],
    "$electricalMethodSheetSealCapture.sheet",
  );
  const sheetId = safeId(sheet.id, "$electricalMethodSheetSealCapture.sheet.id");
  const sheetFingerprint = parseFingerprint(
    sheet.fingerprint,
    "$electricalMethodSheetSealCapture.sheet.fingerprint",
  );
  if (
    sheetId !== admission.sheetId ||
    !fingerprintsEqual(sheetFingerprint, admission.sheetFingerprint)
  ) {
    throw new TypeError(
      "$electricalMethodSheetSealCapture.sheet must equal the signed admission sheet.",
    );
  }
  const expectedUri = electricalObservationMethodSheetUri(sheetFingerprint);
  if (sheet.uri !== expectedUri) {
    throw new TypeError(
      "$electricalMethodSheetSealCapture.sheet.uri must be the content-addressed sheet URI.",
    );
  }
  const recross = exactRecord(
    root.recross,
    ["briefGates", "briefItemIds", "nativeObservationNames"],
    "$electricalMethodSheetSealCapture.recross",
  );
  literalValue(
    recross.briefGates,
    "matched",
    "$electricalMethodSheetSealCapture.recross.briefGates",
  );
  return {
    schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    kind: "electrical-observation-method-sheet-seal",
    operation: VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$electricalMethodSheetSealCapture.trustedRunId",
    ),
    decisionId: safeId(
      root.decisionId,
      "$electricalMethodSheetSealCapture.decisionId",
    ),
    sealedAt: root.sealedAt,
    admission,
    sheet: {
      id: sheetId,
      fingerprint: sheetFingerprint,
      uri: expectedUri,
    },
    recross: {
      briefGates: "matched",
      briefItemIds: arrayOfIds(
        recross.briefItemIds,
        "$electricalMethodSheetSealCapture.recross.briefItemIds",
      ),
      nativeObservationNames: arrayOfText(
        recross.nativeObservationNames,
        "$electricalMethodSheetSealCapture.recross.nativeObservationNames",
      ),
    },
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

function arrayOfIds(value: unknown, path: string): readonly string[] {
  return arrayOf(value, path).map((item, index) => safeId(item, `${path}[${index}]`));
}

function arrayOfText(value: unknown, path: string): readonly string[] {
  return arrayOf(value, path).map((item, index) =>
    nonEmptyText(item, `${path}[${index}]`)
  );
}
