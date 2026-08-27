/**
 * Pure, bounded compiler from explicit brief declarations to the existing
 * production proposal grammars.
 *
 * This spike performs no NLP and no provider I/O. Every emitted parameter is
 * copied from one exact declaration. The sole value transformation is the
 * explicit, code-owned MPa -> Pa conversion required by the current
 * requirements proposal grammar.
 */

import { ProjectBriefSourceAnalyzer } from "../../src/adapters/compile/source/project-brief-source-analyzer.ts";
import type { OracleRequirement } from "../../src/domain/kernel/proof-case.ts";
import { renderTargetedOracleRequirementsSysml } from "../../src/domain/kernel/proof-case.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../src/domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";
import type { EngineeringDecisionProposalParameter } from "../../src/domain/project/engineering-project.ts";
import type {
  ProjectBriefRevision,
  ProjectBriefSourceRef,
} from "../../src/domain/project/project-brief.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
  type RenderedArchitectureSysml,
} from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  parseRequirementsProposalParameters,
  requirementEntriesToOracleRequirements,
  type RequirementsProposal,
} from "../../src/domain/architecture/requirements/requirements-proposal.ts";
import { INTEGRATED_SUPPORT_BLOCK_BRIEF } from "./integrated-fixture.ts";

export const EXPLICIT_BRIEF_DECLARATIONS_SCHEMA =
  "spike-only/explicit-brief-declarations/0.1" as const;
export const BRIEF_PROPOSAL_COMPILATION_SCHEMA =
  "spike-only/brief-proposal-compilation/0.1" as const;

const DECLARATION_FIELDS = [
  "architecture.package",
  "system.name",
  "component.support.name",
  "component.support.usage",
  "requirements.containerComponent",
  "requirement.displacement.name",
  "requirement.displacement.metric",
  "requirement.displacement.operator",
  "requirement.displacement.threshold",
  "requirement.vonMises.name",
  "requirement.vonMises.metric",
  "requirement.vonMises.operator",
  "requirement.vonMises.threshold",
] as const;

export type ExplicitBriefField = typeof DECLARATION_FIELDS[number];

export interface ExplicitBriefFieldDeclaration {
  readonly id: string;
  readonly field: ExplicitBriefField;
  readonly value: string | number;
  /** Null is explicit absence and therefore unresolved for threshold fields. */
  readonly unit: string | null;
  readonly dependsOnDeclarationIds: readonly string[];
  readonly sourceItemId: string;
  readonly sourceRefs: readonly ProjectBriefSourceRef[];
}

export interface ExplicitBriefDeclarations {
  readonly schemaVersion: typeof EXPLICIT_BRIEF_DECLARATIONS_SCHEMA;
  readonly briefSource: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly brief: ProjectBriefRevision;
  readonly declarations: readonly ExplicitBriefFieldDeclaration[];
}

export interface ProposalFieldProvenance {
  readonly proposalField: ExplicitBriefField;
  readonly declarationId: string;
  readonly dependsOnDeclarationIds: readonly string[];
  readonly sourceItemId: string;
  readonly sourceRefs: readonly ProjectBriefSourceRef[];
  readonly transformation: "identity" | "MPa-to-Pa";
}

export type BriefProposalDiagnosticCode =
  | "ambiguous-declaration"
  | "brief-item-binding-mismatch"
  | "brief-item-content-mismatch"
  | "brief-item-dependency-mismatch"
  | "brief-item-kind-mismatch"
  | "brief-item-source-mismatch"
  | "brief-source-mismatch"
  | "brief-source-rejected"
  | "missing-declaration"
  | "missing-explicit-dependency"
  | "missing-source-ref"
  | "proposal-grammar-rejected"
  | "unknown-dependency"
  | "unsupported-spike-value"
  | "unsupported-unit";

export interface BriefProposalDiagnostic {
  readonly code: BriefProposalDiagnosticCode;
  readonly field: ExplicitBriefField | "brief";
  readonly declarationIds: readonly string[];
  readonly message: string;
}

