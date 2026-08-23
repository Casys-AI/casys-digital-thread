import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  buildOverviewThreadHero,
  overviewLaneFor,
} from "./src/project/overview-thread-hero-model.ts";

Deno.test("overview hero places recorded nodes in 2a lanes and never invents ids", () => {
  const hero = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const fixtureIds = new Set(
    GENERIC_THREAD_FIXTURE.graph.nodes.map((node) => node.ref.id),
  );

  assertEquals(hero.lanes.map((column) => column.lane.id), [
    "requirements",
    "system-model",
    "geometry",
    "physics",
    "verdicts",
  ]);
  assertEquals(
    hero.nodes.every((item) => fixtureIds.has(item.node.ref.id)),
    true,
  );
  assertEquals(
    hero.nodes.some((item) => item.node.ref.id === "REQ-M-001"),
    false,
  );
  assertEquals(
    hero.nodes.some((item) => item.node.ref.id === "REQ-MECH-014"),
    true,
  );
  assertEquals(
    hero.nodes.find((item) => item.node.ref.id === "REQ-MECH-014")?.lane,
    "requirements",
  );
  assertEquals(
    hero.nodes.find((item) => item.node.ref.id === "ART-CAD-018")?.lane,
    "geometry",
  );
  assertEquals(
    hero.nodes.find((item) => item.node.ref.id === "OBS-STRESS-MAX")?.lane,
    "physics",
  );
});

Deno.test("overview lane assignment skips change and action nodes", () => {
  const change = GENERIC_THREAD_FIXTURE.graph.nodes.find((node) =>
    node.entityKind === "change"
  )!;
  const action = GENERIC_THREAD_FIXTURE.graph.nodes.find((node) =>
    node.entityKind === "action"
  )!;
  assertEquals(overviewLaneFor(change), undefined);
  assertEquals(overviewLaneFor(action), undefined);
});

Deno.test("overview hero wraps every recorded semantic point instead of truncating a lane", () => {
  const thread = structuredClone(GENERIC_THREAD_FIXTURE);
  const requirement = thread.graph.nodes.find((node) =>
    node.entityKind === "requirement"
  )!;
  for (let index = 0; index < 6; index++) {
    thread.graph.nodes.push({
      ...requirement,
      id: `graph:requirement:wrap-requirement-${index}`,
      ref: { kind: "requirement", id: `wrap-requirement-${index}` },
      entityKind: "requirement",
      label: `Wrapped requirement ${index}`,
    });
    thread.graph.nodes.push({
      ...requirement,
      id: `graph:evaluation:wrap-${index}`,
      ref: { kind: "evaluation", id: `wrap-${index}` },
      entityKind: "evaluation",
      label: `Wrapped verdict ${index}`,
    });
  }

  const hero = buildOverviewThreadHero(thread);
  assertEquals(
    hero.nodes.filter((item) =>
      item.lane === "requirements" &&
      item.node.ref.id.startsWith("wrap-requirement-")
    ).length,
    6,
  );
  const verdicts = hero.nodes.filter((item) =>
    item.lane === "verdicts" && item.node.ref.id.startsWith("wrap-")
  );
  assertEquals(verdicts.length, 6);
  assertEquals(new Set(verdicts.map((item) => item.x)).size, 2);
  assertEquals(new Set(verdicts.map((item) => item.y)).size >= 3, true);
});
