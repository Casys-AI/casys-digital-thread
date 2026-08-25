import { assertEquals, assertRejects } from "@std/assert";
import { sampleAgentResourceReference } from "../../testing/agent-resource-test-support.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../domain/project-source-workspace/transitions.ts";
import {
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceState,
} from "../../domain/project-source-workspace/types.ts";
import { ProjectSourceWorkspaceAuthoringAttachmentReader } from "./product-navigation-authoring-attachment-reader.ts";

const PROJECT = "project.slider";
const OTHER = "project.other";
const TARGET = {
  elementId: "def-system",
  elementKind: "PartDefinition" as const,
};
const BINDING = `sha256:${"a".repeat(64)}`;
const OTHER_BINDING = `sha256:${"b".repeat(64)}`;

Deno.test("authoring attachment reader refuses MAC mutation, domain JSON, and a cross-project cursor before historical read", async () => {
  const seeded = await seedTwoHeads();
  const freshRevisions: number[] = [];
  const reader = new ProjectSourceWorkspaceAuthoringAttachmentReader({
    load: () => Promise.resolve(seeded.head),
    loadAtFresh: (_projectId, workspaceRevision) => {
      freshRevisions.push(workspaceRevision);
      const named = seeded.revisions.get(workspaceRevision);
      if (!named) {
        throw new ProjectSourceWorkspaceError(
          "revision_not_found",
          `missing ${workspaceRevision}`,
        );
      }
      return Promise.resolve(named);
    },
  });
  const first = await reader.listActiveHeads({
    projectId: PROJECT,
    target: TARGET,
    cursorBinding: BINDING,
    pageSize: 1,
  });
  assertEquals(first.attachments.map((item) => item.attachmentId), ["att-a"]);
  assertEquals(first.nextCursor !== null, true);
  const afterHead = freshRevisions.length;
  const [prefix, payload, mac] = first.nextCursor!.split(".");
  const flipped = mac!.endsWith("A") ? "B" : "A";
  await assertRejects(
    () =>
      reader.listActiveHeads({
        projectId: PROJECT,
        target: TARGET,
        cursorBinding: BINDING,
        pageSize: 1,
        cursor: `${prefix}.${payload}.${mac!.slice(0, -1)}${flipped}`,
      }),
    ProjectSourceWorkspaceError,
    "not a valid opaque cursor",
  );
  await assertRejects(
    () =>
      reader.listActiveHeads({
        projectId: PROJECT,
        target: TARGET,
        cursorBinding: BINDING,
        pageSize: 1,
        cursor: btoa(JSON.stringify({
          kind: "attachment-list",
          workspaceRevision: first.workspaceRevision,
          filter: { target: TARGET },
        })),
      }),
    ProjectSourceWorkspaceError,
    "not a valid opaque cursor",
  );
  await assertRejects(
    () =>
      reader.listActiveHeads({
        projectId: OTHER,
        target: TARGET,
        cursorBinding: BINDING,
        pageSize: 1,
        cursor: first.nextCursor!,
      }),
    ProjectSourceWorkspaceError,
    "does not match the requested project",
  );
  await assertRejects(
    () =>
      reader.listActiveHeads({
        projectId: PROJECT,
        target: { elementId: "def-rail", elementKind: "PartDefinition" },
        cursorBinding: BINDING,
        pageSize: 1,
        cursor: first.nextCursor!,
      }),
    ProjectSourceWorkspaceError,
    "does not match the requested exact target",
  );
  const recoded = JSON.parse(
    new TextDecoder().decode(decodeBase64Url(payload!)),
  ) as { workspaceRevision: number };
  recoded.workspaceRevision = 1;
  await assertRejects(
    () =>
      reader.listActiveHeads({
        projectId: PROJECT,
        target: TARGET,
        cursorBinding: BINDING,
        pageSize: 1,
        cursor: `${prefix}.${
          encodeBase64Url(new TextEncoder().encode(JSON.stringify(recoded)))
        }.${mac}`,
      }),
    ProjectSourceWorkspaceError,
    "not a valid opaque cursor",
  );
  assertEquals(freshRevisions.length, afterHead);
});

