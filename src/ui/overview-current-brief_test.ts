import { assertEquals, assertStrictEquals } from "@std/assert";
import type {
  ProjectBriefItemKind,
  ProjectBriefRevision,
} from "../domain/project/project-brief.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import { buildOverviewThreadHero } from "./src/project/overview-thread-hero-model.ts";
import { buildOverviewHullContents } from "./src/project/overview/hulls/content.ts";
import {
  currentBriefAdapter,
  OVERVIEW_BRIEF_HULL_KEY,
  OVERVIEW_CURRENT_BRIEF_ADAPTER_ID,
  overviewBriefItemRowKey,
  overviewBriefReferencedSnapshotLabel,
  overviewBriefRootLabel,
  overviewBriefRootRowKey,
  overviewBriefSectionLabel,
  overviewBriefSectionRowKey,
  withOverviewCurrentBrief,
  withOverviewCurrentBriefContent,
} from "./src/project/overview/hulls/current-brief.ts";
import {
  applyOverviewHullAdapters,
  OVERVIEW_HULL_ADAPTERS,
} from "./src/project/overview/hulls/adapters/index.ts";
import { overviewBriefSnapshotGroupKey } from "./src/project/overview/hulls/content.ts";
import {
  type OverviewBriefSourceHeroNode,
  overviewBriefSourceKey,
} from "./src/project/overview-thread-brief-correspondence.ts";
import {
  overviewCurrentBriefDocument,
  overviewCurrentBriefMatches,
  overviewCurrentBriefViewerId,
  overviewCurrentBriefViewerTitle,
} from "./src/project/overview-thread-current-brief.ts";
import {
  activateOverviewHullRow,
  overviewHullRowActions,
  overviewHullRowPresentation,
} from "./src/project/overview/hulls/row.ts";
import { overviewHullRowAnchors } from "./src/project/overview/hulls/row-anchors.ts";
import { layoutOverviewHullRows } from "./src/project/overview/hulls/row-layout.ts";

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

