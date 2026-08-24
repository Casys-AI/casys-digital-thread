import { assertEquals, assertRejects } from "@std/assert";
import { sampleAgentResourceReference } from "../../testing/agent-resource-test-support.ts";
import {
  PROJECT_SOURCE_CLOSURE_BOUNDS,
  PROJECT_SOURCE_CLOSURE_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  PROJECT_SOURCE_CLOSURE_SCHEMA,
  PROJECT_SOURCE_CLOSURE_URI_PREFIX,
  type ProjectSourceClosure,
  ProjectSourceClosureError,
  type ProjectSourceClosureFile,
  recrossProjectSourceClosure,
  resolveProjectSourceClosure,
  sealProjectSourceClosure,
  validateProjectSourceClosure,
  validateProjectSourceClosureLocator,
} from "./closure.ts";
import {
  applyProjectSourceWorkspaceCommand,
  cloneProjectSourceWorkspaceState,
  emptyProjectSourceWorkspace,
} from "./transitions.ts";
import type {
  ProjectSourceFileRevision,
  ProjectSourceFileRevisionRecord,
  ProjectSourceWorkspaceState,
} from "./types.ts";

const PROJECT = "generic-project";

Deno.test("root-only PartDefinition closure is deterministic and content-addressed", async () => {
  const state = await seedAttached("def-rail", "PartDefinition");
  const first = await resolveProjectSourceClosure(state, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  const second = await resolveProjectSourceClosure(state, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  assertEquals(first.schemaVersion, PROJECT_SOURCE_CLOSURE_SCHEMA);
  assertEquals(first.kind, PROJECT_SOURCE_CLOSURE_KIND);
  assertEquals(first.projectId, PROJECT);
  assertEquals(first.files.length, 1);
  assertEquals(first.edges, []);
  assertEquals(first.root.fileId, "file-root");
  assertEquals(first.attachment.target, {
    elementId: "def-rail",
    elementKind: "PartDefinition",
  });
  assertEquals(first.fingerprint, second.fingerprint);
  const validated = await validateProjectSourceClosure(first);
  assertEquals(validated.fingerprint, first.fingerprint);
});

Deno.test("exact PartUsage attachment is not reduced to a PartDefinition", async () => {
  const state = await seedAttached("usage-rail", "PartUsage");
  const closure = await resolveProjectSourceClosure(state, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  assertEquals(closure.attachment.target, {
    elementId: "usage-rail",
    elementKind: "PartUsage",
  });
});

Deno.test("historical dependency revisions stay in topological order with de-duplication", async () => {
  const state = await seedHistoricalDiamond();
  const closure = await resolveProjectSourceClosure(state, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  assertEquals(
    closure.files.map((file) => `${file.fileId}@${file.fileRevision}`),
    ["file-a@1", "file-b@1", "file-c@1", "file-root@1"],
  );
  assertEquals(closure.edges.map(edgeKey), [
    "file-b@1->file-a@1",
    "file-c@1->file-a@1",
    "file-root@1->file-b@1",
    "file-root@1->file-c@1",
  ]);
  assertEquals(closure.files[0]?.fileRevision, 1);
  assertEquals(closure.root.fileRevision, 1);
});

Deno.test("a later workspace successor of a dependency does not rewrite the sealed historical revision", async () => {
  let state = await seedChain();
  const historicalState = state;
  const historical = await resolveProjectSourceClosure(historicalState, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  state = (await apply(
    state,
    filePut("dep-bump", state.workspaceRevision, {
      fileId: "file-dep",
      predecessorFileRevision: 1,
      logicalName: "dep.py",
      role: "cad-script",
      digest: "2",
    }),
  )).state;
  const recrossed = await recrossProjectSourceClosure(historicalState, historical);
  assertEquals(recrossed.fingerprint, historical.fingerprint);
  assertEquals(recrossed.files.map((file) => `${file.fileId}@${file.fileRevision}`), [
    "file-dep@1",
    "file-root@1",
  ]);
  await assertCode(
    recrossProjectSourceClosure(state, historical),
    "workspace_mismatch",
  );
});

Deno.test("detached, non-head, source-removed and missing event fingerprints fail closed", async () => {
  const active = await seedAttached("def-rail", "PartDefinition");
  await assertCode(
    resolveProjectSourceClosure(active, {
      attachmentId: "att-missing",
      attachmentRevision: 1,
    }),
    "attachment_not_found",
  );

  const detached = (await apply(active, {
    projectId: PROJECT,
    mutationId: "detach",
    expectedWorkspaceRevision: active.workspaceRevision,
    mutation: {
      kind: "attachment_detach",
      attachmentId: "att-root",
      activeAttachmentRevision: 1,
    },
  })).state;
  await assertCode(
    resolveProjectSourceClosure(detached, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "attachment_not_active",
  );

  const successor = (await apply(
    active,
    attachmentPut("att-2", active.workspaceRevision, {
      predecessorAttachmentRevision: 1,
      target: { elementId: "def-other", elementKind: "PartDefinition" },
    }),
  )).state;
  await assertCode(
    resolveProjectSourceClosure(successor, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "attachment_revision_not_head",
  );

  const removed = (await apply(active, {
    projectId: PROJECT,
    mutationId: "remove-root",
    expectedWorkspaceRevision: active.workspaceRevision,
    mutation: {
      kind: "file_remove",
      fileId: "file-root",
      activeFileRevision: 1,
    },
  })).state;
  await assertCode(
    resolveProjectSourceClosure(removed, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "source_removed",
  );

  await assertCode(
    resolveProjectSourceClosure(emptyProjectSourceWorkspace(PROJECT), {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "event_fingerprint_missing",
  );
});

Deno.test("missing, tombstoned and cyclic dependencies fail closed", async () => {
  const chain = await seedChain();
  const missing = replaceRootDependencies(chain, [
    { fileId: "file-dep", fileRevision: 99 },
  ]);
  await assertCode(
    resolveProjectSourceClosure(missing, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "dependency_missing",
  );

  const tomb = replaceRootDependencies(chain, [
    { fileId: "file-dep", fileRevision: 1 },
  ]);
  const dep = tomb.files.get("file-dep")!;
  (dep.revisions as Map<number, ProjectSourceFileRevisionRecord>).set(1, {
    kind: "tombstone",
    fileId: "file-dep",
    fileRevision: 1,
    predecessorFileRevision: 1,
    fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
  });
  await assertCode(
    resolveProjectSourceClosure(tomb, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "dependency_tombstone",
  );

  const cyclic = replaceRootDependencies(chain, [
    { fileId: "file-root", fileRevision: 1 },
  ]);
  await assertCode(
    resolveProjectSourceClosure(cyclic, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "dependency_cycle",
  );
});

Deno.test("server-owned closure bounds are distinct from page size and fail closed", async () => {
  const chain = await seedChain();
  const fanout = replaceRootDependencies(
    chain,
    Array.from({ length: PROJECT_SOURCE_CLOSURE_BOUNDS.maxFanout + 1 }, () => ({
      fileId: "file-dep",
      fileRevision: 1,
    })),
  );
  await assertCode(
    resolveProjectSourceClosure(fanout, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "bound_exceeded",
  );

  const depth = await seedDepth(PROJECT_SOURCE_CLOSURE_BOUNDS.maxDepth + 1);
  await assertCode(
    resolveProjectSourceClosure(depth, {
      attachmentId: "att-root",
      attachmentRevision: 1,
    }),
    "bound_exceeded",
  );
});

Deno.test("tampered closure fingerprint and locator fail closed", async () => {
  const state = await seedAttached("def-rail", "PartDefinition");
  const closure = await resolveProjectSourceClosure(state, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  await assertRejects(
    () =>
      validateProjectSourceClosure({
        ...closure,
        fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      }),
    TypeError,
  );
  const recross = await recrossProjectSourceClosure(state, closure);
  assertEquals(recross.fingerprint, closure.fingerprint);
  await assertCode(
    recrossProjectSourceClosure(state, {
      ...closure,
      fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
    }),
    "closure_mismatch",
  );
  const locator = validateProjectSourceClosureLocator({
    schemaVersion: PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    byteCount: 12,
    casUri: `${PROJECT_SOURCE_CLOSURE_URI_PREFIX}${"a".repeat(64)}`,
  });
  assertEquals(locator.schemaVersion, PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA);
  assertRejectsLocator();
});

Deno.test("validation rejects noncanonical order, duplicates, edge/dep mismatch, fileId mismatch and bounds even when the fingerprint is recomputed", async () => {
  const state = await seedHistoricalDiamond();
  const closure = await resolveProjectSourceClosure(state, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  async function reseal(
    patch: Partial<Omit<typeof closure, "fingerprint">>,
  ) {
    const { fingerprint: _ignored, ...facts } = closure;
    return await sealProjectSourceClosure({ ...facts, ...patch });
  }

  await assertRejects(
    () =>
      reseal({ files: [...closure.files].reverse() }).then(
        validateProjectSourceClosure,
      ),
    TypeError,
    "canonical topological order",
  );
  await assertRejects(
    () =>
      reseal({ edges: [...closure.edges].reverse() }).then(
        validateProjectSourceClosure,
      ),
    TypeError,
    "file.dependencies relation",
  );
  await assertRejects(
    () =>
      reseal({ files: [closure.files[0]!, ...closure.files] }).then(
        validateProjectSourceClosure,
      ),
    TypeError,
    "duplicates",
  );
  await assertRejects(
    () =>
      reseal({ edges: [...closure.edges, closure.edges[0]!] }).then(
        validateProjectSourceClosure,
      ),
    TypeError,
    "duplicates",
  );
  await assertRejects(
    () =>
      reseal({
        attachment: { ...closure.attachment, fileId: "file-other" },
      }).then(validateProjectSourceClosure),
    TypeError,
    "attachment.fileId",
  );
  await assertRejects(
    () => reseal({ edges: [] }).then(validateProjectSourceClosure),
    TypeError,
    "file.dependencies relation",
  );
  const oversized = closure.files.map((file) =>
    file.fileId === "file-root"
      ? {
        ...file,
        dependencies: Array.from(
          { length: PROJECT_SOURCE_CLOSURE_BOUNDS.maxFanout + 1 },
          (_, index) => ({ fileId: `file-pad-${index}`, fileRevision: 1 }),
        ),
      }
      : file
  );
  await assertRejects(
    () =>
      reseal({
        files: [
          ...closure.files.slice(0, 3),
          {
            ...closure.files[0]!,
            fileId: "file-extra",
            dependencies: [],
          },
          closure.files[3]!,
        ],
      }).then(validateProjectSourceClosure),
    TypeError,
    "reachable from the root",
  );
  await assertRejects(
    () => reseal({ files: oversized }).then(validateProjectSourceClosure),
    TypeError,
    "fan-out bound",
  );
});

Deno.test("validation walks overlapping paths in bounded time and still enforces max depth", async () => {
  const state = await seedAttached("def-rail", "PartDefinition");
  const template = await resolveProjectSourceClosure(state, {
    attachmentId: "att-root",
    attachmentRevision: 1,
  });
  const overlapping = overlappingDagFacts(template, 40, 2);
  const sealed = await sealProjectSourceClosure(overlapping);
  const validated = await validateProjectSourceClosure(sealed);
  assertEquals(validated.files.length, 1 + 40 * 2);
  const tooDeep = overlappingDagFacts(
    template,
    PROJECT_SOURCE_CLOSURE_BOUNDS.maxDepth + 1,
    2,
  );
  await assertRejects(
    () => sealProjectSourceClosure(tooDeep).then(validateProjectSourceClosure),
    TypeError,
    "depth bound",
  );
});

function overlappingDagFacts(
  template: ProjectSourceClosure,
  layers: number,
  width: number,
): Omit<ProjectSourceClosure, "fingerprint"> {
  const prototype = template.files[0]!;
  const layerId = (layer: number, index: number) =>
    `file-l${String(layer).padStart(2, "0")}-w${index}`;
  const files: ProjectSourceClosureFile[] = [];
  for (let layer = layers - 1; layer >= 0; layer -= 1) {
    for (let index = 0; index < width; index += 1) {
      files.push(
        dagFile(
          prototype,
          layerId(layer, index),
          layer === layers - 1 ? [] : Array.from({ length: width }, (_, next) => ({
            fileId: layerId(layer + 1, next),
            fileRevision: 1,
          })),
        ),
      );
    }
  }
  files.push(
    dagFile(
      prototype,
      template.root.fileId,
      Array.from({ length: width }, (_, index) => ({
        fileId: layerId(0, index),
        fileRevision: 1,
      })),
    ),
  );
  const edges = files.flatMap((file) =>
    file.dependencies.map((dependency) => ({
      from: { fileId: file.fileId, fileRevision: file.fileRevision },
      to: { fileId: dependency.fileId, fileRevision: dependency.fileRevision },
    }))
  ).sort((left, right) => {
    const fromKey = `${left.from.fileId}@${left.from.fileRevision}`;
    const rightFrom = `${right.from.fileId}@${right.from.fileRevision}`;
    if (fromKey < rightFrom) return -1;
    if (fromKey > rightFrom) return 1;
    const toKey = `${left.to.fileId}@${left.to.fileRevision}`;
    const rightTo = `${right.to.fileId}@${right.to.fileRevision}`;
    return toKey < rightTo ? -1 : toKey > rightTo ? 1 : 0;
  });
  const { fingerprint: _ignored, ...facts } = template;
  return { ...facts, files, edges };
}

function dagFile(
  prototype: ProjectSourceClosureFile,
  fileId: string,
  dependencies: { fileId: string; fileRevision: number }[],
): ProjectSourceClosureFile {
  return {
    fileId,
    fileRevision: 1,
    fingerprint: prototype.fingerprint,
    resourceRef: prototype.resourceRef,
    role: prototype.role,
    ...(prototype.captureRequest === undefined
      ? {}
      : { captureRequest: prototype.captureRequest }),
    dependencies,
  };
}

function assertRejectsLocator(): void {
  let threw = false;
  try {
    validateProjectSourceClosureLocator({
      schemaVersion: "project-source-closure-locator/1.0",
      kind: "project-source-closure-locator",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      byteCount: 12,
      casUri: `casys://technical-source-analysis-capture/sha256/${"a".repeat(64)}`,
    });
  } catch (error) {
    threw = error instanceof TypeError;
  }
  assertEquals(threw, true);
}

async function seedAttached(
  elementId: string,
  elementKind: "PartDefinition" | "PartUsage",
): Promise<ProjectSourceWorkspaceState> {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(state, modulePut("m1", 0))).state;
  state = (await apply(
    state,
    filePut("f-root", 1, {
      fileId: "file-root",
      logicalName: "root.py",
      role: "cad-script",
      digest: "1",
    }),
  )).state;
  return (await apply(
    state,
    attachmentPut("a1", 2, {
      target: { elementId, elementKind },
    }),
  )).state;
}

async function seedChain(): Promise<ProjectSourceWorkspaceState> {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(state, modulePut("m1", 0))).state;
  state = (await apply(
    state,
    filePut("f-dep", 1, {
      fileId: "file-dep",
      logicalName: "dep.py",
      role: "cad-script",
      digest: "1",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("f-root", 2, {
      fileId: "file-root",
      logicalName: "root.py",
      role: "cad-script",
      digest: "a",
      dependencies: [{ fileId: "file-dep", fileRevision: 1 }],
    }),
  )).state;
  return (await apply(state, attachmentPut("a1", 3))).state;
}

function replaceRootDependencies(
  state: ProjectSourceWorkspaceState,
  dependencies: { fileId: string; fileRevision: number }[],
): ProjectSourceWorkspaceState {
  const cloned = cloneProjectSourceWorkspaceState(state);
  const file = cloned.files.get("file-root")!;
  const record = file.revisions.get(file.headRevision)! as ProjectSourceFileRevision;
  (file.revisions as Map<number, ProjectSourceFileRevisionRecord>).set(
    file.headRevision,
    { ...record, dependencies },
  );
  return cloned;
}

async function seedHistoricalDiamond(): Promise<ProjectSourceWorkspaceState> {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(state, modulePut("m1", 0))).state;
  state = (await apply(
    state,
    filePut("fa", 1, {
      fileId: "file-a",
      logicalName: "a.py",
      role: "cad-script",
      digest: "1",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fb", 2, {
      fileId: "file-b",
      logicalName: "b.py",
      role: "cad-script",
      digest: "2",
      dependencies: [{ fileId: "file-a", fileRevision: 1 }],
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fc", 3, {
      fileId: "file-c",
      logicalName: "c.py",
      role: "cad-script",
      digest: "3",
      dependencies: [{ fileId: "file-a", fileRevision: 1 }],
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fr", 4, {
      fileId: "file-root",
      logicalName: "root.py",
      role: "cad-script",
      digest: "4",
      dependencies: [
        { fileId: "file-b", fileRevision: 1 },
        { fileId: "file-c", fileRevision: 1 },
      ],
    }),
  )).state;
  return (await apply(state, attachmentPut("a1", 5))).state;
}

async function seedDepth(depth: number): Promise<ProjectSourceWorkspaceState> {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(state, modulePut("m1", 0))).state;
  let previousId = "file-leaf";
  state = (await apply(
    state,
    filePut("f-leaf", 1, {
      fileId: previousId,
      logicalName: "leaf.py",
      role: "cad-script",
      digest: "1",
    }),
  )).state;
  for (let index = 1; index <= depth; index += 1) {
    const fileId = index === depth ? "file-root" : `file-mid-${index}`;
    state = (await apply(
      state,
      filePut(`f-mid-${index}`, state.workspaceRevision, {
        fileId,
        logicalName: `${fileId}.py`,
        role: "cad-script",
        digest: (index + 1).toString(16),
        dependencies: [{ fileId: previousId, fileRevision: 1 }],
      }),
    )).state;
    previousId = fileId;
  }
  return (await apply(
    state,
    attachmentPut("a1", state.workspaceRevision),
  )).state;
}

function modulePut(mutationId: string, expectedWorkspaceRevision: number) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "module_put" as const,
      moduleId: "mod-a",
      slug: "src",
      displayName: "Sources",
    },
  };
}

function filePut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  mutation: {
    fileId: string;
    logicalName: string;
    role: string;
    digest: string;
    predecessorFileRevision?: number;
    dependencies?: { fileId: string; fileRevision: number }[];
  },
) {
  const digest = mutation.digest.padStart(64, "c");
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "file_put" as const,
      fileId: mutation.fileId,
      moduleId: "mod-a",
      logicalName: mutation.logicalName,
      role: mutation.role,
      dependencies: mutation.dependencies ?? [],
      resourceRef: sampleAgentResourceReference({
        name: mutation.logicalName,
        mimeType: "text/x-python",
        fingerprint: { algorithm: "sha256", digest },
        uri: `casys://agent-resource-capture/sha256/${digest}`,
      }),
      captureRequest: { profileId: "build123d-closed-subset-v1" },
      ...(mutation.predecessorFileRevision === undefined
        ? {}
        : { predecessorFileRevision: mutation.predecessorFileRevision }),
    },
  };
}

function attachmentPut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  overrides: {
    predecessorAttachmentRevision?: number;
    target?: { elementId: string; elementKind: "PartDefinition" | "PartUsage" };
  } = {},
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "attachment_put" as const,
      attachmentId: "att-root",
      fileId: "file-root",
      role: { id: "design-source", version: 1 },
      target: overrides.target ?? {
        elementId: "def-rail",
        elementKind: "PartDefinition" as const,
      },
      declaredAgainst: {
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
      },
      ...(overrides.predecessorAttachmentRevision === undefined ? {} : {
        predecessorAttachmentRevision: overrides.predecessorAttachmentRevision,
      }),
    },
  };
}

async function apply(
  state: ProjectSourceWorkspaceState,
  command: unknown,
) {
  return await applyProjectSourceWorkspaceCommand(state, command);
}

function edgeKey(edge: {
  from: { fileId: string; fileRevision: number };
  to: { fileId: string; fileRevision: number };
}): string {
  return `${edge.from.fileId}@${edge.from.fileRevision}->${edge.to.fileId}@${edge.to.fileRevision}`;
}

async function assertCode(
  promise: Promise<unknown>,
  code: ProjectSourceClosureError["code"],
) {
  const error = await assertRejects(() => promise, ProjectSourceClosureError);
  assertEquals(error.code, code);
}
