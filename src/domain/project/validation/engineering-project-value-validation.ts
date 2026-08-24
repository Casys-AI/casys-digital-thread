import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue } from "./engineering-project-validation-issue.ts";

export function uniqueStrings(
  values: readonly string[],
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      issue(issues, "duplicate_reference", `${path}[${index}]`, "must be unique");
    }
    seen.add(value);
  });
}

export function validateArray(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  validate: (
    value: unknown,
    path: string,
    issues: EngineeringProjectValidationIssue[],
  ) => void,
): void {
  if (!Array.isArray(value)) {
    issue(issues, "invalid_array", path, "must be an array");
    return;
  }
  value.forEach((item, index) => validate(item, `${path}[${index}]`, issues));
}

export function stringArray(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issue(issues, "invalid_array", path, "must be an array");
    return;
  }
  value.forEach((item, index) => nonEmptyString(item, `${path}[${index}]`, issues));
}

export function exactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: EngineeringProjectValidationIssue[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issue(issues, "invalid_object", path, "must be an object");
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  required.forEach((key) => {
    if (!(key in input)) {
      issue(issues, "missing_property", `${path}.${key}`, "is required");
    }
  });
  Object.keys(input).forEach((key) => {
    if (!allowed.has(key)) {
      issue(
        issues,
        "unknown_property",
        `${path}.${key}`,
        "is not allowed by schema 1.0",
      );
    }
  });
  return input;
}

export function nonEmptyString(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): value is string {
  if (typeof value !== "string" || !value.trim()) {
    issue(issues, "invalid_string", path, "must be a non-empty string");
    return false;
  }
  return true;
}

export function optionalNonEmptyString(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (value !== undefined) nonEmptyString(value, path, issues);
}

export function positiveInteger(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    issue(issues, "invalid_integer", path, "must be a positive integer");
  }
}

export function isoDateTime(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) issue(issues, "invalid_datetime", path, "must be an ISO 8601 UTC timestamp");
}

export function optionalIsoDateTime(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (value !== undefined) isoDateTime(value, path, issues);
}

export function literal(
  value: unknown,
  expected: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (value !== expected) {
    issue(issues, "invalid_literal", path, `must equal ${String(expected)}`);
  }
}

export function oneOf(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issue(issues, "invalid_enum", path, `must be one of ${allowed.join(", ")}`);
  }
}

export function validateJson(
  value: unknown,
  path: string,
  issues: EngineeringProjectValidationIssue[],
  ancestors: Set<object>,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issue(issues, "not_json", path, "must be a finite JSON number");
    }
    return;
  }
  if (typeof value !== "object") {
    issue(issues, "not_json", path, "must contain only JSON values");
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    issue(issues, "not_json", path, "must be a plain JSON object");
    return;
  }
  if (ancestors.has(value)) {
    issue(issues, "not_json", path, "must not contain cycles");
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJson(item, `${path}[${index}]`, issues, ancestors)
    );
  } else {
    Object.entries(value).forEach(([key, item]) =>
      validateJson(item, `${path}.${key}`, issues, ancestors)
    );
  }
  ancestors.delete(value);
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
