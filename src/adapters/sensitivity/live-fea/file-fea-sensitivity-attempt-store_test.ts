import { assertEquals, assertRejects } from "@std/assert";
import {
  FeaSensitivityIllegalTransitionError,
  FeaSensitivityOutcomeUnknownError,
  FileFeaSensitivityAttemptStore,
} from "./file-fea-sensitivity-attempt-store.ts";

const RUNTIME = {
  operationalCapabilityFingerprint: {
    algorithm: "sha256" as const,
    digest: "0".repeat(64),
  },
  binding: { id: "calculix-static-sensitivity", version: "1.0.0" },
  material: {
    unitId: "casys.mcp-calculix",
    materialId: "mcp-calculix-image",
    imageDigest: "1".repeat(64),
  },
  launchGroup: {
    id: "casys-mcp-calculix",
    version: "0.8.2",
    fingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
  },
};

Deno.test("a dispatched CAD slot cannot be dispatched again", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      runtime: RUNTIME,
    });
    await store.markCadDispatched({
      projectId: "p",
      runId: "r",
      phase: "base",
      executionRunId: "r:cad-base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      sourceSha256: "a".repeat(64),
    });
    await assertRejects(
      () =>
        store.markCadDispatched({
          projectId: "p",
          runId: "r",
          phase: "base",
          executionRunId: "r:cad-base",
          dispatchedAt: "2026-08-14T00:00:01.000Z",
          sourceSha256: "a".repeat(64),
        }),
      FeaSensitivityOutcomeUnknownError,
      "dispatched without a published STEP",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a prepared or dispatched solve is never reset or redispatched", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      runtime: RUNTIME,
    });
    await store.markSolvePrepared({
      projectId: "p",
      runId: "r",
      phase: "base",
      preparedAt: "2026-08-14T00:00:00.000Z",
      stepSha256: "a".repeat(64),
      stepBytes: 10,
      requestId: "request-base",
    });
    await store.markSolveDispatched({
      projectId: "p",
      runId: "r",
      phase: "base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      providerRunId: "r-11111111-1111-1111-1111-111111111111",
      requestSha256: "b".repeat(64),
    });
    const preserved = await store.markSolvePrepared({
      projectId: "p",
      runId: "r",
      phase: "base",
      preparedAt: "2026-08-14T00:00:00.000Z",
      stepSha256: "a".repeat(64),
      stepBytes: 10,
      requestId: "request-base",
    });
    assertEquals(preserved.solves.base.status, "dispatched");
    await assertRejects(
      () =>
        store.markSolveDispatched({
          projectId: "p",
          runId: "r",
          phase: "base",
          dispatchedAt: "2026-08-14T00:00:01.000Z",
          providerRunId: "r-11111111-1111-1111-1111-111111111111",
          requestSha256: "b".repeat(64),
        }),
      FeaSensitivityIllegalTransitionError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("WAL parse rejects a published CAD slot with an extra key", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      runtime: RUNTIME,
    });
    const path = `${directory}/p__r.json`;
    const tampered = JSON.parse(await Deno.readTextFile(path));
    tampered.cad.base = {
      status: "published",
      executionRunId: "r:cad-base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      sourceSha256: "a".repeat(64),
      stepSha256: "b".repeat(64),
      stepBytes: 4,
      bytes: [1, 2, 3, 4],
    };
    await Deno.writeTextFile(path, `${JSON.stringify(tampered)}\n`);
    await assertRejects(
      () => store.read("p", "r"),
      TypeError,
      "unsupported field bytes",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("sensitivity CAD WAL persists output-validation rejection and refuses redispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      runtime: RUNTIME,
    });
    await store.markCadDispatched({
      projectId: "p",
      runId: "r",
      phase: "base",
      executionRunId: "r:cad-base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      sourceSha256: "a".repeat(64),
    });
    const observation = {
      role: "geometry",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    const destruction = {
      status: "proven" as const,
      runId: "r:cad-base",
      proofFingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    };
    const rejected = await store.markCadOutputValidationRejected({
      projectId: "p",
      runId: "r",
      phase: "base",
      observation,
      destruction,
      registeredRoles: ["geometry"],
    });
    assertEquals(rejected.cad.base.status, "output-validation-rejected");
    const restarted = new FileFeaSensitivityAttemptStore(directory);
    const recovered = await restarted.read("p", "r");
    assertEquals(recovered?.cad.base, rejected.cad.base);
    assertEquals(
      await restarted.markCadOutputValidationRejected({
        projectId: "p",
        runId: "r",
        phase: "base",
        observation,
        destruction,
        registeredRoles: ["geometry"],
      }),
      recovered,
    );
    await assertRejects(
      () =>
        restarted.markCadDispatched({
          projectId: "p",
          runId: "r",
          phase: "base",
          executionRunId: "r:cad-base",
          dispatchedAt: "2026-08-14T00:00:01.000Z",
          sourceSha256: "a".repeat(64),
        }),
      FeaSensitivityIllegalTransitionError,
      "output-validation-rejected",
    );
    await assertRejects(
      () =>
        restarted.markCadOutputValidationRejected({
          projectId: "p",
          runId: "r",
          phase: "base",
          observation: { ...observation, role: "job.dat" },
          destruction,
          registeredRoles: ["geometry"],
        }),
      FeaSensitivityIllegalTransitionError,
      "registered-output-role",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
