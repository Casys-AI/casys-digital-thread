import { assertEquals } from "@std/assert";
import { buildOperationsFleetView } from "./src/project/operations-fleet-model.ts";
import type { CockpitFleetProjection } from "../presentation/workbench/fleet/projection.ts";
import type { ThreadFlowStage, ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

function stage(
  system: string,
  freshness: ThreadFlowStage["freshness"],
): ThreadFlowStage {
  return {
    id: `stage-${system}-${freshness}`,
    label: system,
    system,
    freshness,
    summary: "recorded stage",
    selection: { kind: "artifact", id: `artifact-${system}` },
    dependsOn: [],
  };
}

function threadWith(
  stages: readonly ThreadFlowStage[],
  nodes: readonly { system: string; recordedAt?: string }[] = [],
): ThreadWorkbenchSnapshot {
  return {
    flow: [...stages],
    graph: {
      nodes: nodes.map((node, index) => ({
        ref: { kind: "artifact", id: `node-${index}` },
        system: node.system,
        recordedAt: node.recordedAt,
      })),
      edges: [],
    },
  } as unknown as ThreadWorkbenchSnapshot;
}

const project = {} as Parameters<typeof buildOperationsFleetView>[2];

Deno.test("declared servers join observed systems by exact identity first", () => {
  const fleet: CockpitFleetProjection = {
    servers: [
      {
        id: "build123d",
        displayName: "build123d",
        role: "CAD",
        required: true,
      },
      {
        id: "build123d-sandbox",
        displayName: "build123d sandbox",
        role: "Isolated CAD",
        required: false,
      },
    ],
  };
  const view = buildOperationsFleetView(
    fleet,
    threadWith(
      [stage("build123d-sandbox", "fresh")],
      [{ system: "build123d-sandbox", recordedAt: "2026-08-19T10:00:00Z" }],
    ),
    project,
  );

  assertEquals(view.cards.map((card) => card.id), [
    "build123d",
    "build123d-sandbox",
  ]);
  assertEquals(view.cards[0].state, "unrecorded");
  assertEquals(view.cards[0].freshness, undefined);
  assertEquals(view.cards[0].required, true);
  assertEquals(view.cards[1].lastEvidenceAt, "2026-08-19T10:00:00Z");
  assertEquals(view.declaredIdle, ["build123d"]);
  assertEquals(view.source, "declared-fleet");
  assertEquals(view.summary, { declared: 2, observed: 1, running: 0 });
});

Deno.test("a declared server without observed evidence remains an explicit unrecorded row", () => {
  const fleet: CockpitFleetProjection = {
    servers: [
      {
        id: "syson",
        displayName: "SysON",
        role: "System model",
        required: true,
      },
      {
        id: "erpnext",
        displayName: "ERPNext",
        role: "Sourcing",
        required: false,
      },
    ],
  };
  const view = buildOperationsFleetView(
    fleet,
    threadWith([stage("syson", "running")]),
    project,
  );

  assertEquals(view.cards.map((card) => card.id), ["syson", "erpnext"]);
  assertEquals(view.cards[0].state, "running");
  assertEquals(view.cards[1], {
    id: "erpnext",
    displayName: "ERPNext",
    role: "Sourcing",
    required: false,
    freshness: undefined,
    state: "unrecorded",
    lastEvidenceAt: undefined,
    stageCount: 0,
  });
  assertEquals(view.declaredIdle, ["ERPNext"]);
  assertEquals(view.summary.running, 1);
});

Deno.test("without a declared fleet the view degrades to observed systems only", () => {
  const view = buildOperationsFleetView(
    undefined,
    threadWith([
      stage("mcp-calculix", "fresh"),
      stage("mcp-calculix", "failed"),
    ]),
    project,
  );

  assertEquals(view.declaredIdle, []);
  assertEquals(view.source, "thread-observed-only");
  assertEquals(view.cards.length, 1);
  assertEquals(view.cards[0].displayName, "mcp-calculix");
  assertEquals(view.cards[0].role, "");
  assertEquals(view.cards[0].required, undefined);
  assertEquals(view.cards[0].stageCount, 2);
  assertEquals(view.cards[0].state, "attention");
  assertEquals(view.summary, { declared: 0, observed: 1, running: 0 });
});
