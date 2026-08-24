import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectSourceWorkspaceUseCase } from "../../application/ports/in/project-source-workspace/project-source-workspace.ts";
import { AGENT_RESOURCE_REFERENCE_SCHEMA } from "../../domain/resource/agent-resource-reference.ts";
import { PROJECT_SOURCE_WORKSPACE_BOUNDS } from "../../domain/project-source-workspace/types.ts";
import {
  FINGERPRINT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectSourceWorkspaceToolDependencies {
  sourceWorkspace?: ProjectSourceWorkspaceUseCase;
}

const WORKSPACE_MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
} as const;

const SLUG_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxSlugLength,
  pattern: "^[a-z][a-z0-9_-]*$",
} as const;

const LOGICAL_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxLogicalNameLength,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
} as const;

const CLASSIFICATION_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxSlugLength,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
} as const;

const MUTATION_ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
  description:
    "Project-scoped mutation identity. Replay the same id with the same command after acknowledgement loss.",
} as const;

const EXPECTED_WORKSPACE_REVISION = {
  type: "integer",
  minimum: 0,
  description: "Exact workspace revision. 0 is the empty workspace. latest is refused.",
} as const;

const WORKSPACE_REVISION = {
  type: "integer",
  minimum: 0,
  description: "Exact workspace revision to read. latest is refused.",
} as const;

const PAGE_SIZE = {
  type: "integer",
  minimum: 1,
  maximum: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxPageSize,
} as const;

const FILE_REVISION_REF = {
  type: "object",
  properties: {
    fileId: ID_SCHEMA,
    fileRevision: { type: "integer", minimum: 1 },
  },
  required: ["fileId", "fileRevision"],
  additionalProperties: false,
} as const;

const CAPTURE_REQUEST = {
  type: "object",
  properties: {
    profileId: {
      ...ID_SCHEMA,
      description:
        "Caller-authored requested parser/policy identity. Vertical 1 stores it inertly and grants nothing. Not compilation, runtime, provider, tool, image selection, or a registered profile lookup.",
    },
    sourceId: {
      ...ID_SCHEMA,
      description:
        "Caller-authored requested source identity. Grants nothing. Vertical 2 will resolve the pair fail-closed against the registry.",
    },
  },
  required: ["profileId", "sourceId"],
  additionalProperties: false,
} as const;

const SNAPSHOT_OUTPUT = {
  type: "object",
  properties: {
    schemaVersion: { const: "project-source-workspace-snapshot/1.0" },
    projectId: PROJECT_ID,
    workspaceRevision: WORKSPACE_REVISION,
    lastEventFingerprint: {
      anyOf: [FINGERPRINT_SCHEMA, { type: "null" }],
    },
    rootModuleIds: { type: "array", items: ID_SCHEMA },
    moduleCount: { type: "integer", minimum: 0 },
    activeFileCount: { type: "integer", minimum: 0 },
    grants: { const: "none" },
  },
  required: [
    "schemaVersion",
    "projectId",
    "workspaceRevision",
    "lastEventFingerprint",
    "rootModuleIds",
    "moduleCount",
    "activeFileCount",
    "grants",
  ],
  additionalProperties: false,
} as const;

const TREE_ENTRY = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "module" },
        id: ID_SCHEMA,
        name: SLUG_SCHEMA,
        derivedPath: {
          type: "string",
          minLength: 1,
          maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDerivedPathLength,
        },
        domain: CLASSIFICATION_SCHEMA,
      },
      required: ["kind", "id", "name", "derivedPath"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "file" },
        id: ID_SCHEMA,
        name: LOGICAL_NAME_SCHEMA,
        derivedPath: {
          type: "string",
          minLength: 1,
          maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDerivedPathLength,
        },
        role: CLASSIFICATION_SCHEMA,
        fileRevision: { type: "integer", minimum: 1 },
      },
      required: ["kind", "id", "name", "derivedPath", "role", "fileRevision"],
      additionalProperties: false,
    },
  ],
} as const;

const TREE_OUTPUT = {
  type: "object",
  properties: {
    workspaceRevision: WORKSPACE_REVISION,
    entries: { type: "array", items: TREE_ENTRY },
    nextCursor: {
      anyOf: [
        {
          type: "string",
          minLength: 1,
          maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
        },
        { type: "null" },
      ],
    },
    grants: { const: "none" },
  },
  required: ["workspaceRevision", "entries", "nextCursor", "grants"],
  additionalProperties: false,
} as const;

