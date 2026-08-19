import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  FileModelicaRecordedScenarioAttemptStore,
  ModelicaRecordedScenarioAttemptIntegrityError,
} from "./recorded-scenario-attempt-store.ts";

const PROJECT = "recorded-modelica-project";
const RUN = "run:recorded-modelica";
const PLAN = "a".repeat(64);
const MANIFEST = "b".repeat(64);
const REQUEST = "c".repeat(64);
const RESOURCE = "d".repeat(64);
const CAPTURE = "e".repeat(64);
const AT = "2026-08-12T09:00:00.000Z";

Deno.test("recorded Modelica WAL makes a dispatched recovery request_get-only and CAS-only after capture", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-modelica-recorded-wal-" });
  try {
    const store = new FileModelicaRecordedScenarioAttemptStore(directory);
    let attempt = await store.begin({
      projectId: PROJECT,
      runId: RUN,
      planSha256: PLAN,
      requestId: "request-modelica-v2",
      manifestSha256: MANIFEST,
      preparedAt: AT,
    });
    assertEquals(attempt.status, "pre-dispatch");
    attempt = await store.markDispatched({
      projectId: PROJECT,
      runId: RUN,
      dispatchedAt: AT,
    });
    assertEquals(attempt.status, "dispatched");
    attempt = await store.recordProviderRun({
      projectId: PROJECT,
      runId: RUN,
      requestSha256: REQUEST,
      manifestSha256: MANIFEST,
      providerRunId: "run_123e4567-e89b-42d3-a456-426614174000",
    });
    assertEquals(attempt.status, "provider-run-known");
    attempt = await store.recordResourcesCaptured({
      projectId: PROJECT,
      runId: RUN,
      resources: [{
        role: "run.json",
        uri: `casys://modelica-runs/sha256/${RESOURCE}`,
        mediaType: "application/json",
        byteCount: 1,
        sha256: RESOURCE,
      }],
      captureManifest: {
        uri: `casys://modelica-recorded-resource-manifest/sha256/${CAPTURE}`,
        byteCount: 2,
        sha256: CAPTURE,
      },
      evidence: {
        runId: "run_123e4567-e89b-42d3-a456-426614174000",
        status: "succeeded",
        startedAt: AT,
        completedAt: "2026-08-12T09:01:00.000Z",
        resolvedParameters: {},
        metrics: { temperature: { value: 90, unit: "degC" } },
        warnings: [],
      },
    });
    assertEquals(attempt.status, "resources-captured");
    attempt = await store.complete({
      projectId: PROJECT,
      runId: RUN,
      snapshot: { snapshotId: "subject:r2", revision: 2, subjectId: "subject" },
    });
    assertEquals(attempt.status, "completed");
    const reread = await store.read(PROJECT, RUN);
    assertEquals(reread, attempt);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recorded Modelica WAL refuses a provider run before durable dispatch and divergent plan adoption", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-recorded-wal-reject-",
  });
  try {
    const store = new FileModelicaRecordedScenarioAttemptStore(directory);
    await store.begin({
      projectId: PROJECT,
      runId: RUN,
      planSha256: PLAN,
      requestId: "request-modelica-v2",
      manifestSha256: MANIFEST,
      preparedAt: AT,
    });
    await assertRejects(
      () =>
        store.recordProviderRun({
          projectId: PROJECT,
          runId: RUN,
          requestSha256: REQUEST,
          manifestSha256: MANIFEST,
          providerRunId: "run_123e4567-e89b-42d3-a456-426614174000",
        }),
      ModelicaRecordedScenarioAttemptIntegrityError,
      "before durable dispatch",
    );
    await assertRejects(
      () =>
        store.begin({
          projectId: PROJECT,
          runId: RUN,
          planSha256: "f".repeat(64),
          requestId: "request-modelica-v2",
          manifestSha256: MANIFEST,
          preparedAt: AT,
        }),
      ModelicaRecordedScenarioAttemptIntegrityError,
      "different sealed request",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recorded Modelica WAL preserves a durable dispatched marker after a lost acknowledgement", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-recorded-wal-lost-ack-",
  });
  try {
    const store = new FileModelicaRecordedScenarioAttemptStore(directory);
    await store.begin({
      projectId: PROJECT,
      runId: RUN,
      planSha256: PLAN,
      requestId: "request-modelica-v2",
      manifestSha256: MANIFEST,
      preparedAt: AT,
    });
    await store.markDispatched({ projectId: PROJECT, runId: RUN, dispatchedAt: AT });
    const recovered = await store.begin({
      projectId: PROJECT,
      runId: RUN,
      planSha256: PLAN,
      requestId: "request-modelica-v2",
      manifestSha256: MANIFEST,
      preparedAt: AT,
    });
    assertEquals(recovered.status, "dispatched");
    assert(
      recovered.status !== "pre-dispatch",
      "a lost acknowledgement cannot reopen submit authority",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
