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

Deno.test("declared servers join observed systems by exact literal id only", () => {
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
  assertEquals(view.cards[0].state, "unavailable");
  assertEquals(view.cards[0].match, "unmatched");
  assertEquals(view.cards[0].freshness, undefined);
  assertEquals(view.cards[0].required, true);
  assertEquals(view.cards[1].match, "exact");
  assertEquals(view.cards[1].lastEvidenceAt, "2026-08-19T10:00:00Z");
  assertEquals(view.declaredIdle, ["build123d"]);
  assertEquals(view.source, "declared-fleet");
  assertEquals(view.summary, { declared: 2, observed: 1, running: 0 });
});

Deno.test("a declared server without an exact system remains explicitly unavailable", () => {
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
  assertEquals(view.cards[0].match, "exact");
  assertEquals(view.cards[1], {
    id: "erpnext",
    displayName: "ERPNext",
    role: "Sourcing",
    required: false,
    freshness: undefined,
    state: "unavailable",
    match: "unmatched",
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
  assertEquals(view.cards[0].match, "unavailable");
  assertEquals(view.cards[0].stageCount, 2);
  assertEquals(view.cards[0].state, "attention");
  assertEquals(view.summary, { declared: 0, observed: 1, running: 0 });
});

Deno.test("literal joins do not lowercase, trim, use display names, or match substrings", () => {
  const fleet: CockpitFleetProjection = {
    servers: [{
      id: "syson",
      displayName: "SysON",
      role: "System model",
      required: true,
    }],
  };
  const view = buildOperationsFleetView(
    fleet,
    threadWith(
      [
        stage("syson", "fresh"),
        stage("SysON", "failed"),
        stage("mcp-syson", "running"),
        stage("syson ", "stale"),
      ],
      [
        { system: "syson", recordedAt: "2026-08-19T10:00:00Z" },
        { system: "SysON", recordedAt: "2026-08-19T11:00:00Z" },
      ],
    ),
    project,
  );

  assertEquals(view.cards.map((card) => card.id), [
    "syson",
    "SysON",
    "mcp-syson",
    "syson ",
  ]);
  assertEquals(view.cards[0].match, "exact");
  assertEquals(view.cards[0].stageCount, 1);
  assertEquals(view.cards[0].lastEvidenceAt, "2026-08-19T10:00:00Z");
  assertEquals(
    view.cards.slice(1).map((card) => ({
      id: card.id,
      match: card.match,
      required: card.required,
    })),
    [
      { id: "SysON", match: "unmatched", required: undefined },
      { id: "mcp-syson", match: "unmatched", required: undefined },
      { id: "syson ", match: "unmatched", required: undefined },
    ],
  );
  assertEquals(view.cards[1].lastEvidenceAt, "2026-08-19T11:00:00Z");
  assertEquals(view.declaredIdle, []);
  assertEquals(view.summary, { declared: 1, observed: 4, running: 1 });
});

Deno.test("display-name equality cannot substitute for the declared server id", () => {
  const fleet: CockpitFleetProjection = {
    servers: [{
      id: "syson",
      displayName: "SysON",
      role: "System model",
      required: true,
    }],
  };
  const view = buildOperationsFleetView(
    fleet,
    threadWith([stage("SysON", "fresh")]),
    project,
  );

  assertEquals(view.cards[0], {
    id: "syson",
    displayName: "SysON",
    role: "System model",
    required: true,
    freshness: undefined,
    state: "unavailable",
    match: "unmatched",
    lastEvidenceAt: undefined,
    stageCount: 0,
  });
  assertEquals(view.cards[1].id, "SysON");
  assertEquals(view.cards[1].match, "unmatched");
  assertEquals(view.cards[1].state, "ok");
  assertEquals(view.declaredIdle, ["SysON"]);
  assertEquals(view.summary, { declared: 1, observed: 1, running: 0 });
});
