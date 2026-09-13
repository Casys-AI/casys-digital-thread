import { assertEquals } from "@std/assert";
import { fingerprintResourceBytes } from "../../domain/kernel/resource-bytes.ts";
import { REQUIREMENTS_CAPTURE_DESCRIPTOR } from "../shared/cas/file-capture-store.ts";
import {
  createDocumentaryClauseResponseStore,
  DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY,
} from "./documentary-clause-response-store.ts";

Deno.test("writer clause-response CAS root is not nested under requirements-captures", async () => {
  assertEquals(
    DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY,
    "state/local/documentary-clause-responses",
  );
  assertEquals(
    DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY ===
      `${REQUIREMENTS_CAPTURE_DESCRIPTOR.directory}/clause-responses`,
    false,
  );
  const root = await Deno.makeTempDir({ prefix: "clause-response-cas-" });
  try {
    const directory = `${root}/${DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY}`;
    const writer = createDocumentaryClauseResponseStore(directory);
    const text = '{"schemaVersion":"documentary-clause-response/1.0"}';
    const digest = await fingerprintResourceBytes(
      new TextEncoder().encode(text),
    );
    const fingerprint = { algorithm: "sha256" as const, digest };
    await writer.save(fingerprint, text);
    const reader = createDocumentaryClauseResponseStore(directory);
    assertEquals(await reader.read(fingerprint), text);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
