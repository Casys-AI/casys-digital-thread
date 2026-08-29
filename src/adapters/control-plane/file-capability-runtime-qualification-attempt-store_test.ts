import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimeQualificationAttemptIntegrityError,
  FileCapabilityRuntimeQualificationAttemptStore,
} from "./file-capability-runtime-qualification-attempt-store.ts";
import {
  fingerprintCapabilityRuntimeObservedHost,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeQualificationAttemptIdentity,
} from "../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";

Deno.test("qualification attempt WAL is monotone, durable and idempotent", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    const start = await fingerprint("runtime-start");
    const receipt = await fingerprint("receipt");
    const outcome = await fingerprint("outcome");
    const stop = await fingerprint("runtime-stop");
    const attestation = await fingerprint("attestation");

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
      (await store.markOutcome(identity, {
        status: "qualified",
        basis: "recorded",
        fingerprint: outcome,
      })).phase,
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
    assertEquals(
      (await store.markAttested(identity, { attestationFingerprint: attestation }))
        .phase,
      "attested",
    );

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
    const entries = await Array.fromAsync(Deno.readDir(directory));
    const dispatchEvent = entries.find((entry) =>
      entry.name.includes(".event-dispatching-")
    );
    if (!dispatchEvent) throw new Error("dispatch event absent");
    await Deno.remove(`${directory}/${dispatchEvent.name}`);
    const afterClaimOnly = await new FileCapabilityRuntimeQualificationAttemptStore(
      directory,
    )
      .claimDispatching(identity);
    assertEquals(afterClaimOnly.dispatchNow, false);
    assertEquals(afterClaimOnly.attempt.phase, "dispatching");
    await store.markQuarantined(identity, { reason: "uncertain" });
    const unavailable = await fingerprint("unavailable");
    await store.markOutcome(identity, {
      status: "unavailable",
      basis: "quarantined",
      fingerprint: unavailable,
    });
    const later = await store.claimDispatching(identity);
    assertEquals(later.dispatchNow, false);
    assertEquals(later.attempt.phase, "outcome");
    await assertRejects(
      () => store.markAttested(identity, { attestationFingerprint: unavailable }),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "cannot precede verified runtime stop",
    );
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

Deno.test("qualification WAL rejects corruption and foreign entries rather than guessing", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeQualificationAttemptStore(directory);
    const identity = await fixtureIdentity();
    await store.prepare(identity);
    await Deno.writeTextFile(`${directory}/foreign.json`, "{}\n");
    await assertRejects(
      () => store.read(keyFor(identity)),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "unsupported entry",
    );
    await Deno.remove(`${directory}/foreign.json`);
    const entries = await Array.fromAsync(Deno.readDir(directory));
    const prepared = entries.find((entry) => entry.name.includes(".event-prepared-"));
    if (!prepared) throw new Error("prepared event absent");
    await Deno.writeTextFile(`${directory}/${prepared.name}`, "not-json\n");
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
    const entries = await Array.fromAsync(Deno.readDir(directory));
    const claim = entries.find((entry) => entry.name.includes(".dispatch-claim-"));
    if (!claim) throw new Error("dispatch claim absent");
    await Deno.remove(`${directory}/${claim.name}`);
    await assertRejects(
      () => store.read(keyFor(identity)),
      CapabilityRuntimeQualificationAttemptIntegrityError,
      "lacks its durable claim",
    );
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

async function fixtureIdentity(): Promise<
  CapabilityRuntimeQualificationAttemptIdentity
> {
  const hostIdentity = await fingerprint("host-identity");
  const hostFingerprint = await fingerprintCapabilityRuntimeObservedHost(
    "linux/arm64",
    hostIdentity,
  );
  return {
    candidate: {
      id: "chrono-arm64-emulation-v1",
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
  return {
    candidateId: identity.candidate.id,
    candidateFingerprint: identity.candidate.fingerprint,
    observedHostFingerprint: identity.observedHost.fingerprint,
  };
}

function fingerprint(label: string) {
  return sha256Fingerprint({ schemaVersion: "test-fingerprint/1.0", label });
}
