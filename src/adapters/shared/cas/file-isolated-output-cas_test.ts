import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  EphemeralExecutionBackend,
  EphemeralExecutionBackendRequest,
  EphemeralExecutionDestruction,
  EphemeralExecutionReport,
  EphemeralOutputInventoryEntry,
} from "../../../application/ports/out/compile/isolation/ephemeral-execution-backend.ts";
import { BrokeredIsolatedCodeRunner } from "../../../application/use-cases/compile/isolation/brokered-isolated-code-runner.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeRuntimeAttestation,
  isolatedOutputPublicationManifestUri,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  FileIsolatedOutputCas,
  FileIsolatedOutputCasError,
} from "./file-isolated-output-cas.ts";

const encoder = new TextEncoder();
const A = "a".repeat(64);
const B = "b".repeat(64);
const POLICY = {
  id: "kernel-isolated-no-network",
  version: "1.0",
  fingerprint: { algorithm: "sha256" as const, digest: B },
};
const GEOMETRY_DECLARATION = {
  role: "geometry",
  basename: "geometry.step",
  mediaType: "model/step",
  format: "step-ap242",
} as const;
const RUNTIME: IsolatedCodeRuntimeAttestation = {
  isolationClass: "microvm",
  imageDigest: { algorithm: "sha256", digest: A },
  requestedLimits: {
    maxWallTimeMs: 1_000,
    maxCpuTimeMs: 500,
    maxMemoryBytes: 64_000_000,
    maxProcesses: 4,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
    maxOutputFileBytes: 1_024,
    maxOutputTotalBytes: 2_048,
  },
  limitAssurance: {
    maxWallTimeMs: "unattested",
    maxCpuTimeMs: "unattested",
    maxMemoryBytes: "backend-attested",
    maxProcesses: "unattested",
    maxStdoutBytes: "broker-observed-cap",
    maxStderrBytes: "broker-observed-cap",
    maxOutputFileBytes: "broker-observed-cap",
    maxOutputTotalBytes: "broker-observed-cap",
  },
};

Deno.test("filesystem isolated CAS rejects root, empty, traversal and ambiguous paths", () => {
  for (
    const root of [
      "",
      " ",
      "/",
      "//",
      ".",
      "..",
      "../outside",
      "state/../outside",
      "state//outside",
      "state\\outside",
      "/tmp/../outside",
    ]
  ) {
    assertThrows(
      () => new FileIsolatedOutputCas(root),
      TypeError,
      "bounded directory",
    );
  }
});

