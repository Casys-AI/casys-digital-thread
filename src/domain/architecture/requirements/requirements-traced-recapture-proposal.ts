/**
 * Exact MRTR identities for read-only traced requirements recapture @2.
 *
 * The 21 scalar fields retain the @1 grammar. Only the admission/operation
 * discriminants and admitted predecessor schemas change. A traced predecessor
 * must stay traced: neither promotion of untraced history nor downgrade is
 * granted by this operation. Brief origins are reopened from the predecessor,
 * never supplied in this envelope by the caller.
 */

import { deepFreeze, exactRecord, literalValue } from "../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  encodeRequirementsRecaptureParameters,
  MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
  parseRequirementsRecaptureParameters,
  REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
  type RequirementsRecaptureAdmission,
  validateRequirementsRecaptureAdmission,
} from "./requirements-recapture-proposal.ts";

export const MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION = Object.freeze(
  {
    id: "model.recapture-requirements",
    version: "2",
  } as const,
);

export const MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL =
  "model.recapture-requirements@2" as const;

export const REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA =
  "requirements-recapture-admission/2.0" as const;

export const REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA =
  "requirements-capture/6.0" as const;

type TracedPredecessorSchema =
  | "requirements-capture/5.0"
  | typeof REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA;

export interface RequirementsTracedRecaptureAdmission extends
  Omit<
    RequirementsRecaptureAdmission,
    "schemaVersion" | "operation" | "predecessor"
  > {
  readonly schemaVersion: typeof REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA;
  readonly operation: typeof MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION;
  readonly predecessor:
    & Omit<RequirementsRecaptureAdmission["predecessor"], "schemaVersion">
    & {
      readonly schemaVersion: TracedPredecessorSchema;
    };
}

const PREFIX = "model.recaptureRequirements";

export function encodeTracedRequirementsRecaptureParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateTracedRequirementsRecaptureAdmission(value);
  return deepFreeze(
    encodeRequirementsRecaptureParameters(legacyValidationView(admission)).map(
      (parameter) => {
        switch (parameter.key) {
          case `${PREFIX}.schemaVersion`:
            return { ...parameter, value: admission.schemaVersion };
          case `${PREFIX}.operation.version`:
            return { ...parameter, value: admission.operation.version };
          case `${PREFIX}.predecessor.schemaVersion`:
            return { ...parameter, value: admission.predecessor.schemaVersion };
          default:
            return parameter;
        }
      },
    ),
  );
}

export function parseTracedRequirementsRecaptureProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): RequirementsTracedRecaptureAdmission {
  if (!Array.isArray(parameters)) {
    throw new TypeError("$parameters must be an array.");
  }
  let predecessorSchema: TracedPredecessorSchema | undefined;
  // Validate the new discriminants before making a transient @1 validation
  // view. The existing parser still checks every key, label, order and scalar;
  // the view is never persisted or returned as historical evidence.
  const validationParameters = parameters.map((parameter, index) => {
    const path = `$parameters[${index}]`;
    const record = exactRecord(parameter, ["key", "label", "value"], path);
    switch (record.key) {
      case `${PREFIX}.schemaVersion`:
        literalValue(
          record.value,
          REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA,
          `${path}.value`,
        );
        return { ...parameter, value: REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA };
      case `${PREFIX}.operation.version`:
        literalValue(record.value, "2", `${path}.value`);
        return { ...parameter, value: "1" };
      case `${PREFIX}.predecessor.schemaVersion`:
        predecessorSchema = parseTracedPredecessorSchema(record.value, `${path}.value`);
        return { ...parameter, value: legacyPredecessorSchema(predecessorSchema) };
      default:
        return parameter;
    }
  });
  const native = parseRequirementsRecaptureParameters(validationParameters);
  if (predecessorSchema === undefined) {
    throw new TypeError(
      "Traced requirements recapture predecessor schema is required.",
    );
  }
  return tracedAdmission(native, predecessorSchema);
}

/** Naming counterpart of the historical recapture parser. */
export const parseTracedRequirementsRecaptureParameters =
  parseTracedRequirementsRecaptureProposalParameters;

export function validateTracedRequirementsRecaptureAdmission(
  value: unknown,
  path = "$requirementsTracedRecaptureAdmission",
): RequirementsTracedRecaptureAdmission {
  const root = exactRecord(
    value,
    [
      "architecture",
      "basis",
      "containerComponent",
      "envelope",
      "operation",
      "partDefName",
      "predecessor",
      "requirementsElementId",
      "schemaVersion",
      "target",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(operation.version, "2", `${path}.operation.version`);
  const predecessor = exactRecord(
    root.predecessor,
    ["artifactId", "fingerprint", "producerRunId", "schemaVersion"],
    `${path}.predecessor`,
  );
  const schema = parseTracedPredecessorSchema(
    predecessor.schemaVersion,
    `${path}.predecessor.schemaVersion`,
  );
  const native = validateRequirementsRecaptureAdmission({
    ...root,
    schemaVersion: REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
    operation: MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    predecessor: { ...predecessor, schemaVersion: legacyPredecessorSchema(schema) },
  }, path);
  return tracedAdmission(native, schema);
}

function parseTracedPredecessorSchema(
  value: unknown,
  path: string,
): TracedPredecessorSchema {
  if (
    value !== "requirements-capture/5.0" &&
    value !== REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA
  ) {
    throw new TypeError(`${path} must be a traced requirements capture (5.0 or 6.0).`);
  }
  return value;
}

function legacyPredecessorSchema(schema: TracedPredecessorSchema): string {
  return schema === "requirements-capture/5.0"
    ? "requirements-capture/3.0"
    : "requirements-capture/4.0";
}

function legacyValidationView(
  admission: RequirementsTracedRecaptureAdmission,
): RequirementsRecaptureAdmission {
  return {
    ...admission,
    schemaVersion: REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
    operation: MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    predecessor: {
      ...admission.predecessor,
      schemaVersion: legacyPredecessorSchema(admission.predecessor.schemaVersion),
    },
  };
}

function tracedAdmission(
  native: RequirementsRecaptureAdmission,
  predecessorSchema: TracedPredecessorSchema,
): RequirementsTracedRecaptureAdmission {
  return deepFreeze({
    ...native,
    schemaVersion: REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA,
    operation: MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
    predecessor: { ...native.predecessor, schemaVersion: predecessorSchema },
  });
}
