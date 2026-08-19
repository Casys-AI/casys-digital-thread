import { assertEquals, assertRejects } from "@std/assert";
import { createEngineeringProjectCommandRuntime } from "./engineering-project-command-runtime.ts";

Deno.test("project command runtimes share active revisions and use the tracked manifest only as initial fallback", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-project-runtime-" });
  const evidenceSnapshots = {
    get: () => Promise.resolve(undefined),
  };
  try {
    const first = await createEngineeringProjectCommandRuntime({
      projectId: "generic-test-system",
      trackedManifestPath: "src/testing/generic-engineering-project.fixture.json",
      activeDirectory: directory,
      evidenceSnapshots,
    });
    const initial = (await first.projects.get("generic-test-system"))!;
    assertEquals(initial.revision, 1);

    const next = await first.commands.proposeDecision(
      { kind: "agent", actorId: "runtime-test-agent" },
      {
        commandId: "runtime-proposal-1",
        projectId: initial.project.id,
        expectedRevision: initial.revision,
        issuedAt: "2026-08-01T14:30:00.000Z",
        decisionId: "review-mechanical-proof-case",
        proposal: {
          summary: "Use the reviewed aluminium material card.",
          parameters: [{
            key: "youngs-modulus",
            label: "Young's modulus",
            value: 69,
            unit: "GPa",
          }],
        },
        baseSnapshot: initial.threadSnapshots[0],
      },
    );
    assertEquals(next.revision, 2);

    const second = await createEngineeringProjectCommandRuntime({
      projectId: "generic-test-system",
      trackedManifestPath: "src/testing/generic-engineering-project.fixture.json",
      activeDirectory: directory,
      evidenceSnapshots,
    });
    assertEquals(
      (await second.projects.get("generic-test-system"))?.revision,
      2,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("project command runtime starts without a bundled product seed", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-project-runtime-empty-" });
  try {
    const runtime = await createEngineeringProjectCommandRuntime({
      activeDirectory: directory,
      evidenceSnapshots: { get: () => Promise.resolve(undefined) },
    });
    assertEquals(await runtime.projects.get("generic-test-system"), undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("project command runtime rejects a partial explicit seed", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-project-runtime-partial-",
  });
  try {
    await assertRejects(
      () =>
        createEngineeringProjectCommandRuntime({
          projectId: "isolated-project",
          activeDirectory: directory,
          evidenceSnapshots: { get: () => Promise.resolve(undefined) },
        }),
      TypeError,
      "requires projectId and trackedManifestPath together",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