Deno.test("current Brief hull is root, nested sections, then exact items", () => {
  const brief = liveShapedBrief();
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const view = withOverviewCurrentBrief(raw, brief);
  const contents = withOverviewCurrentBriefContent(
    buildOverviewHullContents(view.nodes, []),
    view.nodes,
    brief,
  );
  const content = contents.get(OVERVIEW_BRIEF_HULL_KEY)!;
  const root = content.rows[0]!;
  const sections = content.rows.filter((row) => row.parentKey === root.key);
  const items = content.rows.filter((row) => row.key.startsWith("brief-item:"));
  assertEquals(
    content.rows.length,
    1 + LIVE_KIND_ORDER.length + brief.items.length,
  );
  assertEquals(root.key, overviewBriefRootRowKey(brief.id));
  assertEquals(
    root.label,
    overviewBriefRootLabel(brief),
  );
  assertEquals(
    root.label,
    "Brief courant · inspection-drone-id01:brief",
  );
  assertEquals(root.detail, "30 éléments · approuvé");
  assertEquals(root.kind, "navigation");
  assertEquals(root.endpoint, false);
  assertEquals(root.nativeAction, "open-current-brief");
  assertEquals(overviewHullRowActions(root), [{ kind: "open-current-brief" }]);
  let opened = 0;
  activateOverviewHullRow(root, {
    selectNode: () => {},
    openSession: () => {},
    openCurrentBrief: () => {
      opened += 1;
    },
  });
  assertEquals(opened, 1);
  assertEquals(
    sections.map((row) => row.label),
    LIVE_KIND_ORDER.map((kind) => overviewBriefSectionLabel(kind)),
  );
  assertEquals(
    sections.map((row) => row.detail),
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
  for (const section of sections) {
    assertEquals(section.kind, "navigation");
    assertEquals(section.parentKey, root.key);
    assertEquals(section.endpoint, false);
    assertEquals(section.role, "folder");
    assertEquals(section.graphRefs, []);
    assertEquals(section.nativeAction, undefined);
    assertEquals(overviewHullRowActions(section), []);
  }
  assertEquals(
    items.map((row) => row.label),
    LIVE_KIND_ORDER.flatMap((kind) =>
      brief.items.filter((item) => item.kind === kind).map((item) => item.id)
    ),
  );
  for (const row of items) {
    const item = brief.items.find((candidate) => candidate.id === row.label)!;
    assertEquals(row.key, overviewBriefItemRowKey(brief.id, item.id));
    assertEquals(
      row.parentKey,
      overviewBriefSectionRowKey(brief.id, item.kind),
    );
    assertEquals(row.kind, "navigation");
    assertEquals(row.detail, item.kind);
    assertEquals(row.nodeKey, undefined);
    assertEquals(row.graphRefs, []);
    assertEquals(row.endpoint, false);
    assertEquals(row.nativeAction, undefined);
    assertEquals(overviewHullRowActions(row), []);
  }
  assertEquals(
    content.rows[1]!.key,
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
    view.nodes,
    brief,
  ).get(OVERVIEW_BRIEF_HULL_KEY)!;
  assertEquals(content.rows.some((row) => row.key === exactKey), false);
  assertEquals(
    content.rows.filter((row) =>
      row.key === overviewBriefRootRowKey(brief.id) ||
      row.parentKey === overviewBriefRootRowKey(brief.id) ||
      row.key.startsWith("brief-item:")
    ).every((row) => row.kind === "navigation" && row.nodeKey !== exactKey),
    true,
  );
});

function briefSourceNode(
  snapshotId: string,
  itemId: string,
  revision: number,
): OverviewBriefSourceHeroNode {
  return {
    kind: "brief-source",
    key: overviewBriefSourceKey(snapshotId, itemId),
    lane: "requirements",
    groupKey: "brief",
    label: itemId,
    color: "#7c3aed",
    emphasis: false,
    brief: {
      briefId: "inspection-drone-id01:brief",
      snapshotId,
      revision,
    },
    sourceItem: {
      id: itemId,
      kind: "success-criterion",
      statement: "Exact joined statement.",
      sourceRefs: [],
    },
    correspondences: [],
  };
}

const R4_SNAPSHOT_ID = "inspection-drone-id01:brief:r4:8366ffe2fb53e984";
const R3_SNAPSHOT_ID = "inspection-drone-id01:brief:r3:bca2a461299be869";
const BRIEF_ID = "inspection-drone-id01:brief";
const CLAIMED_ITEM_ID = "camera-bracket-bench-stress";

function r4CurrentBrief(): ProjectBriefRevision {
  return {
    briefId: BRIEF_ID,
    id: R4_SNAPSHOT_ID,
    revision: 4,
    contractVersion: "2.0",
    previous: { revision: 3, snapshotId: R3_SNAPSHOT_ID },
    proposedAt: "2026-09-08T01:49:29.631Z",
    proposedBy: { id: "mcp:casys-mcp-call@1", origin: "agent" },
    items: [
      {
        id: "objective",
        kind: "objective",
        statement: "Concevoir ID01.",
        sourceRefs: [],
      },
      {
        id: CLAIMED_ITEM_ID,
        kind: "success-criterion",
        statement: "Banc théorique CameraMountBracket.",
        sourceRefs: [],
      },
    ],
  };
}

Deno.test("actual r3 trace stays a visible referenced-source row under r4 current Brief", () => {
  const brief = r4CurrentBrief();
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const r3Source = briefSourceNode(R3_SNAPSHOT_ID, CLAIMED_ITEM_ID, 3);
  const view = {
    ...raw,
    nodes: [...raw.nodes, r3Source],
  };
  const contents = withOverviewCurrentBriefContent(
    buildOverviewHullContents(view.nodes, []),
    view.nodes,
    brief,
  );
  const content = contents.get(OVERVIEW_BRIEF_HULL_KEY)!;
  const currentItem = content.rows.find((row) =>
    row.key === overviewBriefItemRowKey(brief.id, CLAIMED_ITEM_ID)
  )!;
  const referencedSource = content.rows.find((row) =>
    row.key === r3Source.key
  )!;
  assertEquals(currentItem.kind, "navigation");
  assertEquals(currentItem.endpoint, false);
  assertEquals(currentItem.nodeKey, undefined);
  assertEquals(currentItem.detail, "success-criterion");
  assertEquals(referencedSource.endpoint, true);
  assertEquals(referencedSource.nodeKey, r3Source.key);
  assertEquals(
    referencedSource.parentKey,
    overviewBriefSnapshotGroupKey(r3Source.brief),
  );
  assertEquals(
    content.rows.filter((row) => row.nodeKey === r3Source.key).length,
    1,
  );
  const anchors = overviewHullRowAnchors(contents, view.nodes);
  assertEquals(
    anchors[OVERVIEW_BRIEF_HULL_KEY]?.[r3Source.key],
    content.rows.indexOf(referencedSource),
  );
  assertEquals(
    content.rows.indexOf(currentItem) ===
      anchors[OVERVIEW_BRIEF_HULL_KEY]?.[r3Source.key],
    false,
  );
});

Deno.test("r3 claim cable docks the visible referenced-source row, never the r4 item", () => {
  const brief = r4CurrentBrief();
  const raw = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const r3Source = briefSourceNode(R3_SNAPSHOT_ID, CLAIMED_ITEM_ID, 3);
  const r4Source = briefSourceNode(R4_SNAPSHOT_ID, CLAIMED_ITEM_ID, 4);
  const view = {
    ...raw,
    nodes: [...raw.nodes, r3Source, r4Source],
  };
  const contents = withOverviewCurrentBriefContent(
    buildOverviewHullContents(view.nodes, []),
    view.nodes,
    brief,
  );
  const content = contents.get(OVERVIEW_BRIEF_HULL_KEY)!;
  const currentItem = content.rows.find((row) =>
    row.key === overviewBriefItemRowKey(brief.id, CLAIMED_ITEM_ID)
  )!;
  const referencedRoot = content.rows.find((row) =>
    row.key === overviewBriefSnapshotGroupKey(r3Source.brief)
  )!;
  const referencedSource = content.rows.find((row) =>
    row.key === r3Source.key
  )!;
  assertEquals(content.rows[0]!.label, overviewBriefRootLabel(brief));
  assertEquals(
    content.rows[0]!.label,
    "Brief courant · inspection-drone-id01:brief",
  );
  assertEquals(currentItem.kind, "source");
  assertEquals(currentItem.endpoint, true);
  assertEquals(currentItem.nodeKey, r4Source.key);
  assertEquals(currentItem.detail, "success-criterion");
  assertEquals(
    currentItem.parentKey,
    overviewBriefSectionRowKey(
      brief.id,
      "success-criterion",
    ),
  );
  assertEquals(
    referencedRoot.label,
    overviewBriefReferencedSnapshotLabel(),
  );
  assertEquals(referencedRoot.label, "Sources référencées");
  assertEquals(referencedRoot.detail, R3_SNAPSHOT_ID);
  assertEquals(referencedRoot.kind, "navigation");
  assertEquals(referencedRoot.endpoint, false);
  assertEquals(referencedRoot.nativeAction, undefined);
  assertEquals(referencedRoot.parentKey, undefined);
  assertEquals(referencedSource.kind, "source");
  assertEquals(referencedSource.endpoint, true);
  assertEquals(referencedSource.nodeKey, r3Source.key);
  assertEquals(referencedSource.parentKey, referencedRoot.key);
  assertEquals(referencedSource.label, CLAIMED_ITEM_ID);
  assertEquals(referencedSource.detail, "success-criterion");
  assertEquals(
    content.rows.filter((row) => row.nodeKey === r3Source.key).length,
    1,
  );
  assertEquals(
    content.rows.filter((row) => row.nodeKey === r4Source.key).length,
    1,
  );
  assertEquals(currentItem.nodeKey === referencedSource.nodeKey, false);
  const anchors = overviewHullRowAnchors(contents, view.nodes);
  assertEquals(
    anchors[OVERVIEW_BRIEF_HULL_KEY]?.[r3Source.key],
    content.rows.indexOf(referencedSource),
  );
  assertEquals(
    anchors[OVERVIEW_BRIEF_HULL_KEY]?.[r4Source.key],
    content.rows.indexOf(currentItem),
  );
  assertEquals(
    anchors[OVERVIEW_BRIEF_HULL_KEY]?.[r3Source.key] ===
      anchors[OVERVIEW_BRIEF_HULL_KEY]?.[r4Source.key],
    false,
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
    withOverviewCurrentBriefContent(content, view.nodes, undefined),
    content,
  );
});

Deno.test("content.ts no longer emits a parallel Clauses sources brief tree", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview/hulls/content.ts", import.meta.url),
  );
  assertEquals(source.includes("briefNavigationRows"), false);
  assertEquals(source.includes("Clauses sources"), false);
});

