import { SidecarFailure } from "./contracts.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
  code: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SidecarFailure(code, `${path} must be an object`);
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new SidecarFailure(code, `${path} has unsupported field ${key}`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new SidecarFailure(code, `${path}.${key} is required`);
    }
  }
  return value;
}

export function parseJsonObject(text: string, path: string, code: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SidecarFailure(code, `${path} is not valid JSON`);
  }
}
