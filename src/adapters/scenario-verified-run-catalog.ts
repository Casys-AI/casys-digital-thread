import type {
  EngineeringValue,
  EvidenceArtifact,
  ModelicaEvidenceIdentity,
  ObservedRunCatalog,
  RequirementVerdict,
  RunDetail,
  RunProvenance,
  RunStage,
  RunSummary,
  VerdictStatus,
} from "../domain/types.ts";
import type {
  ModelicaScenarioEvidence,
  ScenarioConstraint,
  ScenarioContractVerification,
} from "./scenario-contract-verifier.ts";

/** Structural seam so the catalog remains unit-testable without HTTP. */
export interface ScenarioContractVerifierLike {
  verify(
    evidence: ModelicaScenarioEvidence,
  ): Promise<ScenarioContractVerification | undefined>;
}

export interface ScenarioVerifiedRunCatalogOptions {
  source: ObservedRunCatalog;
  verifier: ScenarioContractVerifierLike;
}

interface CachedSummary {
  status: RunSummary["status"];
  completedAt?: string;
  summary: RunSummary;
}

interface ProjectedOutcome {
  requirements: RequirementVerdict[];
  verdictStatus: Exclude<VerdictStatus, "not_evaluated">;
  passedRequirements: number;
  failedRequirements: number;
  unresolvedRequirements: number;
}

/**
 * Read-only overlay that joins immutable Modelica evidence with a live SysON
 * comparison. Modelica remains the owner of its run catalog; SysON is called
 * only for a completed observed run whose exact model and scenario identities
 * match the versioned provisional contract.
 */
export class ScenarioVerifiedRunCatalog implements ObservedRunCatalog {
  readonly #source: ObservedRunCatalog;
  readonly #verifier: ScenarioContractVerifierLike;
  readonly #summaries = new Map<string, CachedSummary>();

  constructor(options: ScenarioVerifiedRunCatalogOptions) {
    this.#source = options.source;
    this.#verifier = options.verifier;
  }

  async list(): Promise<readonly RunSummary[]> {
    const source = await this.#source.list();
    return source.map((run) => {
      const cached = this.#summaries.get(run.id);
      if (
        cached && cached.status === run.status &&
        cached.completedAt === run.completedAt
      ) {
        return structuredClone(cached.summary);
      }
      return structuredClone(run);
    });
  }

  async detail(id: string): Promise<RunDetail | undefined> {
    const observed = await this.#source.detail(id);
    if (!observed) return undefined;

    // Do not overwrite a result owned by another verifier, a demo fixture, or
    // an incomplete computation. In particular, SysON never turns a failed
    // simulation into a passed scenario contract.
    if (
      observed.source !== "observed" || observed.status !== "succeeded" ||
      observed.verdictStatus !== "not_evaluated" || !observed.modelicaEvidence
    ) {
      this.#remember(observed);
      return structuredClone(observed);
    }

    let verification: ScenarioContractVerification | undefined;
    try {
      verification = await this.#verifier.verify(toScenarioEvidence(observed));
    } catch (error) {
      const projected = attachEvaluationError(observed, errorMessage(error));
      this.#remember(projected);
      return projected;
    }
    if (!verification) {
      this.#remember(observed);
      return structuredClone(observed);
    }

    try {
      const projected = attachVerification(observed, verification);
      this.#remember(projected);
      return projected;
    } catch (error) {
      const projected = attachEvaluationError(observed, errorMessage(error));
      this.#remember(projected);
      return projected;
    }
  }

  #remember(detail: RunDetail): void {
    this.#summaries.set(detail.id, {
      status: detail.status,
      completedAt: detail.completedAt,
      summary: toSummary(detail),
    });
  }
}

function toScenarioEvidence(run: RunDetail): ModelicaScenarioEvidence {
  const identity = run.modelicaEvidence!;
  return {
    runId: identity.runId,
    model: identity.model,
    scenario: identity.scenario,
    metrics: Object.fromEntries(
      run.measurements.map((measurement) => [
        measurement.id,
        {
          value: measurement.value.value,
          unit: measurement.value.unit,
        },
      ]),
    ),
  };
}

