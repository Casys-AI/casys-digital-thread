import { assertEquals, assertRejects } from "@std/assert";
import {
  FileCm01DripTrayPrintEstimateAttemptStore,
  PrintEstimateRunOutcomeUnknownError,
  writeAll,
} from "./file-cm01-drip-tray-print-estimate-attempt-store.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";

const basis = {
  projectId: "coffee-machine-cm01-v3",
  runId: "run:print-estimate-wal",
  caseDigest: "a".repeat(64),
  dispatchedAt: "2026-08-11T00:00:00.000Z",
};

Deno.test("print-estimate WAL rereads and rejects a canonical capture whose fingerprint was tampered", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-print-estimate-wal-" });
  try {
    const store = new FileCm01DripTrayPrintEstimateAttemptStore(directory);
    const text = deterministicJson({ capture: "exact" });
    const fingerprint = await sha256Fingerprint(JSON.parse(text));
    await store.begin(basis);
    await store.recordCapture({
      ...basis,
      recordedAt: basis.dispatchedAt,
      canonicalCaptureText: text,
      captureFingerprint: fingerprint,
    });
    const path = store.pathFor(basis.projectId, basis.runId, basis.caseDigest);
    const wal = JSON.parse(await Deno.readTextFile(path));
    wal.captureFingerprint = { algorithm: "sha256", digest: "b".repeat(64) };
    await Deno.writeTextFile(path, deterministicJson(wal));
    await assertRejects(() => store.begin(basis), PrintEstimateRunOutcomeUnknownError);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("print-estimate WAL writeAll handles partial writes exactly", async () => {
  const chunks: number[] = [];
  const file = {
    write: (bytes: Uint8Array) => {
      const count = Math.min(2, bytes.length);
      chunks.push(...bytes.subarray(0, count));
      return Promise.resolve(count);
    },
  };
  await writeAll(file, new Uint8Array([1, 2, 3, 4, 5]));
  assertEquals(chunks, [1, 2, 3, 4, 5]);
});
