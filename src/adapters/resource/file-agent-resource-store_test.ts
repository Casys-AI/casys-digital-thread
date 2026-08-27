import { assertEquals, assertRejects } from "@std/assert";
import { parseAgentResourceEnvelope } from "../../domain/resource/agent-resource-envelope.ts";
import { encodeCanonicalBase64 } from "../../domain/resource/agent-resource-envelope.ts";
import { FileAgentResourceStore } from "./file-agent-resource-store.ts";

Deno.test("agent resource store round-trips text, is idempotent, and rediscovers after reopen", async () => {
  const root = await Deno.makeTempDir({ prefix: "agent-resource-store-" });
  try {
    const store = new FileAgentResourceStore(root);
    const envelope = parseAgentResourceEnvelope({
      name: "sheet.json",
      mimeType: "application/json",
      text: '{"ok":true}',
    });
    const first = await store.save(envelope);
    const second = await store.save(envelope);
    assertEquals(second.reference.uri, first.reference.uri);
    assertEquals(
      second.reference.fingerprint.digest,
      first.reference.fingerprint.digest,
    );
    const rediscovered = new FileAgentResourceStore(root);
    const listed = await rediscovered.list();
    assertEquals(listed.length, 1);
    assertEquals(listed[0]?.reference.uri, first.reference.uri);
    assertEquals(new TextDecoder().decode(listed[0]!.bytes), '{"ok":true}');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("agent resource store refuses same bytes with conflicting name, MIME, or representation", async () => {
  const root = await Deno.makeTempDir({ prefix: "agent-resource-conflict-" });
  try {
    const store = new FileAgentResourceStore(root);
    const text = '{"ok":true}';
    await store.save(parseAgentResourceEnvelope({
      name: "sheet.json",
      mimeType: "application/json",
      text,
    }));
    await assertRejects(
      () =>
        store.save(parseAgentResourceEnvelope({
          name: "other.json",
          mimeType: "application/json",
          text,
        })),
      TypeError,
      "metadata does not match the captured envelope",
    );
    await assertRejects(
      () =>
        store.save(parseAgentResourceEnvelope({
          name: "sheet.json",
          mimeType: "text/plain",
          text,
        })),
      TypeError,
      "metadata does not match the captured envelope",
    );
    await assertRejects(
      () =>
        store.save(parseAgentResourceEnvelope({
          name: "sheet.json",
          mimeType: "application/json",
          blob: encodeCanonicalBase64(new TextEncoder().encode(text)),
        })),
      TypeError,
      "metadata does not match the captured envelope",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("agent resource store preserves blob bytes across reread", async () => {
  const root = await Deno.makeTempDir({ prefix: "agent-resource-blob-" });
  try {
    const store = new FileAgentResourceStore(root);
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    const stored = await store.save(parseAgentResourceEnvelope({
      name: "blob.bin",
      mimeType: "application/octet-stream",
      blob: encodeCanonicalBase64(bytes),
    }));
    assertEquals(stored.reference.representation, "blob");
    const reread = await store.read(stored.reference.uri);
    assertEquals(reread?.bytes, bytes);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
