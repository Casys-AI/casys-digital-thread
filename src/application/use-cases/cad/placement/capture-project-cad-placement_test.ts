import { assertEquals, assertRejects } from "@std/assert";
import { FileProjectSourceWorkspaceStore } from "../../../../adapters/project-source-workspace/file-project-source-workspace-store.ts";
import { FileCadImmediatePlacementSourceStore } from "../../../../adapters/cad/placement/file-cad-immediate-placement-source-store.ts";
import { FileCadPlacementAnalysisCaptureStore } from "../../../../adapters/cad/placement/file-cad-placement-analysis-capture-store.ts";
import { FileByteStore } from "../../../../adapters/shared/cas/file-byte-store.ts";
import { FileAgentResourceStore } from "../../../../adapters/resource/file-agent-resource-store.ts";
import { parseAgentResourceEnvelope } from "../../../../domain/resource/agent-resource-envelope.ts";
import { CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA } from "../../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import { ReopenAgentResource } from "../../resource/reopen-agent-resource.ts";
import { ProjectSourceWorkspaceUseCases } from "../../project-source-workspace/project-source-workspace-use-cases.ts";
import type { CadPlacementArchitectureFacts } from "../../../../domain/cad/placement/cad-placement-coverage.ts";
import type { OpenedProductStructure } from "../../../ports/out/product-navigation/product-structure-traversal.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { FixedProjectSourceAttachmentRoleCatalog } from "../../../../adapters/project-source-workspace/fixed-project-source-attachment-role-catalog.ts";
import { CaptureProjectCadPlacement } from "./capture-project-cad-placement.ts";
import { ProjectCadPlacementCaptureError } from "../../../ports/in/cad/placement/project-cad-placement-capture.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import { isCadPlacementAttachment } from "../../../../domain/cad/placement/cad-placement-attachments.ts";
import { cloneProjectSourceWorkspaceState } from "../../../../domain/project-source-workspace/transitions.ts";
import type { ProjectSourceWorkspaceState } from "../../../../domain/project-source-workspace/types.ts";

const PROJECT = "project.placement";
const SUBJECT = "subject.placement";
const SNAPSHOT_ID = "snapshot.1";
const ARCHITECTURE_ID = "architecture-" + "a".repeat(64);
const ARCHITECTURE_FP = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};

function placementJson(
  usages: readonly { usage: string; definition: string }[] = [
    { usage: "usage-right", definition: "def-rail" },
    { usage: "usage-left", definition: "def-rail" },
  ],
): string {
  return JSON.stringify({
    schemaVersion: "cad-immediate-placement-source/1.0",
    unitSystem: "mm",
    placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
    placements: usages.map((item) => ({
      usageElementId: item.usage,
      partDefinitionElementId: item.definition,
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    })),
  });
}

function architectureFacts(): CadPlacementArchitectureFacts {
  return {
    ownerDefinitionId: (usageId) =>
      usageId === "usage-left" || usageId === "usage-right" ? "def-system" : undefined,
    immediateUsageIds: (definitionId) =>
      definitionId === "def-system" ? ["usage-left", "usage-right"] : [],
    typedDefinitionId: (usageId) =>
      usageId === "usage-left" || usageId === "usage-right" ? "def-rail" : undefined,
  };
}

Deno.test("project_cad_placement_capture returns an opaque locator when coverage is exact", async () => {
  await withHarness(async (harness) => {
    const put = await harness.putPlacement();
    const review = await harness.capture.capture({
      projectId: PROJECT,
      workspaceRevision: put.workspaceRevision,
      attachmentId: put.leftAttachmentId,
      attachmentRevision: put.leftAttachmentRevision,
    });
    assertEquals(review.status, "resolved");
    if (review.status !== "resolved") return;
    assertEquals(review.grants, "none");
    assertEquals(review.owner.elementId, "def-system");
    assertEquals(review.usageCount, 2);
    assertEquals(
      review.reference.schemaVersion,
      CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    );
  });
});

Deno.test("project_cad_placement_capture stays unresolved for a missing immediate usage", async () => {
  await withHarness(async (harness) => {
    const put = await harness.putPlacement({
      text: placementJson([{ usage: "usage-left", definition: "def-rail" }]),
      usages: ["usage-left"],
    });
    const review = await harness.capture.capture({
      projectId: PROJECT,
      workspaceRevision: put.workspaceRevision,
      attachmentId: put.leftAttachmentId,
      attachmentRevision: put.leftAttachmentRevision,
    });
    assertEquals(review.status, "unresolved");
    if (review.status !== "unresolved") return;
    assertEquals(review.grants, "none");
    assertEquals("reference" in review, false);
    assertEquals(
      review.gaps.some((gap) => gap.name === "usage-right"),
      true,
    );
  });
});

