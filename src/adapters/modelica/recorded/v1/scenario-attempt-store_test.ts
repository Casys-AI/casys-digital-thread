import { assertEquals, assertRejects } from "@std/assert";
import {
  FileModelicaScenarioAttemptStore,
  ModelicaScenarioIllegalTransitionError,
  ModelicaScenarioOutcomeUnknownError,
  ModelicaScenarioRunQuarantinedError,
} from "./scenario-attempt-store.ts";

const PLAN = "a".repeat(64);
const PLAN_B = "b".repeat(64);
const RUN_ID = "run:simulate-modelica-scenario-001";
const PROJ = "project:inspection-drone-v4";
const PROVIDER_RUN_ID = "modelica-run-abc123";
const AT = "2026-08-10T09:00:00.000Z";
const FP1 = "c".repeat(64);
const FP2 = "d".repeat(64);

const ENVELOPE: Record<string, unknown> = {
  schemaVersion: "modelica-simulate-response/1.0",
  kind: "simulate",
  run_id: PROVIDER_RUN_ID,
  status: "accepted",
};

function identity() {
  return { projectId: PROJ, runId: RUN_ID };
}

function beginInput(planDigest = PLAN) {
  return { ...identity(), planDigest, dispatchedAt: AT };
}

function recordInput(planDigest = PLAN) {
  return {
    ...identity(),
    planDigest,
    providerRunId: PROVIDER_RUN_ID,
    canonicalSimulateEnvelope: ENVELOPE,
  };
}

function completeInput(planDigest = PLAN) {
  return {
    ...identity(),
    planDigest,
    providerRunRecordFp: FP1,
    receiptFp: FP2,
  };
}

async function withStore(
  body: (store: FileModelicaScenarioAttemptStore) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-scenario-attempt-",
  });
  try {
    await body(new FileModelicaScenarioAttemptStore(directory));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

// ── State 1: dispatched ──────────────────────────────────────────────────────

Deno.test("Modelica scenario WAL returns dispatch action for a new run", async () => {
  await withStore(async (store) => {
    assertEquals(await store.begin(beginInput()), { action: "dispatch" });
    assertEquals((await store.readRun(PROJ, RUN_ID))?.status, "dispatched");
  });
});

Deno.test("Modelica scenario WAL treats a dispatched record as unknown outcome on begin", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await assertRejects(
      () => store.begin(beginInput()),
      ModelicaScenarioOutcomeUnknownError,
    );
  });
});

Deno.test("Modelica scenario WAL treats a dispatched record as unknown even with a matching plan digest", async () => {
  await withStore(async (store) => {
    assertEquals(await store.begin(beginInput(PLAN)), { action: "dispatch" });
    // Second begin with the same planDigest: dispatched → still unknown.
    await assertRejects(
      () => store.begin(beginInput(PLAN)),
      ModelicaScenarioOutcomeUnknownError,
    );
  });
});

// ── State 2: provider-run-known ──────────────────────────────────────────────

Deno.test("Modelica scenario WAL advances dispatched to provider-run-known", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    const record = await store.readRun(PROJ, RUN_ID);
    assertEquals(record?.status, "provider-run-known");
    if (record?.status !== "provider-run-known") return;
    assertEquals(record.providerRunId, PROVIDER_RUN_ID);
    assertEquals(record.canonicalSimulateEnvelope, ENVELOPE);
  });
});

Deno.test("Modelica scenario WAL returns provider-run-known action on begin when run-id is recorded", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    assertEquals(await store.begin(beginInput()), {
      action: "provider-run-known",
      providerRunId: PROVIDER_RUN_ID,
      canonicalSimulateEnvelope: ENVELOPE,
    });
  });
});

Deno.test("Modelica scenario WAL throws OutcomeUnknown on begin for provider-run-known with wrong plan digest", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await assertRejects(
      () => store.begin(beginInput(PLAN_B)),
      ModelicaScenarioOutcomeUnknownError,
    );
  });
});

