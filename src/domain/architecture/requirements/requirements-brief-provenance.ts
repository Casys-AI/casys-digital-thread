/**
 * Exact reviewed-brief provenance for a traced scalar-requirements proposal.
 *
 * The builder reopens one already-typed `ProjectBriefRevision` and records the
 * immutable brief items named by the proposal. It never parses prose, never
 * asserts that a threshold restates a clause, and performs no I/O. The parser
 * only admits a closed document; it cannot attest human approval against
 * storage.
 */

import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import {
  normaliseThreshold,
  UNIT_NORMALISATION,
  type UnitNormalisationLabel,
} from "../../kernel/unit-normalisation.ts";
import type { EngineeringApprovedBriefBasis } from "../../project/engineering-project.ts";
import {
  isProjectBriefGateKind,
  type ProjectBriefItem,
  type ProjectBriefItemKind,
  type ProjectBriefRevision,
  type ProjectBriefSourceKind,
  type ProjectBriefSourceRef,
  type ProjectBriefVerificationAuthority,
} from "../../project/project-brief.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import type { TracedRequirementsProposal } from "./requirements-traced-proposal.ts";

export const REQUIREMENTS_BRIEF_PROVENANCE_SCHEMA =
  "requirements-brief-provenance/1.0" as const;

export interface RequirementsBriefProvenance {
  readonly schemaVersion: typeof REQUIREMENTS_BRIEF_PROVENANCE_SCHEMA;
  readonly briefBasis: EngineeringApprovedBriefBasis;
  readonly briefContentFingerprint: ContentFingerprint;
  readonly container: { readonly sourceItem: ProjectBriefItem };
  readonly requirements: readonly {
    readonly requirementId: string;
    readonly sourceItem: ProjectBriefItem;
    readonly declaredThreshold: { readonly value: number; readonly unit: string };
    readonly transformation: UnitNormalisationLabel | "identity";
  }[];
}

const PATH = "$requirementsBriefProvenance";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_REQUIREMENTS = 128;
const MAX_SOURCE_REFS = 32;
const MAX_DEPENDENCIES = 64;

const PROJECT_BRIEF_ITEM_KINDS: readonly ProjectBriefItemKind[] = [
  "objective",
  "primary-user",
  "mission-scenario",
  "operating-environment",
  "success-criterion",
  "constraint",
  "exclusion",
  "intended-market",
  "manufacturing-jurisdiction",
  "operating-jurisdiction",
  "compliance-target",
  "verification-activity",
  "manufacturing-evidence",
  "observed-fact",
  "assumption",
  "open-question",
  "proposed-decision",
];

const PROJECT_BRIEF_SOURCE_KINDS: readonly ProjectBriefSourceKind[] = [
  "intent",
  "answer",
  "tool",
  "document",
  "expert",
];

const UNIT_NORMALISATION_LABELS: ReadonlySet<string> = new Set(
  [...UNIT_NORMALISATION.values()].map((entry) => entry.label),
);

