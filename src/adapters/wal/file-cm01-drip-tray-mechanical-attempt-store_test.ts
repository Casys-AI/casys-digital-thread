import { assertEquals, assertRejects } from "@std/assert";
import {
  Cm01DripTrayMechanicalOutcomeUnknownError,
  FileCm01DripTrayMechanicalAttemptStore,
} from "./file-cm01-drip-tray-mechanical-attempt-store.ts";

Deno.test("CM-01 V3 mechanical attempt store never replays a dispatched outcome", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-cm01-mechanical-attempt-",
  });
  try {
    const store = new FileCm01DripTrayMechanicalAttemptStore(directory);
    assertEquals(
      await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-1",
        dispatchedAt: "2026-08-03T16:00:00.000Z",
      }),
      { action: "dispatch" },
    );
    await assertRejects(
      () =>
        store.begin({
          projectId: "coffee-machine-cm01-v3",
          runId: "run-1",
          dispatchedAt: "2026-08-03T16:01:00.000Z",
        }),
      Cm01DripTrayMechanicalOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 mechanical attempt recovery reads a completed capture without creating a marker", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-cm01-mechanical-attempt-recovery-",
  });
  try {
    const store = new FileCm01DripTrayMechanicalAttemptStore(directory);
    assertEquals(
      await store.completedCapture({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-missing",
      }),
      undefined,
    );
    const entries: string[] = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry.name);
    assertEquals(entries, []);

    await store.begin({
      projectId: "coffee-machine-cm01-v3",
      runId: "run-completed",
      dispatchedAt: "2026-08-03T16:00:00.000Z",
    });
    const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
    await store.complete({
      projectId: "coffee-machine-cm01-v3",
      runId: "run-completed",
      completedAt: "2026-08-03T16:01:00.000Z",
      captureFingerprint: fingerprint,
    });
    assertEquals(
      await store.completedCapture({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-completed",
      }),
      fingerprint,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