function attachVerification(
  run: RunDetail,
  verification: ScenarioContractVerification,
): RunDetail {
  assertVerificationMatchesRun(run, verification);
  const outcome = projectOutcome(verification);
  const plan = verification.plan;
  const stage = verificationStage(run.modelicaEvidence!, verification, outcome);
  const artifact: EvidenceArtifact = {
    id: `${run.id}:scenario-contract:${plan.id}:${plan.sha256}`,
    kind: "verdict",
    label: `Live SysON verdict: ${plan.title}`,
    path: plan.path,
    sha256: plan.sha256,
    producedBy: "mcp-syson:syson_constraint_evaluate",
  };
  const warning =
    "Provisional scenario contract derived from a versioned Modelica scenario; it is not a product requirement or a SysON project requirement.";
  const provenance: RunProvenance = {
    label: "Scenario contract SHA-256",
    value: plan.sha256,
  };
  return {
    ...structuredClone(run),
    description:
      "Observed OpenModelica simulation evidence. A live, units-aware SysON evaluation has attached a provisional scenario contract; it is not a product requirement or a SysON project requirement.",
    verdictStatus: outcome.verdictStatus,
    passedRequirements: outcome.passedRequirements,
    failedRequirements: outcome.failedRequirements,
    unresolvedRequirements: outcome.unresolvedRequirements,
    stages: [...run.stages, stage],
    requirements: outcome.requirements,
    evidence: [...run.evidence, artifact],
    provenance: [...run.provenance, provenance],
    warnings: appendUnique(run.warnings, warning),
    verification: {
      kind: "scenario_contract",
      title: plan.title,
      source: plan.source.sourcePath,
      planId: plan.id,
      planSha256: plan.sha256,
    },
  };
}

function attachEvaluationError(run: RunDetail, message: string): RunDetail {
  const warning = `SysON scenario-contract evaluation error: ${message}`;
  const requirement: RequirementVerdict = {
    id: "scenario-contract-evaluation",
    title: "Scenario contract evaluation",
    status: "error",
    message,
  };
  const stage: RunStage = {
    id: "scenario-contract-evaluation",
    title: "SysON scenario contract evaluation",
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    status: "error",
    summary:
      "SysON could not evaluate the provisional scenario contract. Modelica simulation evidence remains unchanged.",
    inputs: { modelicaEvidence: run.modelicaEvidence },
    outputs: { error: message },
  };
  return {
    ...structuredClone(run),
    description:
      "Observed OpenModelica simulation evidence. SysON could not evaluate the provisional scenario contract; this error does not alter the simulation evidence.",
    verdictStatus: "error",
    stages: [...run.stages, stage],
    requirements: [...run.requirements, requirement],
    warnings: appendUnique(run.warnings, warning),
    verification: {
      kind: "scenario_contract",
      title: "Scenario contract evaluation",
      source: "mcp-syson / syson_constraint_evaluate",
    },
  };
}

/**
 * The concrete verifier enforces this binding itself. Keep the boundary check
 * here too: a test double, adapter regression, or future verifier must never
 * attach another run's result to this immutable Modelica evidence.
 */
function assertVerificationMatchesRun(
  run: RunDetail,
  verification: ScenarioContractVerification,
): void {
  const observed = run.modelicaEvidence!;
  const returnedEvidence = verification.evidence;
  if (
    returnedEvidence.runId !== observed.runId ||
    !sameModelIdentity(returnedEvidence.model, observed.model) ||
    !sameScenarioIdentity(returnedEvidence.scenario, observed.scenario)
  ) {
    throw new Error(
      "Scenario contract verifier returned evidence that does not match the observed Modelica run.",
    );
  }
  if (
    !sameModelIdentity(verification.plan.model, observed.model) ||
    !sameScenarioIdentity(verification.plan.scenario, observed.scenario)
  ) {
    throw new Error(
      "Scenario contract plan does not bind the observed Modelica model and scenario.",
    );
  }
  if (
    verification.request.tool !== "syson_constraint_evaluate" ||
    !sameConstraints(
      verification.plan.constraints,
      verification.request.arguments.constraints,
    )
  ) {
    throw new Error(
      "Scenario contract verifier request does not match its versioned plan.",
    );
  }
}

