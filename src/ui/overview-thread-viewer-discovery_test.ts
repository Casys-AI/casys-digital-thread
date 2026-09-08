import { assertEquals } from "@std/assert";
import {
  overviewCanonicalViewerNodeKey,
  overviewDefaultViewerSessions,
  overviewRequirementSourceViewerAliases,
  type OverviewViewerAliasEdge,
  type OverviewViewerAliasRecord,
} from "./src/project/overview-thread-viewer-discovery.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "./src/project/overview/hulls/domain-groups.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";
import type { ThreadViewerHierarchyProjection } from "../presentation/workbench/thread/viewer-hierarchy.ts";

function session(id: string, record = id): ThreadViewerSession {
  return {
    id,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: record },
    app: { id: "example.viewer", version: "1.0.0" },
    manifest: {
      uri: "ui://example/manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://example/app",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 1,
    },
    launchUri: "/api/viewer/app",
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: "example/1.0",
      payload: {},
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}
const hierarchy: ThreadViewerHierarchyProjection = {
  schemaVersion: "thread-viewer-hierarchy/1.0",
  status: "available",
  rootIds: ["root"],
  nodes: [
    {
      id: "root",
      label: "Assembly",
      partDefinitionElementId: "root-def",
      sessionIds: ["assembly"],
    },
    {
      id: "module",
      parentId: "root",
      label: "Repeated",
      partDefinitionElementId: "module-def",
      sessionIds: ["module-app"],
    },
    {
      id: "piece-left",
      parentId: "module",
      label: "Piece",
      partDefinitionElementId: "piece-def",
      sessionIds: [],
    },
    {
      id: "piece-right",
      parentId: "module",
      label: "Piece",
      partDefinitionElementId: "piece-def",
      sessionIds: [],
    },
  ],
};

function defaultSessionIds(
  sessions: readonly ThreadViewerSession[],
  viewerHierarchy?: ThreadViewerHierarchyProjection,
): readonly string[] {
  return overviewDefaultViewerSessions(sessions, viewerHierarchy).map(
    (item) => item.id,
  );
}

const siblingSessions = [
  session("module-app"),
  session("brief"),
  session("assembly"),
  session("brief-alt", "brief"),
  session("calculix-1"),
  session("calculix-2"),
  session("calculix-3"),
];

Deno.test("default viewers open only the unique hierarchy root session", () => {
  assertEquals(defaultSessionIds(siblingSessions, hierarchy), ["assembly"]);
});

Deno.test("default discovery fails closed without an available hierarchy", () => {
  assertEquals(defaultSessionIds(siblingSessions), []);
  assertEquals(
    defaultSessionIds(siblingSessions, { ...hierarchy, status: "unavailable" }),
    [],
  );
});

Deno.test("default discovery fails closed when hierarchy has several roots", () => {
  assertEquals(
    defaultSessionIds(siblingSessions, { ...hierarchy, rootIds: [] }),
    [],
  );
  assertEquals(
    defaultSessionIds(siblingSessions, {
      ...hierarchy,
      rootIds: ["root", "module"],
    }),
    [],
  );
});

Deno.test("default discovery fails closed when the unique root id is absent", () => {
  assertEquals(
    defaultSessionIds(siblingSessions, {
      ...hierarchy,
      rootIds: ["missing"],
    }),
    [],
  );
});

Deno.test("default discovery fails closed when the unique root has no session", () => {
  assertEquals(
    defaultSessionIds(siblingSessions, {
      ...hierarchy,
      nodes: hierarchy.nodes.map((node) =>
        node.id === "root" ? { ...node, sessionIds: [] } : node
      ),
    }),
    [],
  );
});

Deno.test("default discovery fails closed when the unique root has several sessions", () => {
  assertEquals(
    defaultSessionIds(siblingSessions, {
      ...hierarchy,
      nodes: hierarchy.nodes.map((node) =>
        node.id === "root"
          ? { ...node, sessionIds: ["assembly", "assembly-alt"] }
          : node
      ),
    }),
    [],
  );
});

Deno.test("default discovery fails closed when the root session is not current", () => {
  assertEquals(
    defaultSessionIds(
      siblingSessions.filter((item) => item.id !== "assembly"),
      hierarchy,
    ),
    [],
  );
});