export async function buildRequirementsBriefProvenance(input: {
  brief: ProjectBriefRevision;
  basis: EngineeringApprovedBriefBasis;
  proposal: TracedRequirementsProposal;
}): Promise<RequirementsBriefProvenance> {
  const { brief, basis, proposal } = input;
  if (deterministicJson(basis) !== deterministicJson(proposal.briefSource.basis)) {
    throw new TypeError(
      "The supplied brief basis does not equal the signed approved brief basis.",
    );
  }
  if (
    brief.briefId !== basis.briefId ||
    brief.id !== basis.briefSnapshotId ||
    brief.revision !== basis.briefRevision
  ) {
    throw new TypeError(
      "The approved brief identity does not match the signed brief basis.",
    );
  }
  const contentFingerprint = await sha256Fingerprint(brief);
  if (
    !fingerprintsEqual(
      contentFingerprint,
      proposal.briefSource.briefContentFingerprint,
    )
  ) {
    throw new TypeError(
      "The approved brief does not match the signed brief content fingerprint.",
    );
  }

  const container = uniqueBriefItem(
    brief,
    proposal.briefSource.containerSourceItemId,
    `${PATH}.container`,
  );
  assertContainerSource(container, `${PATH}.container.sourceItem`);

  const declarations = declarationsByCanonicalMetric(proposal);
  const requirements = proposal.requirements.map((entry, index) => {
    const declaration = declarations.get(entry.metric);
    if (!declaration) {
      throw new TypeError(
        `Canonical requirement metric "${entry.metric}" has no source declaration.`,
      );
    }
    const path = `${PATH}.requirements[${index}]`;
    const sourceItem = uniqueBriefItem(brief, declaration.sourceItemId, path);
    assertRequirementSource(sourceItem, `${path}.sourceItem`);
    assertNormalisation(entry, declaration, path);
    return {
      requirementId: entry.metric,
      sourceItem: structuredClone(sourceItem),
      declaredThreshold: {
        value: declaration.declaredThreshold.value,
        unit: declaration.declaredThreshold.unit,
      },
      transformation: declaration.transformation,
    };
  });

  // Apply the same closed shape and limits before a writer can claim/dispatch,
  // not only when it reopens the completed capture after the native write.
  return parseRequirementsBriefProvenance({
    schemaVersion: REQUIREMENTS_BRIEF_PROVENANCE_SCHEMA,
    briefBasis: structuredClone(basis),
    briefContentFingerprint: structuredClone(
      proposal.briefSource.briefContentFingerprint,
    ),
    container: { sourceItem: structuredClone(container) },
    requirements,
  });
}

export function parseRequirementsBriefProvenance(
  value: unknown,
): RequirementsBriefProvenance {
  const root = exactRecord(value, [
    "schemaVersion",
    "briefBasis",
    "briefContentFingerprint",
    "container",
    "requirements",
  ], PATH);
  literalValue(
    root.schemaVersion,
    REQUIREMENTS_BRIEF_PROVENANCE_SCHEMA,
    `${PATH}.schemaVersion`,
  );
  const container = exactRecord(root.container, ["sourceItem"], `${PATH}.container`);
  const requirementValues = boundedArray(
    nonEmptyArray(root.requirements, `${PATH}.requirements`),
    `${PATH}.requirements`,
    1,
    MAX_REQUIREMENTS,
  );
  const requirements = requirementValues.map((item, index) =>
    parseRequirementOrigin(item, `${PATH}.requirements[${index}]`)
  );
  rejectDuplicates(
    requirements.map((item) => item.requirementId),
    `${PATH}.requirements.requirementId`,
  );
  const provenance = deepFreeze({
    schemaVersion: REQUIREMENTS_BRIEF_PROVENANCE_SCHEMA,
    briefBasis: parseApprovedBriefBasis(root.briefBasis, `${PATH}.briefBasis`),
    briefContentFingerprint: parseFingerprint(
      root.briefContentFingerprint,
      `${PATH}.briefContentFingerprint`,
    ),
    container: {
      sourceItem: parseProjectBriefItem(
        container.sourceItem,
        `${PATH}.container.sourceItem`,
      ),
    },
    requirements,
  });
  assertContainerSource(
    provenance.container.sourceItem,
    `${PATH}.container.sourceItem`,
  );
  for (const [index, requirement] of provenance.requirements.entries()) {
    assertRequirementSource(
      requirement.sourceItem,
      `${PATH}.requirements[${index}].sourceItem`,
    );
  }
  return provenance;
}

function declarationsByCanonicalMetric(
  proposal: TracedRequirementsProposal,
): Map<string, TracedRequirementsProposal["briefSource"]["requirements"][number]> {
  const declarations = proposal.briefSource.requirements;
  if (declarations.length !== proposal.requirements.length) {
    throw new TypeError(
      "The traced source declarations must name each canonical requirement metric exactly once.",
    );
  }
  const byMetric = new Map<
    string,
    TracedRequirementsProposal["briefSource"]["requirements"][number]
  >();
  for (const declaration of declarations) {
    if (byMetric.has(declaration.requirementId)) {
      throw new TypeError(
        `Duplicate requirementId "${declaration.requirementId}".`,
      );
    }
    byMetric.set(declaration.requirementId, declaration);
  }
  for (const entry of proposal.requirements) {
    if (!byMetric.has(entry.metric)) {
      throw new TypeError(
        `Canonical requirement metric "${entry.metric}" has no source declaration.`,
      );
    }
  }
  if (byMetric.size !== proposal.requirements.length) {
    throw new TypeError(
      "The traced source declarations must name each canonical requirement metric exactly once.",
    );
  }
  return byMetric;
}

