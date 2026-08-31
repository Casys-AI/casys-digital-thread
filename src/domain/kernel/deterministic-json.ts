import type { ContentFingerprint } from "./primitives.ts";
import { fingerprintResourceBytes } from "./resource-bytes.ts";

/** Canonical JSON with lexicographically sorted object keys and stable arrays. */
export function deterministicJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(deterministicJson).join(",")}]`;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Deterministic JSON cannot encode a non-finite number.");
      }
      return JSON.stringify(value);
    case "object": {
      const record = value as Record<string, unknown>;
      const entries = Object.keys(record).filter((key) => record[key] !== undefined)
        .sort().map((key) =>
          `${JSON.stringify(key)}:${deterministicJson(record[key])}`
        );
      return `{${entries.join(",")}}`;
    }
    default:
      throw new TypeError(`Deterministic JSON cannot encode ${typeof value}.`);
  }
}

/** SHA-256 of exact bytes as lowercase hex. Delegates to the kernel primitive. */
export function sha256Hex(bytes: Uint8Array): Promise<string> {
  return fingerprintResourceBytes(bytes);
}

export async function sha256Fingerprint(
  value: unknown,
): Promise<ContentFingerprint> {
  const bytes = new TextEncoder().encode(deterministicJson(value));
  return {
    algorithm: "sha256",
    digest: await sha256Hex(bytes),
  };
}

export function fingerprintsEqual(
  left: ContentFingerprint | undefined,
  right: ContentFingerprint | undefined,
): boolean {
  return left?.algorithm === right?.algorithm &&
    left?.digest.toLowerCase() === right?.digest.toLowerCase();
}
