import { assertEquals } from "@std/assert";
import { persistAgentResourceText } from "../../testing/agent-resource-test-support.ts";
import { createProjectSourceWorkspaceComposition } from "./server-composition.ts";

Deno.test("workspace composition mutates without a provider, runtime or compilation grant", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-comp-" });
  try {
    const persisted = await persistAgentResourceText(`${root}/cas`, {
      name: "notes.txt",
      mimeType: "text/plain",
      text: "ok\n",
    });
    const composed = createProjectSourceWorkspaceComposition({
      directory: `${root}/ws`,
      projects: { get: () => Promise.resolve({ id: "generic-project" }) },
      resources: persisted.reopen,
      snapshots: {
        get: () => Promise.reject(new Error("snapshots must not be used")),
      },
      traversal: {
        open: () => Promise.reject(new Error("traversal must not be used")),
      },
    });
    const snapshot = await composed.sourceWorkspace.putModule({
      projectId: "generic-project",
      mutationId: "m1",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put",
        moduleId: "mod-a",
        slug: "notes",
        displayName: "Notes",
      },
    });
    assertEquals(snapshot.grants, "none");
    assertEquals(snapshot.workspaceRevision, 1);
    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("HttpMcpToolClient"), false);
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
    assertEquals(source.includes("imageReference"), false);
    assertEquals(snapshot.activeAttachmentCount, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
