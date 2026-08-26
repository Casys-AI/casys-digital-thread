import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { AdmittedModelicaExecutionAttemptIdentity } from "../../../application/ports/out/modelica/admitted-execution-attempt-store.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  deriveAdmittedModelicaExecutionRunId,
} from "../../../domain/modelica/admitted/execution-evidence.ts";
import {
  validateModelicaAdmittedRunAdmission,
} from "../../../domain/modelica/admitted/run-proposal.ts";
import { FixedAdmittedModelicaExecutionProfileCatalog } from "./execution-profile-catalog.ts";
import {
  AdmittedModelicaExecutionAttemptIntegrityError,
  FileAdmittedModelicaExecutionAttemptStore,
} from "./file-execution-attempt-store.ts";

const AT = "2026-08-20T05:00:00.000Z";
const RUN_PERMISSION = await Deno.permissions.query({ name: "run" });

Deno.test("admitted Modelica WAL follows the exact generation-zero path and completes only with its Thread successor", async () => {
  await withStore(async (store, directory) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    assertEquals(prepared.phase, "prepared");
    assertEquals(await store.prepare(fixture.identity, AT), prepared);
    await assertRejects(
      () => store.prepare(fixture.identity, "2026-08-20T05:00:01.000Z"),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "differs from its exact run start",
    );
    const key = keyFor(prepared);
    const firstDispatch = await store.markDispatching({
      ...key,
      dispatchedAt: AT,
    });
    assertEquals(firstDispatch.outcome, "transitioned-now");
    const dispatching = firstDispatch.attempt;
    assertEquals(dispatching.phase, "dispatching");
    if (dispatching.phase !== "dispatching") throw new Error("unreachable");
    assertEquals(dispatching.dispatch, {
      dispatchCount: 1,
      producerGeneration: 0,
      dispatchedAt: AT,
    });
    assertEquals(dispatching.generationRecovery, null);
    assertEquals(await store.markDispatching({ ...key, dispatchedAt: AT }), {
      outcome: "already-transitioned",
      attempt: dispatching,
    });
    await assertRejects(
      () =>
        store.markDispatching({
          ...key,
          dispatchedAt: "2026-08-20T05:00:01.000Z",
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "differs from its exact run start",
    );

    const published = await store.markOutputPublished({
      ...key,
      receiptRecord: fixture.receiptG0,
    });
    assertEquals(published.phase, "output-published");
    assertEquals(
      await store.markOutputPublished({
        ...key,
        receiptRecord: fixture.receiptG0,
      }),
      published,
    );
    await assertRejects(
      () => store.markCompleted({ ...key, threadEvidence: fixture.foreignThread }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "exact documentary successor",
    );
    const completed = await store.markCompleted({
      ...key,
      threadEvidence: fixture.threadG0,
    });
    assertEquals(completed.phase, "completed");
    assertEquals(
      await store.markCompleted({ ...key, threadEvidence: fixture.threadG0 }),
      completed,
    );
    assertEquals(
      await store.markOutputPublished({
        ...key,
        receiptRecord: fixture.receiptG0,
      }),
      completed,
    );
    assertEquals(
      await store.read(fixture.identity.projectId, fixture.identity.agentRunId),
      completed,
    );

    if (Deno.build.os !== "windows") {
      assertEquals((await Deno.stat(directory)).mode! & 0o777, 0o700);
      assertEquals(
        (await Deno.stat(
          await store.pathFor(
            fixture.identity.projectId,
            fixture.identity.agentRunId,
          ),
        )).mode! & 0o777,
        0o600,
      );
    }
  });
});

Deno.test("admitted Modelica WAL fences cleanup before one generation-one dispatch and keeps ACK loss recovery-only", async () => {
  await withStore(async (store, directory) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    await assertRejects(
      () =>
        store.markGenerationZeroCleaned({
          ...key,
          destruction: fixture.unattestedDestruction as never,
        }),
      TypeError,
    );
    const cleaned = await store.markGenerationZeroCleaned({
      ...key,
      destruction: fixture.generationZeroDestruction,
    });
    assertEquals(cleaned.phase, "generation-zero-cleaned");
    assertEquals(
      await store.markGenerationZeroCleaned({
        ...key,
        destruction: fixture.generationZeroDestruction,
      }),
      cleaned,
    );
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });

    // Simulate a durable write whose return acknowledgement never reaches the
    // executor: discard the return value and reconstruct the adapter. The
    // reopened state is already dispatching generation one. The executor must
    // therefore enter publication recovery/cleanup and never call runner.run.
    const redispatch = await store.markRedispatching({
      ...key,
      advance,
      dispatchedAt: AT,
    });
    assertEquals(redispatch.outcome, "transitioned-now");
    const reopened = await new FileAdmittedModelicaExecutionAttemptStore(directory)
      .read(fixture.identity.projectId, fixture.identity.agentRunId);
    assertEquals(reopened?.phase, "dispatching");
    if (reopened?.phase !== "dispatching") throw new Error("unreachable");
    assertEquals(reopened.dispatch, {
      dispatchCount: 2,
      producerGeneration: 1,
      dispatchedAt: AT,
    });
    assertEquals(reopened.generationRecovery, {
      generationZeroDestruction: fixture.generationZeroDestruction,
      advance,
    });
    assertEquals(
      await store.markRedispatching({ ...key, advance, dispatchedAt: AT }),
      { outcome: "already-transitioned", attempt: reopened },
    );
    await assertRejects(
      () => store.markDispatching({ ...key, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "divergent",
    );
    await assertRejects(
      () =>
        store.markGenerationZeroCleaned({
          ...key,
          destruction: fixture.generationZeroDestruction,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptG0,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "durable identity",
    );
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.forgedPublicationReceipt,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "durable identity",
    );
    const published = await store.markOutputPublished({
      ...key,
      receiptRecord: fixture.receiptG1,
    });
    assertEquals(published.phase, "output-published");
    const completed = await store.markCompleted({
      ...key,
      threadEvidence: fixture.threadG1,
    });
    assertEquals(completed.phase, "completed");
  });
});

Deno.test("admitted Modelica WAL rejects authority, basis and byte-free request transplants", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    await assertRejects(
      () =>
        store.prepare({
          ...fixture.identity,
          executionRunId: "admitted-modelica-foreign",
          isolatedRequest: {
            ...fixture.identity.isolatedRequest,
            runId: "admitted-modelica-foreign",
          },
        }, AT),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "not server-derived",
    );
    await assertRejects(
      () =>
        store.prepare({
          ...fixture.identity,
          approval: {
            ...fixture.identity.approval,
            inputFingerprint: hash("e"),
          },
        }, AT),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "fingerprints diverge",
    );
    await assertRejects(
      () =>
        store.prepare({
          ...fixture.identity,
          isolatedRequest: {
            ...fixture.identity.isolatedRequest,
            sourceSha256: "e".repeat(64),
          },
        }, AT),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "differ from their durable authority",
    );
    await assertRejects(
      () =>
        store.prepare({
          ...fixture.identity,
          basis: { ...fixture.identity.basis, snapshotId: "latest" },
        }, AT),
      TypeError,
      "latest alias",
    );
    await assertRejects(
      () =>
        store.prepare({
          ...fixture.identity,
          startedAt: "2026-08-20T05:00:01.000Z",
        }, AT),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "differs from its exact run start",
    );

    const prepared = await store.prepare(fixture.identity, AT);
    await assertRejects(
      () =>
        store.prepare({
          ...fixture.identity,
          basisFingerprint: hash("f"),
        }, AT),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "key is divergent",
    );
    await assertRejects(
      () =>
        store.markDispatching({
          ...keyFor(prepared),
          attemptFingerprint: hash("f"),
          dispatchedAt: AT,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "key is divergent",
    );
  });
});

Deno.test("admitted Modelica WAL rejects a valid foreign receipt and divergent Thread artifacts", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.foreignReceipt,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "durable identity",
    );
    await store.markOutputPublished({ ...key, receiptRecord: fixture.receiptG0 });
    await assertRejects(
      () =>
        store.markCompleted({
          ...key,
          threadEvidence: {
            ...fixture.threadG0,
            artifacts: {
              ...fixture.threadG0.artifacts,
              capture: {
                ...fixture.threadG0.artifacts.capture,
                id: `modelica-admitted-capture-${"f".repeat(64)}`,
              },
            },
          },
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "does not derive",
    );
    await store.markCompleted({ ...key, threadEvidence: fixture.threadG0 });
    const path = await store.pathFor(
      fixture.identity.projectId,
      fixture.identity.agentRunId,
    );
    const corrupted = JSON.parse(await Deno.readTextFile(path));
    corrupted.threadEvidence.artifacts.capture = {
      id: `modelica-admitted-capture-${"f".repeat(64)}`,
      fingerprint: hash("f"),
    };
    await Deno.writeTextFile(path, `${JSON.stringify(corrupted)}\n`);
    await assertRejects(
      () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "Thread evidence fingerprint is divergent",
    );
  });
});

