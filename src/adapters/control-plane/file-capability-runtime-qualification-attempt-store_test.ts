import { assertEquals, assertRejects } from "@std/assert";
import {
  type CapabilityRuntimeQualificationAttemptIdentity,
  CapabilityRuntimeQualificationAttemptIntegrityError,
  type CapabilityRuntimeQualificationAttemptOutcome,
  type CapabilityRuntimeQualificationAttemptOutcomeInput,
  capabilityRuntimeQualificationAttemptStorageKey,
  createCapabilityRuntimeQualificationAttemptOutcome,
  fingerprintCapabilityRuntimeQualificationAttempt,
  qualificationAttemptKeyFor,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { createCapabilityRuntimeQualificationHostStopProof } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import { createCapabilityRuntimeQualificationIsolatedDestructionProof } from "../../domain/capability/runtime/capability-runtime-qualification-stop-proof.ts";
import { CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  FileCapabilityRuntimeQualificationAttemptStore,
} from "./file-capability-runtime-qualification-attempt-store.ts";
import {
  fingerprintCapabilityRuntimeObservedHost,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";

Deno.test("qualification attempt WAL is monotone, durable and idempotent", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    const start = await fingerprint("runtime-start");
    const receipt = await fingerprint("receipt");
    const stop = await fixtureStopProof();
    const attestation = await fingerprint("attestation");
    const qualifiedOutcome = await outcome({
      status: "qualified",
      basis: "recorded",
      recordedAt: "2026-08-29T00:01:00.000Z",
      basisFingerprint: receipt,
    });

    assertEquals(
      (await store.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" })).phase,
      "prepared",
    );
    assertEquals(
      (await store.markActive(identity, { runtimeStartFingerprint: start })).phase,
      "active",
    );
    assertEquals(
      (await store.markCaseSubmitted(identity, {
        caseSha256: identity.caseFingerprint.digest,
        caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
      })).phase,
      "case-submitted",
    );
    assertEquals(
      (await store.claimDispatching(identity, {
        claimedAt: "2026-08-29T00:00:00.000Z",
        deadlineAt: "2026-08-29T00:05:00.000Z",
      })).dispatchNow,
      true,
    );
    assertEquals(
      (await store.claimDispatching(identity, {
        claimedAt: "2026-08-29T00:00:00.000Z",
        deadlineAt: "2026-08-29T00:05:00.000Z",
      })).dispatchNow,
      false,
    );
    assertEquals(
      (await store.markRecorded(identity, {
        receiptSha256: "c".repeat(64),
        receiptFingerprint: receipt,
      })).phase,
      "recorded",
    );
    assertEquals(
      (await store.markOutcome(
        identity,
        qualifiedOutcome,
      )).phase,
      "outcome",
    );
    assertEquals(
      (await store.markStopped(identity, { runtimeStopProof: stop })).phase,
      "stopped",
    );
    const terminal = await store.markAttested(identity, {
      attestationFingerprint: attestation,
    });
    assertEquals(terminal.phase, "attested");
    const repeated = await store.markAttested(identity, {
      attestationFingerprint: attestation,
    });
    assertEquals(repeated, terminal);
    if (terminal.phase !== "attested") throw new Error("attestation absent");
    assertEquals(terminal.outcome.recordedAt, qualifiedOutcome.recordedAt);
    assertEquals(terminal.outcome.fingerprint, qualifiedOutcome.fingerprint);

    const recovered = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const dispatch = await recovered.claimDispatching(identity, {
      claimedAt: "2026-08-29T00:00:00.000Z",
      deadlineAt: "2026-08-29T00:05:00.000Z",
    });
    assertEquals(dispatch.dispatchNow, false);
    assertEquals(dispatch.attempt.phase, "attested");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL claim prevents redispatch after an uncertain readback", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    await prepareThroughDispatch(store, identity);
    // Simulate a process stop after the durable claim but before its readable
    // mirror event survives. Recovery must still see dispatching and refuse a
    // second `run` grant.
    const attemptDirectory = await directoryFor(directory, identity);
    const entries = await Array.fromAsync(Deno.readDir(attemptDirectory));
    const dispatchEvent = entries.find((entry) =>
      entry.name.startsWith("event-dispatching-")
    );
    if (!dispatchEvent) throw new Error("dispatch event absent");
    await Deno.remove(`${attemptDirectory}/${dispatchEvent.name}`);
    const afterClaimOnly = await new FileCapabilityRuntimeQualificationAttemptStore(
      directory,
    )
      .claimDispatching(identity, {
        claimedAt: "2026-08-29T00:00:00.000Z",
        deadlineAt: "2026-08-29T00:05:00.000Z",
      });
    assertEquals(afterClaimOnly.dispatchNow, false);
    assertEquals(afterClaimOnly.attempt.phase, "dispatching");
    assertEquals(
      (await Array.fromAsync(Deno.readDir(attemptDirectory))).some((entry) =>
        entry.name.startsWith("event-dispatching-")
      ),
      false,
    );
    await store.markQuarantined(identity, { reason: "uncertain" });
    const quarantined = await store.read(keyFor(identity));
    if (!quarantined || quarantined.phase !== "quarantined") {
      throw new Error("quarantine event absent");
    }
    const unavailable = await outcome({
      status: "unavailable",
      basis: "quarantined",
      recordedAt: "2026-08-29T00:01:00.000Z",
      basisFingerprint: await fingerprintCapabilityRuntimeQualificationAttempt(
        quarantined,
      ),
    });
    await store.markOutcome(identity, unavailable);
    const later = await store.claimDispatching(identity, {
      claimedAt: "2026-08-29T00:00:00.000Z",
      deadlineAt: "2026-08-29T00:05:00.000Z",
    });
    assertEquals(later.dispatchNow, false);
    assertEquals(later.attempt.phase, "outcome");
    await assertRejects(
      () =>
        store.markAttested(identity, {
          attestationFingerprint: unavailable.fingerprint,
        }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "cannot precede verified runtime stop",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL rejects an isolated stop proof transplanted from another attempt or receipt", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const identity = await fixtureIdentity();
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    await prepareThroughDispatch(store, identity);
    const receipt = await fingerprint("recorded-receipt");
    await store.markRecorded(identity, {
      receiptSha256: "c".repeat(64),
      receiptFingerprint: receipt,
    });
    await store.markOutcome(
      identity,
      await outcome({
        status: "qualified",
        basis: "recorded",
        recordedAt: "2026-08-29T00:01:00.000Z",
        basisFingerprint: receipt,
      }),
    );

    const otherRun = await createCapabilityRuntimeQualificationIsolatedDestructionProof(
      {
        runId: "sibling-qualification-run",
        producerGeneration: 0,
        receiptFingerprint: receipt,
        destruction: {
          status: "proven",
          runId: "sibling-qualification-run",
          proofFingerprint: await fingerprint("sibling-destruction"),
        },
      },
    );
    await assertRejects(
      () => store.markStopped(identity, { runtimeStopProof: otherRun }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "run ID conflicts",
    );

    const otherReceipt =
      await createCapabilityRuntimeQualificationIsolatedDestructionProof({
        runId: identity.requestId,
        producerGeneration: 0,
        receiptFingerprint: await fingerprint("sibling-receipt"),
        destruction: {
          status: "proven",
          runId: identity.requestId,
          proofFingerprint: await fingerprint("same-run-sibling-receipt"),
        },
      });
    await assertRejects(
      () => store.markStopped(identity, { runtimeStopProof: otherReceipt }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "isolated stop proof receipt",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL promotes a quarantined request on later factual readback", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const identity = await fixtureIdentity();
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    await prepareThroughDispatch(store, identity);
    await store.markQuarantined(identity, { reason: "absent" });

    const recovered = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    assertEquals(
      (
        await recovered.markRecorded(identity, {
          receiptSha256: "c".repeat(64),
          receiptFingerprint: await fingerprint("late-receipt"),
        })
      ).phase,
      "recorded",
    );
    const dispatch = await recovered.claimDispatching(identity, {
      claimedAt: "2026-08-29T00:00:00.000Z",
      deadlineAt: "2026-08-29T00:05:00.000Z",
    });
    assertEquals(dispatch.dispatchNow, false);
    assertEquals(dispatch.attempt.phase, "recorded");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL refuses skipped transitions, rewritten identity and secrets", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    await store.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" });
    await assertRejects(
      () =>
        store.markCaseSubmitted(identity, {
          caseSha256: identity.caseFingerprint.digest,
          caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
        }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "cannot precede a durable runtime start",
    );
    await assertRejects(
      () =>
        store.prepare({ ...identity, requestId: "different-request" }, {
          preparedAt: "2026-08-29T00:00:00.000Z",
        }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "identity conflicts",
    );
    await assertRejects(
      () =>
        store.prepare({ ...identity, bearerToken: "must-not-persist" } as never, {
          preparedAt: "2026-08-29T00:00:00.000Z",
        }),
      TypeError,
      "unsupported field bearerToken",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL refuses same-key divergent identities before claim or transition", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    const runtimeStartFingerprint = await fingerprint("runtime-start");
    await store.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" });
    const divergentIdentities = [
      { ...identity, requestId: "different-request" },
      {
        ...identity,
        reviewFingerprint: await fingerprint("different-review"),
      },
      {
        ...identity,
        sourceFingerprint: await fingerprint("different-source"),
      },
      {
        ...identity,
        loweringFingerprint: await fingerprint("different-lowering"),
      },
      { ...identity, caseFingerprint: await fingerprint("different-case") },
      {
        ...identity,
        runRequestFingerprint: await fingerprint("different-run-request"),
      },
    ];
    for (const divergent of divergentIdentities) {
      await assertRejects(
        () => store.prepare(divergent, { preparedAt: "2026-08-29T00:00:01.000Z" }),
        CapabilityRuntimeQualificationAttemptIntegrityError,
        "identity conflicts",
      );
      await assertRejects(
        () =>
          store.claimDispatching(divergent, {
            claimedAt: "2026-08-29T00:00:00.000Z",
            deadlineAt: "2026-08-29T00:05:00.000Z",
          }),
        CapabilityRuntimeQualificationAttemptIntegrityError,
        "identity conflicts",
      );
      await assertRejects(
        () =>
          store.markActive(divergent, {
            runtimeStartFingerprint,
          }),
        CapabilityRuntimeQualificationAttemptIntegrityError,
        "identity conflicts",
      );
    }
    assertEquals((await store.read(keyFor(identity)))?.phase, "prepared");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL rejects corruption and foreign entries rather than guessing", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    await store.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" });
    const attemptDirectory = await directoryFor(directory, identity);
    await Deno.writeTextFile(`${attemptDirectory}/foreign.json`, "{}\n");
    await assertRejects(
      () => store.read(keyFor(identity)),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "unsupported entry",
    );
    await Deno.remove(`${attemptDirectory}/foreign.json`);
    const entries = await Array.fromAsync(Deno.readDir(attemptDirectory));
    const prepared = entries.find((entry) => entry.name.startsWith("event-prepared-"));
    if (!prepared) throw new Error("prepared event absent");
    await Deno.writeTextFile(`${attemptDirectory}/${prepared.name}`, "not-json\n");
    await assertRejects(
      () => store.read(keyFor(identity)),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "not JSON",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL rejects a dispatch event whose durable claim is absent", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    await prepareThroughDispatch(store, identity);
    const attemptDirectory = await directoryFor(directory, identity);
    const entries = await Array.fromAsync(Deno.readDir(attemptDirectory));
    const claim = entries.find((entry) => entry.name.startsWith("dispatch-claim-"));
    if (!claim) throw new Error("dispatch claim absent");
    await Deno.remove(`${attemptDirectory}/${claim.name}`);
    await assertRejects(
      () => store.read(keyFor(identity)),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "lacks its durable claim",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("preparedAt is a one-shot event fact, reused across restarts, and absent from identity", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const identity = await fixtureIdentity();
    const first = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const prepared = await first.prepare(identity, {
      preparedAt: "2026-08-29T00:00:00.000Z",
    });
    assertEquals(prepared.phase, "prepared");
    if (prepared.phase !== "prepared") throw new Error("prepared absent");
    assertEquals(prepared.preparedAt, "2026-08-29T00:00:00.000Z");
    const recovered = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const again = await recovered.prepare(identity, {
      preparedAt: "2026-08-29T00:00:01.000Z",
    });
    assertEquals(again.preparedAt, "2026-08-29T00:00:00.000Z");
    assertEquals(again, prepared);
    assertEquals(
      (await recovered.read(keyFor(identity)))?.preparedAt,
      "2026-08-29T00:00:00.000Z",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("two store instances linearize one Prepared and one dispatch claim under File.lock", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const identity = await fixtureIdentity();
    const left = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const right = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const prepares = await Promise.all([
      left.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" }),
      right.prepare(identity, { preparedAt: "2026-08-29T00:00:01.000Z" }),
    ]);
    assertEquals(prepares[0], prepares[1]);
    assertEquals(prepares[0]?.phase, "prepared");
    assertEquals(prepares[0]?.preparedAt, prepares[1]?.preparedAt);
    const attemptDirectory = await directoryFor(directory, identity);
    const preparedEvents = (await Array.fromAsync(Deno.readDir(attemptDirectory)))
      .filter((entry) => entry.name.startsWith("event-prepared-"));
    assertEquals(preparedEvents.length, 1);

    await left.markActive(identity, {
      runtimeStartFingerprint: await fingerprint("start"),
    });
    await left.markCaseSubmitted(identity, {
      caseSha256: identity.caseFingerprint.digest,
      caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
    });
    const clock = {
      claimedAt: "2026-08-29T00:00:00.000Z",
      deadlineAt: "2026-08-29T00:05:00.000Z",
    };
    const claims = await Promise.all([
      left.claimDispatching(identity, clock),
      right.claimDispatching(identity, {
        claimedAt: "2026-08-29T00:00:02.000Z",
        deadlineAt: "2026-08-29T00:05:02.000Z",
      }),
    ]);
    assertEquals(
      claims.map((item) => item.dispatchNow).toSorted(),
      [false, true],
    );
    assertEquals(claims[0].attempt, claims[1].attempt);
    assertEquals(claims[0].attempt.phase, "dispatching");
    const claimFiles = (await Array.fromAsync(Deno.readDir(attemptDirectory)))
      .filter((entry) => entry.name.startsWith("dispatch-claim-"));
    assertEquals(claimFiles.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

const RUN_OS_PROCESS_LOCK_TEST = Deno.args.includes("--run-os-process-lock-test");

Deno.test({
  name: "two OS processes linearize one Prepared under File.lock",
  ignore: !RUN_OS_PROCESS_LOCK_TEST,
  fn: async () => {
    const directory = await Deno.realPath(await Deno.makeTempDir());
    try {
      const identity = await fixtureIdentity();
      const prepares = await racePrepareInSeparateProcesses(directory, identity);
      assertEquals(prepares[0], prepares[1]);
      assertEquals(prepares[0]?.preparedAt, prepares[1]?.preparedAt);
      const preparedEvents = (await Array.fromAsync(
        Deno.readDir(await directoryFor(directory, identity)),
      )).filter((entry) => entry.name.startsWith("event-prepared-"));
      assertEquals(preparedEvents.length, 1);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("dispatch deadline seals one unavailable under lock with the store clock", async () => {
  const directory = await Deno.makeTempDir();
  try {
    let now = "2026-08-29T00:05:00.000Z";
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory, {
      now: () => now,
    });
    const identity = await fixtureIdentity();
    await prepareThroughDispatch(store, identity);
    const sealed = await store.sealDispatchDeadline(identity);
    assertEquals(sealed.phase, "outcome");
    if (sealed.phase !== "outcome") throw new Error("outcome absent");
    assertEquals(sealed.outcome.status, "unavailable");
    assertEquals(sealed.outcome.basis, "quarantined");
    assertEquals(sealed.outcome.recordedAt, "2026-08-29T00:05:00.000Z");
    now = "2026-08-29T00:06:00.000Z";
    const again = await store.sealDispatchDeadline(identity);
    assertEquals(again, sealed);
    assertEquals(
      again.phase === "outcome" ? again.outcome.recordedAt : undefined,
      "2026-08-29T00:05:00.000Z",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recorded vs deadline race keeps the first persisted fact", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const identity = await fixtureIdentity();
    const clock = () => "2026-08-29T00:05:00.000Z";
    const setup = new FileCapabilityRuntimeQualificationAttemptStore(directory, {
      now: clock,
    });
    await prepareThroughDispatch(setup, identity);
    const receipt = await fingerprint("race-receipt");
    const left = new FileCapabilityRuntimeQualificationAttemptStore(directory, {
      now: clock,
    });
    const right = new FileCapabilityRuntimeQualificationAttemptStore(directory, {
      now: clock,
    });
    const [first, second] = await Promise.all([
      left.markRecorded(identity, {
        receiptSha256: "c".repeat(64),
        receiptFingerprint: receipt,
      }),
      right.sealDispatchDeadline(identity),
    ]);
    const winner = await setup.read(keyFor(identity));
    assertEquals(first, winner);
    assertEquals(second, winner);
    assertEquals(
      winner?.phase === "recorded" || winner?.phase === "outcome",
      true,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("pre-dispatch outcome must recross the exact prior event fingerprint", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    await store.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" });
    const active = await store.markActive(identity, {
      runtimeStartFingerprint: await fingerprint("start"),
    });
    const forged = await outcome({
      status: "unavailable",
      basis: "pre-dispatch",
      recordedAt: "2026-08-29T00:00:01.000Z",
      basisFingerprint: await fingerprint("forged-basis"),
    });
    await assertRejects(
      () => store.markOutcome(identity, forged),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "pre-dispatch basis",
    );
    const valid = await outcome({
      status: "unavailable",
      basis: "pre-dispatch",
      recordedAt: "2026-08-29T00:00:01.000Z",
      basisFingerprint: await fingerprintCapabilityRuntimeQualificationAttempt(active),
    });
    assertEquals((await store.markOutcome(identity, valid)).phase, "outcome");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification WAL constructor rejects path escape", () => {
  try {
    new FileCapabilityRuntimeQualificationAttemptStore("state/../escaped");
    throw new Error("expected invalid directory");
  } catch (error) {
    assertEquals(error instanceof TypeError, true);
    assertEquals(
      error instanceof Error && error.message.includes("invalid"),
      true,
    );
  }
});

Deno.test(
  "qualification WAL prepare/read under production read grants does not inspect ancestors",
  async () => {
    const nonce = crypto.randomUUID();
    const relativeRoot =
      `state/local/capability-runtime-host/.permission-anchor-${nonce}`;
    const relativeAttempts = `${relativeRoot}/attempts`;
    const relativeAttestations = `${relativeRoot}/attestations`;
    const identity = await fixtureIdentity();
    const key = keyFor(identity);
    const worktree = Deno.cwd();
    if (!worktree.startsWith("/")) {
      throw new Error("permission-anchor regression requires an absolute cwd");
    }
    await Deno.mkdir(relativeRoot, { recursive: true, mode: 0o700 });
    const workerPath = `${relativeRoot}/worker.ts`;
    const attemptStoreUrl = new URL(
      "./file-capability-runtime-qualification-attempt-store.ts",
      import.meta.url,
    ).href;
    const attestationStoreUrl = new URL(
      "./file-capability-runtime-qualification-attestation-store.ts",
      import.meta.url,
    ).href;
    await Deno.writeTextFile(
      workerPath,
      `import { FileCapabilityRuntimeQualificationAttemptStore } from ${
        JSON.stringify(attemptStoreUrl)
      };
import { FileCapabilityRuntimeQualificationAttestationStore } from ${
        JSON.stringify(attestationStoreUrl)
      };
const attempts = new FileCapabilityRuntimeQualificationAttemptStore(${
        JSON.stringify(relativeAttempts)
      });
const prepared = await attempts.prepare(${JSON.stringify(identity)}, {
  preparedAt: "2026-08-29T00:00:00.000Z",
});
const read = await attempts.read(${JSON.stringify(key)});
const attestations = new FileCapabilityRuntimeQualificationAttestationStore(${
        JSON.stringify(relativeAttestations)
      });
try {
  await attestations.append(JSON.parse("{}"));
  throw new Error("expected attestation append to fail closed");
} catch (error) {
  if (!(error instanceof Error)) throw error;
}
const listed = await attestations.list();
const missing = await attestations.read({
  algorithm: "sha256",
  digest: ${JSON.stringify("a".repeat(64))},
});
console.log(JSON.stringify({
  prepared: prepared.phase,
  read: read?.phase ?? null,
  listed: listed.length,
  missing: missing === undefined,
}));
`,
    );
    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-prompt",
          "--allow-read=.,state/local",
          "--allow-write=state/local",
          workerPath,
        ],
        cwd: worktree,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!output.success) {
        throw new Error(
          `Production-grant WAL worker failed (${output.code}): ${
            new TextDecoder().decode(output.stderr)
          }`,
        );
      }
      assertEquals(
        JSON.parse(new TextDecoder().decode(output.stdout)),
        { prepared: "prepared", read: "prepared", listed: 0, missing: true },
      );
    } finally {
      await Deno.remove(relativeRoot, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  },
);

Deno.test(
  "qualification WAL list/read under YOLO read grants does not inspect the worktree root",
  async () => {
    const nonce = crypto.randomUUID();
    const relativeRoot =
      `state/local/capability-runtime-host/.yolo-permission-anchor-${nonce}`;
    const relativeAttempts = `${relativeRoot}/attempts`;
    const relativeAttestations = `${relativeRoot}/attestations`;
    const identity = await fixtureIdentity();
    const key = keyFor(identity);
    const worktree = Deno.cwd();
    if (!worktree.startsWith("/")) {
      throw new Error("YOLO-grant regression requires an absolute cwd");
    }
    await Deno.mkdir(relativeRoot, { recursive: true, mode: 0o700 });
    const workerPath = `${relativeRoot}/worker.ts`;
    const attemptStoreUrl = new URL(
      "./file-capability-runtime-qualification-attempt-store.ts",
      import.meta.url,
    ).href;
    const attestationStoreUrl = new URL(
      "./file-capability-runtime-qualification-attestation-store.ts",
      import.meta.url,
    ).href;
    await Deno.writeTextFile(
      workerPath,
      `import { FileCapabilityRuntimeQualificationAttemptStore } from ${
        JSON.stringify(attemptStoreUrl)
      };
import { FileCapabilityRuntimeQualificationAttestationStore } from ${
        JSON.stringify(attestationStoreUrl)
      };
const attempts = new FileCapabilityRuntimeQualificationAttemptStore(${
        JSON.stringify(relativeAttempts)
      });
const read = await attempts.read(${JSON.stringify(key)});
const attestations = new FileCapabilityRuntimeQualificationAttestationStore(${
        JSON.stringify(relativeAttestations)
      });
const listed = await attestations.list();
console.log(JSON.stringify({
  missingAttempt: read === undefined,
  listed: listed.length,
}));
`,
    );
    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-prompt",
          "--allow-read=config,state,src/ui,mcp-server.yaml",
          "--allow-write=state/local",
          workerPath,
        ],
        cwd: worktree,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!output.success) {
        throw new Error(
          `YOLO-grant WAL worker failed (${output.code}): ${
            new TextDecoder().decode(output.stderr)
          }`,
        );
      }
      assertEquals(
        JSON.parse(new TextDecoder().decode(output.stdout)),
        { missingAttempt: true, listed: 0 },
      );
    } finally {
      await Deno.remove(relativeRoot, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  },
);

Deno.test({
  name:
    "qualification WAL rejects a pre-existing descendant behind an ancestor symlink",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "qualification-wal-ancestor-symlink-" }),
    );
    try {
      const trusted = `${base}/trusted`;
      const outside = `${base}/outside`;
      await Deno.mkdir(trusted, { mode: 0o700 });
      await Deno.mkdir(`${outside}/wal`, { recursive: true, mode: 0o700 });
      await Deno.symlink(outside, `${trusted}/hop`);
      const identity = await fixtureIdentity();
      const store = new FileCapabilityRuntimeQualificationAttemptStore(
        `${trusted}/hop/wal`,
      );
      await assertRejects(
        () => store.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" }),
        CapabilityRuntimeQualificationAttemptIntegrityError,
        "real directories",
      );
      assertEquals(
        (await Array.fromAsync(Deno.readDir(`${outside}/wal`))).length,
        0,
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "qualification WAL rejects root, file and lock symlinks",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "qualification-wal-symlink-" }),
    );
    try {
      const identity = await fixtureIdentity();
      const linkedTarget = `${base}/linked-target`;
      const linkedParent = `${base}/linked-parent`;
      await Deno.mkdir(linkedTarget, { mode: 0o700 });
      await Deno.symlink(linkedTarget, linkedParent);
      const linkedStore = new FileCapabilityRuntimeQualificationAttemptStore(
        `${linkedParent}/wal`,
      );
      await assertRejects(
        () => linkedStore.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" }),
        CapabilityRuntimeQualificationAttemptIntegrityError,
        "real directories",
      );

      const lockRoot = `${base}/lock-root`;
      await Deno.mkdir(lockRoot, { mode: 0o700 });
      const lockStore = new FileCapabilityRuntimeQualificationAttemptStore(lockRoot);
      await lockStore.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" });
      const attemptDirectory = await directoryFor(lockRoot, identity);
      const lockPath = `${attemptDirectory}/attempt.lock`;
      const externalLock = `${base}/external-lock`;
      await Deno.writeTextFile(externalLock, "", { createNew: true, mode: 0o600 });
      await Deno.remove(lockPath);
      await Deno.symlink(externalLock, lockPath);
      await assertRejects(
        () => lockStore.prepare(identity, { preparedAt: "2026-08-29T00:00:01.000Z" }),
        CapabilityRuntimeQualificationAttemptIntegrityError,
        "regular file",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test("qualification WAL isolates independent keys and rejects a forged outcome fingerprint", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const first = await fixtureIdentity();
    const second = await fixtureIdentity({ spec: "spec-s2" });
    await store.prepare(first, { preparedAt: "2026-08-29T00:00:00.000Z" });
    await store.prepare(second, { preparedAt: "2026-08-29T00:00:00.000Z" });
    assertEquals((await store.read(keyFor(first)))?.phase, "prepared");
    assertEquals((await store.read(keyFor(second)))?.phase, "prepared");
    assertEquals(
      (await directoryFor(directory, first)) ===
        (await directoryFor(directory, second)),
      false,
    );

    await prepareThroughDispatch(store, first);
    const receipt = await fingerprint("first-receipt");
    await store.markRecorded(first, {
      receiptSha256: "c".repeat(64),
      receiptFingerprint: receipt,
    });
    const canonical = await outcome({
      status: "qualified",
      basis: "recorded",
      recordedAt: "2026-08-29T00:01:00.000Z",
      basisFingerprint: receipt,
    });
    await assertRejects(
      () =>
        store.markOutcome(first, {
          ...canonical,
          fingerprint: forgedFingerprint(),
        }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "fingerprint is not canonical",
    );
    const recorded = await store.markOutcome(first, canonical);
    const idempotent = await store.markOutcome(first, canonical);
    assertEquals(idempotent, recorded);
    assertEquals(idempotent.phase, "outcome");
    if (idempotent.phase !== "outcome") throw new Error("outcome absent");
    assertEquals(idempotent.outcome.recordedAt, canonical.recordedAt);
    assertEquals(idempotent.outcome.fingerprint, canonical.fingerprint);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function prepareThroughDispatch(
  store: FileCapabilityRuntimeQualificationAttemptStore,
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): Promise<void> {
  await store.prepare(identity, { preparedAt: "2026-08-29T00:00:00.000Z" });
  await store.markActive(identity, {
    runtimeStartFingerprint: await fingerprint("start"),
  });
  await store.markCaseSubmitted(identity, {
    caseSha256: identity.caseFingerprint.digest,
    caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
  });
  assertEquals(
    (await store.claimDispatching(identity, {
      claimedAt: "2026-08-29T00:00:00.000Z",
      deadlineAt: "2026-08-29T00:05:00.000Z",
    })).dispatchNow,
    true,
  );
}

async function fixtureIdentity(
  value: { readonly candidate?: string; readonly spec?: string } = {},
): Promise<
  CapabilityRuntimeQualificationAttemptIdentity
> {
  const hostIdentity = await fingerprint("host-identity");
  const hostFingerprint = await fingerprintCapabilityRuntimeObservedHost(
    "linux/arm64",
    hostIdentity,
  );
  return {
    candidate: {
      id: value.candidate ?? "chrono-arm64-emulation-v1",
      fingerprint: await fingerprint("candidate"),
    },
    observedHost: {
      platform: "linux/arm64",
      identityFingerprint: hostIdentity,
      fingerprint: hostFingerprint,
    },
    reviewFingerprint: await fingerprint("review"),
    requestId: "chrono-runtime-qualification-request-v1",
    sourceFingerprint: await fingerprint("source"),
    loweringFingerprint: await fingerprint("lowering"),
    caseFingerprint: await fingerprint("case"),
    runRequestFingerprint: await fingerprint("run-request"),
    qualificationSpecFingerprint: await fingerprint(value.spec ?? "spec"),
  };
}

function keyFor(identity: CapabilityRuntimeQualificationAttemptIdentity) {
  return qualificationAttemptKeyFor(identity);
}

function fingerprint(label: string) {
  return sha256Fingerprint({ schemaVersion: "test-fingerprint/1.0", label });
}

async function fixtureStopProof() {
  const startProofFingerprint = await fingerprint("runtime-start");
  const material = {
    unitId: "casys.test",
    materialId: "image",
    imageDigest: "a".repeat(64),
  };
  const launchGroup = {
    id: "casys-test",
    version: "1.0.0",
    fingerprint: await fingerprint("launch-group"),
  };
  return await createCapabilityRuntimeQualificationHostStopProof({
    schemaVersion: "capability-runtime-qualification-host-stop-proof/1.0",
    journalEntry: {
      id: "capability-group-runtime-stop-test",
      action: "runtime-stop",
      materials: [material],
      launchGroup,
      projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
      plannedAt: "2026-08-29T00:00:00.000Z",
      previousObservations: [{
        material,
        state: { material: "installed", runtime: "active" },
      }],
      effectiveRuntimeProjection: null,
      qualificationStartAuthority: null,
      administrativeRemovalPlanFingerprint: null,
    },
    outcome: {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: "capability-group-runtime-stop-test",
      recordedAt: "2026-08-29T00:00:00.000Z",
      status: "succeeded",
      observations: [{
        material,
        state: { material: "installed", runtime: "inactive" },
      }],
      detail: null,
    },
    convergence: "host-outcome-succeeded",
    observations: [{
      material,
      state: { material: "installed", runtime: "inactive" },
    }],
    observedAt: "2026-08-29T00:00:00.000Z",
    startProofFingerprint,
  });
}

async function outcome(
  input: Omit<CapabilityRuntimeQualificationAttemptOutcomeInput, "schemaVersion">,
): Promise<CapabilityRuntimeQualificationAttemptOutcome> {
  return await createCapabilityRuntimeQualificationAttemptOutcome({
    schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
    ...input,
  });
}

function forgedFingerprint() {
  return {
    algorithm: "sha256" as const,
    digest: "f".repeat(64),
  };
}

async function directoryFor(
  directory: string,
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): Promise<string> {
  return `${directory}/${await capabilityRuntimeQualificationAttemptStorageKey(
    keyFor(identity),
  )}`;
}

async function racePrepareInSeparateProcesses(
  directory: string,
  identity: CapabilityRuntimeQualificationAttemptIdentity,
) {
  const nonce = crypto.randomUUID();
  const gate = `${directory}/.race-${nonce}-gate`;
  const readyPaths = [
    `${directory}/.race-${nonce}-left-ready`,
    `${directory}/.race-${nonce}-right-ready`,
  ] as const;
  const moduleUrl = new URL(
    "./file-capability-runtime-qualification-attempt-store.ts",
    import.meta.url,
  ).href;
  const preparedAt = [
    "2026-08-29T00:00:00.000Z",
    "2026-08-29T00:00:01.000Z",
  ] as const;
  const outputsPromise = Promise.all(readyPaths.map((readyPath, index) => {
    const source = `
      const readyPath = ${JSON.stringify(readyPath)};
      const gate = ${JSON.stringify(gate)};
      await Deno.writeTextFile(readyPath, "ready\\n", { createNew: true, mode: 0o600 });
      const { FileCapabilityRuntimeQualificationAttemptStore } = await import(${
      JSON.stringify(moduleUrl)
    });
      for (;;) {
        try {
          await Deno.lstat(gate);
          break;
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      }
      const store = new FileCapabilityRuntimeQualificationAttemptStore(${
      JSON.stringify(directory)
    });
      const result = await store.prepare(${JSON.stringify(identity)}, {
        preparedAt: ${JSON.stringify(preparedAt[index])},
      });
      console.log(JSON.stringify(result));
    `;
    return new Deno.Command(Deno.execPath(), {
      args: ["eval", "--quiet", source],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();
  }));
  await waitForFiles(readyPaths, outputsPromise);
  await Deno.writeTextFile(gate, "go\n", { createNew: true, mode: 0o600 });
  const outputs = await outputsPromise;
  return outputs.map((output) => {
    if (!output.success) {
      throw new Error(
        `Qualification WAL race worker failed (${output.code}): ${
          new TextDecoder().decode(output.stderr)
        }`,
      );
    }
    return JSON.parse(new TextDecoder().decode(output.stdout));
  });
}

async function waitForFiles(
  paths: readonly string[],
  outputsPromise: Promise<readonly Deno.CommandOutput[]>,
): Promise<void> {
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
    const settled = await Promise.race([
      outputsPromise.then((outputs) => outputs),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20)),
    ]);
    if (settled) {
      const failed = settled.find((output) => !output.success);
      throw new Error(
        `Qualification WAL race worker exited before ready: ${
          new TextDecoder().decode(failed?.stderr ?? settled[0]?.stderr)
        }`,
      );
    }
  }
  throw new Error("Timed out waiting for both qualification WAL race workers.");
}