Deno.test("Modelica scenario WAL recordProviderRun is idempotent for identical data", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    // Second call with identical data must not throw and must not mutate.
    await store.recordProviderRun(recordInput());
    assertEquals((await store.readRun(PROJ, RUN_ID))?.status, "provider-run-known");
  });
});

Deno.test("Modelica scenario WAL throws OutcomeUnknown when recordProviderRun data conflicts", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await assertRejects(
      () =>
        store.recordProviderRun({
          ...recordInput(),
          providerRunId: "different-run-id",
        }),
      ModelicaScenarioOutcomeUnknownError,
    );
  });
});

// ── State 3: completed ───────────────────────────────────────────────────────

Deno.test("Modelica scenario WAL advances provider-run-known to completed", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await store.complete(completeInput());
    const record = await store.readRun(PROJ, RUN_ID);
    assertEquals(record?.status, "completed");
    if (record?.status !== "completed") return;
    assertEquals(record.providerRunRecordFp, FP1);
    assertEquals(record.receiptFp, FP2);
  });
});

Deno.test("Modelica scenario WAL returns completed action on begin when both fingerprints are recorded", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await store.complete(completeInput());
    assertEquals(await store.begin(beginInput()), {
      action: "completed",
      providerRunId: PROVIDER_RUN_ID,
      providerRunRecordFp: FP1,
      receiptFp: FP2,
      canonicalSimulateEnvelope: ENVELOPE,
    });
  });
});

Deno.test("Modelica scenario WAL throws OutcomeUnknown on begin for completed with wrong plan digest", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await store.complete(completeInput());
    await assertRejects(
      () => store.begin(beginInput(PLAN_B)),
      ModelicaScenarioOutcomeUnknownError,
    );
  });
});

Deno.test("Modelica scenario WAL complete is idempotent for identical fingerprints", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await store.complete(completeInput());
    await store.complete(completeInput());
    assertEquals((await store.readRun(PROJ, RUN_ID))?.status, "completed");
  });
});

// ── Illegal transitions ──────────────────────────────────────────────────────

Deno.test("Modelica scenario WAL blocks complete directly from dispatched", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await assertRejects(
      () => store.complete(completeInput()),
      ModelicaScenarioIllegalTransitionError,
      "dispatched",
    );
  });
});

Deno.test("Modelica scenario WAL blocks recordProviderRun on a completed record", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await store.complete(completeInput());
    await assertRejects(
      () => store.recordProviderRun(recordInput()),
      ModelicaScenarioIllegalTransitionError,
      "completed",
    );
  });
});

// ── Plan digest mismatch ─────────────────────────────────────────────────────

Deno.test("Modelica scenario WAL throws OutcomeUnknown when recordProviderRun plan digest mismatches", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput(PLAN));
    await assertRejects(
      () => store.recordProviderRun({ ...recordInput(), planDigest: PLAN_B }),
      ModelicaScenarioOutcomeUnknownError,
    );
  });
});

Deno.test("Modelica scenario WAL throws OutcomeUnknown when complete plan digest mismatches", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await assertRejects(
      () => store.complete({ ...completeInput(), planDigest: PLAN_B }),
      ModelicaScenarioOutcomeUnknownError,
    );
  });
});

// ── Envelope persistence ─────────────────────────────────────────────────────

Deno.test("Modelica scenario WAL preserves canonical simulate envelope from provider-run-known through completed", async () => {
  const richEnvelope: Record<string, unknown> = {
    schemaVersion: "modelica-simulate-response/1.0",
    kind: "simulate",
    run_id: PROVIDER_RUN_ID,
    status: "accepted",
    model: { id: "ThermalKit.CoffeeMachine", version: "1.2.3" },
    resolved_parameters: [{ id: "T_ambient", value: 20, unit: "degC" }],
  };
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun({
      ...recordInput(),
      canonicalSimulateEnvelope: richEnvelope,
    });
    await store.complete(completeInput());
    const record = await store.readRun(PROJ, RUN_ID);
    if (record?.status !== "completed") throw new Error("Expected completed.");
    assertEquals(record.canonicalSimulateEnvelope, richEnvelope);
    // Also verified via begin recovery path.
    const recovered = await store.begin(beginInput());
    if (recovered.action !== "completed") throw new Error("Expected completed action.");
    assertEquals(recovered.canonicalSimulateEnvelope, richEnvelope);
  });
});

