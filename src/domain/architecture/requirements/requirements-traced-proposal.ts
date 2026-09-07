/**
 * Closed MRTR grammar for `model.write-requirements@2`.
 *
 * Adds mandatory exact brief-source identity to the integer-scalar proposal
 * of `model.write-requirements@1` without changing that operation. Scalar
 * metrics, operators, oracle thresholds and enrichment stay owned by
 * `parseRequirementsProposalParameters`. This module only binds each parsed
 * requirement to an exact approved-brief item and the pre-normalisation
 * declared threshold.
 *
 * Pure: no I/O, no fetch, no caller-supplied sourceRefs.
 */

import {
  closedRecord,
  deepFreeze,
  finite,
  nonEmptyText,
  positiveInteger,
  PROPOSAL_PARAMETER_SLUG_BODY,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  normaliseThreshold,
  type UnitNormalisationLabel,
} from "../../kernel/unit-normalisation.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
} from "../../project/engineering-project.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import {
  parseRequirementsProposalParameters,
  type RequirementEntry,
  type RequirementsProposal,
} from "./requirements-proposal.ts";

export const MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION = {
  id: "model.write-requirements",
  version: "2",
} as const;

export interface TracedRequirementSourceDeclaration {
  readonly requirementId: string;
  readonly sourceItemId: string;
  readonly declaredThreshold: {
    readonly value: number;
    readonly unit: string;
  };
  readonly transformation: UnitNormalisationLabel | "identity";
}

export interface TracedRequirementsProposal extends RequirementsProposal {
  readonly briefSource: {
    readonly basis: EngineeringApprovedBriefBasis;
    readonly briefContentFingerprint: ContentFingerprint;
    readonly containerSourceItemId: string;
    readonly requirements: readonly TracedRequirementSourceDeclaration[];
  };
}

const SOURCE_PARAMETER_KEYS = [
  "requirements.sourceProjectId",
  "requirements.sourceProjectSnapshotId",
  "requirements.sourceProjectRevision",
  "requirements.sourceBriefId",
  "requirements.sourceBriefSnapshotId",
  "requirements.sourceBriefRevision",
  "requirements.sourceBriefFingerprint",
  "requirements.sourceBriefContentFingerprint",
  "requirements.containerSourceItemId",
] as const;

type SourceParameterKey = (typeof SOURCE_PARAMETER_KEYS)[number];

const SOURCE_PARAMETER_KEY_SET: ReadonlySet<string> = new Set(
  SOURCE_PARAMETER_KEYS,
);

const TRACED_REQUIREMENT_KEY = new RegExp(
  `^requirement\\.(${PROPOSAL_PARAMETER_SLUG_BODY})\\.(sourceItemId|declaredThreshold)$`,
);

const SHA256_PREFIXED = /^sha256:([a-f0-9]{64})$/;

interface RequirementSourceFields {
  sourceItemId?: EngineeringDecisionProposalParameter;
  declaredThreshold?: EngineeringDecisionProposalParameter;
}

/**
 * Parse the @1 scalar grammar plus mandatory brief-source identity into a
 * typed `TracedRequirementsProposal`.
 *
 * Fail-closed: unknown provenance key, duplicate full key, missing or
 * malformed reference, orphan source declaration, or normalisation mismatch
 * throws TypeError. Scalar grammar failures remain
 * `RequirementsProposalParseError`.
 */
