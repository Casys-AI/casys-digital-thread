/**
 * Server-owned catalog shape for a sensitivity study before cadSource is bound.
 *
 * The live case is project-specific because cadSource names a Thread admission.
 * Catalog files therefore cannot be valid sensitivity-study-case/2.0 documents.
 * This template carries every scientific field; the sealer binds cadSource
 * from the signed MRTR and the current Thread head.
 */

import { exactRecord, literalValue } from "../../kernel/case-validation.ts";
import {
  SENSITIVITY_STUDY_CASE_V2_SCHEMA,
  type SensitivityStudyCaseV2,
  validateSensitivityStudyCaseV2,
} from "./sensitivity-study-v2.ts";

export const SENSITIVITY_STUDY_CASE_TEMPLATE_SCHEMA =
  "sensitivity-study-case-template/2.0" as const;

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
  "solver",
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
  readonly project: SensitivityStudyCaseV2["project"];
  readonly target: SensitivityStudyCaseV2["target"];
  readonly baseValue: SensitivityStudyCaseV2["baseValue"];
  readonly step: SensitivityStudyCaseV2["step"];
  readonly metrics: SensitivityStudyCaseV2["metrics"];
  readonly solver: SensitivityStudyCaseV2["solver"];
  readonly domain: SensitivityStudyCaseV2["domain"];
}

/**
 * Validate a catalog template, then reuse the 2.0 case parsers for every
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
  const assembled = validateSensitivityStudyCaseV2({
    schemaVersion: SENSITIVITY_STUDY_CASE_V2_SCHEMA,
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
    solver: root.solver,
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
    solver: assembled.solver,
    domain: assembled.domain,
  };
}

export function assembleSensitivityStudyCaseV2(
  template: SensitivityStudyCaseTemplate,
  cadSource: SensitivityStudyCaseV2["cadSource"],
): SensitivityStudyCaseV2 {
  return validateSensitivityStudyCaseV2({
    schemaVersion: SENSITIVITY_STUDY_CASE_V2_SCHEMA,
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
    solver: template.solver,
    domain: template.domain,
  });
}
