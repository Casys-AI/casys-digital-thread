import { assertEquals, assertRejects } from "@std/assert";
import { FileAgentResourceStore } from "../../../adapters/resource/file-agent-resource-store.ts";
import { parseAgentResourceEnvelope } from "../../../domain/resource/agent-resource-envelope.ts";
import { encodeCanonicalBase64 } from "../../../domain/resource/agent-resource-envelope.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../../domain/resource/agent-resource-reference.ts";
import {
  persistAgentResourceText,
  tamperAgentResourceReference,
} from "../../../testing/agent-resource-test-support.ts";
import {
  AgentResourceReopenError,
  ReopenAgentResource,
} from "./reopen-agent-resource.ts";

Deno.test("reopenUtf8Text returns copied exact text for a matching full reference", async () => {
  const root = await Deno.makeTempDir({ prefix: "reopen-resource-ok-" });
  try {
    const { reopen, reference } = await persistAgentResourceText(root, {
      name: "sheet.json",
      mimeType: "application/json",
      text: '{"ok":true}',
    });
    const reopened = await reopen.reopenUtf8Text(reference, {
      acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
      maxBytes: 262_144,
    });
    assertEquals(reopened.text, '{"ok":true}');
    assertEquals(reopened.reference.uri, reference.uri);
    reopened.bytes[0] = 0;
    const again = await reopen.reopenUtf8Text(reference, {
      acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
      maxBytes: 262_144,
    });
    assertEquals(again.text, '{"ok":true}');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("reopenUtf8Text refuses a tampered full reference and metadata mismatch", async () => {
  const root = await Deno.makeTempDir({ prefix: "reopen-resource-mismatch-" });
  try {
    const { reopen, reference } = await persistAgentResourceText(root, {
      name: "sheet.json",
      mimeType: "application/json",
      text: '{"ok":true}',
    });
    const options = {
      acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
      maxBytes: 262_144,
    };
    const nameError = await assertRejects(
      () =>
        reopen.reopenUtf8Text(
          tamperAgentResourceReference(reference, { name: "other.json" }),
          options,
        ),
      AgentResourceReopenError,
    );
    assertEquals(nameError.code, "resource_mismatch");
    const mimeError = await assertRejects(
      () =>
        reopen.reopenUtf8Text(
          tamperAgentResourceReference(reference, { mimeType: "text/plain" }),
          options,
        ),
      AgentResourceReopenError,
    );
    assertEquals(mimeError.code, "resource_mismatch");
    const digestError = await assertRejects(
      () =>
        reopen.reopenUtf8Text(
          tamperAgentResourceReference(reference, {
            fingerprint: {
              algorithm: "sha256",
              digest: "b".repeat(64),
            },
          }),
          options,
        ),
      AgentResourceReopenError,
    );
    assertEquals(digestError.code, "resource_mismatch");
    const missing = await assertRejects(
      () =>
        reopen.reopenUtf8Text(
          tamperAgentResourceReference(reference, {
            fingerprint: {
              algorithm: "sha256",
              digest: "b".repeat(64),
            },
            uri: `casys://agent-resource-capture/sha256/${"b".repeat(64)}`,
          }),
          options,
        ),
      AgentResourceReopenError,
    );
    assertEquals(missing.code, "resource_missing");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("reopenUtf8Text preserves a leading UTF-8 BOM for text and blob resource refs", async () => {
  const root = await Deno.makeTempDir({ prefix: "reopen-resource-bom-" });
  try {
    const bomText = '\uFEFF{"ok":true}';
    const text = await persistAgentResourceText(`${root}/text`, {
      name: "sheet.json",
      mimeType: "application/json",
      text: bomText,
    });
    const reopenedText = await text.reopen.reopenUtf8Text(text.reference, {
      acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
      maxBytes: 262_144,
    });
    assertEquals(reopenedText.text, bomText);
    assertEquals(reopenedText.text.charCodeAt(0), 0xfeff);
    assertEquals(
      new TextEncoder().encode(reopenedText.text),
      reopenedText.bytes,
    );

    const bomBytes = new TextEncoder().encode(bomText);
    const store = new FileAgentResourceStore(`${root}/blob`);
    const blob = await store.save(parseAgentResourceEnvelope({
      name: "sheet.json",
      mimeType: "application/json",
      blob: encodeCanonicalBase64(bomBytes),
    }));
    const reopenedBlob = await new ReopenAgentResource(store).reopenUtf8Text(
      blob.reference,
      {
        acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
        maxBytes: 262_144,
      },
    );
    assertEquals(reopenedBlob.text, bomText);
    assertEquals(reopenedBlob.bytes, bomBytes);
    assertEquals(new TextEncoder().encode(reopenedBlob.text), bomBytes);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("reopenUtf8Text refuses invalid UTF-8 blob, disallowed MIME, and oversize", async () => {
  const root = await Deno.makeTempDir({ prefix: "reopen-resource-guards-" });
  try {
    const store = new FileAgentResourceStore(root);
    const blob = await store.save(parseAgentResourceEnvelope({
      name: "blob.bin",
      mimeType: "application/octet-stream",
      blob: encodeCanonicalBase64(Uint8Array.from([0xff, 0xfe])),
    }));
    const reopen = new ReopenAgentResource(store);
    const utf8Error = await assertRejects(
      () =>
        reopen.reopenUtf8Text(blob.reference, {
          acceptedMimeTypes: ["application/octet-stream"],
          maxBytes: 262_144,
        }),
      AgentResourceReopenError,
    );
    assertEquals(utf8Error.code, "invalid_utf8");

    const json = await persistAgentResourceText(`${root}/json`, {
      name: "sheet.json",
      mimeType: "application/json",
      text: '{"ok":true}',
    });
    const mimeError = await assertRejects(
      () =>
        json.reopen.reopenUtf8Text(json.reference, {
          acceptedMimeTypes: ["text/x-python"],
          maxBytes: 262_144,
        }),
      AgentResourceReopenError,
    );
    assertEquals(mimeError.code, "disallowed_mime");
    const sizeError = await assertRejects(
      () =>
        json.reopen.reopenUtf8Text(json.reference, {
          acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
          maxBytes: 4,
        }),
      AgentResourceReopenError,
    );
    assertEquals(sizeError.code, "source_size_limit_exceeded");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("reopenExact copies matching bytes without a MIME allowlist", async () => {
  const root = await Deno.makeTempDir({ prefix: "reopen-exact-" });
  try {
    const { reopen, reference } = await persistAgentResourceText(root, {
      name: "notes.bin",
      mimeType: "application/octet-stream",
      text: "abc",
    });
    const reopened = await reopen.reopenExact(reference);
    assertEquals(new TextDecoder().decode(reopened.bytes), "abc");
    const mismatch = await assertRejects(
      () =>
        reopen.reopenExact(
          tamperAgentResourceReference(reference, { name: "other.bin" }),
        ),
      AgentResourceReopenError,
    );
    assertEquals(mismatch.code, "resource_mismatch");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