export interface CompiledArchitectureProposal {
  readonly operation: typeof MODEL_WRITE_ARCHITECTURE_OPERATION;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
  readonly rendered: RenderedArchitectureSysml;
}

export interface CompiledRequirementsProposal {
  readonly operation: typeof MODEL_WRITE_REQUIREMENTS_OPERATION;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
  readonly parsed: RequirementsProposal;
  readonly oracleRequirements: readonly OracleRequirement[];
  readonly renderedSysml: string;
}

export interface BriefProposalCompilation {
  readonly schemaVersion: typeof BRIEF_PROPOSAL_COMPILATION_SCHEMA;
  readonly authority: "proposal-only-human-review-required";
  readonly briefSource: ExplicitBriefDeclarations["briefSource"];
  readonly status: "resolved" | "unresolved";
  readonly diagnostics: readonly BriefProposalDiagnostic[];
  readonly fieldProvenance: readonly ProposalFieldProvenance[];
  readonly architecture?: CompiledArchitectureProposal;
  readonly requirements?: CompiledRequirementsProposal;
  readonly compilationFingerprint: ContentFingerprint;
}

const LABELS: Readonly<Record<ExplicitBriefField, string>> = {
  "architecture.package": "Architecture package",
  "system.name": "System",
  "component.support.name": "Support block definition",
  "component.support.usage": "Support block usage",
  "requirements.containerComponent": "Requirements target component",
  "requirement.displacement.name": "Displacement requirement",
  "requirement.displacement.metric": "Displacement metric",
  "requirement.displacement.operator": "Displacement operator",
  "requirement.displacement.threshold": "Maximum displacement",
  "requirement.vonMises.name": "Von Mises requirement",
  "requirement.vonMises.metric": "Von Mises metric",
  "requirement.vonMises.operator": "Von Mises operator",
  "requirement.vonMises.threshold": "Maximum von Mises stress",
};

/** Explicit fixture-only semantic mapping; statements are never interpreted. */
const FIELD_TO_BRIEF_ITEM_ID: Readonly<Record<ExplicitBriefField, string>> = {
  "architecture.package": "architecture",
  "system.name": "system",
  "component.support.name": "support-block",
  "component.support.usage": "support-block",
  "requirements.containerComponent": "mechanical-verification",
  "requirement.displacement.name": "max-displacement",
  "requirement.displacement.metric": "max-displacement",
  "requirement.displacement.operator": "max-displacement",
  "requirement.displacement.threshold": "max-displacement",
  "requirement.vonMises.name": "max-von-mises",
  "requirement.vonMises.metric": "max-von-mises",
  "requirement.vonMises.operator": "max-von-mises",
  "requirement.vonMises.threshold": "max-von-mises",
};

const REQUIRED_SPIKE_VALUES: Readonly<
  Partial<Record<ExplicitBriefField, string | number>>
> = {
  "component.support.name": "SupportBlock",
  "component.support.usage": "supportBlock",
  "requirements.containerComponent": "SupportBlock",
  "requirement.displacement.metric": "support_block_max_displacement",
  "requirement.displacement.operator": "<=",
  "requirement.displacement.threshold": 2,
  "requirement.vonMises.metric": "support_block_max_von_mises",
  "requirement.vonMises.operator": "<=",
  "requirement.vonMises.threshold": 100,
};

const ARCHITECTURE_FIELDS: readonly ExplicitBriefField[] = DECLARATION_FIELDS.slice(
  0,
  4,
);
const REQUIREMENTS_FIELDS: readonly ExplicitBriefField[] = DECLARATION_FIELDS.slice(4);

/**
 * Compile exact declarations into server-parseable proposal parameters.
 *
 * Missing, duplicate, unreferenced, dependency-free requirement fields and
 * unsupported units produce an `unresolved` document with no proposals. The
 * function never resolves approval or claims that a proposal was accepted.
 */
