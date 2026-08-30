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
    const stop = await fingerprint("runtime-stop");
    const attestation = await fingerprint("attestation");
    const qualifiedOutcome = await outcome({
      status: "qualified",
      basis: "recorded",
      recordedAt: "2026-08-29T00:01:00.000Z",
      basisFingerprint: receipt,
    });

    assertEquals((await store.prepare(identity)).phase, "prepared");
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
    assertEquals((await store.claimDispatching(identity)).dispatchNow, true);
    assertEquals((await store.claimDispatching(identity)).dispatchNow, false);
    assertEquals(
      (await store.markRecorded(identity, { receiptFingerprint: receipt })).phase,
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
      (await store.markStopped(identity, { runtimeStopFingerprint: stop })).phase,
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
    const dispatch = await recovered.claimDispatching(identity);
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
      .claimDispatching(identity);
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
    const later = await store.claimDispatching(identity);
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
          receiptFingerprint: await fingerprint("late-receipt"),
        })
      ).phase,
      "recorded",
    );
    const dispatch = await recovered.claimDispatching(identity);
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
    await store.prepare(identity);
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
      () => store.prepare({ ...identity, requestId: "different-request" }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "identity conflicts",
    );
    await assertRejects(
      () => store.prepare({ ...identity, bearerToken: "must-not-persist" } as never),
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
    await store.prepare(identity);
    const divergentIdentities = [
      { ...identity, requestId: "different-request" },
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
        requestFingerprint: await fingerprint("different-request-fingerprint"),
      },
      { ...identity, preparedAt: "2026-08-29T00:00:01.000Z" },
    ];
    for (const divergent of divergentIdentities) {
      await assertRejects(
        () => store.prepare(divergent),
        CapabilityRuntimeQualificationAttemptIntegrityError,
        "identity conflicts",
      );
      await assertRejects(
        () => store.claimDispatching(divergent),
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
    await store.prepare(identity);
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

Deno.test("qualification WAL isolates independent keys and rejects a forged outcome fingerprint", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const first = await fixtureIdentity();
    const second = await fixtureIdentity({ candidate: "chrono-other-candidate-v1" });
    await store.prepare(first);
    await store.prepare(second);
    assertEquals((await store.read(keyFor(first)))?.phase, "prepared");
    assertEquals((await store.read(keyFor(second)))?.phase, "prepared");
    assertEquals(
      (await directoryFor(directory, first)) ===
        (await directoryFor(directory, second)),
      false,
    );

    await prepareThroughDispatch(store, first);
    const receipt = await fingerprint("first-receipt");
    await store.markRecorded(first, { receiptFingerprint: receipt });
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
  await store.prepare(identity);
  await store.markActive(identity, {
    runtimeStartFingerprint: await fingerprint("start"),
  });
  await store.markCaseSubmitted(identity, {
    caseSha256: identity.caseFingerprint.digest,
    caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
  });
  assertEquals((await store.claimDispatching(identity)).dispatchNow, true);
}

async function fixtureIdentity(
  value: { readonly candidate?: string } = {},
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
    requestId: "chrono-runtime-qualification-request-v1",
    sourceFingerprint: await fingerprint("source"),
    loweringFingerprint: await fingerprint("lowering"),
    caseFingerprint: await fingerprint("case"),
    requestFingerprint: await fingerprint("request"),
    preparedAt: "2026-08-29T00:00:00.000Z",
  };
}

function keyFor(identity: CapabilityRuntimeQualificationAttemptIdentity) {
  return qualificationAttemptKeyFor(identity);
}

function fingerprint(label: string) {
  return sha256Fingerprint({ schemaVersion: "test-fingerprint/1.0", label });
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
