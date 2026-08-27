import { assertEquals, assertThrows } from "@std/assert";
import { parseAgentResourceReference } from "./agent-resource-reference.ts";

const DIGEST = "a".repeat(64);

function validReference() {
  return {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${DIGEST}`,
    name: "source.py",
    mimeType: "text/x-python",
    representation: "text",
    byteCount: 12,
    fingerprint: { algorithm: "sha256", digest: DIGEST },
  };
}

Deno.test("parseAgentResourceReference accepts a closed full reference", () => {
  const parsed = parseAgentResourceReference(validReference());
  assertEquals(parsed.name, "source.py");
  assertEquals(parsed.fingerprint.digest, DIGEST);
});

Deno.test("parseAgentResourceReference refuses extra, partial, and mismatched digest fields", () => {
  assertThrows(
    () => parseAgentResourceReference({ ...validReference(), path: "/tmp" }),
    TypeError,
    "unsupported field path",
  );
  const { fingerprint: _, ...withoutFingerprint } = validReference();
  assertThrows(
    () => parseAgentResourceReference(withoutFingerprint),
    TypeError,
    "fingerprint is required",
  );
  assertThrows(
    () =>
      parseAgentResourceReference({
        ...validReference(),
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      }),
    TypeError,
    "uri digest does not match fingerprint.digest",
  );
});