export function parseTracedRequirementsProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): TracedRequirementsProposal {
  if (!Array.isArray(parameters)) {
    throw new TypeError("Traced requirements parameters must be an array.");
  }

  const seenKeys = new Set<string>();
  const sourceParameters = new Map<
    SourceParameterKey,
    EngineeringDecisionProposalParameter
  >();
  const sourceBySlug = new Map<string, RequirementSourceFields>();
  const legacy: EngineeringDecisionProposalParameter[] = [];

  for (const parameter of parameters) {
    closedRecord(parameter, ["key", "label", "value", "unit"], [
      "key",
      "label",
      "value",
    ], "Traced requirements parameter");
    nonEmptyText(parameter.label, "Traced requirements parameter label");
    if (typeof parameter.key !== "string") {
      throw new TypeError("Each traced requirements parameter key must be a string.");
    }
    if (seenKeys.has(parameter.key)) {
      throw new TypeError(
        `Traced requirements parameter "${parameter.key}" is duplicated.`,
      );
    }
    seenKeys.add(parameter.key);

    if (SOURCE_PARAMETER_KEY_SET.has(parameter.key)) {
      sourceParameters.set(parameter.key as SourceParameterKey, parameter);
      continue;
    }

    const traced = TRACED_REQUIREMENT_KEY.exec(parameter.key);
    if (traced) {
      const slug = traced[1]!;
      const field = traced[2] as keyof RequirementSourceFields;
      const entry = sourceBySlug.get(slug) ?? {};
      entry[field] = parameter;
      sourceBySlug.set(slug, entry);
      continue;
    }

    legacy.push(parameter);
  }

  const basis: EngineeringApprovedBriefBasis = {
    kind: "approved-brief",
    projectId: requireMetadataId(
      sourceParameters,
      "requirements.sourceProjectId",
    ),
    projectSnapshotId: requireMetadataId(
      sourceParameters,
      "requirements.sourceProjectSnapshotId",
    ),
    projectRevision: requireMetadataPositiveInteger(
      sourceParameters,
      "requirements.sourceProjectRevision",
    ),
    briefId: requireMetadataId(sourceParameters, "requirements.sourceBriefId"),
    briefSnapshotId: requireMetadataId(
      sourceParameters,
      "requirements.sourceBriefSnapshotId",
    ),
    briefRevision: requireMetadataPositiveInteger(
      sourceParameters,
      "requirements.sourceBriefRevision",
    ),
    approvedBriefFingerprint: requireMetadataFingerprint(
      sourceParameters,
      "requirements.sourceBriefFingerprint",
    ),
  };
  const briefContentFingerprint = requireMetadataFingerprint(
    sourceParameters,
    "requirements.sourceBriefContentFingerprint",
  );
  const containerSourceItemId = requireMetadataId(
    sourceParameters,
    "requirements.containerSourceItemId",
  );

  const proposal = parseRequirementsProposalParameters(legacy);
  const tracedRequirements: TracedRequirementSourceDeclaration[] = [];
  const usedSlugs = new Set<string>();

  for (const entry of proposal.requirements) {
    const source = sourceBySlug.get(entry.slug);
    if (!source?.sourceItemId) {
      throw new TypeError(`requirement.${entry.slug}.sourceItemId is required.`);
    }
    if (!source.declaredThreshold) {
      throw new TypeError(
        `requirement.${entry.slug}.declaredThreshold is required.`,
      );
    }
    usedSlugs.add(entry.slug);
    tracedRequirements.push(
      parseRequirementSourceDeclaration(entry, source),
    );
  }

  for (const slug of sourceBySlug.keys()) {
    if (!usedSlugs.has(slug)) {
      throw new TypeError(
        `requirement.${slug} source declaration is not attached to a parsed requirement.`,
      );
    }
  }

  return deepFreeze({
    containerComponent: proposal.containerComponent,
    partDefName: proposal.partDefName,
    requirements: proposal.requirements,
    briefSource: {
      basis,
      briefContentFingerprint,
      containerSourceItemId,
      requirements: tracedRequirements,
    },
  });
}

/**
 * Encode a traced proposal back into the production flat grammar. The result
 * round-trips through `parseTracedRequirementsProposalParameters`.
 */
export function tracedRequirementsProposalParameters(
  proposal: TracedRequirementsProposal,
): readonly EngineeringDecisionProposalParameter[] {
  if (proposal.briefSource.requirements.length !== proposal.requirements.length) {
    throw new TypeError(
      "Traced requirements source declarations must match parsed requirements.",
    );
  }

  const parameters: EngineeringDecisionProposalParameter[] = [
    param("requirements.containerComponent", proposal.containerComponent),
    param("requirements.sourceProjectId", proposal.briefSource.basis.projectId),
    param(
      "requirements.sourceProjectSnapshotId",
      proposal.briefSource.basis.projectSnapshotId,
    ),
    param(
      "requirements.sourceProjectRevision",
      proposal.briefSource.basis.projectRevision,
    ),
    param("requirements.sourceBriefId", proposal.briefSource.basis.briefId),
    param(
      "requirements.sourceBriefSnapshotId",
      proposal.briefSource.basis.briefSnapshotId,
    ),
    param(
      "requirements.sourceBriefRevision",
      proposal.briefSource.basis.briefRevision,
    ),
    param(
      "requirements.sourceBriefFingerprint",
      prefixedFingerprint(proposal.briefSource.basis.approvedBriefFingerprint),
    ),
    param(
      "requirements.sourceBriefContentFingerprint",
      prefixedFingerprint(proposal.briefSource.briefContentFingerprint),
    ),
    param(
      "requirements.containerSourceItemId",
      proposal.briefSource.containerSourceItemId,
    ),
  ];

  for (const [index, entry] of proposal.requirements.entries()) {
    const source = proposal.briefSource.requirements[index];
    if (!source) {
      throw new TypeError(
        `Traced requirements source declaration for "${entry.metric}" is missing.`,
      );
    }
    if (source.requirementId !== entry.metric) {
      throw new TypeError(
        `Traced requirementId must equal metric "${entry.metric}".`,
      );
    }
    parameters.push(
      param(`requirement.${entry.slug}.name`, entry.name),
      param(`requirement.${entry.slug}.metric`, entry.metric),
      param(`requirement.${entry.slug}.operator`, entry.operator),
      param(
        `requirement.${entry.slug}.threshold`,
        entry.threshold.value,
        entry.threshold.unit,
      ),
      param(`requirement.${entry.slug}.sourceItemId`, source.sourceItemId),
      param(
        `requirement.${entry.slug}.declaredThreshold`,
        source.declaredThreshold.value,
        source.declaredThreshold.unit,
      ),
    );
  }

  return deepFreeze(parameters);
}

