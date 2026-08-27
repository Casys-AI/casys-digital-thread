/**
 * Domain module for the generic `model.write-requirements@1` operation.
 *
 * Pure: no I/O, no Deno.*, no fetch. All logic is project-agnostic — the
 * word "coffee", "drone" or any product name is a defect in this module.
 *
 * WHY A FLAT PARAMETER GRAMMAR — the proposal lives in an
 * EngineeringDecisionProposal whose parameters field is reviewed and signed by
 * the human operator through MRTR. A flat key/value grammar
 * (`requirement.<slug>.*`) is readable without tooling, safe to elicit in a
 * chat interface, and parsed fail-closed into a typed hierarchy on the server.
 * The agent never supplies SysML text; the renderer in proof-case.ts is the
 * only authoritative source.
 *
 * WHY metric === OracleRequirement.id — the metric IS the fingerprint anchor:
 * it is the SysML attribute name, the featurePath used by constraint evaluation,
 * and the identity key for enrichment diffing. Keeping them equal makes the
 * capture self-describing without a second ID field.
 *
 * WHY partDefName IS SERVER-DERIVED (D3) — this legacy field now names the
 * native RequirementUsage, not a PartDefinition. The agent proposes only the
 * reviewed parameter values; `${containerComponent}Requirements` is computed
 * here and the trusted renderer alone owns the resulting SysML text.
 */

import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import {
  ORACLE_REQUIREMENT_OPERATORS,
  type OracleOperator,
  type OracleRequirement,
  SUPPORTED_ORACLE_UNITS,
} from "../../kernel/proof-case.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { PROPOSAL_PARAMETER_SLUG_BODY } from "../../kernel/case-validation.ts";

// ── Operation identity ───────────────────────────────────────────────────────

export const MODEL_WRITE_REQUIREMENTS_OPERATION = {
  id: "model.write-requirements",
  version: "1",
} as const;

// ── Proposal types ───────────────────────────────────────────────────────────

/** One requirement entry parsed from the flat MRTR grammar. */
export interface RequirementEntry {
  /** User-facing slug from the key prefix — diagnostic only, not persisted. */
  readonly slug: string;
  /** Non-normative human title for display only. Not a constraint. */
  readonly name: string;
  /**
   * SysML identifier used as attribute name, featurePath, and enrichment key.
   * Must satisfy /^[A-Za-z_][A-Za-z0-9_]*$/ (SYSML_ID — no hyphens).
   */
  readonly metric: string;
  readonly operator: OracleOperator;
  readonly threshold: {
    readonly value: number;
    readonly unit: string;
  };
}

/**
 * Parsed, hierarchy-typed representation of the human-reviewed MRTR proposal.
 *
 * partDefName is the legacy property name for the server-derived
 * RequirementUsage name `${containerComponent}Requirements`.
 */
export interface RequirementsProposal {
  readonly containerComponent: string;
  readonly partDefName: string;
  readonly requirements: readonly RequirementEntry[];
}

/**
 * Resolved envelope used for the D1 fingerprint.
 *
 * The fingerprint covers target (resolved at runtime from the architecture
 * capture), architectureBasis, the server-derived RequirementUsage name held
 * in the legacy `partDefName` field, and requirements[].
 * This broader scope means any change to the live model, the architecture
 * basis revision, or the requirements list invalidates the fingerprint — which
 * is exactly the boundary the human approved.
 */
/** Exact reusable SysML type constrained by a requirements declaration. */
export interface RequirementsTarget {
  readonly kind: "part-definition";
  readonly label: string;
  readonly elementId: string;
}

export interface RequirementsEnvelope {
  /** Requirements constrain the reusable type, not one arbitrary occurrence. */
  readonly target: RequirementsTarget;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: string;
  };
  /** Legacy field name: server-derived RequirementUsage name. */
  readonly partDefName: string;
  readonly requirements: readonly OracleRequirement[];
}

// ── Enrichment plan types ────────────────────────────────────────────────────

