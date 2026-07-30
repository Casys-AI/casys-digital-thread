import type { RunDetail } from "../domain/types.ts";

export interface RunFixtureLoaderOptions {
  readTextFile?: (path: string) => Promise<string>;
}

export class RunFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunFixtureError";
  }
}

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
 * provenance, and collection boundaries here without duplicating every field.
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
      "source",
      "startedAt",
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
  if (
    !Array.isArray(value.stages) || !Array.isArray(value.requirements) ||
    !Array.isArray(value.evidence)
  ) {
    throw new RunFixtureError(
      `${path} must contain stages, requirements, and evidence arrays`,
    );
  }
  for (
    const field of [
      "passedRequirements",
      "failedRequirements",
      "unresolvedRequirements",
    ]
  ) {
    if (typeof value[field] !== "number" || value[field] < 0) {
      throw new RunFixtureError(`${path}.${field} must be a non-negative number`);
    }
  }

  // Shape details are consumed from the canonical fixture rather than copied
  // into source. The shared RunDetail contract remains the compile-time truth.
  return structuredClone(value) as unknown as RunDetail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
