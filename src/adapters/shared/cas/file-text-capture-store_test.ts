import { assertEquals, assertRejects } from "@std/assert";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { FileByteStore } from "./file-byte-store.ts";
import { fileTextCaptureStore } from "./file-text-capture-store.ts";

Deno.test(
  "file text capture store round-trips UTF-8, reads absent as undefined, and fails closed on invalid UTF-8",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-text-capture-store-",
    });
    try {
      const bytes = new FileByteStore({
        kind: "text-capture",
        directory,
        uriNamespace: "text-capture",
        label: "Text capture",
      });
      const store = fileTextCaptureStore(bytes);
      const text = "canonical utf-8 café";
      const digest = await fingerprintResourceBytes(
        new TextEncoder().encode(text),
      );
      const fingerprint = { algorithm: "sha256" as const, digest };

      assertEquals(await store.read(fingerprint), undefined);
      await store.save(fingerprint, text);
      assertEquals(await store.read(fingerprint), text);

      const invalid = new Uint8Array([0xff]);
      const invalidDigest = await fingerprintResourceBytes(invalid);
      const invalidFingerprint = {
        algorithm: "sha256" as const,
        digest: invalidDigest,
      };
      await bytes.save(invalidFingerprint, invalid);
      await assertRejects(() => store.read(invalidFingerprint), TypeError);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
