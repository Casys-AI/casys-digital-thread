import { assertEquals } from "@std/assert";
import { overviewRequirementSourceViewerAliases } from "./src/project/overview-thread-viewer-discovery.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "./src/project/overview/hulls/domain-groups.ts";
import { buildOverviewHullContents } from "./src/project/overview/hulls/content.ts";
import {
  activateOverviewHullRow,
  overviewHullRowActions,
} from "./src/project/overview/hulls/row.ts";
import { overviewThreadD3FlowGroupIdentity as groupId } from "./src/project/overview-thread-d3-flow-layout.ts";
import type { OverviewRecordedHeroNode } from "./src/project/overview-thread-hero-model.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";

function recorded(
  kind: OverviewRecordedHeroNode["node"]["ref"]["kind"],
  id: string,
  extras: { readonly isRequirementsCapture?: boolean } = {},
): OverviewRecordedHeroNode {
  const key = `${kind}:${id}`;
  return {
    key,
    lane: "system-model",
    groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
    label: id,
    kind: "recorded",
    color: "black",
    emphasis: false,
    ...(extras.isRequirementsCapture === true ? { isRequirementsCapture: true } : {}),
    node: {
      id: key,
      ref: { kind, id },
      entityKind: kind,
      label: id,
      freshness: "fresh",
      system: "syson",
      summary: id,
      recordedAt: "2026-09-07T00:00:00Z",
    },
  };
}

function session(id: string, record = id): ThreadViewerSession {
  return {
    id,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: record },
    app: { id: "io.casys.mcp-syson", version: "1.0.0" },
    manifest: {
      uri: "ui://mcp-syson/manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-syson/requirements-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 1,
    },
    launchUri: "/api/viewer/app",
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.mcp-syson.recorded-authored-requirements-session/1.0",
      payload: {},
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}

const REQUIREMENT = recorded("requirement", "REQ-MASS");
const CURRENT = recorded("artifact", "requirements-current", {
  isRequirementsCapture: true,
});
const OLD = recorded("artifact", "requirements-old", {
  isRequirementsCapture: true,
});
const ARCHITECTURE = recorded("artifact", "architecture-current");
const CURRENT_SESSION = session("requirements-app", "requirements-current");
const OLD_SESSION = session("requirements-old-app", "requirements-old");
const MODEL_SESSION = {
  ...session("model-app", "architecture-current"),
  resource: {
    ...session("model-app", "architecture-current").resource,
    uri: "ui://mcp-syson/model-explorer-viewer",
  },
  session: {
    ...session("model-app", "architecture-current").session,
    schema: "io.casys.mcp-syson.recorded-model-children-session/1.0",
  },
};
const HULL_KEY = groupId(
  "system-model",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
);

function hullRows(
  nodes: readonly OverviewRecordedHeroNode[],
  edges: readonly {
    readonly from: {
      readonly kind: "artifact" | "requirement";
      readonly id: string;
    };
    readonly to: {
      readonly kind: "artifact" | "requirement";
      readonly id: string;
    };
    readonly relation: "traces_to";
  }[],
  sessions: readonly ThreadViewerSession[],
) {
  const aliases = overviewRequirementSourceViewerAliases(
    nodes.map((node) => ({
      key: node.key,
      groupKey: node.groupKey,
      ref: node.node.ref,
      ...(node.isRequirementsCapture === true ? { isRequirementsCapture: true } : {}),
    })),
    edges,
    sessions,
  );
  const contents = buildOverviewHullContents(
    nodes,
    sessions,
    undefined,
    {},
    aliases,
  );
  return {
    aliases,
    hull: contents.get(HULL_KEY)!,
    architecture: contents.get(
      groupId("system-model", OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel),
    ),
  };
}

function traces(
  fromId: string,
  toId: string,
): {
  readonly from: { readonly kind: "artifact"; readonly id: string };
  readonly to: { readonly kind: "requirement"; readonly id: string };
  readonly relation: "traces_to";
} {
  return {
    from: { kind: "artifact", id: fromId },
    to: { kind: "requirement", id: toId },
    relation: "traces_to",
  };
}

