import { assertEquals } from "@std/assert";
import { resolveThreadPhases } from "./src/project/overview-thread-phase-model.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

function scene(
  { producerRunId, workItemId, phaseId }: {
    producerRunId?: string;
    workItemId?: string;
    phaseId?: string;
  },
) {
  const project = {
    agentRuns: [{ id: "run-1", workItemId: workItemId ?? "wi-1" }],
    workItems: [{ id: "wi-1", phaseId: phaseId ?? "phase-geom" }],
    phases: [
      { id: "phase-seed", name: "SysON container" },
      { id: "phase-geom", name: "Canonical geometry" },
    ],
  } as unknown as EngineeringProjectSnapshot;

  const thread = {
    artifacts: [
      { id: "art-1", ...(producerRunId ? { producerRunId } : {}) },
    ],
    graph: {
      nodes: [
        { ref: { kind: "artifact", id: "art-1" }, entityKind: "artifact" },
        {
          ref: { kind: "observation", id: "obs-1" },
          entityKind: "observation",
        },
        {
          ref: { kind: "requirement", id: "req-1" },
          entityKind: "requirement",
        },
      ],
      edges: [
        {
          from: { kind: "artifact", id: "art-1" },
          to: { kind: "observation", id: "obs-1" },
        },
      ],
    },
  } as unknown as ThreadWorkbenchSnapshot;

  return resolveThreadPhases(project, thread);
}

Deno.test("a record takes the phase of the run that produced it", () => {
  const resolved = scene({ producerRunId: "run-1" });
  assertEquals(resolved.phaseIdByRefKey.get("artifact:art-1"), "phase-geom");
});

Deno.test("a measurement inherits the phase of the artifact it came from", () => {
  const resolved = scene({ producerRunId: "run-1" });
  assertEquals(resolved.phaseIdByRefKey.get("observation:obs-1"), "phase-geom");
});

Deno.test("a broken provenance chain yields no phase instead of a guess", () => {
  // Chaque maillon manquant doit interrompre la résolution : placer un nœud
  // dans une colonne sans savoir d'où il vient serait inventer une étape.
  for (
    const broken of [
      {},
      { producerRunId: "run-unknown" },
      { producerRunId: "run-1", workItemId: "wi-unknown" },
    ]
  ) {
    const resolved = scene(broken);
    assertEquals(resolved.phaseIdByRefKey.get("artifact:art-1"), undefined);
    assertEquals(resolved.phaseIdByRefKey.get("observation:obs-1"), undefined);
  }
});

Deno.test("a record with no producer at all stays unplaced", () => {
  const resolved = scene({ producerRunId: "run-1" });
  assertEquals(resolved.phaseIdByRefKey.get("requirement:req-1"), undefined);
});

Deno.test("phases keep the order the project declares them in", () => {
  const resolved = scene({ producerRunId: "run-1" });
  assertEquals(resolved.orderedPhases.map((phase) => phase.id), [
    "phase-seed",
    "phase-geom",
  ]);
});