Deno.test("default discovery never opens provisional project reviews", () => {
  const review: ThreadViewerSession = {
    ...session("review"),
    anchor: {
      kind: "project-review",
      id: "review",
      revision: 1,
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
  };
  assertEquals(
    defaultSessionIds(
      [review, session("brief"), session("assembly")],
      hierarchy,
    ),
    ["assembly"],
  );
  assertEquals(defaultSessionIds([review, session("brief")]), []);
  assertEquals(
    defaultSessionIds([review], {
      ...hierarchy,
      nodes: hierarchy.nodes.map((node) =>
        node.id === "root" ? { ...node, sessionIds: [review.id] } : node
      ),
    }),
    [],
  );
});

function record(
  kind: OverviewViewerAliasRecord["ref"]["kind"],
  id: string,
  groupKey: string,
  extras: { readonly isRequirementsCapture?: boolean } = {},
): OverviewViewerAliasRecord {
  return {
    key: `${kind}:${id}`,
    groupKey,
    ref: { kind, id },
    ...(extras.isRequirementsCapture === true ? { isRequirementsCapture: true } : {}),
  };
}

function tracesTo(
  fromKind: OverviewViewerAliasEdge["from"]["kind"],
  fromId: string,
  toKind: OverviewViewerAliasEdge["to"]["kind"],
  toId: string,
): OverviewViewerAliasEdge {
  return {
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    relation: "traces_to",
  };
}

const REQUIREMENT = record(
  "requirement",
  "REQ-MASS",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
);
const CURRENT_CAPTURE = record(
  "artifact",
  "requirements-current",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  { isRequirementsCapture: true },
);
const OLD_CAPTURE = record(
  "artifact",
  "requirements-old",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  { isRequirementsCapture: true },
);
const ARCHITECTURE = record(
  "artifact",
  "architecture-current",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
);
const CURRENT_SESSION = session(
  "requirements-app",
  "requirements-current",
);
const OLD_SESSION = session("requirements-old-app", "requirements-old");
const MODEL_SESSION = session("model-app", "architecture-current");

Deno.test("exact current requirements capture aliases the recorded requirement to that session anchor", () => {
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, CURRENT_CAPTURE, OLD_CAPTURE, ARCHITECTURE],
    [
      tracesTo("artifact", "requirements-current", "requirement", "REQ-MASS"),
      tracesTo("artifact", "architecture-current", "requirement", "REQ-MASS"),
    ],
    [CURRENT_SESSION, OLD_SESSION, MODEL_SESSION],
  );
  assertEquals(aliases.get(REQUIREMENT.key), [{
    sessionId: "requirements-app",
    nodeKey: CURRENT_CAPTURE.key,
  }]);
  assertEquals(aliases.has(CURRENT_CAPTURE.key), false);
  assertEquals(aliases.has(ARCHITECTURE.key), false);
  assertEquals(
    overviewCanonicalViewerNodeKey(CURRENT_SESSION),
    CURRENT_CAPTURE.key,
  );
});

Deno.test("architecture traces_to does not borrow a model App for a requirement", () => {
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, ARCHITECTURE],
    [tracesTo("artifact", "architecture-current", "requirement", "REQ-MASS")],
    [MODEL_SESSION],
  );
  assertEquals(aliases.size, 0);
});

Deno.test("an older requirements capture without the traces_to edge is not chosen", () => {
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, CURRENT_CAPTURE, OLD_CAPTURE],
    [tracesTo("artifact", "requirements-current", "requirement", "REQ-MASS")],
    [CURRENT_SESSION, OLD_SESSION],
  );
  assertEquals(aliases.get(REQUIREMENT.key)?.map((item) => item.sessionId), [
    "requirements-app",
  ]);
});

Deno.test("missing traces_to yields no requirement viewer alias", () => {
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, CURRENT_CAPTURE],
    [],
    [CURRENT_SESSION],
  );
  assertEquals(aliases.size, 0);
});

Deno.test("ambiguous distinct requirements captures yield no viewer alias", () => {
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, CURRENT_CAPTURE, OLD_CAPTURE],
    [
      tracesTo("artifact", "requirements-current", "requirement", "REQ-MASS"),
      tracesTo("artifact", "requirements-old", "requirement", "REQ-MASS"),
    ],
    [CURRENT_SESSION, OLD_SESSION],
  );
  assertEquals(aliases.size, 0);
});

Deno.test("a missing source node stays non-actionable", () => {
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT],
    [tracesTo("artifact", "requirements-current", "requirement", "REQ-MASS")],
    [CURRENT_SESSION],
  );
  assertEquals(aliases.size, 0);
});

Deno.test("an unregistered unique source stays non-actionable", () => {
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, CURRENT_CAPTURE],
    [tracesTo("artifact", "requirements-current", "requirement", "REQ-MASS")],
    [MODEL_SESSION],
  );
  assertEquals(aliases.size, 0);
});

Deno.test("direct sessions stay on their recorded anchors and default discovery is unchanged", () => {
  const review: ThreadViewerSession = {
    ...session("review"),
    anchor: {
      kind: "project-review",
      id: "review",
      revision: 1,
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
  };
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, CURRENT_CAPTURE],
    [tracesTo("artifact", "requirements-current", "requirement", "REQ-MASS")],
    [CURRENT_SESSION, review],
  );
  assertEquals(aliases.get(REQUIREMENT.key), [{
    sessionId: "requirements-app",
    nodeKey: CURRENT_CAPTURE.key,
  }]);
  assertEquals(overviewCanonicalViewerNodeKey(review), undefined);
  assertEquals(
    defaultSessionIds([CURRENT_SESSION, MODEL_SESSION, review]),
    [],
  );
});

Deno.test("matching ids without traces_to never invent a requirements alias", () => {
  const twin = record(
    "artifact",
    "REQ-MASS",
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
    { isRequirementsCapture: true },
  );
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, twin],
    [],
    [session("twin-app", "REQ-MASS")],
  );
  assertEquals(aliases.size, 0);
});

Deno.test("display group alone never authorizes a requirements capture source", () => {
  const unlabeled = record(
    "artifact",
    "requirements-current",
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  const leftoverGroup = record(
    "artifact",
    "requirements-old",
    "domain:requirements",
  );
  const aliases = overviewRequirementSourceViewerAliases(
    [REQUIREMENT, unlabeled, leftoverGroup],
    [
      tracesTo("artifact", "requirements-current", "requirement", "REQ-MASS"),
      tracesTo("artifact", "requirements-old", "requirement", "REQ-MASS"),
    ],
    [CURRENT_SESSION, OLD_SESSION],
  );
  assertEquals(aliases.size, 0);
});