export async function compileExplicitBriefProposals(
  input: unknown,
): Promise<BriefProposalCompilation> {
  const parsed = parseInput(input);
  const byField = new Map<ExplicitBriefField, ExplicitBriefFieldDeclaration[]>();
  for (const field of DECLARATION_FIELDS) byField.set(field, []);
  for (const declaration of parsed.declarations) {
    byField.get(declaration.field)!.push(declaration);
  }

  const diagnostics: BriefProposalDiagnostic[] = [];
  const validatedBrief = await validateExactBrief(parsed, diagnostics);
  const exactDeclarations = new Map<
    ExplicitBriefField,
    ExplicitBriefFieldDeclaration
  >();
  for (const field of DECLARATION_FIELDS) {
    const candidates = byField.get(field)!;
    if (candidates.length === 0) {
      diagnostics.push(diagnostic(
        "missing-declaration",
        field,
        [],
        `No explicit brief declaration exists for ${field}.`,
      ));
      continue;
    }
    if (candidates.length !== 1) {
      diagnostics.push(diagnostic(
        "ambiguous-declaration",
        field,
        candidates.map((candidate) => candidate.id).sort(),
        `More than one explicit brief declaration exists for ${field}.`,
      ));
      continue;
    }
    exactDeclarations.set(field, candidates[0]!);
  }

  const supportDeclarationId = exactDeclarations.get("component.support.name")?.id;
  const knownDeclarationIds = new Set(
    parsed.declarations.map((declaration) => declaration.id),
  );
  for (const declaration of parsed.declarations) {
    const unknownDependencyIds = declaration.dependsOnDeclarationIds.filter(
      (dependencyId) => !knownDeclarationIds.has(dependencyId),
    ).sort();
    if (unknownDependencyIds.length !== 0) {
      diagnostics.push(diagnostic(
        "unknown-dependency",
        declaration.field,
        [declaration.id],
        `${declaration.field} names unknown dependencies: ${
          unknownDependencyIds.join(", ")
        }.`,
      ));
    }
  }
  for (const [field, declaration] of exactDeclarations) {
    if (declaration.sourceRefs.length === 0) {
      diagnostics.push(diagnostic(
        "missing-source-ref",
        field,
        [declaration.id],
        `${field} has no explicit source reference.`,
      ));
    }
    if (
      (field === "requirements.containerComponent" ||
        field.startsWith("requirement.")) &&
      supportDeclarationId !== undefined &&
      !declaration.dependsOnDeclarationIds.includes(supportDeclarationId)
    ) {
      diagnostics.push(diagnostic(
        "missing-explicit-dependency",
        field,
        [declaration.id],
        `${field} must explicitly depend on the SupportBlock declaration.`,
      ));
    }
    const expected = REQUIRED_SPIKE_VALUES[field];
    if (expected !== undefined && declaration.value !== expected) {
      diagnostics.push(diagnostic(
        "unsupported-spike-value",
        field,
        [declaration.id],
        `${field} is outside the bounded SupportBlock spike declaration.`,
      ));
    }
    if (validatedBrief) {
      validateFieldBriefBinding(
        field,
        declaration,
        validatedBrief,
        diagnostics,
      );
    }
  }

  validateThresholdUnit(
    exactDeclarations.get("requirement.displacement.threshold"),
    "mm",
    diagnostics,
  );
  validateThresholdUnit(
    exactDeclarations.get("requirement.vonMises.threshold"),
    "MPa",
    diagnostics,
  );
  for (const [field, declaration] of exactDeclarations) {
    if (!field.endsWith(".threshold") && declaration.unit !== null) {
      diagnostics.push(diagnostic(
        "unsupported-unit",
        field,
        [declaration.id],
        `${field} must explicitly declare unit null.`,
      ));
    }
  }

  diagnostics.sort((left, right) =>
    left.field.localeCompare(right.field) || left.code.localeCompare(right.code)
  );

  if (diagnostics.length !== 0) {
    return await finalize({
      schemaVersion: BRIEF_PROPOSAL_COMPILATION_SCHEMA,
      authority: "proposal-only-human-review-required",
      briefSource: parsed.briefSource,
      status: "unresolved",
      diagnostics,
      fieldProvenance: [],
    });
  }

  const architectureParameters = ARCHITECTURE_FIELDS.map((field) =>
    parameter(exactDeclarations.get(field)!)
  );
  const requirementsParameters = REQUIREMENTS_FIELDS.map((field) =>
    parameter(exactDeclarations.get(field)!)
  );
  const stressThreshold = requirementsParameters.find((candidate) =>
    candidate.key === "requirement.vonMises.threshold"
  )!;
  requirementsParameters[requirementsParameters.indexOf(stressThreshold)] = {
    ...stressThreshold,
    value: Number(stressThreshold.value) * 1_000_000,
    unit: "Pa",
  };

  let compiledArchitecture: CompiledArchitectureProposal | undefined;
  let compiledRequirements: CompiledRequirementsProposal | undefined;
  try {
    const architecture = parseArchitectureProposalParameters(architectureParameters);
    compiledArchitecture = {
      operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
      parameters: architectureParameters,
      rendered: renderArchitectureSysmlWithManifest(architecture),
    };
  } catch {
    diagnostics.push(diagnostic(
      "proposal-grammar-rejected",
      "architecture.package",
      ARCHITECTURE_FIELDS.map((field) => exactDeclarations.get(field)!.id),
      "The production architecture proposal grammar or renderer rejected the explicit declarations.",
    ));
  }
  try {
    const requirements = parseRequirementsProposalParameters(requirementsParameters);
    const oracleRequirements = requirementEntriesToOracleRequirements(
      requirements.requirements,
    );
    compiledRequirements = {
      operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
      parameters: requirementsParameters,
      parsed: requirements,
      oracleRequirements,
      renderedSysml: renderTargetedOracleRequirementsSysml(
        requirements.partDefName,
        requirements.containerComponent,
        oracleRequirements,
      ),
    };
  } catch {
    diagnostics.push(diagnostic(
      "proposal-grammar-rejected",
      "requirements.containerComponent",
      REQUIREMENTS_FIELDS.map((field) => exactDeclarations.get(field)!.id),
      "The production requirements proposal grammar or renderer rejected the explicit declarations.",
    ));
  }

  if (diagnostics.length !== 0) {
    diagnostics.sort((left, right) =>
      left.field.localeCompare(right.field) || left.code.localeCompare(right.code)
    );
    return await finalize({
      schemaVersion: BRIEF_PROPOSAL_COMPILATION_SCHEMA,
      authority: "proposal-only-human-review-required",
      briefSource: parsed.briefSource,
      status: "unresolved",
      diagnostics,
      fieldProvenance: [],
    });
  }

  const fieldProvenance = DECLARATION_FIELDS.map((field) => {
    const declaration = exactDeclarations.get(field)!;
    return {
      proposalField: field,
      declarationId: declaration.id,
      dependsOnDeclarationIds: declaration.dependsOnDeclarationIds,
      sourceItemId: declaration.sourceItemId,
      sourceRefs: declaration.sourceRefs,
      transformation: field === "requirement.vonMises.threshold"
        ? "MPa-to-Pa" as const
        : "identity" as const,
    };
  });

  return await finalize({
    schemaVersion: BRIEF_PROPOSAL_COMPILATION_SCHEMA,
    authority: "proposal-only-human-review-required",
    briefSource: parsed.briefSource,
    status: "resolved",
    diagnostics: [],
    fieldProvenance,
    architecture: compiledArchitecture!,
    requirements: compiledRequirements!,
  });
}

