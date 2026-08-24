import { assertEquals, assertRejects } from "@std/assert";
import { persistAgentResourceText } from "../../../testing/agent-resource-test-support.ts";
import { FileProjectSourceWorkspaceStore } from "../../../adapters/project-source-workspace/file-project-source-workspace-store.ts";
import {
  ProjectSourceWorkspaceApplicationError,
  ProjectSourceWorkspaceUseCases,
} from "./project-source-workspace-use-cases.ts";
import { AgentResourceReopenError } from "../resource/reopen-agent-resource.ts";
import { ProjectSourceWorkspaceError } from "../../../domain/project-source-workspace/types.ts";
import type { AgentResourceExactReopener } from "../../ports/out/resource/agent-resource-exact-reopener.ts";
import type { AgentResourceReference } from "../../../domain/resource/agent-resource-capture.ts";
import { tamperAgentResourceReference } from "../../../testing/agent-resource-test-support.ts";

const PROJECT = "generic-project";

Deno.test("file put reopens the exact resource and refuses a missing project or tampered ref", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-uc-" });
  try {
    const persisted = await persistAgentResourceText(`${root}/cas`, {
      name: "rail.py",
      mimeType: "text/plain",
      text: "print(1)\n",
    });
    const workspace = new FileProjectSourceWorkspaceStore(`${root}/ws`);
    const missingProject = new ProjectSourceWorkspaceUseCases({
      projects: { get: () => Promise.resolve(undefined) },
      workspace,
      resources: persisted.reopen,
      ...unusedExternal(),
    });
    const missing = await assertRejects(
      () => missingProject.putModule(modulePut("m1", 0)),
      ProjectSourceWorkspaceApplicationError,
    );
    assertEquals(missing.code, "project_not_found");

    const useCases = cases(workspace, persisted.reopen);
    const snapshot = await useCases.putModule(modulePut("m1", 0));
    assertEquals(snapshot.workspaceRevision, 1);
    assertEquals(snapshot.grants, "none");
    const put = await useCases.putFile(filePut("f1", 1, persisted.reference));
    assertEquals(put.activeFileCount, 1);

    const replay = await useCases.putFile(filePut("f1", 1, persisted.reference));
    assertEquals(replay.workspaceRevision, 2);

    const tampered = await assertRejects(
      () =>
        useCases.putFile(filePut(
          "f2",
          2,
          tamperAgentResourceReference(
            persisted.reference,
            { name: "other.py" },
          ),
        )),
      AgentResourceReopenError,
    );
    assertEquals(tampered.code, "resource_mismatch");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ack-loss replay returns the accepted revision; a different command with the same id fails", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-ack-" });
  try {
    const persisted = await persistAgentResourceText(`${root}/cas`, {
      name: "rail.py",
      mimeType: "text/plain",
      text: "print(1)\n",
    });
    let reopens = 0;
    const resources: AgentResourceExactReopener = {
      reopenExact: async (ref) => {
        reopens += 1;
        return await persisted.reopen.reopenExact(ref);
      },
    };
    const useCases = cases(
      new FileProjectSourceWorkspaceStore(`${root}/ws`),
      resources,
    );
    await useCases.putModule(modulePut("m1", 0));
    const first = await useCases.putFile(filePut("f1", 1, persisted.reference));
    await useCases.putModule({
      projectId: PROJECT,
      mutationId: "m2",
      expectedWorkspaceRevision: 2,
      mutation: {
        kind: "module_put",
        moduleId: "mod-b",
        slug: "drive",
        displayName: "Drive",
      },
    });
    const replay = await useCases.putFile(filePut("f1", 1, persisted.reference));
    assertEquals(replay.workspaceRevision, first.workspaceRevision);
    assertEquals(replay.moduleCount, 1);
    assertEquals(replay.activeFileCount, 1);
    assertEquals(reopens, 1);
    const conflict = await assertRejects(
      () =>
        useCases.putFile(filePut("f1", 1, persisted.reference, {
          logicalName: "other.py",
        })),
      ProjectSourceWorkspaceError,
    );
    assertEquals(conflict.code, "mutation_id_conflict");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("two instances replaying the same mutation after CAS return the accepted snapshot", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-two-uc-" });
  try {
    const left = cases(new FileProjectSourceWorkspaceStore(`${root}/ws`));
    const right = cases(new FileProjectSourceWorkspaceStore(`${root}/ws`));
    const command = modulePut("m-shared", 0);
    const results = await Promise.allSettled([
      left.putModule(command),
      right.putModule(command),
    ]);
    const accepted = results.filter((item) => item.status === "fulfilled") as Array<
      PromiseFulfilledResult<{ workspaceRevision: number; moduleCount: number }>
    >;
    const rejected = results.filter((item) => item.status === "rejected");
    assertEquals(accepted.length, 2);
    assertEquals(rejected.length, 0);
    for (const item of accepted) {
      assertEquals(item.value.workspaceRevision, 1);
      assertEquals(item.value.moduleCount, 1);
    }
    const other = await assertRejects(
      () => right.putModule(modulePut("m-other", 0, "mod-b", "drive")),
      ProjectSourceWorkspaceError,
    );
    assertEquals(other.code, "stale_revision");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("historical read and tree pagination stay at the requested revision", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-hist-" });
  try {
    const persisted = await persistAgentResourceText(`${root}/cas`, {
      name: "rail.py",
      mimeType: "text/plain",
      text: "print(1)\n",
    });
    const v2 = await persistAgentResourceText(`${root}/cas2`, {
      name: "rail-v2.py",
      mimeType: "text/plain",
      text: "print(2)\n",
    });
    const useCases = cases(
      new FileProjectSourceWorkspaceStore(`${root}/ws`),
      persisted.reopen,
    );
    await useCases.putModule(modulePut("m1", 0));
    await useCases.putFile(filePut("f1", 1, persisted.reference));
    const later = new ProjectSourceWorkspaceUseCases({
      projects: { get: () => Promise.resolve({ id: PROJECT }) },
      workspace: new FileProjectSourceWorkspaceStore(`${root}/ws`),
      resources: v2.reopen,
      ...unusedExternal(),
    });
    await later.putFile(filePut("f2", 2, v2.reference, {
      predecessorFileRevision: 1,
    }));
    const historical = await later.readFile({
      projectId: PROJECT,
      workspaceRevision: 2,
      fileId: "file-rail",
      fileRevision: 1,
    });
    assertEquals(historical.record.kind, "content");
    if (historical.record.kind === "content") {
      assertEquals(historical.record.resourceRef.uri, persisted.reference.uri);
    }
    const tree = await later.tree({
      projectId: PROJECT,
      workspaceRevision: 2,
      moduleId: "mod-a",
      pageSize: 1,
    });
    assertEquals(tree.workspaceRevision, 2);
    assertEquals(tree.entries.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function unusedExternal() {
  return {
    snapshots: {
      get: () => Promise.reject(new Error("snapshots must not be used")),
    },
    traversal: {
      open: () => Promise.reject(new Error("traversal must not be used")),
    },
    roles: {
      accept: () => {
        throw new Error("roles must not be used");
      },
    },
  };
}

function cases(
  workspace: FileProjectSourceWorkspaceStore,
  resources: AgentResourceExactReopener = { reopenExact: () => Promise.resolve({}) },
) {
  return new ProjectSourceWorkspaceUseCases({
    projects: { get: () => Promise.resolve({ id: PROJECT }) },
    workspace,
    resources,
    ...unusedExternal(),
  });
}

function modulePut(
  mutationId: string,
  expected: number,
  moduleId = "mod-a",
  slug = "mech",
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision: expected,
    mutation: {
      kind: "module_put",
      moduleId,
      slug,
      displayName: slug,
    },
  };
}

function filePut(
  mutationId: string,
  expected: number,
  resourceRef: AgentResourceReference,
  overrides: {
    logicalName?: string;
    predecessorFileRevision?: number;
  } = {},
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision: expected,
    mutation: {
      kind: "file_put",
      fileId: "file-rail",
      moduleId: "mod-a",
      logicalName: overrides.logicalName ?? "rail.py",
      role: "script",
      dependencies: [],
      resourceRef,
      ...(overrides.predecessorFileRevision !== undefined
        ? { predecessorFileRevision: overrides.predecessorFileRevision }
        : {}),
    },
  };
}