function uniqueBriefItem(
  brief: ProjectBriefRevision,
  itemId: string,
  path: string,
): ProjectBriefItem {
  const matches = brief.items.filter((item) => item.id === itemId);
  if (matches.length === 0) {
    throw new TypeError(
      `${path} names brief item "${itemId}", which the approved brief does not contain.`,
    );
  }
  if (matches.length > 1) {
    throw new TypeError(
      `${path} names brief item "${itemId}", which is not unique in the approved brief.`,
    );
  }
  return matches[0]!;
}

function assertRequirementSource(item: ProjectBriefItem, path: string): void {
  if (!isProjectBriefGateKind(item.kind)) {
    throw new TypeError(
      `${path} has kind ${item.kind}; only a success-criterion or a verification-activity states a normative requirement.`,
    );
  }
  assertSourced(item, path);
}

function assertContainerSource(item: ProjectBriefItem, path: string): void {
  if (item.kind === "exclusion" || item.kind === "open-question") {
    throw new TypeError(
      `${path} has kind ${item.kind}; an exclusion or an open-question cannot state the requirements container.`,
    );
  }
  assertSourced(item, path);
}

function assertSourced(item: ProjectBriefItem, path: string): void {
  if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0) {
    throw new TypeError(`${path} carries no source reference.`);
  }
}

function assertNormalisation(
  entry: TracedRequirementsProposal["requirements"][number],
  declaration: TracedRequirementsProposal["briefSource"]["requirements"][number],
  path: string,
): void {
  const normalised = normaliseThreshold(
    declaration.declaredThreshold.value,
    declaration.declaredThreshold.unit,
  );
  if (
    !Object.is(normalised.value, entry.threshold.value) ||
    normalised.unit !== entry.threshold.unit ||
    normalised.transformation !== declaration.transformation
  ) {
    throw new TypeError(
      `${path} declared threshold normalisation does not match the canonical requirement "${entry.metric}".`,
    );
  }
}

function parseRequirementOrigin(
  value: unknown,
  path: string,
): RequirementsBriefProvenance["requirements"][number] {
  const root = exactRecord(value, [
    "requirementId",
    "sourceItem",
    "declaredThreshold",
    "transformation",
  ], path);
  const threshold = exactRecord(
    root.declaredThreshold,
    ["value", "unit"],
    `${path}.declaredThreshold`,
  );
  return {
    requirementId: safeId(root.requirementId, `${path}.requirementId`),
    sourceItem: parseProjectBriefItem(root.sourceItem, `${path}.sourceItem`),
    declaredThreshold: {
      value: finite(threshold.value, `${path}.declaredThreshold.value`),
      unit: nonEmptyText(threshold.unit, `${path}.declaredThreshold.unit`),
    },
    transformation: parseTransformation(
      root.transformation,
      `${path}.transformation`,
    ),
  };
}

