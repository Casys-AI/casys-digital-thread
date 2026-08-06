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