Deno.test("layout and row activation keep the current Brief root nativeAction", () => {
  const brief = r4CurrentBrief();
  const view = withOverviewCurrentBrief(
    buildOverviewThreadHero(GENERIC_THREAD_FIXTURE),
    brief,
  );
  const contents = applyOverviewHullAdapters(
    buildOverviewHullContents(view.nodes, []),
    { nodes: view.nodes, currentBrief: brief },
  );
  const content = contents.get(OVERVIEW_BRIEF_HULL_KEY)!;
  const root = content.rows[0]!;
  const laidOut = layoutOverviewHullRows(content.rows, {
    x: 0,
    y: 0,
    width: 280,
    height: 400,
    headerHeight: 24,
    footerHeight: 13,
    view: "tree",
    columns: 1,
    visibleRows: content.rows.length,
    scrollRow: 0,
    collapsed: false,
  });
  assertEquals(root.nativeAction, "open-current-brief");
  assertEquals(laidOut[0]!.row.nativeAction, "open-current-brief");
  assertEquals(
    overviewHullRowPresentation(laidOut[0]!.row).hasViewer,
    true,
  );
  let opened = 0;
  activateOverviewHullRow(laidOut[0]!.row, {
    selectNode: () => {
      throw new Error("current Brief root must not select a graph node");
    },
    openSession: () => {
      throw new Error("current Brief root must not open a documentary session");
    },
    openCurrentBrief: () => {
      opened += 1;
    },
  });
  assertEquals(opened, 1);
  assertEquals(
    overviewCurrentBriefViewerTitle(brief.revision),
    "Current approved Brief · r4",
  );
});

