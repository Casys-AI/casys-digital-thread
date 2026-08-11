import { assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  FileSensitivityRunAttemptStore,
  SensitivityRunIllegalTransitionError,
  SensitivityRunOutcomeUnknownError,
} from "./file-sensitivity-run-attempt-store.ts";

const AT = "2026-08-04T00:00:00.000Z";
const DIVERGENT_AT = "2026-08-04T00:01:00.000Z";

function begin(caseDigest = "b".repeat(64)) {
  return {
    projectId: "coffee-machine-cm01-v3",
    runId: "run:sensitivity-test",
    caseDigest,
    dispatchedAt: AT,
  };
}

async function capture() {
  const canonicalCaptureText = deterministicJson({
    schemaVersion: "sensitivity-study-capture/test",
    trustedRunId: begin().runId,
  });
  return {
    canonicalCaptureText,
    captureFingerprint: await sha256Fingerprint(JSON.parse(canonicalCaptureText)),
  };
}

Deno.test("a fresh sensitivity attempt reserves exactly one provider dispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    assertEquals(await store.begin(begin()), { action: "dispatch" });
    await assertRejects(
      () => store.begin(begin()),
      SensitivityRunOutcomeUnknownError,
      "will not be retried automatically",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture-recorded and completed states recover exact capture bytes without dispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const exact = await capture();
    await store.begin(begin());
    await store.recordCapture({ ...begin(), recordedAt: AT, ...exact });
    assertEquals(await store.begin(begin()), {
      action: "capture-recorded",
      ...exact,
    });
    await store.complete({
      ...begin(),
      completedAt: "2026-08-04T00:01:00.000Z",
      captureFingerprint: exact.captureFingerprint,
    });
    assertEquals(await store.begin(begin()), {
      action: "completed",
      ...exact,
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture-recorded and completed attempts reject a divergent dispatched start", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const exact = await capture();
    await store.begin(begin());
    await store.recordCapture({ ...begin(), recordedAt: AT, ...exact });
    await assertRejects(
      () => store.begin({ ...begin(), dispatchedAt: DIVERGENT_AT }),
      SensitivityRunOutcomeUnknownError,
    );
    await store.complete({
      ...begin(),
      completedAt: DIVERGENT_AT,
      captureFingerprint: exact.captureFingerprint,
    });
    await assertRejects(
      () => store.begin({ ...begin(), dispatchedAt: DIVERGENT_AT }),
      SensitivityRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a raced attempt with a divergent dispatched start is outcome-unknown", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const instrumented = store as unknown as {
      readExisting: (...args: string[]) => Promise<unknown>;
    };
    const originalReadExisting = instrumented.readExisting.bind(store);
    let pauseFirstRead!: () => void;
    const firstReadReached = new Promise<void>((resolve) => {
      pauseFirstRead = resolve;
    });
    let releaseFirstRead!: () => void;
    const firstReadReleased = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let firstRead = true;
    instrumented.readExisting = async (...args: string[]) => {
      if (firstRead) {
        firstRead = false;
        pauseFirstRead();
        await firstReadReleased;
      }
      return await originalReadExisting(...args);
    };

    const losingBegin = store.begin(begin());
    await firstReadReached;
    assertEquals(
      await store.begin({ ...begin(), dispatchedAt: DIVERGENT_AT }),
      { action: "dispatch" },
    );
    releaseFirstRead();
    await assertRejects(
      () => losingBegin,
      SensitivityRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a legacy completed attempt rejects a divergent dispatched start", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const path = store.pathFor(begin().projectId, begin().runId, begin().caseDigest);
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(
      path,
      deterministicJson({
        schemaVersion: "sensitivity-run-attempt/1.0",
        projectId: begin().projectId,
        runId: begin().runId,
        caseDigest: begin().caseDigest,
        status: "completed",
        dispatchedAt: AT,
        completedAt: DIVERGENT_AT,
        captureFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      }),
    );
    await assertRejects(
      () => store.begin({ ...begin(), dispatchedAt: DIVERGENT_AT }),
      SensitivityRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture-recorded WAL replay rejects tampered capture text or fingerprint", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const exact = await capture();
    await store.begin(begin());
    await store.recordCapture({ ...begin(), recordedAt: AT, ...exact });
    const path = store.pathFor(begin().projectId, begin().runId, begin().caseDigest);
    const record = JSON.parse(await Deno.readTextFile(path));
    record.canonicalCaptureText = deterministicJson({ tampered: true });
    await Deno.writeTextFile(path, deterministicJson(record));
    await assertRejects(
      () => store.begin(begin()),
      SensitivityRunOutcomeUnknownError,
    );

    record.canonicalCaptureText = exact.canonicalCaptureText;
    record.captureFingerprint = { algorithm: "sha256", digest: "a".repeat(64) };
    await Deno.writeTextFile(path, deterministicJson(record));
    await assertRejects(
      () => store.begin(begin()),
      SensitivityRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a completed WAL replay revalidates its exact capture text", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const exact = await capture();
    await store.begin(begin());
    await store.recordCapture({ ...begin(), recordedAt: AT, ...exact });
    await store.complete({
      ...begin(),
      completedAt: DIVERGENT_AT,
      captureFingerprint: exact.captureFingerprint,
    });
    const path = store.pathFor(begin().projectId, begin().runId, begin().caseDigest);
    const record = JSON.parse(await Deno.readTextFile(path));
    record.canonicalCaptureText = JSON.stringify(
      JSON.parse(exact.canonicalCaptureText),
      null,
      2,
    );
    await Deno.writeTextFile(path, deterministicJson(record));
    await assertRejects(
      () => store.begin(begin()),
      SensitivityRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("complete refuses a dispatched sensitivity attempt without capture-recorded", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const exact = await capture();
    await store.begin(begin());
    await assertRejects(
      () =>
        store.complete({
          ...begin(),
          completedAt: "2026-08-04T00:01:00.000Z",
          captureFingerprint: exact.captureFingerprint,
        }),
      SensitivityRunIllegalTransitionError,
      "dispatched -> completed",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a different case digest reserves a distinct attempt", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    await store.begin(begin());
    assertEquals(await store.begin(begin("c".repeat(64))), { action: "dispatch" });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a corrupted or extended sensitivity WAL shape is outcome-unknown", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    await store.begin(begin());
    const path = store.pathFor(begin().projectId, begin().runId, begin().caseDigest);
    const record = JSON.parse(await Deno.readTextFile(path));
    record.undeclared = true;
    await Deno.writeTextFile(path, deterministicJson(record));
    await assertRejects(
      () => store.begin(begin()),
      SensitivityRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