Deno.test("project_cad_placement_capture refuses free-root fields and a stale attachment head", async () => {
  await withHarness(async (harness) => {
    const extra = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          fileId: "file.place",
        }),
      ProjectCadPlacementCaptureError,
    );
    assertEquals(extra.code, "invalid_request");

    const missing = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          attachmentId: "att.missing",
          attachmentRevision: 1,
        }),
      ProjectCadPlacementCaptureError,
    );
    assertEquals(missing.code, "attachment_not_found");
  });
});

Deno.test("project_cad_placement_capture refuses a cad-script file role", async () => {
  await withHarness(async (harness) => {
    const put = await harness.putPlacement({ fileRole: "cad-script" });
    const rejected = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: put.workspaceRevision,
          attachmentId: put.leftAttachmentId,
          attachmentRevision: put.leftAttachmentRevision,
        }),
      ProjectCadPlacementCaptureError,
    );
    assertEquals(rejected.code, "file_role_rejected");
  });
});

Deno.test(
  "project_cad_placement_capture stays unresolved for duplicate active same-file attachments",
  async () => {
    await withHarness(async (harness) => {
      const put = await harness.putPlacement();
      const review = await harness.capture.capture({
        projectId: PROJECT,
        workspaceRevision: put.workspaceRevision,
        attachmentId: put.leftAttachmentId,
        attachmentRevision: put.leftAttachmentRevision,
      });
      assertEquals(review.status, "unresolved");
      if (review.status !== "unresolved") return;
      assertEquals(review.grants, "none");
      assertEquals("reference" in review, false);
      assertEquals(
        review.gaps.some((gap) =>
          gap.name === "usage-left" && gap.relation === "attachment"
        ),
        true,
      );
    }, { duplicateSameFileAttachment: true });
  },
);

async function withHarness(
  run: (harness: PlacementHarness) => Promise<void>,
  options: { readonly duplicateSameFileAttachment?: boolean } = {},
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "cad-placement-" });
  try {
    const resourceStore = new FileAgentResourceStore(`${directory}/resources`);
    const reopen = new ReopenAgentResource(resourceStore);
    const store = new FileProjectSourceWorkspaceStore(`${directory}/workspace`);
    const roles = new FixedProjectSourceAttachmentRoleCatalog();
    const workspace = new ProjectSourceWorkspaceUseCases({
      projects: {
        get: (id) =>
          Promise.resolve(
            id === PROJECT
              ? {
                project: { id: PROJECT, name: "P", subjectId: SUBJECT },
                threadSnapshots: [{
                  snapshotId: SNAPSHOT_ID,
                  revision: 1,
                  subjectId: SUBJECT,
                }],
              } as unknown as EngineeringProjectSnapshot
              : undefined,
          ),
      },
      workspace: store,
      resources: reopen,
      snapshots: {
        get: () =>
          Promise.resolve({
            id: SNAPSHOT_ID,
            revision: 1,
            subject: { id: SUBJECT },
            artifacts: [{
              id: ARCHITECTURE_ID,
              fingerprint: ARCHITECTURE_FP,
            }],
          } as unknown as ThreadSnapshot),
      },
      traversal: { open: () => Promise.resolve(openedStructure()) },
      roles,
    });
    await workspace.putModule({
      projectId: PROJECT,
      mutationId: "module-root",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put",
        moduleId: "mod.root",
        slug: "src",
        displayName: "Sources",
      },
    });
    const capture = new CaptureProjectCadPlacement({
      workspace: options.duplicateSameFileAttachment
        ? wrapDuplicateSameFileAttachment(store)
        : store,
      resources: reopen,
      sources: new FileCadImmediatePlacementSourceStore(
        new FileByteStore({
          kind: "cad-immediate-placement-source",
          directory: `${directory}/sources`,
          uriNamespace: "cad-immediate-placement-source",
          label: "CAD immediate placement source",
        }),
      ),
      analyses: new FileCadPlacementAnalysisCaptureStore(
        new FileByteStore({
          kind: "cad-placement-analysis-capture",
          directory: `${directory}/analyses`,
          uriNamespace: "cad-placement-analysis-capture",
          label: "CAD placement analysis capture",
        }),
      ),
      architecture: {
        open: (declaredAgainst) => {
          assertEquals(declaredAgainst.thread.snapshotId, SNAPSHOT_ID);
          assertEquals(declaredAgainst.thread.revision, 1);
          assertEquals(declaredAgainst.thread.subjectId, SUBJECT);
          assertEquals(declaredAgainst.architecture.artifactId, ARCHITECTURE_ID);
          assertEquals(
            declaredAgainst.architecture.captureSchema,
            "architecture-capture/4.0",
          );
          return Promise.resolve(architectureFacts());
        },
      },
    });
    const harness: PlacementHarness = {
      revision: 1,
      workspace,
      capture,
      async putPlacement(input = {}) {
        const stored = await resourceStore.save(parseAgentResourceEnvelope({
          name: "placements.json",
          mimeType: "application/json",
          text: input.text ?? placementJson(),
        }));
        const file = await workspace.putFile({
          projectId: PROJECT,
          mutationId: `file-${this.revision + 1}`,
          expectedWorkspaceRevision: this.revision,
          mutation: {
            kind: "file_put",
            fileId: "file.place",
            moduleId: "mod.root",
            logicalName: "placements.json",
            role: input.fileRole ?? "cad-placement-source",
            dependencies: [],
            resourceRef: stored.reference,
          },
        });
        this.revision = file.workspaceRevision;
        const usages = input.usages ?? ["usage-left", "usage-right"];
        let leftAttachmentId = "";
        let leftAttachmentRevision = 0;
        for (const usage of usages) {
          const attachmentId = `att.${usage}`;
          const snapshot = await workspace.putAttachment({
            projectId: PROJECT,
            mutationId: `att-${usage}-${this.revision + 1}`,
            expectedWorkspaceRevision: this.revision,
            mutation: {
              kind: "attachment_put",
              attachmentId,
              fileId: "file.place",
              role: { id: "design-source", version: 1 },
              target: { elementId: usage, elementKind: "PartUsage" },
              declaredAgainst: {
                thread: {
                  snapshotId: SNAPSHOT_ID,
                  revision: 1,
                  subjectId: SUBJECT,
                },
                architecture: {
                  artifactId: ARCHITECTURE_ID,
                  fingerprint: ARCHITECTURE_FP,
                  captureSchema: "architecture-capture/4.0",
                },
              },
            },
          });
          this.revision = snapshot.workspaceRevision;
          if (usage === usages[0]) {
            leftAttachmentId = attachmentId;
            leftAttachmentRevision = 1;
          }
        }
        return {
          workspaceRevision: this.revision,
          leftAttachmentId,
          leftAttachmentRevision,
        };
      },
    };
    await run(harness);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

