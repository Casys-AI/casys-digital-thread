import { unavailableEngineeringCaseCatalog } from "../../presentation/workbench/thread/evidence.ts";
import type { ProjectBriefRevision } from "../../domain/project/project-brief.ts";
import type { ThreadWorkbenchSnapshot } from "../src/thread/types.ts";
import type { ThreadViewerSessionsProjection } from "../src/thread/viewer-sessions-client.ts";

/** Local presentation isolation only; never a live project identity. */
export const WHITEBOARD_ALPHA_PROJECT_ID = "project/whiteboard-alpha";
export const WHITEBOARD_BETA_PROJECT_ID = "project/whiteboard-beta";

export const WHITEBOARD_SYSML_ARTIFACT_ID = "ART-SYSML-WB-1";
export const WHITEBOARD_CAD_ARTIFACT_ID = "ART-CAD-WB-1";
export const WHITEBOARD_SYSML_NODE_KEY =
  `artifact:${WHITEBOARD_SYSML_ARTIFACT_ID}`;
export const WHITEBOARD_CAD_NODE_KEY = `artifact:${WHITEBOARD_CAD_ARTIFACT_ID}`;
export const WHITEBOARD_CAD_CONTEXT_TARGET = `node:${WHITEBOARD_CAD_NODE_KEY}`;

export const WHITEBOARD_CAD_SESSION_ID = `mcp-app:${"a".repeat(64)}`;
export const WHITEBOARD_SYSML_SESSION_ID = `mcp-app:${"b".repeat(64)}`;
export const WHITEBOARD_CAD_VIEWER_ID =
  `session:${WHITEBOARD_CAD_NODE_KEY}:${WHITEBOARD_CAD_SESSION_ID}`;

export const WHITEBOARD_BRIEF_DOCUMENT_ID = "approved-brief-document-r4";
export const WHITEBOARD_BRIEF_DOCUMENT_NODE_KEY =
  `artifact:${WHITEBOARD_BRIEF_DOCUMENT_ID}`;
export const WHITEBOARD_BRIEF_DOCUMENT_SESSION_ID = `mcp-app:${"9".repeat(64)}`;
export const WHITEBOARD_BRIEF_SNAPSHOT_ID =
  "inspection-drone-id01:brief:r4:8366ffe2fb53e984";
export const WHITEBOARD_CURRENT_BRIEF: ProjectBriefRevision = {
  briefId: "inspection-drone-id01:brief",
  id: WHITEBOARD_BRIEF_SNAPSHOT_ID,
  revision: 4,
  contractVersion: "2.0",
  proposedAt: "2026-09-08T01:49:29.631Z",
  proposedBy: { id: "author", origin: "human" },
  items: [
    {
      id: "objective",
      kind: "objective",
      statement: "Concevoir ID01.",
      sourceRefs: [],
    },
    {
      id: "camera-bracket-bench-stress",
      kind: "success-criterion",
      statement: "Banc théorique CameraMountBracket.",
      sourceRefs: [],
    },
  ],
};

const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const SHA_E = `sha256:${"e".repeat(64)}`;
const SHA_F = `sha256:${"f".repeat(64)}`;
const SHA_1 = `sha256:${"1".repeat(64)}`;
const SHA_2 = `sha256:${"2".repeat(64)}`;

/**
 * Two recorded hulls and two exact App sessions. A second session suppresses
 * automatic default opening so the harness can distinguish selection from an
 * explicit viewer open.
 */