/**
 * A named threshold conflict between the proposal and the prior requirements.
 *
 * Same metric, different (value | unit | operator) — the executor surfaces
 * this as `requirements_threshold_conflict` and refuses the run.
 */
export interface EnrichmentConflict {
  readonly metric: string;
  readonly proposed: {
    readonly operator: OracleOperator;
    readonly value: number;
    readonly unit: string;
  };
  readonly prior: {
    readonly operator: OracleOperator;
    readonly value: number;
    readonly unit: string;
  };
}

/**
 * Diff of the proposal against the prior requirements capture.
 *
 * Initial mode: no prior exists — every requirement goes into toInsert.
 * Enrichment mode: metrics are compared against the prior.
 *   toInsert — new metrics not present in the prior.
 *   adopted  — identical (metric + operator + threshold) already in the prior.
 *   conflicts — same metric, different threshold → executor must refuse.
 *   disappeared — metrics present in the prior but absent from the proposal
 *                 → cliquet violation, executor must refuse.
 */
export interface RequirementsEnrichmentPlan {
  readonly mode: "initial" | "enrichment";
  readonly toInsert: readonly RequirementEntry[];
  readonly adopted: readonly RequirementEntry[];
  readonly conflicts: readonly EnrichmentConflict[];
  readonly disappeared: readonly string[];
}

// ── Error types ──────────────────────────────────────────────────────────────

export type RequirementsProposalParseErrorCode =
  | "empty_proposal"
  | "missing_container"
  | "unknown_key"
  | "invalid_identifier"
  | "invalid_metric_identifier"
  | "invalid_operator"
  | "invalid_threshold_value"
  | "unsupported_unit"
  | "missing_threshold_unit"
  | "missing_requirement_field"
  | "non_string_key_value"
  | "non_numeric_threshold"
  | "duplicate_metric"
  | "duplicate_slug";

