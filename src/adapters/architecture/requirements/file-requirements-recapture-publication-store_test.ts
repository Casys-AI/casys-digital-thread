import { assert, assertEquals } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import {
  FileRequirementsRecapturePublicationStore,
  type RequirementsRecapturePublication,
} from "./file-requirements-recapture-publication-store.ts";

Deno.test("requirements recapture publication WAL uses stable short names", async () => {
  const root = await Deno.makeTempDir({ prefix: "reqs-recapture-wal-" });
  try {
    const projectId = "p".repeat(160);
    const runId = "r".repeat(160);
    const store = new FileRequirementsRecapturePublicationStore(root);
    const firstPath = await store.pathFor(projectId, runId);
    assertEquals(firstPath.split("/").at(-1)?.length, 69);
    const value = publication(projectId, runId);
    await store.save(value);
    assertEquals(await store.read(projectId, runId), value);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("requirements recapture publication WAL refuses a conflicting record", async () => {
  const root = await Deno.makeTempDir({ prefix: "reqs-recapture-wal-conflict-" });
  try {
    const store = new FileRequirementsRecapturePublicationStore(root);
    const value = publication("project:a", "run:a");
    await store.save(value);
    await store.save(value);
    const other = publication("project:a", "run:a");
    (other.snapshot as { id: string }).id = "other";
    let failed = false;
    try {
      await store.save(other);
    } catch {
      failed = true;
    }
    assert(failed);
    assertEquals(await store.read("project:a", "run:a"), value);
    assertEquals(
      deterministicJson(await store.read("project:a", "run:a")),
      deterministicJson(value),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function publication(
  projectId: string,
  runId: string,
): RequirementsRecapturePublication {
  const at = "2026-09-07T12:00:00.000Z";
  const digest = "a".repeat(64);
  const snapshot = {
    schemaVersion: "1.0",
    id: "snap-r2",
    revision: 2,
    previous: { snapshotId: "snap-r1", revision: 1 },
    generatedAt: at,
    subject: {
      id: "subject:a",
      name: "A",
      kind: "system",
      version: "r2",
      modelArtifactId: "architecture-" + digest,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "cs-r2",
      name: "Revision 2",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [],
    },
    artifacts: [{
      id: "architecture-" + digest,
      name: "Architecture",
      kind: "sysml-model",
      version: digest,
      fingerprint: { algorithm: "sha256", digest },
      uri: `casys://architecture-capture/sha256/${digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:arch",
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  } as ThreadSnapshot;
  return {
    schemaVersion: "requirements-recapture-publication/1.0",
    projectId,
    runId,
    fingerprint: { algorithm: "sha256", digest },
    snapshot,
    capture: '{"schemaVersion":"requirements-capture/4.0"}',
  };
}
