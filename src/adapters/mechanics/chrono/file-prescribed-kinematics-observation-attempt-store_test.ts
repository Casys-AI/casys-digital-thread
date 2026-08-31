import { assertEquals, assertRejects } from "@std/assert";
import {
  FilePrescribedKinematicsObservationAttemptStore,
} from "./file-prescribed-kinematics-observation-attempt-store.ts";

const identity = {
  projectId: "project-mechanism",
  agentRunId: "run-prescribed",
  requestId: "request-prescribed",
  caseFingerprint: fingerprint("b"),
  runtime: {
    resolvedOperationPlanFingerprint: fingerprint("a"),
    operationalCapabilityFingerprint: fingerprint("c"),
    binding: { id: "chrono-prescribed-kinematics", version: "1" },
    adapter: {
      id: "chrono-prescribed-kinematics-adapter",
      version: "0.3.2",
      source: "src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts",
    },
    profile: null,
    material: {
      unitId: "casys.mcp-chrono",
      materialId: "mcp-chrono-image",
      imageDigest: "f".repeat(64),
    },
    launchGroup: {
      id: "casys-chrono",
      version: "1.0.0",
      fingerprint: fingerprint("a"),
    },
    platformMode: "emulated" as const,
  },
  sourceFingerprint: fingerprint("d"),
  loweringFingerprint: fingerprint("e"),
  requestFingerprint: fingerprint("f"),
  startedAt: "2026-08-29T00:00:00.000Z",
} as const;

Deno.test("prescribed-kinematics L3 WAL persists dispatch intent and never grants a redispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-wal-" });
  try {
    const first = new FilePrescribedKinematicsObservationAttemptStore(directory);
    await first.prepare(identity);
    await first.markCaseSubmitted(identity, {
      caseSha256: "e".repeat(64),
      caseUri: `chrono-case:sha256:${"e".repeat(64)}`,
    });
    const dispatched = await first.markDispatching(identity);
    assertEquals(dispatched.dispatchNow, true);

    // Simulate a process crash after the provider may have received `run`.
    const restarted = new FilePrescribedKinematicsObservationAttemptStore(directory);
    const replay = await restarted.markDispatching(identity);
    assertEquals(replay.dispatchNow, false);
    assertEquals(replay.attempt.phase, "dispatching");
    await assertRejects(
      () =>
        restarted.markCaseSubmitted(identity, {
          caseSha256: "f".repeat(64),
          caseUri: `chrono-case:sha256:${"f".repeat(64)}`,
        }),
      Error,
      "identity",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 WAL leaves uncertain and absent readback recoverable", async () => {
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-wal-" });
  try {
    const store = new FilePrescribedKinematicsObservationAttemptStore(directory);
    await store.prepare(identity);
    await store.markCaseSubmitted(identity, {
      caseSha256: "e".repeat(64),
      caseUri: `chrono-case:sha256:${"e".repeat(64)}`,
    });
    await store.markDispatching(identity);
    const quarantined = await store.markQuarantined(identity, "uncertain");
    assertEquals(quarantined.phase, "quarantined");
    if (quarantined.phase !== "quarantined") {
      throw new Error("A fresh quarantine cannot be recorded.");
    }
    assertEquals(quarantined.quarantineReason, "uncertain");
    const resumed = await new FilePrescribedKinematicsObservationAttemptStore(directory)
      .markDispatching(identity);
    assertEquals(resumed.dispatchNow, false);
    assertEquals(resumed.attempt.phase, "quarantined");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 WAL grants exactly one inter-process dispatch claim", async () => {
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-wal-" });
  try {
    const stores = Array.from(
      { length: 8 },
      () => new FilePrescribedKinematicsObservationAttemptStore(directory),
    );
    await stores[0]!.prepare(identity);
    await stores[0]!.markCaseSubmitted(identity, {
      caseSha256: "e".repeat(64),
      caseUri: `chrono-case:sha256:${"e".repeat(64)}`,
    });
    const results = await Promise.all(
      stores.map((store) => store.markDispatching(identity)),
    );
    assertEquals(results.filter((result) => result.dispatchNow).length, 1);
    assertEquals(
      results.every((result) => result.attempt.phase === "dispatching"),
      true,
    );
    const replay = await new FilePrescribedKinematicsObservationAttemptStore(directory)
      .markDispatching(identity);
    assertEquals(replay.dispatchNow, false);
    assertEquals(replay.attempt.phase, "dispatching");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 treats a torn visible claim as no-redispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-wal-" });
  try {
    const store = new FilePrescribedKinematicsObservationAttemptStore(directory);
    await store.prepare(identity);
    await store.markCaseSubmitted(identity, {
      caseSha256: "e".repeat(64),
      caseUri: `chrono-case:sha256:${"e".repeat(64)}`,
    });
    assertEquals((await store.markDispatching(identity)).dispatchNow, true);
    const claim = (await Array.fromAsync(Deno.readDir(directory))).find((entry) =>
      entry.name.endsWith(".dispatch-claim")
    );
    if (!claim) throw new Error("The test dispatch claim was not persisted.");
    // Simulate a legacy/direct write dying mid-payload. Content is never
    // parsed for authority; the deterministic createNew name already seals it.
    await Deno.writeTextFile(`${directory}/${claim.name}`, "{partial");
    const resumed = await new FilePrescribedKinematicsObservationAttemptStore(directory)
      .markDispatching(identity);
    assertEquals(resumed.dispatchNow, false);
    assertEquals(resumed.attempt.phase, "dispatching");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 event WAL never regresses a concurrent recorded receipt to quarantine", async () => {
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-wal-" });
  try {
    const first = new FilePrescribedKinematicsObservationAttemptStore(directory);
    const second = new FilePrescribedKinematicsObservationAttemptStore(directory);
    await first.prepare(identity);
    await first.markCaseSubmitted(identity, {
      caseSha256: "e".repeat(64),
      caseUri: `chrono-case:sha256:${"e".repeat(64)}`,
    });
    assertEquals((await first.markDispatching(identity)).dispatchNow, true);

    const [recorded, quarantined] = await Promise.all([
      first.markRecorded(identity, "a".repeat(64)),
      second.markQuarantined(identity, "uncertain"),
    ]);
    assertEquals(recorded.phase, "recorded");
    assertEquals(
      quarantined.phase === "quarantined" || quarantined.phase === "recorded",
      true,
    );
    const resumed = await new FilePrescribedKinematicsObservationAttemptStore(directory)
      .read(identity);
    assertEquals(resumed?.phase, "recorded");
    if (resumed?.phase === "recorded") {
      assertEquals(resumed.receiptSha256, "a".repeat(64));
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}
