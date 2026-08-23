import { assertEquals } from "@std/assert";
import { GENERIC_ENGINEERING_WORKBENCH_FIXTURE } from "../testing/workbench/generic-engineering-workbench-fixture.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  nextLiveActivityNode,
  shouldAcceptWorkbenchUpdate,
} from "./src/thread/live-update.ts";
import type {
  EngineeringDocumentaryWorkbenchSnapshot,
  EngineeringEvidenceWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("same-id projection detects a genuinely new feed node without prescribing focus", () => {
  const previous = structuredClone(GENERIC_THREAD_FIXTURE);
  const incoming = structuredClone(previous);
  incoming.graph.nodes.push({
    id: "graph:artifact:cad-live",
    ref: { kind: "artifact", id: "cad-live" },
    entityKind: "artifact",
    artifactKind: "cad-model",
    label: "GenericAssembly CAD assembly",
    system: "mcp-build123d",
    freshness: "running",
    summary: "Generating from observed SysML dimensions",
    recordedAt: "2026-08-01T10:00:00.000Z",
    selection: { kind: "artifact", id: "cad-live" },
  });

  assertEquals(incoming.id, previous.id);
  assertEquals(nextLiveActivityNode(previous, incoming)?.ref.id, "cad-live");
});

Deno.test("same-id projection detects a server-declared live milestone", () => {
  const previous = structuredClone(GENERIC_THREAD_FIXTURE);
  const incoming = structuredClone(previous);
  incoming.graph.nodes.push({
    id: "graph:artifact:projector-milestone",
    ref: { kind: "artifact", id: "projector-milestone" },
    entityKind: "artifact",
    artifactKind: "other",
    activityRole: "milestone",
    label: "Model container",
    system: "server-owned-projector",
    freshness: "running",
    summary: "Creating the bounded model container.",
    recordedAt: "2026-08-01T10:00:00.000Z",
  });

  assertEquals(
    nextLiveActivityNode(previous, incoming)?.ref.id,
    "projector-milestone",
  );
});

Deno.test("same-id in-place update adds no new live activity", () => {
  const previous = structuredClone(GENERIC_THREAD_FIXTURE);
  const incoming = structuredClone(previous);
  incoming.graph.nodes[0].freshness = "running";
  incoming.graph.nodes[0].summary = "Rereading current SysML element";

  assertEquals(incoming.id, previous.id);
  assertEquals(nextLiveActivityNode(previous, incoming), undefined);
});

Deno.test("delayed SSE cannot overwrite a newer project snapshot", () => {
  const fixture = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  const current = { ...fixture, project: { ...fixture.project, revision: 3 } };
  const delayed = { ...fixture, project: { ...fixture.project, revision: 2 } };

  assertEquals(shouldAcceptWorkbenchUpdate(current, delayed), false);
});

Deno.test("equal project revision accepts a newer thread or live sequence only", () => {
  const current = withLiveVersion(
    structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE),
    4,
  );
  const newerLive = withLiveVersion(structuredClone(current), 5);
  const duplicate = withLiveVersion(structuredClone(current), 4);
  const newerThread = {
    ...structuredClone(current),
    alignment: {
      ...current.alignment,
      currentThreadRevision: current.alignment.currentThreadRevision + 1,
    },
  };

  assertEquals(shouldAcceptWorkbenchUpdate(current, newerLive), true);
  assertEquals(shouldAcceptWorkbenchUpdate(current, newerThread), true);
  assertEquals(shouldAcceptWorkbenchUpdate(current, duplicate), false);
});

Deno.test("a documentary record has no live evidence overlay to compare", () => {
  const fixture = GENERIC_ENGINEERING_WORKBENCH_FIXTURE;
  const current: EngineeringDocumentaryWorkbenchSnapshot = {
    schemaVersion: "engineering-workbench/0.6",
    surface: "documentary",
    project: fixture.project,
    documentary: {
      status: "recorded",
      message: "Durable provenance only.",
      record: {
        origin: "approved-brief",
        snapshotId: fixture.project.threadSnapshots[0]!.snapshotId,
        snapshotRevision: 1,
        artifactId: "approved-brief-document",
        label: "Approved project brief documentary baseline (pre-technical)",
        fingerprint: "sha256:documentary-record",
        recordedAt: "2026-08-02T12:00:00.000Z",
      },
      technicalEvidence: {
        status: "not-recorded",
        message: "No technical proof is recorded.",
      },
    },
  };
  const duplicate = structuredClone(current);

  assertEquals(shouldAcceptWorkbenchUpdate(current, duplicate), false);
});

Deno.test("a documentary record accepts a newer closed technical-start feed", () => {
  const fixture = GENERIC_ENGINEERING_WORKBENCH_FIXTURE;
  const current: EngineeringDocumentaryWorkbenchSnapshot = {
    schemaVersion: "engineering-workbench/0.6",
    surface: "documentary",
    project: fixture.project,
    documentary: {
      status: "recorded",
      message: "Durable provenance only.",
      record: {
        origin: "approved-brief",
        snapshotId: fixture.project.threadSnapshots[0]!.snapshotId,
        snapshotRevision: 1,
        artifactId: "approved-brief-document",
        label: "Approved project brief documentary baseline (pre-technical)",
        fingerprint: "sha256:documentary-record",
        recordedAt: "2026-08-02T12:00:00.000Z",
      },
      technicalEvidence: {
        status: "not-recorded",
        message: "No technical proof is recorded.",
      },
      technicalStart: technicalStart(4),
    },
  };
  const newer = {
    ...current,
    documentary: {
      ...current.documentary,
      technicalStart: technicalStart(5),
    },
  };

  assertEquals(shouldAcceptWorkbenchUpdate(current, newer), true);
  assertEquals(shouldAcceptWorkbenchUpdate(newer, current), false);
});

function technicalStart(version: number) {
  return {
    kind: "sysml-container-seed" as const,
    state: "running" as const,
    message: "Creating the first empty SysON model container.",
    activity: {
      version,
      steps: [{
        id: "project-container" as const,
        state: "fresh" as const,
        label: "SysON project container",
        summary: "Created.",
        recordedAt: "2026-08-02T12:00:00.000Z",
      }],
    },
  };
}

function withLiveVersion(
  snapshot: EngineeringEvidenceWorkbenchSnapshot,
  version: number,
): EngineeringEvidenceWorkbenchSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      live: { version, active: [], schemaVersion: "live-thread-overlay/1.0" },
    } as EngineeringEvidenceWorkbenchSnapshot["thread"],
  };
}