async function finalize(
  draft: Omit<BriefProposalCompilation, "compilationFingerprint">,
): Promise<BriefProposalCompilation> {
  return deepFreeze({
    ...draft,
    compilationFingerprint: await sha256Fingerprint(draft),
  });
}

async function validateExactBrief(
  input: ExplicitBriefDeclarations,
  diagnostics: BriefProposalDiagnostic[],
): Promise<ProjectBriefRevision | undefined> {
  const sourceText = deterministicJson(input.brief);
  const bundle = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId: input.briefSource.id,
    role: "brief",
    language: "plain-text",
    sourceText,
  });
  if (bundle.policy.status !== "passed") {
    diagnostics.push(diagnostic(
      "brief-source-rejected",
      "brief",
      [],
      "The exact ProjectBrief source was rejected by the canonical brief analyzer.",
    ));
  }
  if (!fingerprintsEqual(bundle.source.fingerprint, input.briefSource.fingerprint)) {
    diagnostics.push(diagnostic(
      "brief-source-mismatch",
      "brief",
      [],
      "The exact ProjectBrief bytes do not match briefSource.fingerprint.",
    ));
  }
  return bundle.policy.status === "passed" ? input.brief : undefined;
}

function validateFieldBriefBinding(
  field: ExplicitBriefField,
  declaration: ExplicitBriefFieldDeclaration,
  brief: ProjectBriefRevision,
  diagnostics: BriefProposalDiagnostic[],
): void {
  const expectedItemId = FIELD_TO_BRIEF_ITEM_ID[field];
  if (declaration.sourceItemId !== expectedItemId) {
    diagnostics.push(diagnostic(
      "brief-item-binding-mismatch",
      field,
      [declaration.id],
      `${field} must bind to exact ProjectBrief item ${expectedItemId}.`,
    ));
    return;
  }
  const actual = brief.items.find((item) => item.id === expectedItemId);
  const canonical = INTEGRATED_SUPPORT_BLOCK_BRIEF.items.find((item) =>
    item.id === expectedItemId
  ) as ProjectBriefRevision["items"][number] | undefined;
  if (!actual || !canonical) {
    diagnostics.push(diagnostic(
      "brief-item-binding-mismatch",
      field,
      [declaration.id],
      `${field} has no exact ProjectBrief item ${expectedItemId}.`,
    ));
    return;
  }
  if (actual.kind !== canonical.kind) {
    diagnostics.push(diagnostic(
      "brief-item-kind-mismatch",
      field,
      [declaration.id],
      `${field} ProjectBrief item kind differs from the code-owned mapping.`,
    ));
  }
  if (actual.statement !== canonical.statement) {
    diagnostics.push(diagnostic(
      "brief-item-content-mismatch",
      field,
      [declaration.id],
      `${field} ProjectBrief item statement differs from the exact code-owned content.`,
    ));
  }
  if (
    deterministicJson(actual.dependsOnItemIds ?? []) !==
      deterministicJson(canonical.dependsOnItemIds ?? [])
  ) {
    diagnostics.push(diagnostic(
      "brief-item-dependency-mismatch",
      field,
      [declaration.id],
      `${field} ProjectBrief item dependencies differ from the code-owned mapping.`,
    ));
  }
  if (
    deterministicJson(actual.sourceRefs) !== deterministicJson(canonical.sourceRefs) ||
    deterministicJson(declaration.sourceRefs) !== deterministicJson(actual.sourceRefs)
  ) {
    diagnostics.push(diagnostic(
      "brief-item-source-mismatch",
      field,
      [declaration.id],
      `${field} declaration sources do not equal the exact ProjectBrief item sources.`,
    ));
  }
}

