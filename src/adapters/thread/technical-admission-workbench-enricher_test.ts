import { assertEquals } from "@std/assert";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import type { ProjectSourceWorkspaceState } from "../../domain/project-source-workspace/types.ts";
import { enrichThreadWorkbenchWithSealedCadLevers } from "./sealed-cad-lever-workbench-enricher.ts";
import { enrichThreadWorkbenchWithTechnicalAdmissions } from "./technical-admission-workbench-enricher.ts";

const DIGEST = "a".repeat(64);
const ADMISSION = `technical-compilation-admission-${DIGEST}`;

Deno.test("enrichThreadWorkbenchWithSealedCadLevers ignores a lookalike document", async () => {
  const snapshot = emptySnapshot({
    id: "architecture-sysml-seal-" + DIGEST,
    kind: "document",
    producedBy: "model.seal-architecture-sysml@1",
    uri: `casys://architecture-sysml-seal-capture/sha256/${DIGEST}`,
    fingerprint: `sha256:${DIGEST}`,
  });
  const enriched = await enrichThreadWorkbenchWithSealedCadLevers(snapshot, {
    read: () => Promise.reject(new Error("must not reopen")),
  });
  assertEquals(enriched, snapshot);
});

Deno.test("enrichThreadWorkbenchWithSealedCadLevers skips an unreadable sealed admission", async () => {
  const snapshot = emptySnapshot({
    id: ADMISSION,
    kind: "document",
    producedBy: "compile.seal-admission@3",
    uri: `casys://technical-compilation-admission-capture/sha256/${DIGEST}`,
    fingerprint: `sha256:${DIGEST}`,
  });
  const enriched = await enrichThreadWorkbenchWithSealedCadLevers(snapshot, {
    read: () => Promise.resolve("{"),
  });
  assertEquals(enriched, snapshot);
});

Deno.test(
  "technical admission enricher does not consult the workspace for a lookalike document",
  async () => {
    const snapshot = emptySnapshot({
      id: "architecture-sysml-seal-" + DIGEST,
      kind: "document",
      producedBy: "model.seal-architecture-sysml@1",
      uri: `casys://architecture-sysml-seal-capture/sha256/${DIGEST}`,
      fingerprint: `sha256:${DIGEST}`,
    });
    const enriched = await enrichThreadWorkbenchWithTechnicalAdmissions(
      snapshot,
      {
        admissions: { read: () => Promise.reject(new Error("must not reopen")) },
        workspace: {
          load: () => Promise.reject(new Error("must not load workspace")),
          loadAtFresh: () => Promise.reject(new Error("must not load workspace")),
        },
      },
      { projectId: "project.support" },
    );
    assertEquals(enriched.sourceFiles?.status, "unavailable");
    assertEquals(enriched.graph, snapshot.graph);
  },
);

Deno.test(
  "technical admission enricher leaves source files unattached when the seal cannot be recrossed",
  async () => {
    const snapshot = emptySnapshot({
      id: ADMISSION,
      kind: "document",
      producedBy: "compile.seal-admission@3",
      uri: `casys://technical-compilation-admission-capture/sha256/${DIGEST}`,
      fingerprint: `sha256:${DIGEST}`,
    });
    const emptyWorkspace: ProjectSourceWorkspaceState = {
      projectId: "project.support",
      workspaceRevision: 0,
      modules: new Map(),
      files: new Map(),
      attachments: new Map(),
      mutations: new Map(),
    };
    const enriched = await enrichThreadWorkbenchWithTechnicalAdmissions(
      snapshot,
      {
        admissions: { read: () => Promise.resolve("{") },
        workspace: {
          load: () => Promise.resolve(emptyWorkspace),
          loadAtFresh: () => Promise.resolve(emptyWorkspace),
        },
      },
      { projectId: "project.support" },
    );
    assertEquals(enriched.sourceFiles, {
      schemaVersion: "thread-source-files/1.0",
      status: "unavailable",
      files: [],
    });
    assertEquals(enriched.graph, snapshot.graph);
  },
);

function emptySnapshot(
  artifact: {
    readonly id: string;
    readonly kind: "document";
    readonly producedBy: string;
    readonly uri: string;
    readonly fingerprint: string;
  },
): ThreadWorkbenchSnapshot {
  return {
    schemaVersion: "thread-workbench/0.2",
    generatedAt: "2026-08-19T00:00:00.000Z",
    snapshotId: "snap",
    revision: 1,
    subject: { id: "subject", name: "subject" },
    freshness: { status: "fresh" },
    artifacts: [{
      id: artifact.id,
      label: artifact.id,
      kind: artifact.kind,
      system: "digital-thread",
      revision: "1",
      freshness: "fresh",
      fingerprint: artifact.fingerprint,
      uri: artifact.uri,
      producedBy: artifact.producedBy,
      dependsOn: [],
    }],
    observations: [],
    requirements: [],
    violations: [],
    actions: [],
    flow: [],
    graph: { nodes: [], edges: [] },
    evidenceFamilyGraph: {
      schemaVersion: "thread-evidence-family-graph/1.0",
      families: [],
    },
    components: {
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId: "subject",
      rationale: "test",
      systemViews: {},
      components: [],
    },
  } as unknown as ThreadWorkbenchSnapshot;
}
