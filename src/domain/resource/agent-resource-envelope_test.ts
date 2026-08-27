import { assertEquals, assertThrows } from "@std/assert";
import {
  AGENT_RESOURCE_MAX_BYTES,
  encodeCanonicalBase64,
  parseAgentResourceEnvelope,
} from "./agent-resource-envelope.ts";

Deno.test("agent resource envelope accepts UTF-8 text and rejects a path name", () => {
  const parsed = parseAgentResourceEnvelope({
    name: "notes.txt",
    mimeType: "text/plain",
    text: "hello",
  });
  assertEquals(parsed.representation, "text");
  assertEquals(parsed.bytes.byteLength, 5);
  assertThrows(
    () =>
      parseAgentResourceEnvelope({
        name: "../secret",
        mimeType: "text/plain",
        text: "hello",
      }),
    Error,
    "must not contain a path",
  );
});

Deno.test("agent resource envelope accepts canonical padded base64 and rejects XOR payloads", () => {
  const blob = encodeCanonicalBase64(new TextEncoder().encode("png-bytes"));
  const parsed = parseAgentResourceEnvelope({
    name: "icon",
    mimeType: "application/octet-stream",
    blob,
  });
  assertEquals(parsed.representation, "blob");
  assertEquals(new TextDecoder().decode(parsed.bytes), "png-bytes");
  assertThrows(
    () =>
      parseAgentResourceEnvelope({
        name: "both",
        mimeType: "text/plain",
        text: "a",
        blob,
      }),
    Error,
    "exactly one of text or blob",
  );
  assertThrows(
    () =>
      parseAgentResourceEnvelope({
        name: "none",
        mimeType: "text/plain",
      }),
    Error,
    "exactly one of text or blob",
  );
  assertThrows(
    () =>
      parseAgentResourceEnvelope({
        name: "bad-b64",
        mimeType: "application/octet-stream",
        blob: "abc",
      }),
    Error,
    "canonical padded standard base64",
  );
});

Deno.test("agent resource envelope enforces MIME length 256 like the public schema", () => {
  assertThrows(
    () =>
      parseAgentResourceEnvelope({
        name: "notes.txt",
        mimeType: `text/${"x".repeat(252)}`,
        text: "hello",
      }),
    Error,
    "mimeType is longer than 256 characters",
  );
});

Deno.test("agent resource envelope refuses payloads above the 262144-byte bound", () => {
  const over = "x".repeat(AGENT_RESOURCE_MAX_BYTES + 1);
  assertThrows(
    () =>
      parseAgentResourceEnvelope({
        name: "oversize",
        mimeType: "text/plain",
        text: over,
      }),
    Error,
    "at most 262144",
  );
});