const SEARCH_HIT = {
  type: "object",
  properties: {
    fileId: ID_SCHEMA,
    fileRevision: { type: "integer", minimum: 1 },
    moduleId: ID_SCHEMA,
    logicalName: LOGICAL_NAME_SCHEMA,
    derivedPath: {
      type: "string",
      minLength: 1,
      maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDerivedPathLength,
    },
    role: CLASSIFICATION_SCHEMA,
    domain: CLASSIFICATION_SCHEMA,
    captureRequest: CAPTURE_REQUEST,
    fingerprint: FINGERPRINT_SCHEMA,
  },
  required: [
    "fileId",
    "fileRevision",
    "moduleId",
    "logicalName",
    "derivedPath",
    "role",
    "fingerprint",
  ],
  additionalProperties: false,
} as const;

const SEARCH_OUTPUT = {
  type: "object",
  properties: {
    workspaceRevision: WORKSPACE_REVISION,
    entries: { type: "array", items: SEARCH_HIT },
    nextCursor: {
      anyOf: [
        {
          type: "string",
          minLength: 1,
          maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
        },
        { type: "null" },
      ],
    },
    grants: { const: "none" },
  },
  required: ["workspaceRevision", "entries", "nextCursor", "grants"],
  additionalProperties: false,
} as const;

const CONTENT_RECORD = {
  type: "object",
  properties: {
    kind: { const: "content" },
    fileId: ID_SCHEMA,
    fileRevision: { type: "integer", minimum: 1 },
    predecessorFileRevision: { type: "integer", minimum: 1 },
    resourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    moduleId: ID_SCHEMA,
    logicalName: LOGICAL_NAME_SCHEMA,
    role: CLASSIFICATION_SCHEMA,
    captureRequest: CAPTURE_REQUEST,
    dependencies: {
      type: "array",
      maxItems: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDependencyFanout,
      items: FILE_REVISION_REF,
    },
    fingerprint: FINGERPRINT_SCHEMA,
  },
  required: [
    "kind",
    "fileId",
    "fileRevision",
    "resourceRef",
    "moduleId",
    "logicalName",
    "role",
    "dependencies",
    "fingerprint",
  ],
  additionalProperties: false,
} as const;

const TOMBSTONE_RECORD = {
  type: "object",
  properties: {
    kind: { const: "tombstone" },
    fileId: ID_SCHEMA,
    fileRevision: { type: "integer", minimum: 1 },
    predecessorFileRevision: { type: "integer", minimum: 1 },
    fingerprint: FINGERPRINT_SCHEMA,
  },
  required: [
    "kind",
    "fileId",
    "fileRevision",
    "predecessorFileRevision",
    "fingerprint",
  ],
  additionalProperties: false,
} as const;

const FILE_READ_OUTPUT = {
  type: "object",
  properties: {
    workspaceRevision: WORKSPACE_REVISION,
    derivedPath: {
      anyOf: [
        {
          type: "string",
          minLength: 1,
          maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDerivedPathLength,
        },
        { type: "null" },
      ],
    },
    record: {
      oneOf: [CONTENT_RECORD, TOMBSTONE_RECORD],
    },
    grants: { const: "none" },
  },
  required: ["workspaceRevision", "derivedPath", "record", "grants"],
  additionalProperties: false,
} as const;

