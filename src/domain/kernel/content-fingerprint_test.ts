import { assertEquals, assertThrows } from "@std/assert";
import { requireSha256Fingerprint } from "./content-fingerprint.ts";

const VALID = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("requireSha256Fingerprint accepts a sha256 64-lowercase-hex digest", () => {
  assertEquals(requireSha256Fingerprint(VALID, "fingerprint"), VALID);
});

Deno.test("requireSha256Fingerprint refuses an invalid ContentFingerprint", () => {
  assertThrows(
    () =>
      requireSha256Fingerprint(
        { algorithm: "sha256", digest: "a".repeat(32) },
        "fingerprint",
      ),
    TypeError,
    "sha256 64-lowercase-hex",
  );
  assertThrows(
    () =>
      requireSha256Fingerprint(
        { algorithm: "sha256", digest: "A".repeat(64) },
        "fingerprint",
      ),
    TypeError,
    "sha256 64-lowercase-hex",
  );
  assertThrows(
    () =>
      requireSha256Fingerprint(
        { algorithm: "sha1" as "sha256", digest: "a".repeat(64) },
        "fingerprint",
      ),
    TypeError,
    "sha256 64-lowercase-hex",
  );
  assertThrows(
    () => requireSha256Fingerprint(undefined, "fingerprint"),
    TypeError,
    "sha256 64-lowercase-hex",
  );
});
