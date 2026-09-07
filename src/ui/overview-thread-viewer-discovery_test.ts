import { assertEquals } from "@std/assert";
import { overviewDefaultViewerSessions } from "./src/project/overview-thread-viewer-discovery.ts";
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

Deno.test("default viewers show the whole assembly and independent brief, never every module", () => {
  const sessions = [
    session("module-app"),
    session("brief"),
    session("assembly"),
    session("brief-alt", "brief"),
  ];
  assertEquals(
    overviewDefaultViewerSessions(sessions, hierarchy).map((s) => s.id),
    [
      "brief",
      "assembly",
    ],
  );
  assertEquals(
    overviewDefaultViewerSessions(sessions.slice(0, 2), hierarchy).map((s) => s.id),
    ["module-app", "brief"],
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
    overviewDefaultViewerSessions([review, session("brief")]).map((s) => s.id),
    ["brief"],
  );
});