Deno.test("admitted Modelica WAL rejects noncanonical and fingerprint-divergent files", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    await store.prepare(fixture.identity, AT);
    const path = await store.pathFor(
      fixture.identity.projectId,
      fixture.identity.agentRunId,
    );
    const canonical = await Deno.readTextFile(path);
    await Deno.writeTextFile(path, canonical.trim());
    await assertRejects(
      () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "not canonical",
    );
    const corrupted = JSON.parse(canonical);
    corrupted.identity.basisFingerprint.digest = "f".repeat(64);
    await Deno.writeTextFile(path, `${JSON.stringify(corrupted)}\n`);
    await assertRejects(
      () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "identity is divergent",
    );
    await Deno.writeTextFile(path, "not-json\n");
    await assertRejects(
      () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "not JSON",
    );
  });
});

Deno.test({
  name:
    "two Deno processes consume each admitted Modelica dispatch transition exactly once",
  ignore: RUN_PERMISSION.state !== "granted",
  async fn() {
    const directory = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "admitted-modelica-wal-race-" }),
    );
    try {
      const store = new FileAdmittedModelicaExecutionAttemptStore(directory);
      const fixture = await walFixture();
      const prepared = await store.prepare(fixture.identity, AT);
      const key = keyFor(prepared);

      const firstDispatches = await raceDispatchInSeparateProcesses(
        directory,
        "markDispatching",
        { ...key, dispatchedAt: AT },
      );
      assertEquals(
        firstDispatches.map((transition) => transition.outcome).sort(),
        ["already-transitioned", "transitioned-now"],
      );
      assertEquals(firstDispatches[0]!.attempt, firstDispatches[1]!.attempt);
      assertEquals(
        await new FileAdmittedModelicaExecutionAttemptStore(directory).read(
          fixture.identity.projectId,
          fixture.identity.agentRunId,
        ),
        firstDispatches[0]!.attempt,
      );

      await store.markGenerationZeroCleaned({
        ...key,
        destruction: fixture.generationZeroDestruction,
      });
      const advance = await createIsolatedOutputProducerGenerationAdvance({
        runId: fixture.identity.executionRunId,
        closedGeneration: 0,
        nextGeneration: 1,
      });
      const redispatches = await raceDispatchInSeparateProcesses(
        directory,
        "markRedispatching",
        { ...key, advance, dispatchedAt: AT },
      );
      assertEquals(
        redispatches.map((transition) => transition.outcome).sort(),
        ["already-transitioned", "transitioned-now"],
      );
      assertEquals(redispatches[0]!.attempt, redispatches[1]!.attempt);
      assertEquals(
        await new FileAdmittedModelicaExecutionAttemptStore(directory).read(
          fixture.identity.projectId,
          fixture.identity.agentRunId,
        ),
        redispatches[0]!.attempt,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("admitted Modelica WAL rejects every skipped, reversed and divergent transition", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () =>
        store.markGenerationZeroCleaned({
          ...key,
          destruction: fixture.generationZeroDestruction,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () => store.markRedispatching({ ...key, advance, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptG0,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () => store.markCompleted({ ...key, threadEvidence: fixture.threadG0 }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "before output publication",
    );
  });

  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    await store.markGenerationZeroCleaned({
      ...key,
      destruction: fixture.generationZeroDestruction,
    });
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    const foreignAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: "admitted-modelica-foreign-run",
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () => store.markDispatching({ ...key, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptG0,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () => store.markCompleted({ ...key, threadEvidence: fixture.threadG0 }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "before output publication",
    );
    await assertRejects(
      () =>
        store.markRedispatching({
          ...key,
          advance: foreignAdvance,
          dispatchedAt: AT,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "this admitted Modelica run",
    );
    await assertRejects(
      () =>
        store.markRedispatching({
          ...key,
          advance: { ...advance, fingerprint: hash("f") },
          dispatchedAt: AT,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "this admitted Modelica run",
    );
    await assertRejects(
      () =>
        store.markRedispatching({
          ...key,
          advance: { ...advance, nextGeneration: 2 } as never,
          dispatchedAt: AT,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "this admitted Modelica run",
    );
  });

  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const published = await store.markOutputPublished({
      ...key,
      receiptRecord: fixture.receiptG0,
    });
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () => store.markDispatching({ ...key, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markGenerationZeroCleaned({
          ...key,
          destruction: fixture.generationZeroDestruction,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () => store.markRedispatching({ ...key, advance, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.foreignReceipt,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "durable identity",
    );
    assertEquals(
      await store.markOutputPublished({
        ...key,
        receiptRecord: fixture.receiptG0,
      }),
      published,
    );
  });

  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    await store.markOutputPublished({ ...key, receiptRecord: fixture.receiptG0 });
    const completed = await store.markCompleted({
      ...key,
      threadEvidence: fixture.threadG0,
    });
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () => store.markDispatching({ ...key, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markGenerationZeroCleaned({
          ...key,
          destruction: fixture.generationZeroDestruction,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () => store.markRedispatching({ ...key, advance, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.foreignReceipt,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "durable identity",
    );
    await assertRejects(
      () =>
        store.markCompleted({
          ...key,
          threadEvidence: fixture.foreignThread,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "exact documentary successor",
    );
    assertEquals(
      await store.markOutputPublished({
        ...key,
        receiptRecord: fixture.receiptG0,
      }),
      completed,
    );
    assertEquals(
      await store.markCompleted({ ...key, threadEvidence: fixture.threadG0 }),
      completed,
    );
  });
});

Deno.test("admitted Modelica WAL rejects broad and traversing storage roots", () => {
  for (
    const path of [
      ".",
      "..",
      "/",
      "../outside",
      "state/../outside",
      "state//outside",
      "state\\outside",
    ]
  ) {
    assertThrows(
      () => new FileAdmittedModelicaExecutionAttemptStore(path),
      TypeError,
      "bounded path",
    );
  }
});

Deno.test({
  name:
    "admitted Modelica WAL rejects root, file and lock symlinks plus a swapped root",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "admitted-modelica-wal-symlink-" }),
    );
    try {
      const fixture = await walFixture();
      const linkedTarget = `${base}/linked-target`;
      const linkedParent = `${base}/linked-parent`;
      await Deno.mkdir(linkedTarget, { mode: 0o700 });
      await Deno.symlink(linkedTarget, linkedParent);
      const linkedStore = new FileAdmittedModelicaExecutionAttemptStore(
        `${linkedParent}/wal`,
      );
      await assertRejects(
        () => linkedStore.prepare(fixture.identity, AT),
        AdmittedModelicaExecutionAttemptIntegrityError,
        "real directories",
      );

      const fileRoot = `${base}/file-root`;
      await Deno.mkdir(fileRoot, { mode: 0o700 });
      const fileStore = new FileAdmittedModelicaExecutionAttemptStore(fileRoot);
      await fileStore.prepare(fixture.identity, AT);
      const walPath = await fileStore.pathFor(
        fixture.identity.projectId,
        fixture.identity.agentRunId,
      );
      const externalWal = `${base}/external-wal`;
      await Deno.writeTextFile(externalWal, "external\n", {
        createNew: true,
        mode: 0o600,
      });
      await Deno.remove(walPath);
      await Deno.symlink(externalWal, walPath);
      await assertRejects(
        () => fileStore.read(fixture.identity.projectId, fixture.identity.agentRunId),
        AdmittedModelicaExecutionAttemptIntegrityError,
        "regular file",
      );

      const lockRoot = `${base}/lock-root`;
      await Deno.mkdir(lockRoot, { mode: 0o700 });
      const lockStore = new FileAdmittedModelicaExecutionAttemptStore(lockRoot);
      const lockPath = `${await lockStore.pathFor(
        fixture.identity.projectId,
        fixture.identity.agentRunId,
      )}.lock`;
      const externalLock = `${base}/external-lock`;
      await Deno.writeTextFile(externalLock, "", {
        createNew: true,
        mode: 0o600,
      });
      await Deno.symlink(externalLock, lockPath);
      await assertRejects(
        () => lockStore.prepare(fixture.identity, AT),
        AdmittedModelicaExecutionAttemptIntegrityError,
        "regular file",
      );

      const swapRoot = `${base}/swap-root`;
      const swappedAside = `${base}/swap-root-original`;
      const swappedTarget = `${base}/swap-root-target`;
      const swapStore = new FileAdmittedModelicaExecutionAttemptStore(swapRoot);
      const prepared = await swapStore.prepare(fixture.identity, AT);
      await Deno.rename(swapRoot, swappedAside);
      await Deno.mkdir(swappedTarget, { mode: 0o700 });
      await Deno.symlink(swappedTarget, swapRoot);
      await assertRejects(
        () =>
          swapStore.markDispatching({
            ...keyFor(prepared),
            dispatchedAt: AT,
          }),
        AdmittedModelicaExecutionAttemptIntegrityError,
        "real directories",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "admitted Modelica WAL rejects non-private roots and files on read",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "admitted-modelica-wal-mode-" }),
    );
    try {
      const fixture = await walFixture();
      const root = `${base}/root`;
      await Deno.mkdir(root, { mode: 0o700 });
      const store = new FileAdmittedModelicaExecutionAttemptStore(root);
      await store.prepare(fixture.identity, AT);
      const path = await store.pathFor(
        fixture.identity.projectId,
        fixture.identity.agentRunId,
      );
      await Deno.chmod(path, 0o644);
      await assertRejects(
        () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
        AdmittedModelicaExecutionAttemptIntegrityError,
        "permissions must be 600",
      );
      await Deno.chmod(path, 0o600);
      await Deno.chmod(root, 0o755);
      await assertRejects(
        () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
        AdmittedModelicaExecutionAttemptIntegrityError,
        "permissions must be 700",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test("admitted Modelica WAL persists a terminal output-validation rejection and refuses redispatch", async () => {
  await withStore(async (store, directory) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const observation = {
      role: "evidence",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    const destruction = {
      status: "proven" as const,
      runId: fixture.identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
    };
    const rejected = await store.markOutputValidationRejected({
      ...key,
      observation,
      destruction,
    });
    assertEquals(rejected.phase, "output-validation-rejected");
    const restarted = new FileAdmittedModelicaExecutionAttemptStore(directory);
    assertEquals(
      await restarted.read(fixture.identity.projectId, fixture.identity.agentRunId),
      rejected,
    );
    assertEquals(
      await restarted.markOutputValidationRejected({
        ...key,
        observation,
        destruction,
      }),
      rejected,
    );
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () => restarted.markRedispatching({ ...key, advance, dispatchedAt: AT }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        restarted.markOutputValidationRejected({
          ...key,
          observation: { ...observation, role: "job.dat" },
          destruction,
        }),
      AdmittedModelicaExecutionAttemptIntegrityError,
      "role is not registered",
    );
  });
});

async function walFixture() {
  const source = new TextEncoder().encode(
    "model GenericState\n  Real position;\nequation\n  der(position) = 2;\nend GenericState;\n",
  );
  const sourceSha256 = await fingerprintResourceBytes(source);
  const limits = {
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 20_000,
    maxMemoryBytes: 1_073_741_824,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 33_554_432,
    maxOutputTotalBytes: 33_554_432,
  };
  const profile = await new FixedAdmittedModelicaExecutionProfileCatalog({
    imageReference: `ghcr.io/casys-ai/modelica-runtime@sha256:${"9".repeat(64)}`,
    policy: {
      id: "modelica-admitted-deny-all",
      version: "1.0.0",
      fingerprint: hash("8"),
    },
    limits,
  }).initial();
  const admission = validateModelicaAdmittedRunAdmission({
    schemaVersion: "modelica-admitted-run-admission/3.0",
    admissionArtifact: {
      schemaVersion: "technical-compilation-admission-capture/4.0",
      id: `technical-compilation-admission-${"1".repeat(64)}`,
      fingerprint: hash("1"),
    },
    compilation: {
      document: {
        schemaVersion: "technical-compilation/2.0",
        fingerprint: hash("2"),
        status: "ready-for-review",
      },
      projection: {
        target: "modelica-source-qualification",
        fingerprint: hash("3"),
        status: "ready-for-review",
      },
      source: {
        id: "source.mr02",
        sourceFingerprint: {
          algorithm: "sha256",
          digest: sourceSha256,
        },
        captureFingerprint: hash("4"),
        analysisFingerprint: hash("5"),
      },
      profile: {
        id: profile.compilationProfile.id,
        version: profile.compilationProfile.version,
        fingerprint: profile.compilationProfileFingerprint,
      },
    },
    execution: {
      profile: {
        ...profile.executionProfile,
        fingerprint: profile.profileFingerprint,
      },
      isolationPolicy: profile.isolationPolicy,
      runtimeBackend: profile.runtimeBackend,
      runtime: {
        imageDigest: profile.runtime.imageDigest,
        isolationClass: profile.runtime.isolationClass,
        limits: profile.runtime.requestedLimits,
        limitAssurance: profile.runtime.limitAssurance,
      },
      outputValidator: profile.outputValidator,
      outputs: profile.outputManifest,
      minimumDestructionAssurance: profile.minimumDestructionAssurance,
    },
    status: "ready-for-execution-review",
  });
  const projectId = "modelica-generic-wal";
  const agentRunId = "run-generic-admitted-modelica";
  const executionRunId = await deriveAdmittedModelicaExecutionRunId(
    projectId,
    agentRunId,
  );
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: "subject.mr02:r4:compile-seal-admission",
    revision: 4,
    subjectId: "subject.mr02",
  };
  const authorityFingerprint = await sha256Fingerprint({
    basis,
    decisionId: "decision.mr02.run-modelica",
  });
  const identity: AdmittedModelicaExecutionAttemptIdentity = {
    projectId,
    agentRunId,
    executionRunId,
    startedAt: AT,
    basis,
    basisFingerprint: await sha256Fingerprint({ snapshot: basis }),
    reviewedRunFingerprint: await sha256Fingerprint({
      workItemId: "work.mr02.run-modelica",
      basis,
      decision: authorityFingerprint,
    }),
    decision: {
      id: "decision.mr02.run-modelica",
      inputFingerprint: authorityFingerprint,
    },
    approval: {
      id: "approval.mr02.run-modelica",
      inputFingerprint: authorityFingerprint,
    },
    admission,
    executionProfile: profile,
    isolatedRequest: {
      schemaVersion: "isolated-code-execution-request/1.0",
      runId: executionRunId,
      producerGeneration: 0,
      profile: profile.executionProfile,
      sourceSha256,
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    },
  };
  const receiptG0 = await receiptFor({ identity, source, producerGeneration: 0 });
  const receiptG1 = await receiptFor({ identity, source, producerGeneration: 1 });
  const foreignReceipt = await receiptFor({
    identity,
    source,
    producerGeneration: 0,
    runId: "admitted-modelica-foreign-run",
  });
  const forgedPublicationReceipt = await receiptFor({
    identity,
    source,
    producerGeneration: 0,
    publicationFingerprint: hash("f"),
  });
  const generationZeroDestruction = {
    status: "proven" as const,
    runId: executionRunId,
    proofFingerprint: hash("6"),
  };
  const unattestedDestruction = {
    status: "acknowledged-unattested" as const,
    runId: executionRunId,
    acknowledgementFingerprint: hash("6"),
  };
  const threadG0 = threadEvidence(identity, receiptG0);
  const threadG1 = threadEvidence(identity, receiptG1);
  return {
    identity,
    receiptG0,
    receiptG1,
    foreignReceipt,
    forgedPublicationReceipt,
    generationZeroDestruction,
    unattestedDestruction,
    threadG0,
    threadG1,
    foreignThread: {
      ...threadG0,
      snapshotId: "subject.mr02:r6:foreign",
    },
  };
}

async function receiptFor(input: {
  readonly identity: AdmittedModelicaExecutionAttemptIdentity;
  readonly source: Uint8Array;
  readonly producerGeneration: 0 | 1;
  readonly runId?: string;
  readonly publicationFingerprint?: ReturnType<typeof hash>;
}): Promise<IsolatedCodeExecutionReceiptRecord> {
  const runId = input.runId ?? input.identity.executionRunId;
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: "isolated-code-execution-request/1.0",
    runId,
    producerGeneration: input.producerGeneration,
    profile: input.identity.executionProfile.executionProfile,
    source: {
      bytes: input.source,
      sha256: input.identity.isolatedRequest.sourceSha256,
    },
    policy: input.identity.executionProfile.isolationPolicy,
    outputs: input.identity.executionProfile.outputManifest,
  });
  const evidenceBytes = new TextEncoder().encode(
    '{"modelName":"GenericState"}\n',
  );
  const resultBytes = new TextEncoder().encode("time,position\n0,0\n2,4\n");
  const members = await Promise.all([
    outputMember(
      input.identity.executionProfile.outputManifest[0]!,
      evidenceBytes,
    ),
    outputMember(
      input.identity.executionProfile.outputManifest[1]!,
      resultBytes,
    ),
  ]);
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    runId,
    input.producerGeneration,
    members.map(({ bytes: _bytes, ...member }) => member),
  );
  return isolatedCodeExecutionReceiptRecord(
    await createIsolatedCodeExecutionReceipt({
      request,
      runtime: input.identity.executionProfile.runtime,
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: members,
      destruction: {
        status: "proven",
        runId,
        proofFingerprint: hash(input.producerGeneration === 0 ? "a" : "b"),
      },
      publication: await createIsolatedOutputPublicationRef(
        runId,
        input.producerGeneration,
        input.publicationFingerprint ?? publicationFingerprint,
      ),
    }),
  );
}

async function outputMember(
  declaration:
    AdmittedModelicaExecutionAttemptIdentity["isolatedRequest"]["outputs"][number],
  bytes: Uint8Array,
) {
  const sha256 = await fingerprintResourceBytes(bytes);
  return {
    ...declaration,
    bytes,
    byteCount: bytes.byteLength,
    sha256,
    casUri: `casys://isolated-output/sha256/${sha256}`,
  };
}

function threadEvidence(
  identity: AdmittedModelicaExecutionAttemptIdentity,
  receipt: IsolatedCodeExecutionReceiptRecord,
) {
  const outputs = new Map(receipt.outputs.map((output) => [output.role, output]));
  const evidence = outputs.get("evidence")!;
  const result = outputs.get("result")!;
  const captureFingerprint = hash("d");
  const revision = identity.basis.revision + 1;
  return {
    snapshotId:
      `${identity.basis.subjectId}:r${revision}:simulate-run-admitted-modelica-${identity.agentRunId}`,
    revision,
    subjectId: identity.basis.subjectId,
    artifacts: {
      capture: {
        id: `modelica-admitted-capture-${captureFingerprint.digest}`,
        fingerprint: captureFingerprint,
      },
      evidence: {
        id: `modelica-admitted-evidence-${evidence.sha256}`,
        fingerprint: { algorithm: "sha256" as const, digest: evidence.sha256 },
      },
      result: {
        id: `modelica-admitted-result-${result.sha256}`,
        fingerprint: { algorithm: "sha256" as const, digest: result.sha256 },
      },
    },
  };
}

function keyFor(value: {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: ReturnType<typeof hash>;
}) {
  return {
    projectId: value.projectId,
    agentRunId: value.agentRunId,
    executionRunId: value.executionRunId,
    attemptFingerprint: value.attemptFingerprint,
  };
}

function hash(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}

async function withStore(
  body: (
    store: FileAdmittedModelicaExecutionAttemptStore,
    directory: string,
  ) => Promise<void>,
) {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "admitted-modelica-wal-" }),
  );
  try {
    await body(new FileAdmittedModelicaExecutionAttemptStore(directory), directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function raceDispatchInSeparateProcesses(
  directory: string,
  method: "markDispatching" | "markRedispatching",
  input: unknown,
) {
  const nonce = crypto.randomUUID();
  const gate = `${directory}/.race-${nonce}-gate`;
  const readyPaths = [
    `${directory}/.race-${nonce}-left-ready`,
    `${directory}/.race-${nonce}-right-ready`,
  ] as const;
  const moduleUrl = new URL(
    "./file-execution-attempt-store.ts",
    import.meta.url,
  ).href;
  const commands = readyPaths.map((readyPath) => {
    const source = `
      import { FileAdmittedModelicaExecutionAttemptStore } from ${
      JSON.stringify(moduleUrl)
    };
      const directory = ${JSON.stringify(directory)};
      const readyPath = ${JSON.stringify(readyPath)};
      const gate = ${JSON.stringify(gate)};
      const store = new FileAdmittedModelicaExecutionAttemptStore(directory);
      await Deno.writeTextFile(readyPath, "ready\\n", { createNew: true, mode: 0o600 });
      for (;;) {
        try {
          await Deno.lstat(gate);
          break;
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      }
      const transition = await store.${method}(${JSON.stringify(input)});
      console.log(JSON.stringify(transition));
    `;
    return new Deno.Command(Deno.execPath(), {
      args: ["eval", "--quiet", source],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();
  });
  await waitForFiles(readyPaths);
  await Deno.writeTextFile(gate, "go\n", {
    createNew: true,
    mode: 0o600,
  });
  const outputs = await Promise.all(commands);
  return outputs.map((output) => {
    if (!output.success) {
      throw new Error(
        `Deno WAL race worker failed (${output.code}): ${
          new TextDecoder().decode(output.stderr)
        }`,
      );
    }
    return JSON.parse(new TextDecoder().decode(output.stdout));
  });
}

async function waitForFiles(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const present = await Promise.all(paths.map(async (path) => {
      try {
        await Deno.lstat(path);
        return true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
      }
    }));
    if (present.every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for both Deno WAL race workers.");
}
