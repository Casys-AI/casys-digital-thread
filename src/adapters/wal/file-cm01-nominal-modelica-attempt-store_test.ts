import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  Cm01NominalModelicaOutcomeUnknownError,
  FileCm01NominalModelicaAttemptStore,
} from "./file-cm01-nominal-modelica-attempt-store.ts";

const identity = {
  projectId: "coffee-machine-cm01-v3",
  runId: "run:cm01-nominal-thermal",
  dispatchedAt: "2026-08-03T14:00:00.000Z",
};

Deno.test("CM-01 Modelica attempt store fails closed for an unknown dispatch and resumes only a hash-bound capture", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-modelica-attempt-" });
  try {
    const store = new FileCm01NominalModelicaAttemptStore(directory);
    assertEquals(await store.begin(identity), { action: "dispatch" });
    await assertRejects(
      () => store.begin(identity),
      Cm01NominalModelicaOutcomeUnknownError,
      "will not be retried automatically",
    );

    const fingerprint = await sha256Fingerprint({ capture: "cm01" });
    await store.complete({
      ...identity,
      completedAt: "2026-08-03T14:01:00.000Z",
      captureFingerprint: fingerprint,
    });
    assertEquals(await store.begin(identity), {
      action: "completed",
      captureFingerprint: fingerprint,
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