// ── Quarantine ───────────────────────────────────────────────────────────────

Deno.test("Modelica scenario WAL quarantine marks a run and isQuarantined reports it", async () => {
  await withStore(async (store) => {
    assertEquals(await store.isQuarantined(PROJ, RUN_ID), false);
    await store.quarantine({ ...identity(), quarantinedAt: AT });
    assertEquals(await store.isQuarantined(PROJ, RUN_ID), true);
  });
});

Deno.test("Modelica scenario WAL quarantine is idempotent for the same run", async () => {
  await withStore(async (store) => {
    await Promise.all([
      store.quarantine({ ...identity(), quarantinedAt: AT }),
      store.quarantine({ ...identity(), quarantinedAt: AT }),
    ]);
    assertEquals(await store.isQuarantined(PROJ, RUN_ID), true);
  });
});

Deno.test("Modelica scenario WAL quarantine blocks begin before any attempt record", async () => {
  await withStore(async (store) => {
    await store.quarantine({ ...identity(), quarantinedAt: AT });
    await assertRejects(
      () => store.begin(beginInput()),
      ModelicaScenarioRunQuarantinedError,
    );
    assertEquals(await store.readRun(PROJ, RUN_ID), undefined);
  });
});

Deno.test("Modelica scenario WAL quarantine wins over an existing completed attempt", async () => {
  await withStore(async (store) => {
    await store.begin(beginInput());
    await store.recordProviderRun(recordInput());
    await store.complete(completeInput());
    await store.quarantine({ ...identity(), quarantinedAt: AT });

    await assertRejects(
      () => store.begin(beginInput()),
      ModelicaScenarioRunQuarantinedError,
    );
    assertEquals((await store.readRun(PROJ, RUN_ID))?.status, "completed");
  });
});

Deno.test("Modelica scenario WAL quarantine validates its sentinel before trusting it", async () => {
  await withStore(async (store) => {
    await store.quarantine({ ...identity(), quarantinedAt: AT });
    // Corrupt the sentinel on disk — isQuarantined must throw, not silently
    // return false (fail-closed: unknown is not clean).
    const dir = await Array.fromAsync(Deno.readDir(
      (store as unknown as { directory: string }).directory,
    ));
    const sentinel = dir.find((e) => e.name.startsWith("quarantine-"));
    const dirPath = (store as unknown as { directory: string }).directory;
    await Deno.writeTextFile(`${dirPath}/${sentinel!.name}`, "{}");
    await assertRejects(() => store.isQuarantined(PROJ, RUN_ID));
  });
});

// ── Persistence and round-trip ───────────────────────────────────────────────

Deno.test("Modelica scenario WAL dispatched record survives a process restart", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-scenario-attempt-",
  });
  try {
    const store1 = new FileModelicaScenarioAttemptStore(directory);
    await store1.begin(beginInput());
    // Re-open with a fresh store instance (simulates restart).
    const store2 = new FileModelicaScenarioAttemptStore(directory);
    const record = await store2.readRun(PROJ, RUN_ID);
    assertEquals(record?.status, "dispatched");
    assertEquals(record?.planDigest, PLAN);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica scenario WAL file names are bounded for arbitrarily long run identities", async () => {
  await withStore(async (store) => {
    const long = "x".repeat(1_000);
    await store.begin({
      projectId: `project:${long}`,
      runId: `run:${long}`,
      planDigest: PLAN,
      dispatchedAt: AT,
    });
    const entries: string[] = [];
    for await (
      const entry of Deno.readDir(
        (store as unknown as { directory: string }).directory,
      )
    ) {
      entries.push(entry.name);
    }
    assertEquals(entries.length, 1);
    assertEquals(entries[0]!.startsWith("run-"), true);
    assertEquals(new TextEncoder().encode(entries[0]!).length <= 255, true);
  });
});
