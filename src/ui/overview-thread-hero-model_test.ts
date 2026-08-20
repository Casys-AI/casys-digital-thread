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

  // Les cinq voies sont là, sans doublon ni oubli.
  const laneIds = hero.lanes.map((column) => column.lane.id);
  assertEquals([...laneIds].sort(), [
    "geometry",
    "physics",
    "requirements",
    "system-model",
    "verdicts",
  ]);
  // Et elles suivent le sens du fil : le modèle système déclare les
  // exigences, donc il les précède ; le verdict clôt la lecture. Figer la
  // liste entière rendrait le test faux au premier réordonnancement légitime.
  assertEquals(
    laneIds.indexOf("system-model") < laneIds.indexOf("requirements"),
    true,
    "the system model declares the requirements, so it comes first",
  );
  assertEquals(laneIds.at(-1), "verdicts");
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
    "verdicts",
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
