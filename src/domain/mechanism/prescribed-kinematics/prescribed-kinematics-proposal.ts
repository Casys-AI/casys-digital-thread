/**
 * Closed MRTR grammars for prescribed-kinematics L1 case seal and L3 run.
 *
 * These sequences exist so `project_decision_propose` (min one parameter) never
 * receives an invented placeholder. L1 names only the exact workspace
 * attachment already supplied to the case review. L3 restates the unique
 * current domain case fingerprint; the executor recrosses it against the
 * ROP-bound case. Neither grammar accepts provider, image, tool, endpoint,
 * runtime, or fingerprint caller choices.
 */

import {
  deepFreeze,
  exactRecord,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import { assertPrescribedKinematicsProposalParameters } from "./proposal-validation.ts";

export interface PrescribedKinematicsCaseProposalParameters {
  readonly workspaceRevision: number;
  readonly attachmentId: string;
  readonly attachmentRevision: number;
}

export interface PrescribedKinematicsRunProposalParameters {
  readonly caseFingerprint: ContentFingerprint;
}

const CASE_SPECS = [
  {
    key: "workspaceRevision",
    label: "Exact ProjectSourceWorkspace revision",
  },
  {
    key: "attachmentId",
    label: "Named mechanism-source attachment id",
  },
  {
    key: "attachmentRevision",
    label: "Named mechanism-source attachment revision",
  },
] as const;

const RUN_SPEC = {
  key: "caseFingerprint",
  label: "Exact L1 prescribed-kinematics case SHA-256",
} as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function encodePrescribedKinematicsCaseProposalParameters(
  value: PrescribedKinematicsCaseProposalParameters,
): readonly EngineeringDecisionProposalParameter[] {
  const parsed = validateCaseProposal(value);
  return deepFreeze([
    {
      key: CASE_SPECS[0].key,
      label: CASE_SPECS[0].label,
      value: parsed.workspaceRevision,
    },
    {
      key: CASE_SPECS[1].key,
      label: CASE_SPECS[1].label,
      value: parsed.attachmentId,
    },
    {
      key: CASE_SPECS[2].key,
      label: CASE_SPECS[2].label,
      value: parsed.attachmentRevision,
    },
  ]);
}

export function parsePrescribedKinematicsCaseProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): PrescribedKinematicsCaseProposalParameters {
  assertPrescribedKinematicsProposalParameters(parameters);
  const values = exactParameterValues(parameters, CASE_SPECS);
  return validateCaseProposal({
    workspaceRevision: requireNumber(values, CASE_SPECS[0].key),
    attachmentId: requireString(values, CASE_SPECS[1].key),
    attachmentRevision: requireNumber(values, CASE_SPECS[2].key),
  });
}

export function encodePrescribedKinematicsRunProposalParameters(
  caseFingerprint: ContentFingerprint,
): readonly EngineeringDecisionProposalParameter[] {
  const parsed = validateRunProposal({ caseFingerprint });
  return deepFreeze([{
    key: RUN_SPEC.key,
    label: RUN_SPEC.label,
    value: parsed.caseFingerprint.digest,
  }]);
}

export function parsePrescribedKinematicsRunProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): PrescribedKinematicsRunProposalParameters {
  assertPrescribedKinematicsProposalParameters(parameters);
  const values = exactParameterValues(parameters, [RUN_SPEC]);
  const digest = requireString(values, RUN_SPEC.key);
  return validateRunProposal({
    caseFingerprint: { algorithm: "sha256", digest },
  });
}

function validateCaseProposal(
  value: PrescribedKinematicsCaseProposalParameters,
): PrescribedKinematicsCaseProposalParameters {
  const attachmentId = safeId(
    value.attachmentId,
    "$prescribedKinematicsCaseProposal.attachmentId",
  );
  if (attachmentId.toLowerCase() === "latest") {
    throw new TypeError("latest is not an exact mechanism-source attachment identity.");
  }
  return deepFreeze({
    workspaceRevision: positiveInteger(
      value.workspaceRevision,
      "$prescribedKinematicsCaseProposal.workspaceRevision",
    ),
    attachmentId,
    attachmentRevision: positiveInteger(
      value.attachmentRevision,
      "$prescribedKinematicsCaseProposal.attachmentRevision",
    ),
  });
}

function validateRunProposal(
  value: PrescribedKinematicsRunProposalParameters,
): PrescribedKinematicsRunProposalParameters {
  const record = exactRecord(
    value.caseFingerprint,
    ["algorithm", "digest"],
    "$prescribedKinematicsRunProposal.caseFingerprint",
  );
  if (record.algorithm !== "sha256") {
    throw new TypeError(
      "$prescribedKinematicsRunProposal.caseFingerprint.algorithm must be sha256.",
    );
  }
  if (typeof record.digest !== "string" || !SHA256_HEX.test(record.digest)) {
    throw new TypeError(
      "$prescribedKinematicsRunProposal.caseFingerprint.digest must be a lowercase SHA-256 hex digest.",
    );
  }
  return deepFreeze({
    caseFingerprint: { algorithm: "sha256" as const, digest: record.digest },
  });
}

function exactParameterValues(
  parameters: readonly EngineeringDecisionProposalParameter[],
  specs: readonly { readonly key: string; readonly label: string }[],
): ReadonlyMap<string, string | number | boolean> {
  if (!Array.isArray(parameters)) {
    throw new TypeError("$parameters must be an array.");
  }
  if (parameters.length !== specs.length) {
    throw new TypeError(
      `$parameters must contain exactly ${specs.length} prescribed-kinematics entries.`,
    );
  }
  const values = new Map<string, string | number | boolean>();
  for (const [index, spec] of specs.entries()) {
    const record = exactRecord(
      parameters[index],
      ["key", "label", "value"],
      `$parameters[${index}]`,
    );
    if (record.key !== spec.key) {
      throw new TypeError(`$parameters[${index}].key must be ${spec.key}.`);
    }
    if (record.label !== spec.label) {
      throw new TypeError(`$parameters[${index}].label must be ${spec.label}.`);
    }
    if (
      typeof record.value !== "string" && typeof record.value !== "number" &&
      typeof record.value !== "boolean"
    ) {
      throw new TypeError(`$parameters[${index}].value must be a JSON scalar.`);
    }
    values.set(spec.key, record.value);
  }
  return values;
}

function requireNumber(
  values: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = values.get(key);
  if (typeof value !== "number") {
    throw new TypeError(`$parameters ${key} must be a number.`);
  }
  return value;
}

function requireString(
  values: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const value = values.get(key);
  if (typeof value !== "string") {
    throw new TypeError(`$parameters ${key} must be a string.`);
  }
  return value;
}
