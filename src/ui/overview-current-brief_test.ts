import { assertEquals, assertStrictEquals } from "@std/assert";
import type {
  ProjectBriefItemKind,
  ProjectBriefRevision,
} from "../domain/project/project-brief.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import { buildOverviewThreadHero } from "./src/project/overview-thread-hero-model.ts";
import { buildOverviewHullContents } from "./src/project/overview/hulls/content.ts";
import {
  OVERVIEW_BRIEF_HULL_KEY,
  overviewBriefSectionLabel,
  overviewBriefSectionRowKey,
  withOverviewCurrentBrief,
  withOverviewCurrentBriefContent,
} from "./src/project/overview/hulls/current-brief.ts";
import { overviewBriefSourceKey } from "./src/project/overview-thread-brief-correspondence.ts";
import {
  overviewCurrentBriefDocument,
  overviewCurrentBriefMatches,
  overviewCurrentBriefViewerId,
  overviewCurrentBriefViewerTitle,
} from "./src/project/overview-thread-current-brief.ts";
import { overviewHullRowActions } from "./src/project/overview/hulls/row.ts";

const LIVE_KIND_ORDER = [
  "objective",
  "mission-scenario",
  "primary-user",
  "operating-environment",
  "constraint",
  "exclusion",
  "proposed-decision",
  "success-criterion",
  "verification-activity",
  "open-question",
  "observed-fact",
  "manufacturing-evidence",
  "assumption",
] as const satisfies readonly ProjectBriefItemKind[];

function liveShapedBrief(): ProjectBriefRevision {
  const kinds: ProjectBriefItemKind[] = [...LIVE_KIND_ORDER];
  while (kinds.length < 30) {
    kinds.push(LIVE_KIND_ORDER[kinds.length % LIVE_KIND_ORDER.length]!);
  }
  return {
    briefId: "inspection-drone-id01:brief",
    id: "inspection-drone-id01:brief:r3:bca2a461299be869",
    revision: 3,
    contractVersion: "2.0",
    proposedAt: "2026-09-07T00:00:00Z",
    proposedBy: { id: "author", origin: "human" },
    items: kinds.map((kind, index) => ({
      id: index === 4 ? "camera-bracket-bench-stress" : `item-${index}`,
      kind,
      statement: `Exact statement ${index} for ${kind}.`,
      sourceRefs: index === 0
        ? [{ kind: "intent" as const, reference: "chat:objective" }]
        : [],
      ...(kind === "assumption"
        ? { owner: "systems", reviewTrigger: "after FEA" }
        : {}),
      ...(index > 0 ? { dependsOnItemIds: [`item-0`] } : {}),
    })),
  };
}

Deno.test("withOverviewCurrentBrief does not invent 30 brief-source nodes or dependency edges", () => {
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const brief = liveShapedBrief();
  const before = JSON.stringify({ raw, brief });
  const view = withOverviewCurrentBrief(raw, brief);
  assertStrictEquals(view, raw);
  assertEquals(
    view.nodes.filter((node) => node.kind === "brief-source").length,
    raw.nodes.filter((node) => node.kind === "brief-source").length,
  );
  assertEquals(
    view.edges.filter((edge) => edge.key.startsWith("brief-dependency:")),
    [],
  );
  assertEquals(JSON.stringify({ raw, brief }), before);
});

Deno.test("current Brief hull lists derived sections without a root wrapper or leaf dump", () => {
  const brief = liveShapedBrief();
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const view = withOverviewCurrentBrief(raw, brief);
  const contents = withOverviewCurrentBriefContent(
    buildOverviewHullContents(view.nodes, []),
    view,
    brief,
  );
  const content = contents.get(OVERVIEW_BRIEF_HULL_KEY)!;
  assertEquals(content.rows.length, 13);
  assertEquals(
    content.rows.some((row) => row.label.includes("Brief courant")),
    false,
  );
  assertEquals(
    content.rows.map((row) => row.label),
    LIVE_KIND_ORDER.map((kind) => overviewBriefSectionLabel(kind)),
  );
  assertEquals(
    content.rows.map((row) => row.detail),
    [
      "3 éléments",
      "3 éléments",
      "3 éléments",
      "3 éléments",
      "2 éléments",
      "2 éléments",
      "2 éléments",
      "2 éléments",
      "2 éléments",
      "2 éléments",
      "2 éléments",
      "2 éléments",
      "2 éléments",
    ],
  );
  for (const row of content.rows) {
    assertEquals(row.kind, "navigation");
    assertEquals(row.nodeKey, undefined);
    assertEquals(row.endpoint, false);
    assertEquals(row.sessionIds, []);
    assertEquals(row.viewerNodeKey, undefined);
    assertEquals(row.parentKey, undefined);
    assertEquals(row.nativeAction, "open-current-brief");
    assertEquals(overviewHullRowActions(row), [{
      kind: "open-current-brief",
    }]);
  }
  assertEquals(
    content.rows[0]!.key,
    overviewBriefSectionRowKey(brief.id, "objective"),
  );
});

Deno.test("pre-existing exact correspondence source remains unchanged and off the section index", () => {
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const source = raw.nodes.find((node) => node.kind === "brief-source");
  const brief = liveShapedBrief();
  const view = withOverviewCurrentBrief(raw, brief);
  if (source) {
    assertStrictEquals(
      view.nodes.find((node) => node.key === source.key),
      source,
    );
  }
  const exactKey = overviewBriefSourceKey(
    brief.id,
    "camera-bracket-bench-stress",
  );
  assertEquals(
    view.nodes.some((node) => node.key === exactKey),
    raw.nodes.some((node) => node.key === exactKey),
  );
  const content = withOverviewCurrentBriefContent(
    buildOverviewHullContents(view.nodes, []),
    view,
    brief,
  ).get(OVERVIEW_BRIEF_HULL_KEY)!;
  assertEquals(content.rows.some((row) => row.key === exactKey), false);
  assertEquals(
    content.rows.every((row) => row.kind === "navigation"),
    true,
  );
});

Deno.test("native current Brief document is the exact r3 snapshot and is not a registered session", () => {
  const brief = liveShapedBrief();
  const document = overviewCurrentBriefDocument(brief);
  assertEquals(document.snapshotId, brief.id);
  assertEquals(document.revision, 3);
  assertEquals(document.contractVersion, "2.0");
  assertEquals(document.items.length, 30);
  assertEquals(
    document.items.map((item) => item.statement),
    brief.items.map((
      item,
    ) => item.statement),
  );
  assertEquals(document.items[0]!.sourceRefs.length, 1);
  assertEquals(
    document.items.find((item) => item.kind === "assumption")?.owner,
    "systems",
  );
  assertEquals(
    overviewCurrentBriefViewerTitle(3),
    "Current approved Brief · r3",
  );
  assertEquals(
    overviewCurrentBriefViewerId(brief.id).startsWith("current-brief:"),
    true,
  );
  assertEquals(overviewCurrentBriefMatches(brief, brief.id), true);
  assertEquals(
    overviewCurrentBriefMatches(
      brief,
      "inspection-drone-id01:brief:r1:caa6202dcc54ab2b",
    ),
    false,
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