function parameter(
  declaration: ExplicitBriefFieldDeclaration,
): EngineeringDecisionProposalParameter {
  return {
    key: declaration.field,
    label: LABELS[declaration.field],
    value: declaration.value,
    ...(declaration.unit === null ? {} : { unit: declaration.unit }),
  };
}

function diagnostic(
  code: BriefProposalDiagnosticCode,
  field: ExplicitBriefField | "brief",
  declarationIds: readonly string[],
  message: string,
): BriefProposalDiagnostic {
  return { code, field, declarationIds, message };
}

function validateThresholdUnit(
  declaration: ExplicitBriefFieldDeclaration | undefined,
  expected: string,
  diagnostics: BriefProposalDiagnostic[],
): void {
  if (declaration && declaration.unit !== expected) {
    diagnostics.push(diagnostic(
      "unsupported-unit",
      declaration.field,
      [declaration.id],
      `${declaration.field} must explicitly use ${expected} in this spike.`,
    ));
  }
}

function parseInput(input: unknown): ExplicitBriefDeclarations {
  const value = exactRecord(
    input,
    ["schemaVersion", "briefSource", "brief", "declarations"],
    "$brief",
  );
  literalValue(
    value.schemaVersion,
    EXPLICIT_BRIEF_DECLARATIONS_SCHEMA,
    "$brief.schemaVersion",
  );
  const briefSource = exactRecord(
    value.briefSource,
    ["id", "fingerprint"],
    "$brief.briefSource",
  );
  const fingerprint = exactRecord(
    briefSource.fingerprint,
    ["algorithm", "digest"],
    "$brief.briefSource.fingerprint",
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    "$brief.briefSource.fingerprint.algorithm",
  );
  const digest = nonEmptyText(
    fingerprint.digest,
    "$brief.briefSource.fingerprint.digest",
  );
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new TypeError(
      "$brief.briefSource.fingerprint.digest must be lowercase SHA-256 hex.",
    );
  }

  const declarations = arrayOf(value.declarations, "$brief.declarations").map(
    parseDeclaration,
  );
  rejectDuplicates(
    declarations.map((declaration) => declaration.id),
    "$brief.declarations[].id",
  );
  return deepFreeze({
    schemaVersion: EXPLICIT_BRIEF_DECLARATIONS_SCHEMA,
    briefSource: {
      id: safeId(briefSource.id, "$brief.briefSource.id"),
      fingerprint: { algorithm: "sha256", digest },
    },
    brief: value.brief as ProjectBriefRevision,
    declarations,
  });
}

