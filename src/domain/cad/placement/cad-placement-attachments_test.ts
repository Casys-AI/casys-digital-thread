import { assertEquals, assertThrows } from "@std/assert";
import { sampleAgentResourceReference } from "../../../testing/agent-resource-test-support.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../project-source-workspace/transitions.ts";
import type { ProjectSourceWorkspaceState } from "../../project-source-workspace/types.ts";
import {
  CadPlacementAttachmentError,
  isCadPlacementAttachment,
  placementAttachmentsShareDeclaredAgainst,
  requireSameFileActivePlacementAttachments,
} from "./cad-placement-attachments.ts";

const PROJECT = "generic-project";

Deno.test("same-file resolution collects only active design-source PartUsage edges of one cad-placement-source file", async () => {
  const state = await seedPlacementWorkspace();
  const resolved = requireSameFileActivePlacementAttachments(state, {
    attachmentId: "att-left",
    attachmentRevision: 1,
  });
  assertEquals(resolved.file.role, "cad-placement-source");
  assertEquals(resolved.attachments.map((item) => item.attachmentId), [
    "att-left",
    "att-right",
  ]);
  assertEquals(
    resolved.attachments.every((item) => isCadPlacementAttachment(item)),
    true,
  );
  assertEquals(placementAttachmentsShareDeclaredAgainst(resolved.attachments), true);
});

Deno.test("same-file resolution ignores a supporting-document edge on the same file", async () => {
  let state = await seedPlacementWorkspace();
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId: PROJECT,
    mutationId: "att-doc",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "attachment_put",
      attachmentId: "att-doc",
      fileId: "file-place",
      role: { id: "supporting-document", version: 1 },
      target: { elementId: "usage-left", elementKind: "PartUsage" },
      declaredAgainst: declaredAgainst(),
    },
  })).state;
  const resolved = requireSameFileActivePlacementAttachments(state, {
    attachmentId: "att-left",
    attachmentRevision: 1,
  });
  assertEquals(resolved.attachments.map((item) => item.attachmentId), [
    "att-left",
    "att-right",
  ]);
});

Deno.test("same-file resolution refuses a stale head, wrong file role, or PartDefinition target", async () => {
  const state = await seedPlacementWorkspace();
  assertThrows(
    () =>
      requireSameFileActivePlacementAttachments(state, {
        attachmentId: "att-left",
        attachmentRevision: 99,
      }),
    CadPlacementAttachmentError,
    "not present",
  );
  const wrongRole = await seedPlacementWorkspace({ fileRole: "cad-script" });
  const roleError = assertThrows(
    () =>
      requireSameFileActivePlacementAttachments(wrongRole, {
        attachmentId: "att-left",
        attachmentRevision: 1,
      }),
    CadPlacementAttachmentError,
  );
  assertEquals(roleError.code, "file_role_rejected");

  let definitionTarget = await seedFileOnly();
  definitionTarget = (await applyProjectSourceWorkspaceCommand(definitionTarget, {
    projectId: PROJECT,
    mutationId: "att-def",
    expectedWorkspaceRevision: definitionTarget.workspaceRevision,
    mutation: {
      kind: "attachment_put",
      attachmentId: "att-def",
      fileId: "file-place",
      role: { id: "design-source", version: 1 },
      target: { elementId: "def-system", elementKind: "PartDefinition" },
      declaredAgainst: declaredAgainst(),
    },
  })).state;
  const namedError = assertThrows(
    () =>
      requireSameFileActivePlacementAttachments(definitionTarget, {
        attachmentId: "att-def",
        attachmentRevision: 1,
      }),
    CadPlacementAttachmentError,
  );
  assertEquals(namedError.code, "named_attachment_not_placement");
});

async function seedPlacementWorkspace(
  options: { readonly fileRole?: string } = {},
): Promise<ProjectSourceWorkspaceState> {
  let state = await seedFileOnly(options);
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId: PROJECT,
    mutationId: "att-left",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "attachment_put",
      attachmentId: "att-left",
      fileId: "file-place",
      role: { id: "design-source", version: 1 },
      target: { elementId: "usage-left", elementKind: "PartUsage" },
      declaredAgainst: declaredAgainst(),
    },
  })).state;
  return (await applyProjectSourceWorkspaceCommand(state, {
    projectId: PROJECT,
    mutationId: "att-right",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "attachment_put",
      attachmentId: "att-right",
      fileId: "file-place",
      role: { id: "design-source", version: 1 },
      target: { elementId: "usage-right", elementKind: "PartUsage" },
      declaredAgainst: declaredAgainst(),
    },
  })).state;
}

async function seedFileOnly(
  options: { readonly fileRole?: string } = {},
): Promise<ProjectSourceWorkspaceState> {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId: PROJECT,
    mutationId: "mod",
    expectedWorkspaceRevision: 0,
    mutation: {
      kind: "module_put",
      moduleId: "mod-a",
      slug: "mech",
      displayName: "Mech",
    },
  })).state;
  return (await applyProjectSourceWorkspaceCommand(state, {
    projectId: PROJECT,
    mutationId: "file",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "file_put",
      fileId: "file-place",
      moduleId: "mod-a",
      logicalName: "placements.json",
      role: options.fileRole ?? "cad-placement-source",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: "placements.json",
        mimeType: "application/json",
        byteCount: 2,
      }),
    },
  })).state;
}

function declaredAgainst() {
  return {
    thread: {
      snapshotId: "thread:p:r1",
      revision: 1,
      subjectId: "subject.p",
    },
    architecture: {
      artifactId: "architecture-" + "a".repeat(64),
      fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      captureSchema: "architecture-capture/4.0" as const,
    },
  };
}
