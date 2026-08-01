import type { ContentFingerprint } from "./thread-snapshot.ts";

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

export async function sha256Fingerprint(
  value: unknown,
): Promise<ContentFingerprint> {
  const bytes = new TextEncoder().encode(deterministicJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

export function fingerprintsEqual(
  left: ContentFingerprint | undefined,
  right: ContentFingerprint | undefined,
): boolean {
  return left?.algorithm === right?.algorithm &&
    left?.digest.toLowerCase() === right?.digest.toLowerCase();
}
