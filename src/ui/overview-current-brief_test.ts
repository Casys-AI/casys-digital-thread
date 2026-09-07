import { assertEquals, assertStrictEquals } from "@std/assert";
import type { ProjectBriefRevision } from "../domain/project/project-brief.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import { buildOverviewThreadHero } from "./src/project/overview-thread-hero-model.ts";
import { buildOverviewHullContents } from "./src/project/overview/hulls/content.ts";
import {
  OVERVIEW_BRIEF_HULL_KEY,
  withOverviewCurrentBrief,
  withOverviewCurrentBriefContent,
} from "./src/project/overview/hulls/current-brief.ts";
import { overviewBriefSourceKey } from "./src/project/overview-thread-brief-correspondence.ts";

const brief: ProjectBriefRevision = {
  briefId: "project:brief",
  id: "project:brief:r3",
  revision: 3,
  contractVersion: "2.0",
  proposedAt: "2026-09-07T00:00:00Z",
  proposedBy: { id: "author", origin: "human" },
  items: Array.from({ length: 30 }, (_, i) => ({
    id: `item-${i}`,
    kind: "success-criterion",
    statement: `Long detailed statement ${i}, only shown after clicking.`,
    sourceRefs: [],
    ...(i > 0 ? { dependsOnItemIds: [`item-${i - 1}`] } : {}),
  })),
};

Deno.test("current Brief is all 30 approved items, compact and clickable, not an analysis subset", () => {
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const before = JSON.stringify({ raw, brief });
  const view = withOverviewCurrentBrief(raw, brief);
  const contents = withOverviewCurrentBriefContent(
    buildOverviewHullContents(view.nodes, []),
    view,
    brief,
  );
  const content = contents.get(OVERVIEW_BRIEF_HULL_KEY)!;
  assertEquals(content.rows.length, 31);
  assertEquals(content.rows[0]!.label, "Brief courant · r3");
  assertEquals(
    content.rows.slice(1).map((row) => row.label),
    brief.items.map((item) => item.id),
  );
  for (const [index, row] of content.rows.slice(1).entries()) {
    assertEquals(row.detail, undefined);
    assertEquals(row.nodeKey, overviewBriefSourceKey(brief.id, brief.items[index]!.id));
    assertEquals(row.endpoint, true);
    const node = view.nodes.find((node) => node.key === row.nodeKey)!;
    assertEquals(node.kind, "brief-source");
    if (node.kind === "brief-source") {
      assertStrictEquals(node.sourceItem, brief.items[index]);
      assertEquals(node.correspondences, []);
    }
  }
  assertEquals(
    view.edges.filter((edge) => edge.key.startsWith("brief-dependency:")).length,
    29,
  );
  assertEquals(JSON.stringify({ raw, brief }), before);
});

Deno.test("current revision never retargets a historical clause or invents its requirement link", () => {
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const old = withOverviewCurrentBrief(raw, {
    ...brief,
    id: "project:brief:r2",
    revision: 2,
  });
  const current = withOverviewCurrentBrief(old, brief);
  const oldKey = overviewBriefSourceKey("project:brief:r2", "item-0");
  assertStrictEquals(
    current.nodes.find((node) => node.key === oldKey),
    old.nodes.find((node) => node.key === oldKey),
  );
  const content = withOverviewCurrentBriefContent(
    buildOverviewHullContents(current.nodes, []),
    current,
    brief,
  ).get(OVERVIEW_BRIEF_HULL_KEY)!;
  assertEquals(content.rows.some((row) => row.key === oldKey), false);
  assertEquals(content.records.some((row) => row.key === oldKey), true);
  assertEquals(
    current.edges.filter((edge) => edge.kind === "brief-correspondence"),
    raw.edges.filter((edge) => edge.kind === "brief-correspondence"),
  );
});

Deno.test("absence of an approved current brief preserves the existing evidence projection", () => {
  const view = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const content = buildOverviewHullContents(view.nodes, []);
  assertStrictEquals(withOverviewCurrentBrief(view, undefined), view);
  assertStrictEquals(
    withOverviewCurrentBriefContent(content, view, undefined),
    content,
  );
});
