/**
 * Shared validation primitives for script-level JSON parsing.
 *
 * WHY THIS MODULE EXISTS — run-coffee-machine-cm01-v3-correction.ts and
 * run-coffee-machine-cm01-v3-mechanical-r3-retry.ts contained byte-identical
 * copies of these four helpers. One canonical copy eliminates the risk of a
 * future divergence going unnoticed.
 *
 * CONTRACT NOTE — these helpers throw Error (not TypeError) and use the
 * parameter name "name" rather than "path", which differs from
 * src/domain/kernel/case-validation.ts. The two modules serve different
 * contexts and must not be force-merged: case-validation.ts targets domain
 * schemas with fail-closed exactRecord semantics; this module targets
 * script-level MCP response parsing where only a subset of fields is checked.
 */

export function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

export function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

/**
 * Assert that value is a safe positive integer (>= 1).
 * "Safe" here means Number.isSafeInteger, consistent with the script-level
 * contract for revision counters carried in MCP responses.
 */
export function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