export const WHITEBOARD_THREAD_FIXTURE: ThreadWorkbenchSnapshot = {
  schemaVersion: "thread-workbench/0.2",
  id: "thread-whiteboard-browser-fixture",
  subject: {
    id: "WB-01",
    label: "Whiteboard interaction fixture",
    program: "local presentation fixture",
  },
  generatedAt: "2026-09-08T10:00:00.000Z",
  source: "fixture",
  sourceLabel: "LABELLED WHITEBOARD FIXTURE — NOT LIVE EVIDENCE",
  change: {
    id: "CHG-WB-1",
    title: "Fixture change",
    summary: "Local projection used only for whiteboard interaction coverage.",
    author: "Casys fixture",
    revision: "whiteboard-fixture@1",
    changedAt: "2026-09-08T10:00:00.000Z",
    status: "pending",
    files: [],
  },
  engineeringCases: unavailableEngineeringCaseCatalog(),
  graph: {
    nodes: [
      {
        id: `graph:artifact:${WHITEBOARD_SYSML_ARTIFACT_ID}`,
        ref: { kind: "artifact", id: WHITEBOARD_SYSML_ARTIFACT_ID },
        entityKind: "artifact",
        artifactKind: "sysml-model",
        label: "Fixture SysML model",
        system: "SysON",
        freshness: "fresh",
        summary: "Documentary SysML hull for whiteboard coverage.",
        selection: { kind: "artifact", id: WHITEBOARD_SYSML_ARTIFACT_ID },
      },
      {
        id: `graph:artifact:${WHITEBOARD_CAD_ARTIFACT_ID}`,
        ref: { kind: "artifact", id: WHITEBOARD_CAD_ARTIFACT_ID },
        entityKind: "artifact",
        artifactKind: "cad-model",
        label: "Fixture CAD model",
        system: "build123d",
        freshness: "fresh",
        summary: "Documentary geometry hull for whiteboard coverage.",
        selection: { kind: "artifact", id: WHITEBOARD_CAD_ARTIFACT_ID },
      },
    ],
    edges: [
      {
        id: "fixture:input:sysml:cad",
        from: { kind: "artifact", id: WHITEBOARD_SYSML_ARTIFACT_ID },
        to: { kind: "artifact", id: WHITEBOARD_CAD_ARTIFACT_ID },
        relation: "input_to",
        rationale: "Fixture lists the SysML model as a CAD input.",
        origin: "structure",
      },
    ],
  },
  evidenceFamilyGraph: {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "thread-whiteboard-browser-fixture", revision: 1 },
    families: [],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  },
  flow: [],
  artifacts: [
    {
      id: WHITEBOARD_SYSML_ARTIFACT_ID,
      label: "Fixture SysML model",
      kind: "sysml-model",
      system: "SysON",
      revision: "sysml/fixture@1",
      freshness: "fresh",
      dependsOn: [],
    },
    {
      id: WHITEBOARD_CAD_ARTIFACT_ID,
      label: "Fixture CAD model",
      kind: "cad-model",
      system: "build123d",
      revision: "cad/fixture@1",
      freshness: "fresh",
      producedBy: "design.write-geometry@1",
      dependsOn: [WHITEBOARD_SYSML_ARTIFACT_ID],
    },
  ],
  observations: [],
  requirements: [],
  violations: [],
  actions: [],
};

export const WHITEBOARD_VIEWER_SESSIONS: ThreadViewerSessionsProjection = {
  schemaVersion: "thread-viewer-sessions/2.0",
  basis: {
    projectId: WHITEBOARD_ALPHA_PROJECT_ID,
    projectRevision: 1,
    subjectId: "WB-01",
    thread: { id: "thread-whiteboard-browser-fixture", revision: 1 },
  },
  sequence: 1,
  projectionFingerprint: SHA_C,
  sessions: [
    fixtureSession({
      id: WHITEBOARD_CAD_SESSION_ID,
      artifactId: WHITEBOARD_CAD_ARTIFACT_ID,
      appId: "io.casys.fixture.cad-viewer",
      launchUri: "/fixture/viewer-apps/cad",
      resourceFingerprint: SHA_D,
      payloadFingerprint: SHA_E,
    }),
    fixtureSession({
      id: WHITEBOARD_SYSML_SESSION_ID,
      artifactId: WHITEBOARD_SYSML_ARTIFACT_ID,
      appId: "io.casys.fixture.sysml-viewer",
      launchUri: "/fixture/viewer-apps/sysml",
      resourceFingerprint: SHA_F,
      payloadFingerprint: SHA_1,
    }),
  ],
  hierarchy: {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "available",
    architectureArtifactId: WHITEBOARD_SYSML_ARTIFACT_ID,
    rootIds: ["fixture-assembly"],
    nodes: [
      {
        id: "fixture-assembly",
        label: "Fixture assembly definition",
        partDefinitionElementId: "fixture-assembly-definition",
        artifactIds: [WHITEBOARD_SYSML_ARTIFACT_ID],
        sessionIds: [],
      },
      {
        id: "fixture-cad-occurrence",
        parentId: "fixture-assembly",
        label: "Fixture CAD definition",
        partDefinitionElementId: "fixture-cad-definition",
        usageId: "fixture-cad-usage",
        usageLabel: "Fixture CAD occurrence",
        geometryArtifactId: WHITEBOARD_CAD_ARTIFACT_ID,
        artifactIds: [WHITEBOARD_CAD_ARTIFACT_ID],
        sessionIds: [WHITEBOARD_CAD_SESSION_ID],
      },
    ],
  },
};