function wrapDuplicateSameFileAttachment(
  store: ProjectSourceWorkspaceEventStore,
): ProjectSourceWorkspaceEventStore {
  return {
    load: (projectId) => store.load(projectId),
    loadAt: (projectId, revision) => store.loadAt(projectId, revision),
    loadAtFresh: async (projectId, revision) =>
      duplicateSameFilePlacementAttachment(
        await store.loadAtFresh(projectId, revision),
      ),
    append: (event) => store.append(event),
  };
}

function duplicateSameFilePlacementAttachment(
  state: ProjectSourceWorkspaceState,
): ProjectSourceWorkspaceState {
  const cloned = cloneProjectSourceWorkspaceState(state);
  const source = [...cloned.attachments.values()].find((item) => {
    const head = item.revisions.get(item.headRevision);
    return item.status === "active" &&
      head !== undefined &&
      head.kind === "content" &&
      isCadPlacementAttachment(head);
  });
  const head = source?.revisions.get(source.headRevision);
  if (!source || head === undefined || head.kind !== "content") return cloned;
  const attachmentId = `${head.attachmentId}.duplicate`;
  const attachments = new Map(cloned.attachments);
  attachments.set(attachmentId, {
    attachmentId,
    fileId: head.fileId,
    headRevision: head.attachmentRevision,
    status: "active",
    revisions: new Map([[head.attachmentRevision, {
      ...head,
      attachmentId,
    }]]),
  });
  return { ...cloned, attachments };
}

function openedStructure(): OpenedProductStructure {
  return {
    architectureArtifactId: ARCHITECTURE_ID,
    architectureFingerprint: ARCHITECTURE_FP,
    root: () => undefined,
    childrenOfRoot: () => [],
    childrenOf: () => [],
    path: () => undefined,
    neighborhood: () => ({ siblings: [], children: [] }),
    element: () => undefined,
    searchElements: () => [],
    pageOccurrences: () => ({ items: [], nextOffset: null }),
    hasDefinition: () => false,
    hasElement: () => true,
    typedDefinition: () => undefined,
  };
}

interface PlacementHarness {
  revision: number;
  workspace: ProjectSourceWorkspaceUseCases;
  capture: CaptureProjectCadPlacement;
  putPlacement(input?: {
    readonly text?: string;
    readonly fileRole?: string;
    readonly usages?: readonly string[];
  }): Promise<{
    workspaceRevision: number;
    leftAttachmentId: string;
    leftAttachmentRevision: number;
  }>;
}
