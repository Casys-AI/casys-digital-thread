/**
 * Shared validation primitives for domain case schemas.
 *
 * WHY THIS MODULE EXISTS — seven case-schema modules contained byte-identical
 * private copies of these helpers. One canonical copy eliminates the risk of a
 * future divergence going unnoticed and reduces the surface for silent mistakes
 * when adding a new case schema.
 *
 * All functions throw TypeError. TypeError extends Error, so existing callers
 * that catch Error are unaffected. The canonical error type for structural
 * validation in this codebase is TypeError.
 */

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;

/**
 * Body of a dotted MRTR parameter slug (`component.<slug>.name`,
 * `requirement.<slug>.metric`). Hyphens are allowed because the slug is a
 * grouping key, not a SysML identifier. Dots and colons are not: they would
 * make the dotted key grammar ambiguous. Narrower than SAFE_ID.
 */
export const PROPOSAL_PARAMETER_SLUG_BODY = "[A-Za-z0-9][A-Za-z0-9_-]*";
export const PROPOSAL_PARAMETER_SLUG = new RegExp(
  `^${PROPOSAL_PARAMETER_SLUG_BODY}$`,
);

/**
 * Assert that value is a plain object with exactly the declared keys.
 * A key in excess or a key missing both throw TypeError — fail-closed.
 */
export function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const expectedSet = new Set(keys);
  for (const key of Object.keys(rec)) {
    if (!expectedSet.has(key)) {
      throw new TypeError(`${path} has unsupported field ${key}.`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(rec, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  return rec;
}

/**
 * A plain object whose keys stay inside `allowed` and include every
 * `required` key. Extra or missing keys throw TypeError.
 */
export function closedRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(rec)) {
    if (!allowedSet.has(key)) {
      throw new TypeError(`${path} has unsupported field ${key}.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(rec, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  return rec;
}

/** Assert that value is an array. */
export function arrayOf(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

/** Assert that value is a non-empty array. */
export function nonEmptyArray(value: unknown, path: string): unknown[] {
  const result = arrayOf(value, path);
  if (result.length === 0) throw new TypeError(`${path} must not be empty.`);
  return result;
}

/** Assert that value is a non-empty string without leading or trailing whitespace. */
export function nonEmptyText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty string without edge whitespace.`);
  }
  return value;
}

/**
 * Assert that value is a non-empty string that matches the stable-identifier
 * pattern: starts with alphanumeric, followed by alphanumerics, `.`, `_`, `:`,
 * or `-`, up to 256 characters total.
 */
export function safeId(value: unknown, path: string): string {
  const s = nonEmptyText(value, path);
  if (!SAFE_ID.test(s)) {
    throw new TypeError(
      `${path} must be a stable identifier (letters, digits, ._:-).`,
    );
  }
  return s;
}

/**
 * Assert that value can occupy one segment of a dotted MRTR parameter key.
 * Rejects dots and colons even though SAFE_ID would accept them.
 */
export function proposalParameterSlug(value: unknown, path: string): string {
  const s = nonEmptyText(value, path);
  if (!PROPOSAL_PARAMETER_SLUG.test(s) || s.length > 256) {
    throw new TypeError(
      `${path} must be a proposal parameter slug (letters, digits, hyphen, underscore; no dot or colon).`,
    );
  }
  return s;
}

/**
 * Assert a bounded ASCII version token. Unlike ordinary stable identifiers,
 * versions may carry build metadata such as `1.0.0+occt`; the separate helper
 * keeps `+` unavailable to every non-version identifier.
 */
export function safeVersion(value: unknown, path: string): string {
  const version = nonEmptyText(value, path);
  if (!SAFE_VERSION.test(version)) {
    throw new TypeError(
      `${path} must be a safe ASCII version (letters, digits, ._:+-; at most 128 characters).`,
    );
  }
  return version;
}

/** Assert an immutable version identity rather than a mutable release alias. */
export function exactVersionToken(value: unknown, path: string): string {
  const version = safeVersion(value, path);
  if (["latest", "current", "stable", "default"].includes(version.toLowerCase())) {
    throw new TypeError(`${path} must not be a mutable version alias.`);
  }
  return version;
}

/** Assert that value is a finite number. */
export function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

/** Assert that value is a safe positive integer (>= 1). */
export function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return Number(value);
}

/** Assert that value strictly equals expected. */
export function literalValue(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new TypeError(`${path} must equal ${JSON.stringify(expected)}.`);
  }
}

/** Assert that values contains no duplicates. */
export function rejectDuplicates(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${path} must not contain duplicates.`);
  }
}

/** Recursively freeze value and all its nested objects. Idempotent. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
