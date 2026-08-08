import { assert, assertEquals } from "@std/assert";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import {
  FileInspectionDroneV4PartDefinitionsPublicationStore,
  type InspectionDroneV4PartDefinitionsPublication,
} from "./file-inspection-drone-v4-part-definitions-publication-store.ts";

Deno.test("PartDefinitions publication WAL uses stable short names for maximum project and run identities", async () => {
  const root = await Deno.makeTempDir({ prefix: "inspection-drone-wal-key-" });
  try {
    const projectId = "p".repeat(160);
    const runId = "r".repeat(160);
    const left = new FileInspectionDroneV4PartDefinitionsPublicationStore(
      `${root}/runtime-a`,
    );
    const right = new FileInspectionDroneV4PartDefinitionsPublicationStore(
      `${root}/runtime-b`,
    );
    const firstPath = await left.pathFor(projectId, runId);
    assertEquals(firstPath, await left.pathFor(projectId, runId));
    assertEquals(firstPath.split("/").at(-1)?.length, 69);
    assert((await left.pathFor(projectId, `${runId.slice(0, -1)}s`)) !== firstPath);

    const value = publication(projectId, runId);
    await left.save(value);
    assertEquals(await left.read(projectId, runId), value);
    assertEquals(await right.read(projectId, runId), undefined);
    await right.save(value);
    assertEquals(await right.read(projectId, runId), value);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function publication(
  projectId: string,
  runId: string,
): InspectionDroneV4PartDefinitionsPublication {
  const at = "2026-08-08T06:00:00.000Z";
  const artifact = {
    id: "inspection-drone-v4-part-definitions-" + "a".repeat(64),
    name: "Inspection-drone V4 PartDefinitions product structure",
    kind: "sysml-model" as const,
    version: "a".repeat(64),
    fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    uri: `casys://inspection-drone-v4-part-definitions-capture/sha256/${
      "a".repeat(64)
    }`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_part_structure", runId },
    inputArtifactIds: [],
    freshness: { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] },
  };
  const snapshot: ThreadSnapshot = {
    schemaVersion: "1.0",
    id: `project:${projectId}:r4`,
    revision: 4,
    previous: { snapshotId: `project:${projectId}:r3`, revision: 3 },
    generatedAt: at,
    subject: {
      id: `project:${projectId}`,
      name: "Inspection drone",
      kind: "system",
      version: "r4",
      modelArtifactId: artifact.id,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "part-definitions",
      name: "PartDefinitions",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [],
    },
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  return {
    schemaVersion: "inspection-drone-v4-part-definitions-publication/1.0",
    projectId,
    runId,
    fingerprint: artifact.fingerprint,
    snapshot,
  };
}
