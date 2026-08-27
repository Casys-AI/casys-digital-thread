import type {
  RunDetail,
  RunStageBasis,
  RunStatus,
  StageStatus,
  VerdictStatus,
} from "../../application/control-plane/read-model/engineering-run.ts";

/** Checked-in run evidence for the control-plane catalog. Demo stays labelled. */
export interface RunFixtureLoaderOptions {
  readTextFile?: (path: string) => Promise<string>;
}

export class RunFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunFixtureError";
  }
}

const RUN_STATUSES = [
  "succeeded",
  "failed",
  "timed_out",
  "running",
  "unavailable",
  "documentary",
] as const satisfies readonly RunStatus[];

const VERDICT_STATUSES = [
  "passed",
  "failed",
  "unresolved",
  "error",
  "not_evaluated",
] as const satisfies readonly VerdictStatus[];

const STAGE_BASES = [
  "execution",
  "documentary",
  "comparison",
] as const satisfies readonly RunStageBasis[];

const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);
const VERDICT_STATUS_SET = new Set<string>(VERDICT_STATUSES);
const STAGE_BASIS_SET = new Set<string>(STAGE_BASES);

export async function loadRunFixtures(
  paths: string[],
  options: RunFixtureLoaderOptions = {},
): Promise<RunDetail[]> {
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  return await Promise.all(paths.map(async (path) => {
    let raw: string;
    try {
      raw = await readTextFile(path);
    } catch (error) {
      throw new RunFixtureError(
        `Unable to read run fixture at ${path}: ${errorMessage(error)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new RunFixtureError(
        `Invalid JSON in ${path}: ${errorMessage(error)}`,
      );
    }
    return validateRunFixture(parsed, path);
  }));
}

/**
 * The fixture is an evidence bundle owned by state/. Validate its identity,
 * provenance, collection boundaries, and the distinction between attested
 * execution, checked-in documentary material, and comparisons.
 */
export function validateRunFixture(value: unknown, path = "run"): RunDetail {
  if (!isRecord(value)) {
    throw new RunFixtureError(`${path} must contain an object`);
  }
  for (
    const field of [
      "id",
      "name",
      "subject",
      "status",
      "verdictStatus",
      "source",
      "description",
    ]
  ) {
    if (typeof value[field] !== "string" || value[field] === "") {
      throw new RunFixtureError(`${path}.${field} must be a non-empty string`);
    }
  }
  if (value.source !== "demo" && value.source !== "observed") {
    throw new RunFixtureError(`${path}.source must be demo or observed`);
  }
  if (!isRunStatus(value.status)) {
    throw new RunFixtureError(`${path}.status must be a known run status`);
  }
  if (!isVerdictStatus(value.verdictStatus)) {
    throw new RunFixtureError(
      `${path}.verdictStatus must be a known verdict status`,
    );
  }
  validateOptionalTimestamp(value, "startedAt", path);
  validateOptionalTimestamp(value, "completedAt", path);
  if (
    !Array.isArray(value.stages) || !Array.isArray(value.measurements) ||
    !Array.isArray(value.provenance) || !Array.isArray(value.warnings) ||
    !Array.isArray(value.requirements) || !Array.isArray(value.evidence)
  ) {
    throw new RunFixtureError(
      `${path} must contain stages, measurements, provenance, warnings, requirements, and evidence arrays`,
    );
  }
  for (
    const field of [
      "passedRequirements",
      "failedRequirements",
      "unresolvedRequirements",
    ]
  ) {
    if (
      typeof value[field] !== "number" || !Number.isInteger(value[field]) ||
      value[field] < 0
    ) {
      throw new RunFixtureError(
        `${path}.${field} must be a non-negative integer`,
      );
    }
  }

  validateStages(value.stages, path, value.source);
  validateRequirements(value.requirements, value, path);

  if (value.source === "demo") {
    if (value.status !== "documentary") {
      throw new RunFixtureError(
        `${path}.status must be documentary when ${path}.source is demo`,
      );
    }
    if (value.verdictStatus !== "not_evaluated") {
      throw new RunFixtureError(
        `${path}.verdictStatus must be not_evaluated when ${path}.source is demo`,
      );
    }
    if (value.startedAt !== undefined || value.completedAt !== undefined) {
      throw new RunFixtureError(
        `${path} demo fixture must not claim run execution timestamps`,
      );
    }
  }

  // Shape details are consumed from the canonical fixture rather than copied
  // into source. The shared RunDetail contract remains the compile-time truth.
  return structuredClone(value) as unknown as RunDetail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUS_SET.has(value);
}

function isVerdictStatus(value: unknown): value is VerdictStatus {
  return typeof value === "string" && VERDICT_STATUS_SET.has(value);
}

function isStageStatus(value: unknown): value is StageStatus {
  return isRunStatus(value) || isVerdictStatus(value);
}

function validateOptionalTimestamp(
  value: Record<string, unknown>,
  field: "startedAt" | "completedAt",
  path: string,
): void {
  if (
    value[field] !== undefined &&
    (typeof value[field] !== "string" || value[field] === "")
  ) {
    throw new RunFixtureError(`${path}.${field} must be a non-empty string`);
  }
}

function validateStages(
  stages: unknown[],
  path: string,
  source: "demo" | "observed",
): void {
  for (const [index, value] of stages.entries()) {
    const stagePath = `${path}.stages[${index}]`;
    if (!isRecord(value)) {
      throw new RunFixtureError(`${stagePath} must be an object`);
    }
    for (const field of ["id", "title", "serverId", "tool", "summary"]) {
      if (typeof value[field] !== "string" || value[field] === "") {
        throw new RunFixtureError(`${stagePath}.${field} must be a non-empty string`);
      }
    }
    if (
      typeof value.basis !== "string" || !STAGE_BASIS_SET.has(value.basis)
    ) {
      throw new RunFixtureError(
        `${stagePath}.basis must be execution, documentary, or comparison`,
      );
    }
    if (!isStageStatus(value.status)) {
      throw new RunFixtureError(`${stagePath}.status must be a known stage status`);
    }
    if (!isRecord(value.inputs) || !isRecord(value.outputs)) {
      throw new RunFixtureError(`${stagePath}.inputs and outputs must be objects`);
    }
    validateOptionalTimestamp(value, "startedAt", stagePath);
    validateOptionalTimestamp(value, "completedAt", stagePath);

    if (value.basis === "documentary" && value.status !== "documentary") {
      throw new RunFixtureError(
        `${stagePath}.status must be documentary for a documentary stage`,
      );
    }
    if (
      value.basis === "execution" &&
      (!isRunStatus(value.status) || value.status === "documentary")
    ) {
      throw new RunFixtureError(
        `${stagePath}.status must be an execution run status for an execution stage`,
      );
    }
    if (value.basis === "comparison" && !isVerdictStatus(value.status)) {
      throw new RunFixtureError(
        `${stagePath}.status must be a verdict status for a comparison stage`,
      );
    }
    if (source === "demo" && value.basis === "execution") {
      throw new RunFixtureError(
        `${stagePath}.basis must not claim execution for a demo fixture`,
      );
    }
    if (
      source === "demo" &&
      (value.startedAt !== undefined || value.completedAt !== undefined)
    ) {
      throw new RunFixtureError(
        `${stagePath} demo stage must not claim execution timestamps`,
      );
    }
  }
}

function validateRequirements(
  requirements: unknown[],
  run: Record<string, unknown>,
  path: string,
): void {
  const statuses: string[] = [];
  for (const [index, value] of requirements.entries()) {
    const requirementPath = `${path}.requirements[${index}]`;
    if (!isRecord(value)) {
      throw new RunFixtureError(`${requirementPath} must be an object`);
    }
    if (typeof value.id !== "string" || value.id === "") {
      throw new RunFixtureError(`${requirementPath}.id must be a non-empty string`);
    }
    if (typeof value.title !== "string" || value.title === "") {
      throw new RunFixtureError(`${requirementPath}.title must be a non-empty string`);
    }
    if (
      value.status !== "pass" && value.status !== "fail" &&
      value.status !== "unresolved" && value.status !== "error"
    ) {
      throw new RunFixtureError(`${requirementPath}.status is not recognized`);
    }
    if (
      value.message !== undefined &&
      (typeof value.message !== "string" || value.message === "")
    ) {
      throw new RunFixtureError(
        `${requirementPath}.message must be a non-empty string`,
      );
    }
    statuses.push(value.status);
  }

  const counts = {
    passed: statuses.filter((status) => status === "pass").length,
    failed: statuses.filter((status) => status === "fail").length,
    unresolved: statuses.filter((status) => status === "unresolved").length,
  };
  if (run.passedRequirements !== counts.passed) {
    throw new RunFixtureError(`${path}.passedRequirements disagrees with requirements`);
  }
  if (run.failedRequirements !== counts.failed) {
    throw new RunFixtureError(`${path}.failedRequirements disagrees with requirements`);
  }
  if (run.unresolvedRequirements !== counts.unresolved) {
    throw new RunFixtureError(
      `${path}.unresolvedRequirements disagrees with requirements`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