function parseDeclaration(
  input: unknown,
  index: number,
): ExplicitBriefFieldDeclaration {
  const path = `$brief.declarations[${index}]`;
  const value = exactRecord(
    input,
    [
      "id",
      "field",
      "value",
      "unit",
      "dependsOnDeclarationIds",
      "sourceItemId",
      "sourceRefs",
    ],
    path,
  );
  const field = nonEmptyText(value.field, `${path}.field`);
  if (!(DECLARATION_FIELDS as readonly string[]).includes(field)) {
    throw new TypeError(`${path}.field is not supported by this bounded spike.`);
  }
  const parsedValue = typeof value.value === "number"
    ? finite(value.value, `${path}.value`)
    : nonEmptyText(value.value, `${path}.value`);
  const unit = value.unit === null ? null : nonEmptyText(value.unit, `${path}.unit`);
  const dependsOnDeclarationIds = arrayOf(
    value.dependsOnDeclarationIds,
    `${path}.dependsOnDeclarationIds`,
  ).map((dependency, dependencyIndex) =>
    safeId(dependency, `${path}.dependsOnDeclarationIds[${dependencyIndex}]`)
  );
  rejectDuplicates(dependsOnDeclarationIds, `${path}.dependsOnDeclarationIds`);
  const sourceRefs = parseProjectBriefSourceRefs(
    value.sourceRefs,
    `${path}.sourceRefs`,
  );
  return {
    id: safeId(value.id, `${path}.id`),
    field: field as ExplicitBriefField,
    value: parsedValue,
    unit,
    dependsOnDeclarationIds,
    sourceItemId: safeId(value.sourceItemId, `${path}.sourceItemId`),
    sourceRefs,
  };
}

function parseProjectBriefSourceRefs(
  value: unknown,
  path: string,
): ProjectBriefSourceRef[] {
  const refs = arrayOf(value, path).map((candidate, index) => {
    const ref = exactRecord(candidate, ["kind", "reference"], `${path}[${index}]`);
    if (
      ref.kind !== "intent" && ref.kind !== "answer" && ref.kind !== "tool" &&
      ref.kind !== "document" && ref.kind !== "expert"
    ) {
      throw new TypeError(`${path}[${index}].kind is unsupported.`);
    }
    return {
      kind: ref.kind as ProjectBriefSourceRef["kind"],
      reference: nonEmptyText(ref.reference, `${path}[${index}].reference`),
    };
  });
  if (refs.length === 0) throw new TypeError(`${path} must not be empty.`);
  rejectDuplicates(refs.map(deterministicJson), path);
  return refs;
}