function sameModelIdentity(
  left: ModelicaEvidenceIdentity["model"],
  right: ModelicaEvidenceIdentity["model"],
): boolean {
  return left.id === right.id && left.version === right.version &&
    left.sha256 === right.sha256;
}

function sameScenarioIdentity(
  left: ModelicaEvidenceIdentity["scenario"],
  right: ModelicaEvidenceIdentity["scenario"],
): boolean {
  return left.id === right.id && left.sha256 === right.sha256;
}

function sameConstraints(
  left: readonly ScenarioConstraint[],
  right: readonly ScenarioConstraint[],
): boolean {
  return left.length === right.length && left.every((constraint, index) => {
    const candidate = right[index];
    return candidate !== undefined && constraint.id === candidate.id &&
      constraint.name === candidate.name &&
      constraint.expression.kind === candidate.expression.kind &&
      constraint.expression.op === candidate.expression.op &&
      constraint.expression.left.kind === candidate.expression.left.kind &&
      constraint.expression.left.featurePath[0] ===
        candidate.expression.left.featurePath[0] &&
      constraint.expression.right.kind === candidate.expression.right.kind &&
      constraint.expression.right.value === candidate.expression.right.value &&
      constraint.expression.right.unit === candidate.expression.right.unit;
  });
}

function verificationStage(
  evidence: ModelicaEvidenceIdentity,
  verification: ScenarioContractVerification,
  outcome: ProjectedOutcome,
): RunStage {
  return {
    id: "scenario-contract-evaluation",
    title: "SysON scenario contract evaluation",
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    status: outcome.verdictStatus,
    summary:
      "Units-aware evaluation of the versioned provisional scenario contract; this is not a product or SysON project requirement.",
    inputs: {
      plan: {
        id: verification.plan.id,
        version: verification.plan.version,
        sha256: verification.plan.sha256,
        source: verification.plan.source,
      },
      model: evidence.model,
      scenario: evidence.scenario,
      runId: evidence.runId,
      fingerprint: evidence.fingerprint,
    },
    outputs: verification.outcome,
  };
}

function projectOutcome(
  verification: ScenarioContractVerification,
): ProjectedOutcome {
  const rawResults = array(
    verification.outcome.results,
    "syson_constraint_evaluate.results",
  );
  if (rawResults.length === 0) {
    throw new Error("syson_constraint_evaluate returned no comparison results.");
  }
  const constraints = new Map(
    verification.request.arguments.constraints.map((constraint) => [
      constraint.id,
      constraint,
    ]),
  );
  if (constraints.size !== verification.request.arguments.constraints.length) {
    throw new Error("Scenario contract request contains duplicate condition ids.");
  }
  const resultsByConstraintId = new Map<string, Record<string, unknown>>();
  for (const [index, raw] of rawResults.entries()) {
    const result = object(raw, `syson_constraint_evaluate.results[${index}]`);
    const id = string(result.constraintId, `results[${index}].constraintId`);
    const constraint = constraints.get(id);
    if (!constraint) {
      throw new Error(`SysON returned an unknown scenario condition: ${id}.`);
    }
    if (resultsByConstraintId.has(id)) {
      throw new Error(`SysON returned a duplicate scenario condition: ${id}.`);
    }
    resultsByConstraintId.set(id, result);
  }
  if (resultsByConstraintId.size !== constraints.size) {
    const missing = [...constraints.keys()].filter((id) =>
      !resultsByConstraintId.has(id)
    );
    throw new Error(
      `SysON did not return every scenario condition: ${missing.join(", ")}.`,
    );
  }
  const requirements = [...constraints.entries()].map(([id, constraint]) => {
    const result = resultsByConstraintId.get(id)!;
    return toRequirementVerdict(
      result,
      constraint,
      `results[${id}]`,
    );
  });
  const passedRequirements = requirements.filter((entry) => entry.status === "pass")
    .length;
  const failedRequirements = requirements.filter((entry) => entry.status === "fail")
    .length;
  const unresolvedRequirements =
    requirements.filter((entry) => entry.status === "unresolved").length;
  const verdictStatus: ProjectedOutcome["verdictStatus"] =
    requirements.some((entry) => entry.status === "error")
      ? "error"
      : failedRequirements > 0
      ? "failed"
      : unresolvedRequirements > 0
      ? "unresolved"
      : passedRequirements === requirements.length
      ? "passed"
      : "error";
  return {
    requirements,
    verdictStatus,
    passedRequirements,
    failedRequirements,
    unresolvedRequirements,
  };
}