Deno.test("filesystem isolated CAS securely creates an absent nested root", async () => {
  const parent = await realTempDir();
  const root = `${parent}/modelica/admitted/outputs`;
  try {
    const cas = new FileIsolatedOutputCas(root);
    const prepared = await prepare(cas, "run:nested-root");
    await cas.abort(prepared.staged.batch);

    for (
      const directory of [
        `${parent}/modelica`,
        `${parent}/modelica/admitted`,
        root,
      ]
    ) {
      assertPrivateMode(await Deno.lstat(directory), directory);
      assertEquals(await Deno.realPath(directory), directory);
    }
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("independent CAS instances safely race to create one nested root", async () => {
  const parent = await realTempDir();
  const root = `${parent}/modelica/admitted/outputs`;
  try {
    const [left, right] = await Promise.all([
      prepare(new FileIsolatedOutputCas(root), "run:nested-left"),
      prepare(new FileIsolatedOutputCas(root), "run:nested-right"),
    ]);
    await Promise.all([
      new FileIsolatedOutputCas(root).abortByRunId(left.record.runId, 0),
      new FileIsolatedOutputCas(root).abortByRunId(right.record.runId, 0),
    ]);

    assertPrivateMode(await Deno.lstat(root), root);
    assertEquals(await Deno.realPath(root), root);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("filesystem isolated CAS rejects symlinked roots and staging ancestors", async () => {
  const parent = await realTempDir();
  const target = `${parent}/target`;
  const configured = `${parent}/configured`;
  await Deno.mkdir(target, { mode: 0o700 });
  await Deno.symlink(target, configured);
  try {
    await assertRejects(
      () => prepare(new FileIsolatedOutputCas(configured), "run:root-symlink"),
      FileIsolatedOutputCasError,
      "root and ancestors",
    );
    assertEquals(await entryNames(target), []);

    const ancestorTarget = `${parent}/ancestor-target`;
    const ancestorAlias = `${parent}/ancestor-alias`;
    await Deno.mkdir(ancestorTarget, { mode: 0o700 });
    await Deno.symlink(ancestorTarget, ancestorAlias);
    await assertRejects(
      () =>
        prepare(
          new FileIsolatedOutputCas(`${ancestorAlias}/nested`),
          "run:ancestor-symlink",
        ),
      FileIsolatedOutputCasError,
      "root parent must not resolve through a symlink",
    );
    assertEquals(await entryNames(ancestorTarget), []);

    const anchored = `${parent}/anchored`;
    const outside = `${parent}/outside`;
    await Deno.mkdir(anchored, { mode: 0o700 });
    await Deno.mkdir(outside, { mode: 0o700 });
    await Deno.symlink(outside, `${anchored}/staging`);
    await assertRejects(
      () => prepare(new FileIsolatedOutputCas(anchored), "run:child-symlink"),
      FileIsolatedOutputCasError,
      "must not be symlinks",
    );
    assertEquals(await entryNames(outside), []);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("filesystem isolated CAS never follows a substituted staging cleanup target", async () => {
  const root = await realTempDir();
  const outside = await realTempDir();
  try {
    const cas = new FileIsolatedOutputCas(root);
    const prepared = await prepare(cas, "run:abort-symlink");
    const runKey = (await entryNames(`${root}/staging`))[0]!;
    const runDirectory = `${root}/staging/${runKey}`;
    const displaced = `${root}/staging/displaced`;
    await Deno.rename(runDirectory, displaced);
    await Deno.writeTextFile(`${outside}/sentinel`, "must-survive");
    await Deno.symlink(outside, runDirectory);

    await assertRejects(
      () => cas.abortByRunId(prepared.record.runId, 0),
      FileIsolatedOutputCasError,
      "child directories must be anchored",
    );
    assertEquals(await Deno.readTextFile(`${outside}/sentinel`), "must-survive");
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("run-scoped abort durably fences both a staged late commit and a later restage", async () => {
  const root = await realTempDir();
  try {
    const runId = "run:durably-fenced";
    const cas = new FileIsolatedOutputCas(root);
    const delayed = await prepare(cas, runId);

    await cas.abortByRunId(runId, 0);

    await assertRejects(
      () => cas.commit(delayed.staged.batch, delayed.record),
      FileIsolatedOutputCasError,
      "durably fenced",
    );
    await assertRejects(
      () => prepare(cas, runId, encoder.encode("LATE-RESTAGE")),
      FileIsolatedOutputCasError,
      "durably fenced",
    );
    assertEquals((await cas.resolvePublication(delayed.ref)).status, "not-published");
    assertEquals(
      (await cas.resolvePublicationByRunId(runId, 0)).status,
      "not-published",
    );
    const stagingRuns = await entryNames(`${root}/staging`);
    assertEquals(stagingRuns.length, 1);
    assertEquals(await entryNames(`${root}/staging/${stagingRuns[0]}`), []);
    assertEquals((await entryNames(`${root}/run-fences`)).length, 1);
    assertPrivateMode(
      await Deno.lstat(
        `${root}/run-fences/${(await entryNames(`${root}/run-fences`))[0]}`,
      ),
      "run fence",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("run-scoped abort is durable and idempotent when the run never staged", async () => {
  const root = await realTempDir();
  try {
    const runId = "run:never-staged";
    const cas = new FileIsolatedOutputCas(root);
    await cas.abortByRunId(runId, 0);
    await cas.abortByRunId(runId, 0);
    assertEquals(
      (await cas.resolvePublicationByRunId(runId, 0)).status,
      "not-published",
    );
    await assertRejects(
      () => prepare(new FileIsolatedOutputCas(root), runId),
      FileIsolatedOutputCasError,
      "durably fenced",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("lost run-fence acknowledgement remains closed after restart and cleanup retry", async () => {
  const root = await realTempDir();
  let fenceAcks = 0;
  try {
    const runId = "run:fence-ack-loss";
    const cas = new FileIsolatedOutputCas(root, {
      afterRunFenceDurable: () => {
        fenceAcks += 1;
        throw new Error("lost run-fence acknowledgement");
      },
    });
    const delayed = await prepare(cas, runId);

    await assertRejects(
      () => cas.abortByRunId(runId, 0),
      Error,
      "lost run-fence acknowledgement",
    );
    assertEquals(fenceAcks, 1);
    assertEquals(
      (await cas.resolvePublicationByRunId(runId, 0)).status,
      "not-published",
    );
    await assertRejects(
      () => cas.commit(delayed.staged.batch, delayed.record),
      FileIsolatedOutputCasError,
      "durably fenced",
    );

    const restarted = new FileIsolatedOutputCas(root);
    assertEquals(
      (await restarted.resolvePublicationByRunId(runId, 0)).status,
      "not-published",
    );
    await assertRejects(
      () => prepare(restarted, runId),
      FileIsolatedOutputCasError,
      "durably fenced",
    );
    await restarted.abortByRunId(runId, 0);
    const stagingRuns = await entryNames(`${root}/staging`);
    assertEquals(stagingRuns.length, 1);
    assertEquals(await entryNames(`${root}/staging/${stagingRuns[0]}`), []);
    assertEquals(
      (await restarted.resolvePublicationByRunId(runId, 0)).status,
      "not-published",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("corrupt durable run fence is outcome-unknown and rejects every producer", async () => {
  const root = await realTempDir();
  try {
    const runId = "run:corrupt-fence";
    const cas = new FileIsolatedOutputCas(root);
    const delayed = await prepare(cas, runId);
    await cas.abortByRunId(runId, 0);
    const fenceName = (await entryNames(`${root}/run-fences`))[0]!;
    await Deno.writeTextFile(`${root}/run-fences/${fenceName}`, "{}");

    const restarted = new FileIsolatedOutputCas(root);
    assertEquals(
      (await restarted.resolvePublicationByRunId(runId, 0)).status,
      "outcome-unknown",
    );
    assertEquals(
      (await restarted.resolvePublication(delayed.ref)).status,
      "outcome-unknown",
    );
    await assertRejects(
      () => prepare(restarted, runId),
      FileIsolatedOutputCasError,
      "cannot be resolved safely",
    );
    await assertRejects(
      () => cas.commit(delayed.staged.batch, delayed.record),
      FileIsolatedOutputCasError,
      "cannot be resolved safely",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("producer generation advance survives acknowledgement loss and authorizes exactly one later dispatch", async () => {
  const root = await realTempDir();
  let advanceAcks = 0;
  try {
    const runId = "run:producer-generation-restart";
    const cas = new FileIsolatedOutputCas(root, {
      afterProducerGenerationAdvanceDurable: () => {
        advanceAcks += 1;
        throw new Error("lost producer generation advance acknowledgement");
      },
    });
    const delayedGenerationZero = await prepare(cas, runId);

    await assertRejects(
      () => prepare(cas, runId, encoder.encode("EARLY-G1"), 1),
      FileIsolatedOutputCasError,
      "durably fenced",
    );
    await cas.abortByRunId(runId, 0);
    await assertRejects(
      () =>
        cas.advanceProducerGeneration({
          runId,
          closedGeneration: 0,
          nextGeneration: 1,
        }),
      Error,
      "lost producer generation advance acknowledgement",
    );
    assertEquals(advanceAcks, 1);

    const restarted = new FileIsolatedOutputCas(root);
    const advance = await restarted.advanceProducerGeneration({
      runId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    assertEquals(advance.closedGeneration, 0);
    assertEquals(advance.nextGeneration, 1);
    await assertRejects(
      () =>
        cas.commit(delayedGenerationZero.staged.batch, delayedGenerationZero.record),
      FileIsolatedOutputCasError,
      "durably fenced",
    );
    await assertRejects(
      () => prepare(restarted, runId, encoder.encode("LATE-G0"), 0),
      FileIsolatedOutputCasError,
      "durably fenced",
    );

    const generationOne = await prepare(
      restarted,
      runId,
      encoder.encode("GENERATION-ONE"),
      1,
    );
    assertEquals(
      (await restarted.commit(generationOne.staged.batch, generationOne.record))
        .status,
      "published",
    );
    assertEquals(
      (await restarted.resolvePublicationByRunId(runId, 0)).status,
      "not-published",
    );
    assertEquals(
      (await restarted.resolvePublicationByRunId(runId, 1)).status,
      "published",
    );
    await assertRejects(
      () => prepare(restarted, runId, encoder.encode("SECOND-G1"), 1),
      FileIsolatedOutputCasError,
      "already published",
    );
    await assertRejects(
      () =>
        restarted.advanceProducerGeneration({
          runId,
          closedGeneration: 0,
          nextGeneration: 1,
        }),
      FileIsolatedOutputCasError,
      "publication marker exists",
    );
    await assertRejects(
      () =>
        restarted.advanceProducerGeneration({
          runId,
          closedGeneration: 1,
          nextGeneration: 2,
        } as never),
      TypeError,
      "closedGeneration",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("run lock linearizes publication against abort and generation advance", async () => {
  const publishedRoot = await realTempDir();
  const abortedRoot = await realTempDir();
  try {
    const commitEntered = deferred<void>();
    const releaseCommit = deferred<void>();
    const committingCas = new FileIsolatedOutputCas(publishedRoot, {
      afterReceiptDurable: () => {
        commitEntered.resolve();
        return releaseCommit.promise;
      },
    });
    const publishing = await prepare(committingCas, "run:commit-wins");
    const commit = committingCas.commit(publishing.staged.batch, publishing.record);
    await commitEntered.promise;
    const losingAbort = committingCas.abortByRunId("run:commit-wins", 0);
    releaseCommit.resolve();
    assertEquals((await commit).status, "published");
    await assertRejects(
      () => losingAbort,
      FileIsolatedOutputCasError,
      "published or ambiguous",
    );

    const abortEntered = deferred<void>();
    const releaseAbort = deferred<void>();
    const abortingCas = new FileIsolatedOutputCas(abortedRoot, {
      afterRunFenceDurable: () => {
        abortEntered.resolve();
        return releaseAbort.promise;
      },
    });
    const delayed = await prepare(abortingCas, "run:abort-wins");
    const abort = abortingCas.abortByRunId("run:abort-wins", 0);
    await abortEntered.promise;
    const losingCommit = abortingCas.commit(delayed.staged.batch, delayed.record);
    const queuedAdvance = abortingCas.advanceProducerGeneration({
      runId: "run:abort-wins",
      closedGeneration: 0,
      nextGeneration: 1,
    });
    releaseAbort.resolve();
    await abort;
    await assertRejects(
      () => losingCommit,
      FileIsolatedOutputCasError,
      "durably fenced",
    );
    assertEquals((await queuedAdvance).nextGeneration, 1);
    assertEquals(
      (await abortingCas.resolvePublicationByRunId("run:abort-wins", 0)).status,
      "not-published",
    );
  } finally {
    await Deno.remove(publishedRoot, { recursive: true });
    await Deno.remove(abortedRoot, { recursive: true });
  }
});

Deno.test("independent CAS instances tolerate concurrent root lock and fence creation", async () => {
  const root = await realTempDir();
  try {
    const runId = "run:interprocess-fence-race";
    const instances = Array.from(
      { length: 12 },
      () => new FileIsolatedOutputCas(root),
    );
    await Promise.all(instances.map((cas) => cas.abortByRunId(runId, 0)));
    assertEquals((await entryNames(`${root}/run-fences`)).length, 1);
    assertEquals(
      (await new FileIsolatedOutputCas(root).resolvePublicationByRunId(runId, 0))
        .status,
      "not-published",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("broker and file CAS publish only the durable authorized second generation", async () => {
  const root = await realTempDir();
  try {
    const runId = "run:broker-file-cas-generation";
    const cas = new FileIsolatedOutputCas(root);
    const delayedGenerationZero = await prepare(
      cas,
      runId,
      encoder.encode("DELAYED-G0"),
      0,
    );
    const backend = new OneOutputBackend(encoder.encode("BROKER-G1"));
    const runner = new BrokeredIsolatedCodeRunner({
      backend,
      cas,
      profile: { id: "build123d-source", version: "1.0" },
      maximumSourceBytes: 1_024,
      outputManifest: [GEOMETRY_DECLARATION],
      policy: POLICY,
      runtime: RUNTIME,
      minimumDestructionAssurance: "proven",
      validateOutput: () => undefined,
    });

    assertEquals(
      (await cas.resolvePublicationByRunId(runId, 0)).status,
      "not-published",
    );
    await runner.destroyByRunId(runId, 0);
    const advance = await runner.advanceProducerGeneration({
      runId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    assertEquals(advance.nextGeneration, 1);

    const receipt = await runner.run(await brokerRequest(runId, 1));
    assertEquals(receipt.producerGeneration, 1);
    assertEquals(receipt.publication.ref.producerGeneration, 1);
    assertEquals(
      (await new FileIsolatedOutputCas(root).resolvePublicationByRunId(runId, 1))
        .status,
      "published",
    );
    await assertRejects(
      () =>
        cas.commit(delayedGenerationZero.staged.batch, delayedGenerationZero.record),
      FileIsolatedOutputCasError,
      "durably fenced",
    );
    const forbiddenThirdRequest = await brokerRequest(runId, 1);
    await assertRejects(
      () => runner.run(forbiddenThirdRequest),
      Error,
      "staging and run-scoped cleanup both failed",
    );
    await assertRejects(
      () =>
        runner.advanceProducerGeneration({
          runId,
          closedGeneration: 1,
          nextGeneration: 2,
        } as never),
      Error,
      "could not be advanced safely",
    );
    assertEquals(backend.createCalls, 2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("filesystem isolated CAS rejects preexisting object and receipt symlinks", async () => {
  const root = await realTempDir();
  const outside = await realTempDir();
  try {
    const objectCas = new FileIsolatedOutputCas(root);
    const objectPrepared = await prepare(objectCas, "run:object-symlink");
    const objectDigest = objectPrepared.record.outputs[0]!.sha256;
    const objectTarget = `${outside}/object-target`;
    await Deno.writeTextFile(objectTarget, "PRIVATE-OUTSIDE");
    await Deno.mkdir(`${root}/objects`, { mode: 0o700 });
    await Deno.symlink(objectTarget, `${root}/objects/${objectDigest}`);
    await assertRejects(
      () => objectCas.commit(objectPrepared.staged.batch, objectPrepared.record),
      FileIsolatedOutputCasError,
      "regular file",
    );
    assertEquals(await Deno.readTextFile(objectTarget), "PRIVATE-OUTSIDE");

    const receiptRoot = `${root}/receipt-case`;
    await Deno.mkdir(receiptRoot, { mode: 0o700 });
    const receiptCas = new FileIsolatedOutputCas(receiptRoot);
    const receiptPrepared = await prepare(receiptCas, "run:receipt-symlink");
    const receiptDigest = await fingerprintResourceBytes(
      encoder.encode(deterministicJson(receiptPrepared.record)),
    );
    const receiptTarget = `${outside}/receipt-target`;
    await Deno.writeTextFile(receiptTarget, "PRIVATE-RECEIPT");
    await Deno.mkdir(`${receiptRoot}/receipts`, { mode: 0o700 });
    await Deno.symlink(
      receiptTarget,
      `${receiptRoot}/receipts/${receiptDigest}`,
    );
    await assertRejects(
      () => receiptCas.commit(receiptPrepared.staged.batch, receiptPrepared.record),
      FileIsolatedOutputCasError,
      "regular file",
    );
    assertEquals(await Deno.readTextFile(receiptTarget), "PRIVATE-RECEIPT");
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("filesystem isolated CAS fails closed when published CAS files become symlinks", async () => {
  const root = await realTempDir();
  const outside = await realTempDir();
  try {
    const cas = new FileIsolatedOutputCas(root);
    const prepared = await prepare(cas, "run:published-symlink");
    const resolution = await cas.commit(prepared.staged.batch, prepared.record);
    assertEquals(resolution.status, "published");

    const objectPath = `${root}/objects/${prepared.record.outputs[0]!.sha256}`;
    const objectBackup = `${root}/objects/object-backup`;
    const outsideObject = `${outside}/object`;
    await Deno.writeFile(outsideObject, prepared.bytes);
    await Deno.rename(objectPath, objectBackup);
    await Deno.symlink(outsideObject, objectPath);
    assertEquals(
      (await cas.resolvePublication(prepared.ref)).status,
      "outcome-unknown",
    );
    await Deno.remove(objectPath);
    await Deno.rename(objectBackup, objectPath);

    const receiptName = (await entryNames(`${root}/receipts`))[0]!;
    const receiptPath = `${root}/receipts/${receiptName}`;
    const receiptBackup = `${root}/receipts/receipt-backup`;
    const outsideReceipt = `${outside}/receipt`;
    await Deno.writeFile(outsideReceipt, await Deno.readFile(receiptPath));
    await Deno.rename(receiptPath, receiptBackup);
    await Deno.symlink(outsideReceipt, receiptPath);
    assertEquals(
      (await cas.resolvePublication(prepared.ref)).status,
      "outcome-unknown",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("filesystem isolated CAS publishes objects then a byte-free receipt then one marker", async () => {
  const root = await realTempDir();
  const events: string[] = [];
  const cas = new FileIsolatedOutputCas(root, {
    afterObjectDurable: (role) => {
      events.push(`object:${role}`);
    },
    afterReceiptDurable: () => {
      events.push("receipt");
    },
    afterMarkerDurable: () => {
      events.push("marker");
    },
  });
  try {
    const prepared = await prepare(cas, "run:ordered");
    const resolution = await cas.commit(prepared.staged.batch, prepared.record);

    assertEquals(resolution.status, "published");
    assertEquals(events, ["object:geometry", "receipt", "marker"]);
    const receiptFiles = await entryNames(`${root}/receipts`);
    assertEquals(receiptFiles.length, 1);
    const durable = JSON.parse(
      await Deno.readTextFile(`${root}/receipts/${receiptFiles[0]}`),
    );
    assertEquals("bytes" in durable.outputs[0], false);
    assertEquals(durable.outputs[0].validation, "accepted");
    assertEquals(
      durable.outputs[0].persistence,
      "staged-reread-atomic-commit",
    );
    const markerDigest = prepared.ref.manifestUri.split("/").at(-1)!;
    for (
      const path of [
        root,
        `${root}/objects`,
        `${root}/receipts`,
        `${root}/publications`,
        `${root}/objects/${prepared.record.outputs[0]!.sha256}`,
        `${root}/receipts/${receiptFiles[0]}`,
        `${root}/publications/${markerDigest}.json`,
      ]
    ) {
      assertPrivateMode(await Deno.lstat(path), path);
    }

    const restored = await cas.readReceipt(prepared.ref);
    assertEquals(restored?.outputs[0]?.bytes.copy(), prepared.bytes);
    const member = resolution.status === "published"
      ? resolution.receipt.outputs[0]!
      : never();
    assertEquals(
      await cas.readPublishedObject(prepared.ref, member),
      prepared.bytes,
    );

    // A published generation is authoritative and cannot be fenced as absent.
    await assertRejects(
      () => cas.abortByRunId(prepared.record.runId, 0),
      FileIsolatedOutputCasError,
      "published or ambiguous",
    );
    await assertRejects(
      () =>
        cas.advanceProducerGeneration({
          runId: prepared.record.runId,
          closedGeneration: 0,
          nextGeneration: 1,
        }),
      FileIsolatedOutputCasError,
      "publication marker exists",
    );
    assertEquals(
      await cas.readPublishedObject(prepared.ref, member),
      prepared.bytes,
    );
    const restarted = new FileIsolatedOutputCas(root);
    assertEquals(
      (await restarted.resolvePublicationByRunId(prepared.record.runId, 0)).status,
      "published",
    );
    await assertRejects(
      () => prepare(restarted, prepared.record.runId),
      FileIsolatedOutputCasError,
      "already published",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("lost marker acknowledgement reconciles as published without a second commit", async () => {
  const root = await realTempDir();
  let markerAcks = 0;
  const cas = new FileIsolatedOutputCas(root, {
    afterMarkerDurable: () => {
      markerAcks += 1;
      throw new Error("lost marker acknowledgement");
    },
  });
  try {
    const prepared = await prepare(cas, "run:ack-loss");
    await assertRejects(
      () => cas.commit(prepared.staged.batch, prepared.record),
      Error,
      "lost marker acknowledgement",
    );

    const restarted = new FileIsolatedOutputCas(root);
    const resolved = await restarted.resolvePublication(prepared.ref);
    assertEquals(resolved.status, "published");
    assertEquals(markerAcks, 1);
    assertEquals(
      (await restarted.readReceipt(prepared.ref))?.outputs[0]?.bytes.copy(),
      prepared.bytes,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("receipt and blobs left before the marker remain invisible and abort removes only staging", async () => {
  const root = await realTempDir();
  const cas = new FileIsolatedOutputCas(root, {
    afterReceiptDurable: () => {
      throw new Error("stop before marker");
    },
  });
  try {
    const prepared = await prepare(cas, "run:orphaned");
    await assertRejects(
      () => cas.commit(prepared.staged.batch, prepared.record),
      Error,
      "stop before marker",
    );
    assertEquals((await entryNames(`${root}/objects`)).length, 1);
    assertEquals((await entryNames(`${root}/receipts`)).length, 1);
    assertEquals((await cas.resolvePublication(prepared.ref)).status, "not-published");
    assertEquals(
      await cas.readPublishedObject(prepared.ref, prepared.record.outputs[0]!),
      undefined,
    );

    await cas.abort(prepared.staged.batch);
    assertEquals((await entryNames(`${root}/objects`)).length, 1);
    assertEquals((await entryNames(`${root}/receipts`)).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("published reader requires the exact run-keyed ref and exact receipt membership", async () => {
  const root = await realTempDir();
  const cas = new FileIsolatedOutputCas(root);
  try {
    const prepared = await prepare(cas, "run:membership");
    const published = await cas.commit(prepared.staged.batch, prepared.record);
    if (published.status !== "published") throw new Error("expected publication");
    const member = published.receipt.outputs[0]!;
    const wrongRef = await createIsolatedOutputPublicationRef(
      prepared.record.runId,
      0,
      { algorithm: "sha256", digest: "f".repeat(64) },
    );
    assertEquals((await cas.resolvePublication(wrongRef)).status, "outcome-unknown");
    await assertRejects(
      () => cas.readReceipt(wrongRef),
      FileIsolatedOutputCasError,
      "cannot be resolved safely",
    );
    await assertRejects(
      () =>
        cas.readPublishedObject(prepared.ref, {
          ...member,
          format: "step-ap203",
        }),
      FileIsolatedOutputCasError,
      "not an exact publication member",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("one run cannot publish divergent manifests while shared digests remain safe", async () => {
  const root = await realTempDir();
  const cas = new FileIsolatedOutputCas(root);
  try {
    const first = await prepare(cas, "run:unique", encoder.encode("STEP-A"));
    const divergent = await prepare(cas, "run:unique", encoder.encode("STEP-B"));
    assertEquals(
      (await cas.commit(first.staged.batch, first.record)).status,
      "published",
    );
    await assertRejects(
      () => cas.commit(divergent.staged.batch, divergent.record),
      FileIsolatedOutputCasError,
      "already published",
    );
    assertEquals((await cas.resolvePublication(first.ref)).status, "published");
    assertEquals(
      (await cas.readReceipt(first.ref))?.outputs[0]?.bytes.copy(),
      first.bytes,
    );
    await cas.abort(divergent.staged.batch);

    const sharedA = await prepare(cas, "run:shared-a", first.bytes);
    const sharedB = await prepare(cas, "run:shared-b", first.bytes);
    assertEquals(
      (await cas.commit(sharedA.staged.batch, sharedA.record)).status,
      "published",
    );
    assertEquals(
      (await cas.commit(sharedB.staged.batch, sharedB.record)).status,
      "published",
    );
    await assertRejects(
      () => cas.abortByRunId("run:shared-b", 0),
      FileIsolatedOutputCasError,
      "published or ambiguous",
    );
    assertEquals(
      (await cas.readReceipt(sharedA.ref))?.outputs[0]?.bytes.copy(),
      first.bytes,
    );
    assertEquals(
      (await cas.readReceipt(sharedB.ref))?.outputs[0]?.bytes.copy(),
      first.bytes,
    );
    assertEquals((await entryNames(`${root}/objects`)).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("corrupt publication marker is never classified as published", async () => {
  const root = await realTempDir();
  const cas = new FileIsolatedOutputCas(root);
  try {
    const prepared = await prepare(cas, "run:corrupt-marker");
    assertEquals(
      (await cas.commit(prepared.staged.batch, prepared.record)).status,
      "published",
    );
    const markerDigest = prepared.ref.manifestUri.split("/").at(-1)!;
    await Deno.writeTextFile(`${root}/publications/${markerDigest}.json`, "{}");
    assertEquals(
      (await cas.resolvePublication(prepared.ref)).status,
      "outcome-unknown",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("run-id-only recovery distinguishes absent, published, corrupt, and divergent markers", async () => {
  const root = await realTempDir();
  const cas = new FileIsolatedOutputCas(root);
  try {
    assertEquals(
      (await cas.resolvePublicationByRunId("run:absent", 0)).status,
      "not-published",
    );

    const prepared = await prepare(cas, "run:recoverable");
    assertEquals(
      (await cas.commit(prepared.staged.batch, prepared.record)).status,
      "published",
    );
    const recovered = await cas.resolvePublicationByRunId("run:recoverable", 0);
    assertEquals(recovered.status, "published");
    if (recovered.status !== "published") throw new Error("expected recovery");
    assertEquals(recovered.ref, prepared.ref);
    assertEquals(recovered.receipt.fingerprint, prepared.record.fingerprint);

    const markerDigest = prepared.ref.manifestUri.split("/").at(-1)!;
    const markerPath = `${root}/publications/${markerDigest}.json`;
    const exactMarker = await Deno.readFile(markerPath);
    await Deno.writeTextFile(markerPath, "{}");
    assertEquals(
      (await cas.resolvePublicationByRunId("run:recoverable", 0)).status,
      "outcome-unknown",
    );

    const divergentRunId = "run:divergent-marker";
    const divergentUri = await isolatedOutputPublicationManifestUri(
      divergentRunId,
      0,
    );
    const divergentDigest = divergentUri.split("/").at(-1)!;
    await Deno.writeFile(
      `${root}/publications/${divergentDigest}.json`,
      exactMarker,
    );
    assertEquals(
      (await cas.resolvePublicationByRunId(divergentRunId, 0)).status,
      "outcome-unknown",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

interface OneOutputLease {
  readonly request: EphemeralExecutionBackendRequest;
}

class OneOutputBackend
  implements EphemeralExecutionBackend<OneOutputLease, "geometry"> {
  readonly #bytes: Uint8Array;
  createCalls = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = Uint8Array.from(bytes);
  }

  create(request: EphemeralExecutionBackendRequest): Promise<OneOutputLease> {
    this.createCalls += 1;
    return Promise.resolve({ request });
  }

  destroyByRunId(runId: string): Promise<EphemeralExecutionDestruction> {
    return Promise.resolve(destructionFor(runId));
  }

  execute(lease: OneOutputLease): Promise<EphemeralExecutionReport> {
    return Promise.resolve({
      runtime: lease.request.runtime,
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
    });
  }

  async inventory(
    _lease: OneOutputLease,
  ): Promise<readonly EphemeralOutputInventoryEntry<"geometry">[]> {
    return [{
      handle: "geometry",
      basename: GEOMETRY_DECLARATION.basename,
      kind: "file",
      claimedByteCount: this.#bytes.byteLength,
      claimedSha256: await fingerprintResourceBytes(this.#bytes),
    }];
  }

  readOutput(
    _lease: OneOutputLease,
    handle: "geometry",
    maximumBytesToRead: number,
  ): Promise<Uint8Array> {
    if (handle !== "geometry" || this.#bytes.byteLength > maximumBytesToRead) {
      return Promise.reject(new Error("unexpected output read"));
    }
    return Promise.resolve(Uint8Array.from(this.#bytes));
  }

  destroy(lease: OneOutputLease): Promise<EphemeralExecutionDestruction> {
    return Promise.resolve(destructionFor(lease.request.runId));
  }
}

function destructionFor(runId: string): EphemeralExecutionDestruction {
  return {
    status: "proven",
    runId,
    proofFingerprint: { algorithm: "sha256", digest: A },
  };
}

async function brokerRequest(
  runId: string,
  producerGeneration: 0 | 1,
): Promise<IsolatedCodeExecutionRequest> {
  const source = encoder.encode("result = Box(1, 2, 3)\n");
  return {
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration,
    profile: { id: "build123d-source", version: "1.0" },
    source: {
      bytes: source,
      sha256: await fingerprintResourceBytes(source),
    },
    policy: POLICY,
    outputs: [GEOMETRY_DECLARATION],
  };
}

async function prepare(
  cas: FileIsolatedOutputCas,
  runId: string,
  bytes = encoder.encode("STEP-BYTES"),
  producerGeneration: 0 | 1 = 0,
) {
  const outputSha256 = await fingerprintResourceBytes(bytes);
  const declaration = {
    role: "geometry",
    basename: "geometry.step",
    mediaType: "model/step",
    format: "step-ap242",
  } as const;
  const staged = await cas.stageBatch([{
    runId,
    producerGeneration,
    ...declaration,
    byteCount: bytes.byteLength,
    sha256: outputSha256,
    bytes,
  }]);
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    runId,
    producerGeneration,
    [{
      ...declaration,
      byteCount: bytes.byteLength,
      sha256: outputSha256,
      casUri: `casys://isolated-output/sha256/${outputSha256}`,
    }],
  );
  const ref = await createIsolatedOutputPublicationRef(
    runId,
    producerGeneration,
    publicationFingerprint,
  );
  const source = encoder.encode("result = Box(1, 2, 3)\n");
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration,
    profile: { id: "build123d-source", version: "1.0" },
    source: {
      bytes: source,
      sha256: await fingerprintResourceBytes(source),
    },
    policy: {
      id: "kernel-isolated-no-network",
      version: "1.0",
      fingerprint: { algorithm: "sha256", digest: B },
    },
    outputs: [declaration],
  });
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: RUNTIME,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: encoder.encode("ok\n"), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs: [{
      ...declaration,
      bytes,
      byteCount: bytes.byteLength,
      sha256: outputSha256,
      casUri: `casys://isolated-output/sha256/${outputSha256}`,
    }],
    destruction: {
      status: "proven",
      runId,
      proofFingerprint: { algorithm: "sha256", digest: A },
    },
    publication: ref,
  });
  return {
    bytes: Uint8Array.from(bytes),
    staged,
    ref,
    record: isolatedCodeExecutionReceiptRecord(receipt),
  };
}

async function entryNames(directory: string): Promise<string[]> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(directory)) entries.push(entry.name);
  return entries.sort();
}

async function realTempDir(): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir());
}

function never(): never {
  throw new Error("unreachable");
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function assertPrivateMode(info: Deno.FileInfo, path: string): void {
  if (info.mode !== null) {
    assertEquals(info.mode & 0o077, 0, `${path} must not grant group/other access`);
  }
}
