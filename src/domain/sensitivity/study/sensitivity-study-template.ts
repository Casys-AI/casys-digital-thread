/**
 * Server-owned catalog shape for a sensitivity study before cadSource is bound.
 *
 * The live case is project-specific because cadSource names a Thread admission.
 * Catalog files therefore cannot be valid sensitivity-study-case/3.0 documents.
 * This template carries every scientific field; the sealer binds cadSource
 * from the signed MRTR and the current Thread head.
 */

import { exactRecord, literalValue } from "../../kernel/case-validation.ts";
import {
  SENSITIVITY_STUDY_CASE_V3_SCHEMA,
  type SensitivityStudyCaseV3,
  validateSensitivityStudyCaseV3,
} from "./sensitivity-study-v3.ts";

export const SENSITIVITY_STUDY_CASE_TEMPLATE_SCHEMA =
  "sensitivity-study-case-template/3.0" as const;

const TEMPLATE_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "target",
  "baseValue",
  "step",
  "metrics",
  "method",
  "domain",
] as const;

const TEMPLATE_CAD_SOURCE_PLACEHOLDER = {
  artifactUri: "thread-artifact://template-placeholder/admission",
  sha256: "0".repeat(64),
} as const;

export interface SensitivityStudyCaseTemplate {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CASE_TEMPLATE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: SensitivityStudyCaseV3["project"];
  readonly target: SensitivityStudyCaseV3["target"];
  readonly baseValue: SensitivityStudyCaseV3["baseValue"];
  readonly step: SensitivityStudyCaseV3["step"];
  readonly metrics: SensitivityStudyCaseV3["metrics"];
  readonly method: SensitivityStudyCaseV3["method"];
  readonly domain: SensitivityStudyCaseV3["domain"];
}

/**
 * Validate a catalog template, then reuse the 3.0 case parsers for every
 * nested scientific field. The placeholder cadSource never leaves this
 * function.
 */
export function validateSensitivityStudyCaseTemplate(
  value: unknown,
): SensitivityStudyCaseTemplate {
  const root = exactRecord(value, TEMPLATE_KEYS, "$template");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_STUDY_CASE_TEMPLATE_SCHEMA,
    "$template.schemaVersion",
  );
  const assembled = validateSensitivityStudyCaseV3({
    schemaVersion: SENSITIVITY_STUDY_CASE_V3_SCHEMA,
    id: root.id,
    revision: root.revision,
    scope: root.scope,
    evidenceBoundary: root.evidenceBoundary,
    project: root.project,
    target: root.target,
    cadSource: TEMPLATE_CAD_SOURCE_PLACEHOLDER,
    baseValue: root.baseValue,
    step: root.step,
    metrics: root.metrics,
    method: root.method,
    domain: root.domain,
  });
  return {
    schemaVersion: SENSITIVITY_STUDY_CASE_TEMPLATE_SCHEMA,
    id: assembled.id,
    revision: assembled.revision,
    scope: assembled.scope,
    evidenceBoundary: assembled.evidenceBoundary,
    project: assembled.project,
    target: assembled.target,
    baseValue: assembled.baseValue,
    step: assembled.step,
    metrics: assembled.metrics,
    method: assembled.method,
    domain: assembled.domain,
  };
}

export function assembleSensitivityStudyCaseV3(
  template: SensitivityStudyCaseTemplate,
  cadSource: SensitivityStudyCaseV3["cadSource"],
): SensitivityStudyCaseV3 {
  return validateSensitivityStudyCaseV3({
    schemaVersion: SENSITIVITY_STUDY_CASE_V3_SCHEMA,
    id: template.id,
    revision: template.revision,
    scope: template.scope,
    evidenceBoundary: template.evidenceBoundary,
    project: template.project,
    target: template.target,
    cadSource,
    baseValue: template.baseValue,
    step: template.step,
    metrics: template.metrics,
    method: template.method,
    domain: template.domain,
  });
}
