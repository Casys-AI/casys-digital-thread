import { assertEquals, assertRejects } from "@std/assert";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import {
  createNeutralStartedProject,
  NEUTRAL_PROJECT_ID,
} from "../../testing/neutral-started-engineering-project-fixture.ts";
import { createEngineeringProjectCommandRuntime } from "./engineering-project-command-runtime.ts";

Deno.test("project command runtimes share active revisions and use the tracked manifest only as initial fallback", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-project-runtime-" });
  const trackedManifestPath = `${directory}/initial-project.json`;
  const evidenceSnapshots = {
    get: () => Promise.resolve(undefined),
  };
  try {
    await Deno.writeTextFile(
      trackedManifestPath,
      `${JSON.stringify(await createNeutralStartedProject())}\n`,
    );
    const first = await createEngineeringProjectCommandRuntime({
      projectId: NEUTRAL_PROJECT_ID,
      trackedManifestPath,
      activeDirectory: directory,
      evidenceSnapshots,
    });
    const initial = (await first.projects.get(NEUTRAL_PROJECT_ID))!;
    assertEquals(initial.revision, 1);

    const briefCommands = new ProjectBriefCommandService(
      first.projects,
      () => "2026-08-01T14:01:00.000Z",
    );
    const next = await briefCommands.proposeQuestion(
      { kind: "agent", actorId: "runtime-test-agent" },
      {
        commandId: "runtime-question-1",
        projectId: initial.project.id,
        expectedRevision: initial.revision,
        issuedAt: "2026-08-01T14:00:30.000Z",
        question: {
          id: "runtime-scope",
          prompt: "Which bounded scope should the runtime test retain?",
          whyItMatters: "It proves a shared active revision can be reread.",
          recommendation: {
            value: "shared-revision",
            rationale: "The test only needs one bounded successor revision.",
            confidence: "high",
          },
          options: [{
            value: "shared-revision",
            label: "Shared revision",
            consequences: "The second runtime must read the successor.",
          }],
          allowUnknown: false,
          risk: "reversible",
          evidenceNeeded: [],
        },
      },
    );
    assertEquals(next.revision, 2);

    const second = await createEngineeringProjectCommandRuntime({
      projectId: NEUTRAL_PROJECT_ID,
      trackedManifestPath,
      activeDirectory: directory,
      evidenceSnapshots,
    });
    assertEquals(
      (await second.projects.get(NEUTRAL_PROJECT_ID))?.revision,
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