function toRequirementVerdict(
  result: Record<string, unknown>,
  constraint: ScenarioConstraint,
  path: string,
): RequirementVerdict {
  const status = comparisonStatus(result.status, `${path}.status`);
  const title = optionalString(result.constraintName) ?? constraint.name;
  const limit = engineeringValue(
    constraint.expression.right.value,
    constraint.expression.right.unit,
  );
  if (status === "pass" || status === "fail") {
    // A positive/negative verdict is meaningful only if the evaluator gave us
    // its complete, unit-bearing comparison. A malformed response must surface
    // as a console evaluation error rather than as an optimistic pass.
    const unit = string(result.unit, `${path}.unit`);
    const computedValue = number(result.computedValue, `${path}.computedValue`);
    const threshold = number(result.threshold, `${path}.threshold`);
    const marginValue = number(result.margin, `${path}.margin`);
    const marginPercent = number(result.marginPercent, `${path}.marginPercent`);
    if (unit !== limit.unit || threshold !== limit.value) {
      throw new Error(
        `${path} does not match the versioned scenario condition's unit and threshold.`,
      );
    }
    return {
      id: constraint.id,
      title,
      status,
      computed: engineeringValue(computedValue, unit),
      limit,
      operator: constraint.expression.op,
      margin: engineeringValue(marginValue, unit),
      marginPercent,
    };
  }
  const unit = optionalString(result.unit) ?? limit.unit;
  const computedValue = optionalNumber(result.computedValue);
  const marginValue = optionalNumber(result.margin);
  const marginPercent = optionalNumber(result.marginPercent);
  return {
    id: constraint.id,
    title,
    status,
    computed: computedValue === undefined
      ? undefined
      : engineeringValue(computedValue, unit),
    limit,
    operator: constraint.expression.op,
    margin: marginValue === undefined ? undefined : engineeringValue(marginValue, unit),
    marginPercent,
    message: comparisonMessage(result, status),
  };
}

function comparisonMessage(
  result: Record<string, unknown>,
  status: RequirementVerdict["status"],
): string | undefined {
  if (status === "error") {
    return optionalString(result.error) ?? "SysON reported an evaluation error.";
  }
  if (status === "unresolved") {
    const unresolvedRefs = Array.isArray(result.unresolvedRefs)
      ? result.unresolvedRefs.filter((value): value is string =>
        typeof value === "string"
      )
      : [];
    return unresolvedRefs.length > 0
      ? `Missing values: ${unresolvedRefs.join(", ")}.`
      : "SysON could not resolve all values needed for this condition.";
  }
  return undefined;
}

function comparisonStatus(
  value: unknown,
  path: string,
): RequirementVerdict["status"] {
  if (
    value === "pass" || value === "fail" || value === "unresolved" || value === "error"
  ) {
    return value;
  }
  throw new Error(`${path} is not a supported SysON comparison status.`);
}

function engineeringValue(value: number, unit: string): EngineeringValue {
  return {
    value,
    unit,
    display: `${formatNumber(value)} ${unit}`,
  };
}

function toSummary(run: RunDetail): RunSummary {
  return {
    id: run.id,
    name: run.name,
    subject: run.subject,
    status: run.status,
    verdictStatus: run.verdictStatus,
    source: run.source,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    passedRequirements: run.passedRequirements,
    failedRequirements: run.failedRequirements,
    unresolvedRequirements: run.unresolvedRequirements,
  };
}

function appendUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${path} must be a non-empty string.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function number(value: unknown, path: string): number {
  const result = optionalNumber(value);
  if (result === undefined) throw new Error(`${path} must be a finite number.`);
  return result;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 6,
    useGrouping: false,
  }).format(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