/** Structured parse failure — code is stable, message is diagnostic only. */
export class RequirementsProposalParseError extends Error {
  readonly code: RequirementsProposalParseErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: RequirementsProposalParseErrorCode,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RequirementsProposalParseError";
    this.code = code;
    this.context = context;
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * PascalCase SysML identifier: starts with a letter, continues with letters,
 * digits or underscores. This is the shape of containerComponent (e.g. "Subsystem").
 */
const SYSML_PASCAL_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * SysML identifier for metrics: same as PASCAL but allows leading underscore.
 * Must not contain hyphens — hyphens are valid in safeId but not in SysML.
 */
const SYSML_METRIC_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Matches `requirement.<slug>.<field>` keys. The slug uses the shared
 * proposal-parameter grammar (hyphens allowed; user-facing only — it never
 * reaches SysML). The field must be a word.
 */
const REQUIREMENT_KEY = new RegExp(
  `^requirement\\.(${PROPOSAL_PARAMETER_SLUG_BODY})\\.([A-Za-z]+)$`,
);

const ALLOWED_REQUIREMENT_FIELDS = new Set(["name", "metric", "operator", "threshold"]);

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a flat list of MRTR-reviewed decision parameters into a typed
 * RequirementsProposal.
 *
 * Fail-closed: unknown key, non-string value (except threshold), invalid
 * identifier, duplicate metric, missing field → RequirementsProposalParseError
 * with a named code.
 *
 * This function validates syntax and semantics of the proposal. It does NOT
 * validate MRTR authority, resolve target elements, or check enrichment
 * continuity — those are the executor's gates.
 */
export function parseRequirementsProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): RequirementsProposal {
  if (parameters.length === 0) {
    throw new RequirementsProposalParseError(
      "empty_proposal",
      "The requirements proposal has no parameters.",
    );
  }

  let containerComponent: string | undefined;
  const requirementFields = new Map<
    string,
    {
      name?: string;
      metric?: string;
      operator?: string;
      threshold?: number;
      unit?: string;
    }
  >();

  for (const param of parameters) {
    if (param.key === "requirements.containerComponent") {
      if (typeof param.value !== "string") {
        throw new RequirementsProposalParseError(
          "non_string_key_value",
          `Parameter "requirements.containerComponent" must be a string.`,
          { key: param.key, valueType: typeof param.value },
        );
      }
      containerComponent = param.value;
      continue;
    }

    const match = REQUIREMENT_KEY.exec(param.key);
    if (!match) {
      throw new RequirementsProposalParseError(
        "unknown_key",
        `Unknown requirements parameter key "${param.key}". Allowed keys: ` +
          `requirements.containerComponent, requirement.<slug>.(name|metric|operator|threshold).`,
        { key: param.key },
      );
    }

    const [, slug, field] = match;
    if (!ALLOWED_REQUIREMENT_FIELDS.has(field!)) {
      throw new RequirementsProposalParseError(
        "unknown_key",
        `Unknown requirement field "${field!}" in key "${param.key}". ` +
          `Allowed fields: name, metric, operator, threshold.`,
        { key: param.key, field },
      );
    }

    if (!requirementFields.has(slug!)) {
      requirementFields.set(slug!, {});
    }
    const entry = requirementFields.get(slug!)!;

    if (field === "threshold") {
      // threshold accepts numeric values (the agent passes them as numbers).
      if (typeof param.value !== "number") {
        throw new RequirementsProposalParseError(
          "non_numeric_threshold",
          `Requirement "${slug!}" threshold must be a number, got ${typeof param
            .value}.`,
          { key: param.key, slug, valueType: typeof param.value },
        );
      }
      if (!Number.isFinite(param.value)) {
        throw new RequirementsProposalParseError(
          "invalid_threshold_value",
          `Requirement "${slug!}" threshold must be a finite number.`,
          { key: param.key, slug, value: param.value },
        );
      }
      if (!Number.isSafeInteger(param.value)) {
        throw new RequirementsProposalParseError(
          "invalid_threshold_value",
          `Requirement "${slug!}" threshold must be a safe integer in this ` +
            "release because SysON 0.5.1 cannot round-trip decimal literals " +
            "through syson_constraint_extract.",
          { key: param.key, slug, value: param.value },
        );
      }
      if (param.unit === undefined || param.unit.trim() === "") {
        throw new RequirementsProposalParseError(
          "missing_threshold_unit",
          `Requirement "${slug!}" threshold is missing its unit. ` +
            `Supported units: ${SUPPORTED_ORACLE_UNITS.join(", ")}.`,
          { key: param.key, slug },
        );
      }
      if (!SUPPORTED_ORACLE_UNITS.includes(param.unit)) {
        throw new RequirementsProposalParseError(
          "unsupported_unit",
          `Requirement "${slug!}" unit "${param.unit}" is not supported. ` +
            `Supported units: ${SUPPORTED_ORACLE_UNITS.join(", ")}.`,
          { key: param.key, slug, unit: param.unit },
        );
      }
      entry.threshold = param.value;
      entry.unit = param.unit;
    } else {
      if (typeof param.value !== "string") {
        throw new RequirementsProposalParseError(
          "non_string_key_value",
          `Requirement "${slug!}" field "${field!}" must be a string, got ${typeof param
            .value}.`,
          { key: param.key, slug, field, valueType: typeof param.value },
        );
      }
      if (field === "name") entry.name = param.value;
      else if (field === "metric") entry.metric = param.value;
      else if (field === "operator") entry.operator = param.value;
    }
  }

  if (!containerComponent || !containerComponent.trim()) {
    throw new RequirementsProposalParseError(
      "missing_container",
      'Required parameter "requirements.containerComponent" is absent or empty.',
    );
  }
  if (!SYSML_PASCAL_IDENTIFIER.test(containerComponent)) {
    throw new RequirementsProposalParseError(
      "invalid_identifier",
      `containerComponent "${containerComponent}" is not a valid SysML identifier ` +
        `(^[A-Za-z][A-Za-z0-9_]*$).`,
      { value: containerComponent },
    );
  }

  if (requirementFields.size === 0) {
    throw new RequirementsProposalParseError(
      "empty_proposal",
      "The requirements proposal declares no requirements.",
    );
  }

  const entries: RequirementEntry[] = [];
  const seenMetrics = new Set<string>();
  const seenSlugs = new Set<string>();

  for (const [slug, fields] of requirementFields) {
    if (seenSlugs.has(slug)) {
      throw new RequirementsProposalParseError(
        "duplicate_slug",
        `Duplicate slug "${slug}" in the requirements proposal.`,
        { slug },
      );
    }
    seenSlugs.add(slug);

    // Validate required fields.
    if (!fields.name || !fields.name.trim()) {
      throw new RequirementsProposalParseError(
        "missing_requirement_field",
        `Requirement "${slug}" is missing its "name" field.`,
        { slug },
      );
    }
    if (!fields.metric || !fields.metric.trim()) {
      throw new RequirementsProposalParseError(
        "missing_requirement_field",
        `Requirement "${slug}" is missing its "metric" field.`,
        { slug },
      );
    }
    if (!SYSML_METRIC_IDENTIFIER.test(fields.metric)) {
      throw new RequirementsProposalParseError(
        "invalid_metric_identifier",
        `Requirement "${slug}" metric "${fields.metric}" is not a valid SysML identifier ` +
          `(^[A-Za-z_][A-Za-z0-9_]*$). Hyphens are not allowed.`,
        { slug, value: fields.metric },
      );
    }
    if (!fields.operator || !fields.operator.trim()) {
      throw new RequirementsProposalParseError(
        "missing_requirement_field",
        `Requirement "${slug}" is missing its "operator" field.`,
        { slug },
      );
    }
    if (
      !ORACLE_REQUIREMENT_OPERATORS.includes(fields.operator as OracleOperator)
    ) {
      throw new RequirementsProposalParseError(
        "invalid_operator",
        `Requirement "${slug}" operator "${fields.operator}" is not valid. ` +
          `Allowed operators: ${ORACLE_REQUIREMENT_OPERATORS.join(", ")}.`,
        { slug, value: fields.operator },
      );
    }
    if (fields.threshold === undefined) {
      throw new RequirementsProposalParseError(
        "missing_requirement_field",
        `Requirement "${slug}" is missing its "threshold" field.`,
        { slug },
      );
    }
    if (!fields.unit) {
      throw new RequirementsProposalParseError(
        "missing_threshold_unit",
        `Requirement "${slug}" is missing its threshold unit.`,
        { slug },
      );
    }

    if (seenMetrics.has(fields.metric)) {
      throw new RequirementsProposalParseError(
        "duplicate_metric",
        `Duplicate metric "${fields.metric}" across requirements in the proposal.`,
        { metric: fields.metric },
      );
    }
    seenMetrics.add(fields.metric);

    entries.push({
      slug,
      name: fields.name,
      metric: fields.metric,
      operator: fields.operator as OracleOperator,
      threshold: { value: fields.threshold, unit: fields.unit },
    });
  }

  // Sort by metric for deterministic canonical order in the enrichment plan.
  entries.sort((left, right) => left.metric.localeCompare(right.metric));

  const partDefName = derivePartDefName(containerComponent);
  return {
    containerComponent,
    partDefName,
    requirements: Object.freeze(entries),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the server-fixed RequirementUsage name from containerComponent (D3).
 *
 * Pattern: `${containerComponent}Requirements`
 * The agent never supplies this name — it is always computed here.
 */
export function derivePartDefName(containerComponent: string): string {
  return `${containerComponent}Requirements`;
}

/**
 * Convert RequirementEntry[] to OracleRequirement[] for use in rendering and
 * evaluation. metric serves as both id and metric (featurePath[0]).
 */
export function requirementEntriesToOracleRequirements(
  entries: readonly RequirementEntry[],
): OracleRequirement[] {
  return entries.map((entry) => ({
    id: entry.metric,
    name: entry.name,
    metric: entry.metric,
    operator: entry.operator,
    limit: { value: entry.threshold.value, unit: entry.threshold.unit },
  }));
}

/**
 * Compute the enrichment plan by diffing the proposal against prior captured
 * requirements.
 *
 * Enrichment invariants (D6):
 *   - A metric absent from the proposal but present in the prior is a cliquet
 *     violation: the disappeared[] list is populated. The executor must refuse.
 *   - A metric with the same threshold (value + unit + operator) in both is adopted.
 *   - A metric with a different threshold is a conflict. The executor must refuse.
 *   - A metric absent from the prior goes into toInsert.
 *
 * This function is pure — callers decide what to do with disappeared[] and
 * conflicts[]. The executor enforces the refusals.
 */
export function planRequirementsEnrichment(
  proposal: RequirementsProposal,
  prior: readonly OracleRequirement[] | undefined,
): RequirementsEnrichmentPlan {
  if (!prior || prior.length === 0) {
    return {
      mode: "initial",
      toInsert: [...proposal.requirements],
      adopted: [],
      conflicts: [],
      disappeared: [],
    };
  }

  const priorByMetric = new Map<string, OracleRequirement>(
    prior.map((req) => [req.metric, req]),
  );
  const proposedMetrics = new Set<string>(proposal.requirements.map((e) => e.metric));

  const toInsert: RequirementEntry[] = [];
  const adopted: RequirementEntry[] = [];
  const conflicts: EnrichmentConflict[] = [];
  const disappeared: string[] = [];

  // Detect disappeared metrics (cliquet).
  for (const priorReq of prior) {
    if (!proposedMetrics.has(priorReq.metric)) {
      disappeared.push(priorReq.metric);
    }
  }

  // Classify each proposed requirement.
  for (const entry of proposal.requirements) {
    const priorReq = priorByMetric.get(entry.metric);
    if (!priorReq) {
      toInsert.push(entry);
      continue;
    }
    // Same metric exists in prior — check threshold + operator identity.
    const thresholdMatches = priorReq.limit.value === entry.threshold.value &&
      priorReq.limit.unit === entry.threshold.unit &&
      priorReq.operator === entry.operator;
    if (thresholdMatches) {
      adopted.push(entry);
    } else {
      conflicts.push({
        metric: entry.metric,
        proposed: {
          operator: entry.operator,
          value: entry.threshold.value,
          unit: entry.threshold.unit,
        },
        prior: {
          operator: priorReq.operator,
          value: priorReq.limit.value,
          unit: priorReq.limit.unit,
        },
      });
    }
  }

  return {
    mode: "enrichment",
    toInsert,
    adopted,
    conflicts,
    disappeared,
  };
}

/**
 * Compute a deterministic SHA-256 fingerprint of the full requirements
 * envelope (D1).
 *
 * The envelope covers the resolved target PartDefinition identity,
 * architectureBasis {snapshotId, revision, fingerprint}, the server-derived
 * RequirementUsage name in legacy `partDefName`, and requirements[].
 *
 * This is broader than fingerprintOracleRequirements (requirements[] only)
 * because the human approved the specific component target and architecture
 * basis, not just the threshold list. A change to any of these invalidates
 * the approval.
 */
export function fingerprintRequirementsEnvelope(
  envelope: RequirementsEnvelope,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(envelope);
}

/**
 * WAL plan digest for insert and completed replay. Sort by metric so
 * enrichment `toInsert + adopted` matches the signed proposal order.
 */
export function fingerprintRequirementsPlan(input: {
  readonly partDefName: string;
  readonly target: RequirementsTarget;
  readonly requirements: readonly OracleRequirement[];
}): Promise<ContentFingerprint> {
  return sha256Fingerprint({
    partDefName: input.partDefName,
    target: input.target,
    requirements: canonicalizeOracleRequirements(input.requirements),
  });
}

export function canonicalizeOracleRequirements(
  requirements: readonly OracleRequirement[],
): OracleRequirement[] {
  return [...requirements].toSorted((left, right) =>
    left.metric.localeCompare(right.metric)
  );
}