Deno.test("authoring attachment reader refuses a cursor under a different inspect binding before historical read", async () => {
  const seeded = await seedTwoHeads();
  const freshRevisions: number[] = [];
  const reader = new ProjectSourceWorkspaceAuthoringAttachmentReader({
    load: () => Promise.resolve(seeded.head),
    loadAtFresh: (_projectId, workspaceRevision) => {
      freshRevisions.push(workspaceRevision);
      const named = seeded.revisions.get(workspaceRevision);
      if (!named) {
        throw new ProjectSourceWorkspaceError(
          "revision_not_found",
          `missing ${workspaceRevision}`,
        );
      }
      return Promise.resolve(named);
    },
  });
  const first = await reader.listActiveHeads({
    projectId: PROJECT,
    target: TARGET,
    cursorBinding: BINDING,
    pageSize: 1,
  });
  assertEquals(first.nextCursor !== null, true);
  const afterHead = freshRevisions.length;
  await assertRejects(
    () =>
      reader.listActiveHeads({
        projectId: PROJECT,
        target: TARGET,
        cursorBinding: OTHER_BINDING,
        pageSize: 1,
        cursor: first.nextCursor!,
      }),
    ProjectSourceWorkspaceError,
    "does not match the requested inspect binding",
  );
  const second = await reader.listActiveHeads({
    projectId: PROJECT,
    target: TARGET,
    cursorBinding: BINDING,
    pageSize: 1,
    cursor: first.nextCursor!,
  });
  assertEquals(second.attachments.map((item) => item.attachmentId), ["att-b"]);
  assertEquals(freshRevisions.length, afterHead + 1);
});

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function seedTwoHeads() {
  const revisions = new Map<number, ProjectSourceWorkspaceState>();
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = record(
    revisions,
    await applyProjectSourceWorkspaceCommand(state, {
      projectId: PROJECT,
      mutationId: "m1",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put",
        moduleId: "mod-a",
        slug: "mech",
        displayName: "Mech",
      },
    }),
  );
  state = record(
    revisions,
    await applyProjectSourceWorkspaceCommand(state, filePut("f-a", 1, "file-a")),
  );
  state = record(
    revisions,
    await applyProjectSourceWorkspaceCommand(state, filePut("f-b", 2, "file-b")),
  );
  state = record(
    revisions,
    await applyProjectSourceWorkspaceCommand(
      state,
      attachmentPut("a1", 3, "att-a", "file-a"),
    ),
  );
  state = record(
    revisions,
    await applyProjectSourceWorkspaceCommand(
      state,
      attachmentPut("a2", 4, "att-b", "file-b"),
    ),
  );
  return { head: state, revisions };
}

function record(
  revisions: Map<number, ProjectSourceWorkspaceState>,
  transition: { state: ProjectSourceWorkspaceState },
) {
  revisions.set(transition.state.workspaceRevision, transition.state);
  return transition.state;
}

function filePut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  fileId: string,
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "file_put" as const,
      fileId,
      moduleId: "mod-a",
      logicalName: `${fileId}.py`,
      role: "script",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: `${fileId}.py`,
        mimeType: "text/plain",
        byteCount: 1,
      }),
    },
  };
}

function attachmentPut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  attachmentId: string,
  fileId: string,
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "attachment_put" as const,
      attachmentId,
      fileId,
      role: { id: "design-source", version: 1 },
      target: TARGET,
      declaredAgainst: {
        thread: {
          snapshotId: "thread:slider:r4",
          revision: 4,
          subjectId: "subject.slider",
        },
        architecture: {
          artifactId: "architecture-" + "1".repeat(64),
          fingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
          captureSchema: "architecture-capture/4.0" as const,
        },
      },
    },
  };
}