export const WHITEBOARD_PRESENTATION_STORAGE_PREFIX =
  "casys.project-whiteboard.presentation:v4:";

export function whiteboardPresentationStorageKey(projectId: string): string {
  return `${WHITEBOARD_PRESENTATION_STORAGE_PREFIX}${
    encodeURIComponent(projectId)
  }`;
}

export function whiteboardThreadWithCurrentBrief(): ThreadWorkbenchSnapshot {
  const thread = structuredClone(WHITEBOARD_THREAD_FIXTURE);
  thread.artifacts.push({
    id: WHITEBOARD_BRIEF_DOCUMENT_ID,
    label: "Approved brief baseline r4",
    kind: "document",
    system: "casys-digital-thread",
    revision: "brief/r4",
    freshness: "fresh",
    producer: {
      serverId: "casys-digital-thread",
      tool: "baseline_from_approved_brief",
      runId: "run:whiteboard-brief-baseline",
    },
    producedBy: "baseline_from_approved_brief",
    dependsOn: [],
  });
  thread.graph.nodes.push({
    id: `graph:artifact:${WHITEBOARD_BRIEF_DOCUMENT_ID}`,
    ref: { kind: "artifact", id: WHITEBOARD_BRIEF_DOCUMENT_ID },
    entityKind: "artifact",
    artifactKind: "document",
    label: "Approved brief baseline r4",
    system: "casys-digital-thread",
    freshness: "fresh",
    summary:
      "Documentary approved-brief baseline. Not the native current Brief.",
    selection: { kind: "artifact", id: WHITEBOARD_BRIEF_DOCUMENT_ID },
  });
  return thread;
}

export function whiteboardViewerSessionsWithBriefDocument(): ThreadViewerSessionsProjection {
  const sessions = structuredClone(WHITEBOARD_VIEWER_SESSIONS);
  return {
    ...sessions,
    sessions: [
      ...sessions.sessions,
      fixtureSession({
        id: WHITEBOARD_BRIEF_DOCUMENT_SESSION_ID,
        artifactId: WHITEBOARD_BRIEF_DOCUMENT_ID,
        appId: "io.casys.project-records",
        launchUri: "/fixture/viewer-apps/brief-document",
        resourceFingerprint: SHA_1,
        payloadFingerprint: SHA_2,
      }),
    ],
  };
}

function fixtureSession(input: {
  readonly id: string;
  readonly artifactId: string;
  readonly appId: string;
  readonly launchUri: string;
  readonly resourceFingerprint: string;
  readonly payloadFingerprint: string;
}): ThreadViewerSessionsProjection["sessions"][number] {
  return {
    id: input.id,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: input.artifactId },
    app: { id: input.appId, version: "1.0.0" },
    manifest: {
      uri: `ui://casys-fixture/${input.appId}/manifest`,
      fingerprint: SHA_2,
    },
    resource: {
      uri: `ui://casys-fixture/${input.appId}/view`,
      fingerprint: input.resourceFingerprint,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 64,
    },
    launchUri: input.launchUri,
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.fixture.session/1.0",
      payload: {
        schemaVersion: "io.casys.fixture.session/1.0",
        projection: { status: "unavailable" },
      },
      fingerprint: input.payloadFingerprint,
    },
  };
}