export function registerProjectSourceWorkspaceTools(
  app: McpApp,
  dependencies: ProjectSourceWorkspaceToolDependencies,
): void {
  if (!dependencies.sourceWorkspace) return;
  const workspace = dependencies.sourceWorkspace;

  app.registerTool(projectSourceModulePutTool, async (args) => {
    const snapshot = await workspace.putModule(modulePutCommand(args));
    return {
      content: `Source module ${
        String(args.moduleId)
      } is recorded at workspace revision ${snapshot.workspaceRevision}. This is draft authoring state only: grants none, and it is not Thread evidence, admission or execution authority.`,
      structuredContent: snapshot as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectSourceFilePutTool, async (args) => {
    const snapshot = await workspace.putFile(filePutCommand(args));
    return {
      content: `Source file ${
        String(args.fileId)
      } is recorded at workspace revision ${snapshot.workspaceRevision} after reopening the exact agent resource. Grants none. Bytes stay in draft CAS; this is not capture, admission or execution.`,
      structuredContent: snapshot as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectSourceFileRemoveTool, async (args) => {
    const snapshot = await workspace.removeFile(fileRemoveCommand(args));
    return {
      content: `Source file ${
        String(args.fileId)
      } is tombstoned at workspace revision ${snapshot.workspaceRevision}. History and CAS bytes remain. Grants none.`,
      structuredContent: snapshot as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectSourceWorkspaceSnapshotTool, async (args) => {
    const snapshot = await workspace.snapshot(args);
    return {
      content:
        `Project source workspace ${snapshot.projectId} is at revision ${snapshot.workspaceRevision}. Draft authoring state only; grants none.`,
      structuredContent: snapshot as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectSourceTreeTool, async (args) => {
    const page = await workspace.tree(args);
    return {
      content:
        `Source tree page at workspace revision ${page.workspaceRevision} has ${page.entries.length} entries. Grants none.`,
      structuredContent: page as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectSourceSearchTool, async (args) => {
    const page = await workspace.search(args);
    return {
      content:
        `Source search page at workspace revision ${page.workspaceRevision} has ${page.entries.length} entries. Grants none.`,
      structuredContent: page as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectSourceFileReadTool, async (args) => {
    const read = await workspace.readFile(args);
    const identity = `Source file ${String(args.fileId)}@${
      String(args.fileRevision)
    } was read at workspace revision ${read.workspaceRevision}.`;
    const body = read.record.kind === "content"
      ? `${identity} Content revision. Read bytes through resources/read on the AgentResourceReference. Grants none.`
      : `${identity} Tombstone revision. No bytes; history remains and this read does not grant resources/read. Grants none.`;
    return {
      content: body,
      structuredContent: read as unknown as Record<string, unknown>,
    };
  });
}

const projectSourceModulePutTool: MCPTool = {
  name: "project_source_module_put",
  description:
    "Create or revise one stable project source module after checking the exact workspace revision. Draft authoring only. Grants none. Not Thread evidence, admission, provider, runtime or path authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      mutationId: MUTATION_ID,
      expectedWorkspaceRevision: EXPECTED_WORKSPACE_REVISION,
      moduleId: ID_SCHEMA,
      parentModuleId: ID_SCHEMA,
      slug: SLUG_SCHEMA,
      displayName: {
        type: "string",
        minLength: 1,
        maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDisplayNameLength,
      },
      domain: CLASSIFICATION_SCHEMA,
    },
    required: [
      "projectId",
      "mutationId",
      "expectedWorkspaceRevision",
      "moduleId",
      "slug",
      "displayName",
    ],
    additionalProperties: false,
  },
  outputSchema: SNAPSHOT_OUTPUT,
  annotations: WORKSPACE_MUTATION_ANNOTATIONS,
};

const projectSourceFilePutTool: MCPTool = {
  name: "project_source_file_put",
  description:
    "Create or revise one project source file after reopening a full AgentResourceReference from project_resource_capture. Caller supplies no path. Optional captureRequest is caller-authored parser/source identity, stored inertly; Vertical 1 does not register or resolve it. Never compilation or runtime selection. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      mutationId: MUTATION_ID,
      expectedWorkspaceRevision: EXPECTED_WORKSPACE_REVISION,
      fileId: ID_SCHEMA,
      predecessorFileRevision: { type: "integer", minimum: 1 },
      moduleId: ID_SCHEMA,
      logicalName: LOGICAL_NAME_SCHEMA,
      role: CLASSIFICATION_SCHEMA,
      dependencies: {
        type: "array",
        maxItems: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDependencyFanout,
        items: FILE_REVISION_REF,
      },
      captureRequest: CAPTURE_REQUEST,
      resourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    },
    required: [
      "projectId",
      "mutationId",
      "expectedWorkspaceRevision",
      "fileId",
      "moduleId",
      "logicalName",
      "role",
      "dependencies",
      "resourceRef",
    ],
    additionalProperties: false,
  },
  outputSchema: SNAPSHOT_OUTPUT,
  annotations: WORKSPACE_MUTATION_ANNOTATIONS,
};

const projectSourceFileRemoveTool: MCPTool = {
  name: "project_source_file_remove",
  description:
    "Record an explicit tombstone for one active source file at an exact workspace revision. History and CAS bytes remain. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      mutationId: MUTATION_ID,
      expectedWorkspaceRevision: EXPECTED_WORKSPACE_REVISION,
      fileId: ID_SCHEMA,
      activeFileRevision: { type: "integer", minimum: 1 },
    },
    required: [
      "projectId",
      "mutationId",
      "expectedWorkspaceRevision",
      "fileId",
      "activeFileRevision",
    ],
    additionalProperties: false,
  },
  outputSchema: SNAPSHOT_OUTPUT,
  annotations: WORKSPACE_MUTATION_ANNOTATIONS,
};

const projectSourceWorkspaceSnapshotTool: MCPTool = {
  name: "project_source_workspace_snapshot",
  description:
    "Read workspace identity, exact revision, roots and counts. Does not inline every file and is not product evidence. Grants none.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: SNAPSHOT_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectSourceTreeTool: MCPTool = {
  name: "project_source_tree",
  description:
    "List immediate children of one module at an exact workspace revision. Bounded page size. A mismatched cursor fails closed. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      workspaceRevision: WORKSPACE_REVISION,
      moduleId: ID_SCHEMA,
      pageSize: PAGE_SIZE,
      cursor: {
        type: "string",
        minLength: 1,
        maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
      },
    },
    required: ["projectId", "workspaceRevision"],
    additionalProperties: false,
  },
  outputSchema: TREE_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectSourceSearchTool: MCPTool = {
  name: "project_source_search",
  description:
    "Search one exact workspace revision by derived path prefix, module, domain, role or requested capture identity. Paginated. A mismatched cursor fails closed. profileId filters captureRequest.profileId; it is not a registry lookup. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      workspaceRevision: WORKSPACE_REVISION,
      pathPrefix: {
        type: "string",
        minLength: 1,
        maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDerivedPathLength,
        pattern: "^/",
        description:
          "Derived POSIX path prefix. It starts with '/', for example /product/mechanics.",
      },
      moduleId: ID_SCHEMA,
      domain: CLASSIFICATION_SCHEMA,
      role: CLASSIFICATION_SCHEMA,
      profileId: {
        ...ID_SCHEMA,
        description:
          "Filter by the caller-authored captureRequest.profileId. Not a registered profile lookup.",
      },
      sourceId: ID_SCHEMA,
      pageSize: PAGE_SIZE,
      cursor: {
        type: "string",
        minLength: 1,
        maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
      },
    },
    required: ["projectId", "workspaceRevision"],
    additionalProperties: false,
  },
  outputSchema: SEARCH_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectSourceFileReadTool: MCPTool = {
  name: "project_source_file_read",
  description:
    "Read metadata for one exact file revision at one exact workspace revision. A content revision includes the full AgentResourceReference; bytes are read through resources/read. A tombstone has no bytes. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      workspaceRevision: WORKSPACE_REVISION,
      fileId: ID_SCHEMA,
      fileRevision: { type: "integer", minimum: 1 },
    },
    required: ["projectId", "workspaceRevision", "fileId", "fileRevision"],
    additionalProperties: false,
  },
  outputSchema: FILE_READ_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

function modulePutCommand(args: Record<string, unknown>): unknown {
  return {
    projectId: args.projectId,
    mutationId: args.mutationId,
    expectedWorkspaceRevision: args.expectedWorkspaceRevision,
    mutation: {
      kind: "module_put",
      moduleId: args.moduleId,
      slug: args.slug,
      displayName: args.displayName,
      ...(args.parentModuleId === undefined
        ? {}
        : { parentModuleId: args.parentModuleId }),
      ...(args.domain === undefined ? {} : { domain: args.domain }),
    },
  };
}

function filePutCommand(args: Record<string, unknown>): unknown {
  return {
    projectId: args.projectId,
    mutationId: args.mutationId,
    expectedWorkspaceRevision: args.expectedWorkspaceRevision,
    mutation: {
      kind: "file_put",
      fileId: args.fileId,
      moduleId: args.moduleId,
      logicalName: args.logicalName,
      role: args.role,
      dependencies: args.dependencies ?? [],
      resourceRef: args.resourceRef,
      ...(args.predecessorFileRevision === undefined
        ? {}
        : { predecessorFileRevision: args.predecessorFileRevision }),
      ...(args.captureRequest === undefined
        ? {}
        : { captureRequest: args.captureRequest }),
    },
  };
}

function fileRemoveCommand(args: Record<string, unknown>): unknown {
  return {
    projectId: args.projectId,
    mutationId: args.mutationId,
    expectedWorkspaceRevision: args.expectedWorkspaceRevision,
    mutation: {
      kind: "file_remove",
      fileId: args.fileId,
      activeFileRevision: args.activeFileRevision,
    },
  };
}