/** Exact fixture used to prove the bounded SupportBlock compilation path. */
export const SUPPORT_BLOCK_EXPLICIT_BRIEF_FIXTURE: ExplicitBriefDeclarations =
  deepFreeze({
    schemaVersion: EXPLICIT_BRIEF_DECLARATIONS_SCHEMA,
    briefSource: {
      id:
        "brief-source:09c7f2a72eeee0b7ec4977464428646a7608cf5685f503d850cc23fdf21eb5db",
      fingerprint: {
        algorithm: "sha256",
        digest: "1bce9a278b465ba9dcb00518cafb49d3548b15f33ad8192ae1ea46700071ccf4",
      },
    },
    brief: INTEGRATED_SUPPORT_BLOCK_BRIEF,
    declarations: [
      declaration(
        "decl-package",
        "architecture.package",
        "GenericSupport",
        null,
        [],
        "architecture",
      ),
      declaration("decl-system", "system.name", "GenericSupportSystem", null, [
        "decl-package",
      ], "system"),
      declaration("decl-support-name", "component.support.name", "SupportBlock", null, [
        "decl-system",
      ], "support-block"),
      declaration(
        "decl-support-usage",
        "component.support.usage",
        "supportBlock",
        null,
        ["decl-support-name"],
        "support-block",
      ),
      declaration(
        "decl-requirements-target",
        "requirements.containerComponent",
        "SupportBlock",
        null,
        ["decl-support-name"],
        "mechanical-verification",
      ),
      declaration(
        "decl-displacement-name",
        "requirement.displacement.name",
        "SupportBlock maximum displacement limit",
        null,
        ["decl-support-name", "decl-requirements-target"],
        "max-displacement",
      ),
      declaration(
        "decl-displacement-metric",
        "requirement.displacement.metric",
        "support_block_max_displacement",
        null,
        ["decl-support-name", "decl-requirements-target"],
        "max-displacement",
      ),
      declaration(
        "decl-displacement-operator",
        "requirement.displacement.operator",
        "<=",
        null,
        ["decl-support-name", "decl-displacement-metric"],
        "max-displacement",
      ),
      declaration(
        "decl-displacement-threshold",
        "requirement.displacement.threshold",
        2,
        "mm",
        ["decl-support-name", "decl-displacement-metric"],
        "max-displacement",
      ),
      declaration(
        "decl-von-mises-name",
        "requirement.vonMises.name",
        "SupportBlock maximum von Mises stress limit",
        null,
        ["decl-support-name", "decl-requirements-target"],
        "max-von-mises",
      ),
      declaration(
        "decl-von-mises-metric",
        "requirement.vonMises.metric",
        "support_block_max_von_mises",
        null,
        ["decl-support-name", "decl-requirements-target"],
        "max-von-mises",
      ),
      declaration(
        "decl-von-mises-operator",
        "requirement.vonMises.operator",
        "<=",
        null,
        ["decl-support-name", "decl-von-mises-metric"],
        "max-von-mises",
      ),
      declaration(
        "decl-von-mises-threshold",
        "requirement.vonMises.threshold",
        100,
        "MPa",
        ["decl-support-name", "decl-von-mises-metric"],
        "max-von-mises",
      ),
    ],
  });

function declaration(
  id: string,
  field: ExplicitBriefField,
  value: string | number,
  unit: string | null,
  dependsOnDeclarationIds: readonly string[],
  sourceItemId: string,
): ExplicitBriefFieldDeclaration {
  const item = INTEGRATED_SUPPORT_BLOCK_BRIEF.items.find((candidate) =>
    candidate.id === sourceItemId
  );
  if (!item) throw new TypeError(`Unknown integrated brief item ${sourceItemId}.`);
  return {
    id,
    field,
    value,
    unit,
    dependsOnDeclarationIds,
    sourceItemId,
    sourceRefs: item.sourceRefs,
  };
}
