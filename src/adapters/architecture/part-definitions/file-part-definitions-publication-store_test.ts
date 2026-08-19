import { assert, assertEquals } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import {
  FilePartDefinitionsPublicationStore,
  type PartDefinitionsPublication,
} from "./file-part-definitions-publication-store.ts";

Deno.test("PartDefinitions publication WAL uses stable short names for maximum project and run identities", async () => {
  const root = await Deno.makeTempDir({ prefix: "part-defs-wal-key-" });
  try {
    const projectId = "p".repeat(160);
    const runId = "r".repeat(160);
    const left = new FilePartDefinitionsPublicationStore(`${root}/runtime-a`);
    const right = new FilePartDefinitionsPublicationStore(`${root}/runtime-b`);
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

Deno.test("PartDefinitions publication WAL reads a safe legacy key without probing an overlong one", async () => {
  const root = await Deno.makeTempDir({ prefix: "part-defs-wal-legacy-" });
  try {
    const projectId = "project:short";
    const runId = "run:short";
    const store = new FilePartDefinitionsPublicationStore(root);
    const value = publication(projectId, runId);
    const legacyBasename = `${
      encodeURIComponent(JSON.stringify([projectId, runId]))
    }.json`;
    await Deno.writeTextFile(
      `${root}/${legacyBasename}`,
      `${deterministicJson(value)}\n`,
    );

    assertEquals(await store.read(projectId, runId), value);
    assertEquals(
      await store.read("p".repeat(160), "r".repeat(160)),
      undefined,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("PartDefinitions publication WAL persists a custom relative root", async () => {
  const directory =
    `casys-relative-part-definitions-publications-${crypto.randomUUID()}`;
  try {
    const store = new FilePartDefinitionsPublicationStore(directory);
    const value = publication("project:relative", "run:relative");
    await store.save(value);
    assertEquals(await store.read(value.projectId, value.runId), value);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function publication(
  projectId: string,
  runId: string,
): PartDefinitionsPublication {
  const at = "2026-08-08T06:00:00.000Z";
  const artifact = {
    id: "part-definitions-" + "a".repeat(64),
    name: "PartDefinition product structure",
    kind: "sysml-model" as const,
    version: "a".repeat(64),
    fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    uri: `casys://part-definitions-capture/sha256/${"a".repeat(64)}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_element_children", runId },
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
      name: "System",
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
    schemaVersion: "part-definitions-publication/1.0",
    projectId,
    runId,
    fingerprint: artifact.fingerprint,
    snapshot,
  };
}
