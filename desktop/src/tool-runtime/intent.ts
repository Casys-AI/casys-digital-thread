/**
 * Durable preparation intent for the Desktop tool-runtime backend (#56).
 *
 * One JSON document per tool in the caller-provided directory. Atomic
 * tmp-file + rename writes; a corrupt intent fails closed with an explicit
 * recovery (delete the file) instead of being guessed at. Steps journal
 * every transition so an interrupted download or an application restart
 * resumes instead of duplicating work — except the smoke execution, whose
 * `done` is trusted and never re-run blindly.
 */

export const TOOL_RUNTIME_INTENT_SCHEMA = "desktop-tool-runtime-intent/1.0" as const;

export type PreparationStepId =
  | "detect-engine"
  | "ensure-engine"
  | "acquire-image"
  | "start-owned"
  | "readiness"
  | "smoke";

export const PREPARATION_STEPS: readonly PreparationStepId[] = [
  "detect-engine",
  "ensure-engine",
  "acquire-image",
  "start-owned",
  "readiness",
  "smoke",
] as const;

export type PreparationStepStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "uncertain";

export interface PreparationStepRecord {
  readonly status: PreparationStepStatus;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly detail?: string;
  readonly code?: string;
  readonly recovery?: string;
}

export interface ToolRuntimeIntent {
  readonly schemaVersion: typeof TOOL_RUNTIME_INTENT_SCHEMA;
  readonly toolId: string;
  readonly imageRef: string;
  readonly platform: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly steps: Record<PreparationStepId, PreparationStepRecord>;
}

export class ToolRuntimeIntentCorruptError extends Error {
  constructor(path: string, reason: string) {
    super(
      `Tool runtime intent at ${path} is corrupt (${reason}); delete the file to start a fresh preparation.`,
    );
    this.name = "ToolRuntimeIntentCorruptError";
  }
}

export function newToolRuntimeIntent(input: {
  toolId: string;
  imageRef: string;
  platform: string;
  now: string;
}): ToolRuntimeIntent {
  const steps = {} as Record<PreparationStepId, PreparationStepRecord>;
  for (const id of PREPARATION_STEPS) {
    steps[id] = { status: "pending", attempts: 0, updatedAt: input.now };
  }
  return {
    schemaVersion: TOOL_RUNTIME_INTENT_SCHEMA,
    toolId: input.toolId,
    imageRef: input.imageRef,
    platform: input.platform,
    createdAt: input.now,
    updatedAt: input.now,
    steps,
  };
}

export function intentFileName(toolId: string): string {
  return `tool-runtime-${toolId}.intent.json`;
}

export async function loadToolRuntimeIntent(
  directory: string,
  toolId: string,
): Promise<ToolRuntimeIntent | undefined> {
  const path = `${directory}/${intentFileName(toolId)}`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ToolRuntimeIntentCorruptError(path, "not valid JSON");
  }
  return validateIntent(parsed, path);
}

export async function saveToolRuntimeIntent(
  directory: string,
  intent: ToolRuntimeIntent,
): Promise<void> {
  await Deno.mkdir(directory, { recursive: true });
  const path = `${directory}/${intentFileName(intent.toolId)}`;
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(intent, null, 2));
  await Deno.rename(tmp, path);
}

/**
 * Resets a failed/uncertain step for an explicit operator re-run. The retry
 * budget (attempts) restarts: each explicit invocation owns a fresh budget,
 * and the stale failure code/recovery no longer describes the step.
 */
export function resetStepForRetry(
  intent: ToolRuntimeIntent,
  step: PreparationStepId,
  now: string,
  detail: string,
): ToolRuntimeIntent {
  return {
    ...intent,
    updatedAt: now,
    steps: {
      ...intent.steps,
      [step]: { status: "pending", attempts: 0, updatedAt: now, detail },
    },
  };
}

export function recordStep(
  intent: ToolRuntimeIntent,
  step: PreparationStepId,
  status: PreparationStepStatus,
  now: string,
  detail?: string,
  code?: string,
  recovery?: string,
): ToolRuntimeIntent {
  const prior = intent.steps[step];
  return {
    ...intent,
    updatedAt: now,
    steps: {
      ...intent.steps,
      [step]: {
        status,
        attempts: status === "running" ? prior.attempts + 1 : prior.attempts,
        updatedAt: now,
        ...(detail === undefined ? {} : { detail }),
        ...(code === undefined ? {} : { code }),
        ...(recovery === undefined ? {} : { recovery }),
      },
    },
  };
}

function validateIntent(value: unknown, path: string): ToolRuntimeIntent {
  if (typeof value !== "object" || value === null) {
    throw new ToolRuntimeIntentCorruptError(path, "not an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== TOOL_RUNTIME_INTENT_SCHEMA) {
    throw new ToolRuntimeIntentCorruptError(path, "schema mismatch");
  }
  for (const key of ["toolId", "imageRef", "platform", "createdAt", "updatedAt"]) {
    if (typeof candidate[key] !== "string") {
      throw new ToolRuntimeIntentCorruptError(path, `missing ${key}`);
    }
  }
  const steps = candidate.steps;
  if (typeof steps !== "object" || steps === null) {
    throw new ToolRuntimeIntentCorruptError(path, "missing steps");
  }
  for (const id of PREPARATION_STEPS) {
    const record = (steps as Record<string, unknown>)[id];
    if (
      typeof record !== "object" || record === null ||
      !isStepStatus((record as Record<string, unknown>).status) ||
      typeof (record as Record<string, unknown>).attempts !== "number" ||
      typeof (record as Record<string, unknown>).updatedAt !== "string"
    ) {
      throw new ToolRuntimeIntentCorruptError(path, `bad step ${id}`);
    }
  }
  return value as ToolRuntimeIntent;
}

function isStepStatus(value: unknown): value is PreparationStepStatus {
  return value === "pending" || value === "running" || value === "done" ||
    value === "failed" || value === "uncertain";
}