function parseRequirementSourceDeclaration(
  entry: RequirementEntry,
  source: RequirementSourceFields,
): TracedRequirementSourceDeclaration {
  const sourceItemParam = source.sourceItemId!;
  const declaredParam = source.declaredThreshold!;
  rejectUnit(sourceItemParam);
  const sourceItemId = safeId(sourceItemParam.value, sourceItemParam.key);
  const declaredThreshold = parseDeclaredThreshold(declaredParam);
  const normalised = normaliseThreshold(
    declaredThreshold.value,
    declaredThreshold.unit,
  );
  if (
    !Object.is(normalised.value, entry.threshold.value) ||
    normalised.unit !== entry.threshold.unit
  ) {
    throw new TypeError(
      `requirement.${entry.slug}.declaredThreshold does not normalise to the canonical threshold.`,
    );
  }
  return {
    requirementId: entry.metric,
    sourceItemId,
    declaredThreshold,
    transformation: normalised.transformation,
  };
}

function parseDeclaredThreshold(
  parameter: EngineeringDecisionProposalParameter,
): { readonly value: number; readonly unit: string } {
  const value = finite(parameter.value, parameter.key);
  if (typeof parameter.unit !== "string" || parameter.unit.trim() === "") {
    throw new TypeError(`${parameter.key} must declare a nonempty unit.`);
  }
  return { value, unit: parameter.unit };
}

function requireMetadataId(
  values: ReadonlyMap<SourceParameterKey, EngineeringDecisionProposalParameter>,
  key: SourceParameterKey,
): string {
  const parameter = requireSourceParameter(values, key);
  rejectUnit(parameter);
  return safeId(parameter.value, parameter.key);
}

function requireMetadataPositiveInteger(
  values: ReadonlyMap<SourceParameterKey, EngineeringDecisionProposalParameter>,
  key: SourceParameterKey,
): number {
  const parameter = requireSourceParameter(values, key);
  rejectUnit(parameter);
  return positiveInteger(parameter.value, parameter.key);
}

function requireMetadataFingerprint(
  values: ReadonlyMap<SourceParameterKey, EngineeringDecisionProposalParameter>,
  key: SourceParameterKey,
): ContentFingerprint {
  const parameter = requireSourceParameter(values, key);
  rejectUnit(parameter);
  return parsePrefixedFingerprint(parameter.value, parameter.key);
}

function requireSourceParameter(
  values: ReadonlyMap<SourceParameterKey, EngineeringDecisionProposalParameter>,
  key: SourceParameterKey,
): EngineeringDecisionProposalParameter {
  const parameter = values.get(key);
  if (!parameter) {
    throw new TypeError(`${key} is required.`);
  }
  return parameter;
}

function parsePrefixedFingerprint(
  value: unknown,
  path: string,
): ContentFingerprint {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be sha256:<64 lowercase hex>.`);
  }
  const match = SHA256_PREFIXED.exec(value);
  if (!match) {
    throw new TypeError(`${path} must be sha256:<64 lowercase hex>.`);
  }
  return { algorithm: "sha256", digest: match[1]! };
}

function prefixedFingerprint(fingerprint: ContentFingerprint): string {
  return `sha256:${fingerprint.digest}`;
}

function rejectUnit(parameter: EngineeringDecisionProposalParameter): void {
  if (parameter.unit !== undefined) {
    throw new TypeError(`${parameter.key} must not carry a unit.`);
  }
}

function param(
  key: string,
  value: string | number | boolean,
  unit?: string,
): EngineeringDecisionProposalParameter {
  return unit === undefined ? { key, label: key, value } : {
    key,
    label: key,
    value,
    unit,
  };
}