Deno.test("Current Brief is a registered generic hull adapter, not a hero special-case", () => {
  const brief = liveShapedBrief();
  const view = withOverviewCurrentBrief(
    buildOverviewThreadHero(GENERIC_THREAD_FIXTURE),
    brief,
  );
  const built = buildOverviewHullContents(view.nodes, []);
  const viaFunction = withOverviewCurrentBriefContent(
    built,
    view.nodes,
    brief,
  );
  const viaAdapter = currentBriefAdapter.apply(built, {
    nodes: view.nodes,
    currentBrief: brief,
  });
  const viaRegistry = applyOverviewHullAdapters(built, {
    nodes: view.nodes,
    currentBrief: brief,
  });
  assertEquals(
    OVERVIEW_HULL_ADAPTERS.map((adapter) => adapter.id),
    ["current-brief", "current-engineering-cases", "current-dfm-cases"],
  );
  assertEquals(
    OVERVIEW_HULL_ADAPTERS[0]?.id,
    OVERVIEW_CURRENT_BRIEF_ADAPTER_ID,
  );
  assertEquals(
    viaAdapter.get(OVERVIEW_BRIEF_HULL_KEY)?.rows,
    viaFunction.get(OVERVIEW_BRIEF_HULL_KEY)?.rows,
  );
  assertEquals(
    viaRegistry.get(OVERVIEW_BRIEF_HULL_KEY)?.rows,
    viaFunction.get(OVERVIEW_BRIEF_HULL_KEY)?.rows,
  );
});
