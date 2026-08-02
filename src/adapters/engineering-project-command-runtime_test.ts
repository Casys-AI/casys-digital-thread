import { assertEquals } from "@std/assert";
import { createEngineeringProjectCommandRuntime } from "./engineering-project-command-runtime.ts";

Deno.test("project command runtimes share active revisions and use the tracked manifest only as initial fallback", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-project-runtime-" });
  const evidenceSnapshots = {
    get: () => Promise.resolve(undefined),
  };
  try {
    const first = await createEngineeringProjectCommandRuntime({
      projectId: "coffee-machine-cm01",
      trackedManifestPath: "config/projects/coffee-machine-cm01.project.json",
      activeDirectory: directory,
      evidenceSnapshots,
    });
    const initial = (await first.projects.get("coffee-machine-cm01"))!;
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
      projectId: "coffee-machine-cm01",
      trackedManifestPath: "config/projects/coffee-machine-cm01.project.json",
      activeDirectory: directory,
      evidenceSnapshots,
    });
    assertEquals(
      (await second.projects.get("coffee-machine-cm01"))?.revision,
      2,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