function parseProjectBriefItem(value: unknown, path: string): ProjectBriefItem {
  const root = closedRecord(
    value,
    [
      "id",
      "kind",
      "statement",
      "sourceRefs",
      "owner",
      "reviewTrigger",
      "dependsOnItemIds",
      "verificationAuthority",
    ],
    ["id", "kind", "statement", "sourceRefs"],
    path,
  );
  const item: {
    id: string;
    kind: ProjectBriefItemKind;
    statement: string;
    sourceRefs: readonly ProjectBriefSourceRef[];
    owner?: string;
    reviewTrigger?: string;
    dependsOnItemIds?: readonly string[];
    verificationAuthority?: ProjectBriefVerificationAuthority;
  } = {
    id: safeId(root.id, `${path}.id`),
    kind: oneOf(root.kind, PROJECT_BRIEF_ITEM_KINDS, `${path}.kind`),
    statement: nonEmptyText(root.statement, `${path}.statement`),
    sourceRefs: boundedArray(
      nonEmptyArray(root.sourceRefs, `${path}.sourceRefs`),
      `${path}.sourceRefs`,
      1,
      MAX_SOURCE_REFS,
    ).map((source, index) => parseSourceRef(source, `${path}.sourceRefs[${index}]`)),
  };
  if (root.owner !== undefined) {
    item.owner = nonEmptyText(root.owner, `${path}.owner`);
  }
  if (root.reviewTrigger !== undefined) {
    item.reviewTrigger = nonEmptyText(root.reviewTrigger, `${path}.reviewTrigger`);
  }
  if (root.dependsOnItemIds !== undefined) {
    const dependsOnItemIds = boundedArray(
      arrayOf(root.dependsOnItemIds, `${path}.dependsOnItemIds`),
      `${path}.dependsOnItemIds`,
      0,
      MAX_DEPENDENCIES,
    ).map((dependency, index) =>
      safeId(dependency, `${path}.dependsOnItemIds[${index}]`)
    );
    rejectDuplicates(dependsOnItemIds, `${path}.dependsOnItemIds`);
    item.dependsOnItemIds = dependsOnItemIds;
  }
  if (root.verificationAuthority !== undefined) {
    item.verificationAuthority = parseVerificationAuthority(
      root.verificationAuthority,
      `${path}.verificationAuthority`,
    );
  }
  return item;
}

function parseSourceRef(value: unknown, path: string): ProjectBriefSourceRef {
  const root = exactRecord(value, ["kind", "reference"], path);
  return {
    kind: oneOf(root.kind, PROJECT_BRIEF_SOURCE_KINDS, `${path}.kind`),
    reference: nonEmptyText(root.reference, `${path}.reference`),
  };
}

function parseVerificationAuthority(
  value: unknown,
  path: string,
): ProjectBriefVerificationAuthority {
  const root = exactRecord(value, ["id", "version"], path);
  return {
    id: safeId(root.id, `${path}.id`),
    version: safeVersion(root.version, `${path}.version`),
  };
}

function parseApprovedBriefBasis(
  value: unknown,
  path: string,
): EngineeringApprovedBriefBasis {
  const root = exactRecord(value, [
    "kind",
    "projectId",
    "projectSnapshotId",
    "projectRevision",
    "briefId",
    "briefSnapshotId",
    "briefRevision",
    "approvedBriefFingerprint",
  ], path);
  literalValue(root.kind, "approved-brief", `${path}.kind`);
  return {
    kind: "approved-brief",
    projectId: safeId(root.projectId, `${path}.projectId`),
    projectSnapshotId: safeId(root.projectSnapshotId, `${path}.projectSnapshotId`),
    projectRevision: positiveInteger(root.projectRevision, `${path}.projectRevision`),
    briefId: safeId(root.briefId, `${path}.briefId`),
    briefSnapshotId: safeId(root.briefSnapshotId, `${path}.briefSnapshotId`),
    briefRevision: positiveInteger(root.briefRevision, `${path}.briefRevision`),
    approvedBriefFingerprint: parseFingerprint(
      root.approvedBriefFingerprint,
      `${path}.approvedBriefFingerprint`,
    ),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (typeof fingerprint.digest !== "string" || !SHA256_HEX.test(fingerprint.digest)) {
    throw new TypeError(`${path}.digest must be canonical lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function parseTransformation(
  value: unknown,
  path: string,
): UnitNormalisationLabel | "identity" {
  if (value === "identity") return "identity";
  if (typeof value === "string" && UNIT_NORMALISATION_LABELS.has(value)) {
    return value as UnitNormalisationLabel;
  }
  throw new TypeError(
    `${path} must be a native unit-normalisation label or "identity".`,
  );
}

function boundedArray(
  value: readonly unknown[],
  path: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (value.length < minimum || value.length > maximum) {
    throw new TypeError(
      `${path} must contain between ${minimum} and ${maximum} entries.`,
    );
  }
  return [...value];
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
