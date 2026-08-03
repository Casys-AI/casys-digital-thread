import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { FileThreadSnapshotStore } from "../src/adapters/file-thread-snapshot-store.ts";
import {
  assertCorrectionLoop,
  assertNoReusedDescendantOutputs,
  createCoffeeMachineCm01V3CorrectionLoopFixture,
  ReusedDescendantOutputError,
  verifyCoffeeMachineCm01V3CorrectionLoop,
} from "./verify-coffee-machine-cm01-v3-correction-loop.ts";

Deno.test("CM-01 V3 inert correction proof retains the old snapshot and recomputes only CAD plus CalculiX", async () => {
  const fixture = await createCoffeeMachineCm01V3CorrectionLoopFixture();
  assertCorrectionLoop(fixture);

  assertEquals(fixture.proofCase.source, {
    proofCasePath:
      "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json",
    field: "geometry.heightMm",
    beforeValue: 28,
    afterValue: 30,
    unit: "mm",
  });
  assertEquals(fixture.after.previous, {
    snapshotId: fixture.before.id,
    revision: fixture.before.revision,
  });
  assertEquals(fixture.after.revision, fixture.before.revision + 1);
  assertEquals(
    fixture.after.artifacts
      .filter((artifact) => fixture.affectedArtifactIds.includes(artifact.id))
      .every((artifact) => artifact.freshness.status === "stale"),
    true,
  );
  assertEquals(
    fixture.after.artifacts
      .filter((artifact) => artifact.id.endsWith("-r2"))
      .map((artifact) => artifact.id),
    [
      "design-input-r2",
      "cad-plan-r2",
      "cad-script-r2",
      "cad-step-r2",
      "calculix-static-result-r2",
    ],
  );
  assertEquals(
    fixture.unaffectedArtifactIds.every((id) => {
      const before = fixture.before.artifacts.find((artifact) => artifact.id === id);
      const after = fixture.after.artifacts.find((artifact) => artifact.id === id);
      return before?.fingerprint.digest === after?.fingerprint.digest &&
        before?.producer.runId === after?.producer.runId &&
        after?.freshness.status === "fresh";
    }),
    true,
  );
});

Deno.test("CM-01 V3 correction proof refuses a structurally valid reuse of old CAD and CalculiX descendants", async () => {
  const fixture = await createCoffeeMachineCm01V3CorrectionLoopFixture();
  assertThrows(
    () =>
      assertNoReusedDescendantOutputs({
        before: fixture.before,
        after: fixture.reusedDescendantCandidate,
        correctionChangeId: fixture.correctionChangeId,
      }),
    ReusedDescendantOutputError,
    "Refusing to reuse descendant output cad-plan-r1",
  );
  const result = await verifyCoffeeMachineCm01V3CorrectionLoop();
  assertEquals(result.providerCalls, 0);
  assertEquals(result.negativeControl.status, "rejected");
  assertEquals(result.negativeControl.reason.includes("cad-plan-r1"), true);
});

Deno.test("CM-01 V3 correction proof persists both snapshots immutably", async () => {
  const fixture = await createCoffeeMachineCm01V3CorrectionLoopFixture();
  const root = await Deno.makeTempDir({ prefix: "casys-cm01-v3-correction-proof-" });
  try {
    const store = new FileThreadSnapshotStore(root);
    await store.save(fixture.before);
    await store.save(fixture.after);

    assertEquals(await store.get(fixture.before.id), fixture.before);
    assertEquals(await store.get(fixture.after.id), fixture.after);
    await assertRejects(
      () =>
        store.save({
          ...structuredClone(fixture.before),
          generatedAt: "2026-08-03T11:00:01.000Z",
        }),
      Error,
      "already exists with different content",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
