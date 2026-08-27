import { assertEquals, assertRejects } from "@std/assert";
import { sampleAgentResourceReference } from "../../testing/agent-resource-test-support.ts";
import { resolveProjectSourceClosure } from "../../domain/project-source-workspace/closure.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../domain/project-source-workspace/transitions.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { FileProjectSourceClosureStore } from "./file-project-source-closure-store.ts";
import { ProjectSourceClosureStoreError } from "../../application/ports/out/project-source-workspace/project-source-closure-store.ts";

const PROJECT = "generic-project";

Deno.test("closure CAS persist recrosses the exact document and refuses a foreign locator URI", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-source-closure-" });
  try {
    const store = new FileProjectSourceClosureStore(
      new FileByteStore({
        kind: "project-source-closure",
        directory,
        uriNamespace: "project-source-closure",
        label: "project source closure",
      }),
    );
    let state = emptyProjectSourceWorkspace(PROJECT);
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId: PROJECT,
      mutationId: "m1",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put",
        moduleId: "mod-a",
        slug: "src",
        displayName: "Sources",
      },
    })).state;
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId: PROJECT,
      mutationId: "f1",
      expectedWorkspaceRevision: 1,
      mutation: {
        kind: "file_put",
        fileId: "file-root",
        moduleId: "mod-a",
        logicalName: "root.py",
        role: "cad-script",
        dependencies: [],
        resourceRef: sampleAgentResourceReference({
          name: "root.py",
          mimeType: "text/x-python",
        }),
        captureRequest: { profileId: "build123d-closed-subset-v1" },
      },
    })).state;
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId: PROJECT,
      mutationId: "a1",
      expectedWorkspaceRevision: 2,
      mutation: {
        kind: "attachment_put",
        attachmentId: "att-root",
        fileId: "file-root",
        role: { id: "design-source", version: 1 },
        target: { elementId: "def-rail", elementKind: "PartDefinition" },
        declaredAgainst: {
          thread: {
            snapshotId: "thread:p:r1",
            revision: 1,
            subjectId: "subject.p",
          },
          architecture: {
            artifactId: "architecture-" + "a".repeat(64),
            fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
            captureSchema: "architecture-capture/4.0",
          },
        },
      },
    })).state;
    const closure = await resolveProjectSourceClosure(state, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    });
    const locator = await store.persist(closure);
    const reopened = await store.reopenLocator(locator);
    assertEquals(reopened.document.fingerprint, closure.fingerprint);
    assertEquals(reopened.document.files.length, 1);
    await assertRejects(
      () => store.reopenLocator({ ...locator, byteCount: locator.byteCount + 1 }),
      ProjectSourceClosureStoreError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
