/** Guard for a sha256 64-lowercase-hex ContentFingerprint. */

import type { ContentFingerprint } from "./primitives.ts";

const SHA256_DIGEST = /^[a-f0-9]{64}$/;

export function requireSha256Fingerprint(
  value: ContentFingerprint | undefined,
  path: string,
): ContentFingerprint {
  if (
    value?.algorithm !== "sha256" ||
    typeof value.digest !== "string" ||
    !SHA256_DIGEST.test(value.digest)
  ) {
    throw new TypeError(
      `${path} must be a sha256 64-lowercase-hex ContentFingerprint.`,
    );
  }
  return { algorithm: "sha256", digest: value.digest };
}