Deno.test("requirement hull row opens the exact current capture session and original artifact anchor", () => {
  const { aliases, hull, architecture } = hullRows(
    [REQUIREMENT, CURRENT, OLD, ARCHITECTURE],
    [
      traces("requirements-current", "REQ-MASS"),
      traces("architecture-current", "REQ-MASS"),
    ],
    [CURRENT_SESSION, OLD_SESSION, MODEL_SESSION],
  );
  assertEquals(hull.mode, "tree");
  const requirement = hull.rows.find((row) => row.nodeKey === REQUIREMENT.key)!;
  const capture = hull.records.find((row) => row.nodeKey === CURRENT.key)!;
  const stale = hull.records.find((row) => row.nodeKey === OLD.key)!;
  assertEquals(overviewHullRowActions(requirement), [{
    kind: "open-session",
    sessionId: "requirements-app",
    nodeKey: CURRENT.key,
  }]);
  assertEquals(overviewHullRowActions(capture), [{
    kind: "open-session",
    sessionId: "requirements-app",
    nodeKey: CURRENT.key,
  }]);
  assertEquals(overviewHullRowActions(stale), [{
    kind: "open-session",
    sessionId: "requirements-old-app",
    nodeKey: OLD.key,
  }]);
  assertEquals(requirement.viewerNodeKey, CURRENT.key);
  assertEquals(aliases.get(REQUIREMENT.key)?.[0]?.nodeKey, CURRENT.key);
  assertEquals(
    hull.rows.some((row) => row.nodeKey === CURRENT.key || row.nodeKey === OLD.key),
    false,
  );
  assertEquals(
    architecture?.records.find((row) => row.nodeKey === ARCHITECTURE.key)
      ?.sessionIds,
    ["model-app"],
  );
  const opened: string[] = [];
  activateOverviewHullRow(requirement, {
    selectNode: () => opened.push("selected"),
    openSession: (sessionId, nodeKey) => opened.push(`${sessionId}:${nodeKey}`),
  });
  activateOverviewHullRow(capture, {
    selectNode: () => opened.push("selected"),
    openSession: (sessionId, nodeKey) => opened.push(`${sessionId}:${nodeKey}`),
  });
  assertEquals(opened, [
    "requirements-app:artifact:requirements-current",
    "requirements-app:artifact:requirements-current",
  ]);
});

Deno.test("architecture traces_to does not give the requirement hull the model App", () => {
  const { hull, architecture } = hullRows(
    [REQUIREMENT, ARCHITECTURE],
    [traces("architecture-current", "REQ-MASS")],
    [MODEL_SESSION],
  );
  const requirement = hull.rows.find((row) => row.nodeKey === REQUIREMENT.key)!;
  assertEquals(overviewHullRowActions(requirement), [{
    kind: "select-node",
    nodeKey: REQUIREMENT.key,
  }]);
  assertEquals(requirement.sessionIds, []);
  assertEquals(
    architecture?.records.find((row) => row.nodeKey === ARCHITECTURE.key)
      ?.sessionIds,
    ["model-app"],
  );
});

Deno.test("older capture without the traces_to edge is not the requirement row route", () => {
  const { hull } = hullRows(
    [REQUIREMENT, CURRENT, OLD],
    [traces("requirements-current", "REQ-MASS")],
    [CURRENT_SESSION, OLD_SESSION],
  );
  const requirement = hull.rows.find((row) => row.nodeKey === REQUIREMENT.key)!;
  assertEquals(overviewHullRowActions(requirement), [{
    kind: "open-session",
    sessionId: "requirements-app",
    nodeKey: CURRENT.key,
  }]);
});

Deno.test("no traces_to or ambiguous distinct captures leave the requirement row non-actionable as a viewer", () => {
  const missing = hullRows(
    [REQUIREMENT, CURRENT],
    [],
    [CURRENT_SESSION],
  );
  const ambiguous = hullRows(
    [REQUIREMENT, CURRENT, OLD],
    [
      traces("requirements-current", "REQ-MASS"),
      traces("requirements-old", "REQ-MASS"),
    ],
    [CURRENT_SESSION, OLD_SESSION],
  );
  for (const { hull } of [missing, ambiguous]) {
    const requirement = hull.rows.find((row) => row.nodeKey === REQUIREMENT.key)!;
    assertEquals(overviewHullRowActions(requirement), [{
      kind: "select-node",
      nodeKey: REQUIREMENT.key,
    }]);
    assertEquals(requirement.sessionIds, []);
  }
});

Deno.test("missing source node or unregistered unique source keeps the requirement row without a viewer", () => {
  const missingNode = hullRows(
    [REQUIREMENT],
    [traces("requirements-current", "REQ-MASS")],
    [CURRENT_SESSION],
  );
  const unregistered = hullRows(
    [REQUIREMENT, CURRENT],
    [traces("requirements-current", "REQ-MASS")],
    [],
  );
  for (const { hull } of [missingNode, unregistered]) {
    const requirement = hull.rows.find((row) => row.nodeKey === REQUIREMENT.key)!;
    assertEquals(overviewHullRowActions(requirement), [{
      kind: "select-node",
      nodeKey: REQUIREMENT.key,
    }]);
  }
});

Deno.test("a direct capture session remains available beside a requirement alias", () => {
  const { hull } = hullRows(
    [REQUIREMENT, CURRENT],
    [traces("requirements-current", "REQ-MASS")],
    [CURRENT_SESSION],
  );
  const capture = hull.records.find((row) => row.nodeKey === CURRENT.key)!;
  assertEquals(hull.mode, "tree");
  assertEquals(
    hull.rows.some((row) => row.nodeKey === CURRENT.key),
    false,
  );
  assertEquals(overviewHullRowActions(capture), [{
    kind: "open-session",
    sessionId: "requirements-app",
    nodeKey: CURRENT.key,
  }]);
});
