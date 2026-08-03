/**
 * The paired agent chooses which durable project record the read-only cockpit
 * follows. This is UI routing state, not engineering evidence or approval.
 */
export const COCKPIT_FOCUS_SCHEMA_VERSION = "cockpit-focus/1.0" as const;

export interface CockpitFocusTarget {
  readonly kind: "project";
  readonly projectId: string;
}

export interface CockpitFocusSnapshot {
  readonly schemaVersion: typeof COCKPIT_FOCUS_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly revision: number;
  readonly commandId: string;
  readonly selectedAt: string;
  readonly selectedBy: {
    readonly kind: "agent";
    readonly actorId: string;
  };
  readonly target: CockpitFocusTarget;
  readonly previous?: {
    readonly revision: number;
  };
}

export function validateCockpitFocusSnapshot(
  value: unknown,
): CockpitFocusSnapshot {
  if (!isRecord(value)) throw new TypeError("Cockpit focus must be an object.");
  exactKeys(
    value,
    [
      "schemaVersion",
      "workspaceId",
      "revision",
      "commandId",
      "selectedAt",
      "selectedBy",
      "target",
      "previous",
    ],
    "Cockpit focus",
  );
  if (value.schemaVersion !== COCKPIT_FOCUS_SCHEMA_VERSION) {
    throw new TypeError("Cockpit focus has an unsupported schemaVersion.");
  }
  nonEmptyString(value.workspaceId, "workspaceId");
  positiveInteger(value.revision, "revision");
  nonEmptyString(value.commandId, "commandId");
  isoDate(value.selectedAt, "selectedAt");
  if (!isRecord(value.selectedBy) || value.selectedBy.kind !== "agent") {
    throw new TypeError("Cockpit focus selectedBy must be an agent origin.");
  }
  exactKeys(value.selectedBy, ["kind", "actorId"], "Cockpit focus selectedBy");
  nonEmptyString(value.selectedBy.actorId, "selectedBy.actorId");
  validateTarget(value.target);
  if (value.previous !== undefined) {
    if (!isRecord(value.previous)) {
      throw new TypeError("Cockpit focus previous must be an object.");
    }
    exactKeys(value.previous, ["revision"], "Cockpit focus previous");
    positiveInteger(value.previous.revision, "previous.revision");
    if (value.previous.revision >= value.revision) {
      throw new TypeError("Cockpit focus previous revision must precede revision.");
    }
  } else if (value.revision !== 1) {
    throw new TypeError("Cockpit focus revision after r1 must retain previous.");
  }
  return structuredClone(value as unknown as CockpitFocusSnapshot);
}

export function validateCockpitFocusTarget(
  value: unknown,
): CockpitFocusTarget {
  validateTarget(value);
  return structuredClone(value as CockpitFocusTarget);
}

function validateTarget(value: unknown): void {
  if (!isRecord(value)) throw new TypeError("Cockpit focus target must be an object.");
  if (value.kind === "project") {
    exactKeys(value, ["kind", "projectId"], "Cockpit focus project target");
    nonEmptyString(value.projectId, "target.projectId");
    return;
  }
  throw new TypeError("Cockpit focus target kind must be project.");
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${name} contains unsupported field ${unknown[0]}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function positiveInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
}

function isoDate(value: unknown, name: string): asserts value is string {
  nonEmptyString(value, name);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO date-time.`);
  }
}
