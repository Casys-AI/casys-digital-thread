import { parseArgs as _parseArgs } from "@std/cli";

/**
 * Parses CLI flags of the form --name=value, returning a record where absent
 * keys map to undefined. Wraps @std/cli parseArgs for the common script
 * pattern; string values are preserved, boolean and numeric flags are
 * converted to their string representations.
 */
export function parseArgs(args: string[]): Record<string, string | undefined> {
  const parsed = _parseArgs(args);
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_") continue;
    if (typeof value === "string") {
      record[key] = value;
    } else if (typeof value === "boolean" || typeof value === "number") {
      record[key] = String(value);
    }
  }
  return record;
}

/**
 * Validates that value matches the stable-identifier regex. Throws TypeError
 * with a message ending in a full stop — consistent with other TypeError
 * messages in the codebase.
 */
export function stableId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(`${label} must be a safe stable identifier.`);
  }
  return value;
}
