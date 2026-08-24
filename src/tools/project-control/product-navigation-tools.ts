/**
 * Lean MCP read tools for SysML-first product navigation.
 *
 * Lean composable queries, not one dump. Workbench remains GET/SSE only.
 * Source bytes stay on project_source_* / project_resource_capture.
 */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProductNavigationUseCase } from "../../application/ports/in/product-navigation/product-navigation.ts";
import { PROJECT_SOURCE_WORKSPACE_BOUNDS } from "../../domain/project-source-workspace/types.ts";
import {
  FINGERPRINT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
  THREAD_SNAPSHOT_REF_SCHEMA,
} from "./mcp-tool-schemas.ts";

export interface ProjectProductNavigationToolDependencies {
  productNavigation?: ProductNavigationUseCase;
}

const NODE_KIND = {
  type: "string",
  enum: ["part-definition", "part-usage"],
} as const;

const ELEMENT_ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
} as const;

const NODE_QUERY = {
  type: "object",
  properties: {
    kind: NODE_KIND,
    id: ELEMENT_ID,
    path: {
      type: "array",
      items: ELEMENT_ID,
      maxItems: 32,
      description:
        "Exact PartUsage occurrence path from the system root. Required for a PartUsage. latest is refused.",
    },
  },
  required: ["kind", "id"],
  additionalProperties: false,
} as const;

const BASIS = {
  type: "object",
  properties: {
    projectId: PROJECT_ID,
    threadSnapshotId: ELEMENT_ID,
    threadRevision: { type: "integer", minimum: 1 },
    architectureArtifactId: ELEMENT_ID,
    architectureFingerprint: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    captureSchema: { const: "architecture-capture/4.0" },
  },
  required: [
    "projectId",
    "threadSnapshotId",
    "threadRevision",
    "architectureArtifactId",
    "architectureFingerprint",
    "captureSchema",
  ],
  additionalProperties: false,
} as const;

export function registerProjectProductNavigationTools(
  app: McpApp,
  dependencies: ProjectProductNavigationToolDependencies,
): void {
  if (!dependencies.productNavigation) return;
  const navigation = dependencies.productNavigation;

  app.registerTool(projectProductNavigationRootsTool, async (args) => {
    const result = await navigation.roots({
      projectId: String(args.projectId),
    });
    return {
      content: contentFor(result.status, "roots"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductNavigationChildrenTool, async (args) => {
    const result = await navigation.children({
      projectId: String(args.projectId),
      node: nodeArg(args.node),
    });
    return {
      content: contentFor(result.status, "children"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductNavigationPathTool, async (args) => {
    const result = await navigation.path({
      projectId: String(args.projectId),
      usagePath: usagePathArg(args.usagePath),
    });
    return {
      content: contentFor(result.status, "path"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductNavigationSearchTool, async (args) => {
    const result = await navigation.search({
      projectId: String(args.projectId),
      id: String(args.id),
    });
    return {
      content: contentFor(result.status, "search"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductNavigationNeighborhoodTool, async (args) => {
    const result = await navigation.neighborhood({
      projectId: String(args.projectId),
      node: nodeArg(args.node),
    });
    return {
      content: contentFor(result.status, "neighborhood"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductNavigationContextTool, async (args) => {
    const result = await navigation.context({
      projectId: String(args.projectId),
      node: nodeArg(args.node),
    });
    return {
      content: contentFor(result.status, "context"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductSourceClosureTool, async (args) => {
    const result = await navigation.sourceClosure({
      projectId: String(args.projectId),
      node: nodeArg(args.node),
      workspaceRevision: Number(args.workspaceRevision),
      attachmentId: String(args.attachmentId),
      attachmentRevision: Number(args.attachmentRevision),
    });
    return {
      content: contentFor(result.status, "source closure"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(
    projectProductNavigationAuthoringAttachmentsTool,
    async (args) => {
      const result = await navigation.authoringAttachments({
        projectId: String(args.projectId),
        node: nodeArg(args.node),
        ...(args.pageSize === undefined ? {} : { pageSize: Number(args.pageSize) }),
        ...(args.cursor === undefined ? {} : { cursor: String(args.cursor) }),
      });
      return {
        content: contentFor(result.status, "authoring attachments"),
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}

function nodeArg(value: unknown): {
  kind: "part-definition" | "part-usage";
  id: string;
  path?: readonly string[];
} {
  const node = value as {
    kind: "part-definition" | "part-usage";
    id: string;
    path?: readonly string[];
  };
  return {
    kind: node.kind,
    id: node.id,
    ...(node.path ? { path: node.path } : {}),
  };
}

function usagePathArg(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function contentFor(status: string, surface: string): string {
  if (status === "observed") {
    return `Product ${surface} recrossed the exact current architecture-capture/4.0 basis. Grants none.`;
  }
  return `Product ${surface} is ${status}. The exact architecture basis is required; latest and labels are refused. Grants none.`;
}

const QUERY_OUTPUT = {
  type: "object",
  additionalProperties: true,
  properties: {
    schemaVersion: { const: "product-navigation-query/1.0" },
    status: {
      type: "string",
      enum: ["observed", "unavailable", "unattached", "unresolved"],
    },
    basis: BASIS,
  },
  required: ["schemaVersion", "status"],
} as const;

const projectProductNavigationRootsTool: MCPTool = {
  name: "project_product_navigation_roots",
  description:
    "Read the unique current SysML product-structure root for a project. The server selects the unique Thread tip and unique architecture-capture/4.0. The response always publishes that exact basis. latest, labels, providers and runtimes are refused. Grants none. Workbench remains GET/SSE only.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductNavigationChildrenTool: MCPTool = {
  name: "project_product_navigation_children",
  description:
    "Read immediate SysML children of one exact PartDefinition or PartUsage occurrence. Pass the occurrence path for a PartUsage. The server reopens the current architecture-capture/4.0 and republishes that basis. Do not walk the workspace DAG as product structure. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      node: NODE_QUERY,
    },
    required: ["projectId", "node"],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductNavigationPathTool: MCPTool = {
  name: "project_product_navigation_path",
  description:
    "Read the exact SysML occurrence path from the system root through named PartUsage identities. An empty path is the unique system PartDefinition. A foreign or out-of-order usage stays unattached. The server reopens the current architecture-capture/4.0 and republishes that basis. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      usagePath: {
        type: "array",
        items: ELEMENT_ID,
        maxItems: 32,
        description:
          "Exact PartUsage occurrence path from the system root. Empty is the root. latest is refused.",
      },
    },
    required: ["projectId", "usagePath"],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductNavigationSearchTool: MCPTool = {
  name: "project_product_navigation_search",
  description:
    "Locate one exact SysML element id in the current architecture-capture/4.0. A reused PartDefinition returns every occurrence path. Labels are not searched. latest is refused. Grants none. Compose with project_product_navigation_context and project_source_file_read; do not add SysON tools.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      id: ELEMENT_ID,
    },
    required: ["projectId", "id"],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductNavigationNeighborhoodTool: MCPTool = {
  name: "project_product_navigation_neighborhood",
  description:
    "Read parent, siblings and immediate children of one exact SysML node. Pass the occurrence path for a PartUsage. The server reopens the current architecture-capture/4.0 and republishes that basis. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      node: NODE_QUERY,
    },
    required: ["projectId", "node"],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductNavigationContextTool: MCPTool = {
  name: "project_product_navigation_context",
  description:
    "Read one exact SysML node with attachments grouped as sources, geometry, physics/cases and requirements/verdicts. Empty groups stay unattached. The server reopens the current architecture-capture/4.0 and republishes that basis. Do not parse labels or rationale. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      node: NODE_QUERY,
    },
    required: ["projectId", "node"],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductSourceClosureTool: MCPTool = {
  name: "project_product_source_closure",
  description:
    "Read the technical dependency closure of one versioned authoring attachment. Name projectId, the semantic node, workspaceRevision, attachmentId and attachmentRevision. PartUsage keeps its usage id and is never reduced to a definition. The server recrosses that exact workspace snapshot; a detached, source-removed or foreign-target attachment stays unattached or unavailable. Grants none. Not admission.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      node: NODE_QUERY,
      workspaceRevision: { type: "integer", minimum: 1 },
      attachmentId: ELEMENT_ID,
      attachmentRevision: { type: "integer", minimum: 1 },
    },
    required: [
      "projectId",
      "node",
      "workspaceRevision",
      "attachmentId",
      "attachmentRevision",
    ],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const AUTHORING_ATTACHMENT = {
  type: "object",
  properties: {
    attachmentId: ELEMENT_ID,
    attachmentRevision: { type: "integer", minimum: 1 },
    fingerprint: FINGERPRINT_SCHEMA,
    fileId: ELEMENT_ID,
    fileHeadRevision: {
      anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
    },
    sourceStatus: { enum: ["active", "source-removed"] },
    role: {
      type: "object",
      properties: {
        id: ELEMENT_ID,
        version: { type: "integer", minimum: 1 },
      },
      required: ["id", "version"],
      additionalProperties: false,
    },
    target: {
      type: "object",
      properties: {
        elementId: ELEMENT_ID,
        elementKind: { enum: ["PartDefinition", "PartUsage"] },
      },
      required: ["elementId", "elementKind"],
      additionalProperties: false,
    },
    declaredAgainst: {
      type: "object",
      properties: {
        thread: THREAD_SNAPSHOT_REF_SCHEMA,
        architecture: {
          type: "object",
          properties: {
            artifactId: ELEMENT_ID,
            fingerprint: FINGERPRINT_SCHEMA,
            captureSchema: { const: "architecture-capture/4.0" },
          },
          required: ["artifactId", "fingerprint", "captureSchema"],
          additionalProperties: false,
        },
      },
      required: ["thread", "architecture"],
      additionalProperties: false,
    },
    basisStatus: { enum: ["exact-basis", "different-basis"] },
  },
  required: [
    "attachmentId",
    "attachmentRevision",
    "fingerprint",
    "fileId",
    "fileHeadRevision",
    "sourceStatus",
    "role",
    "target",
    "declaredAgainst",
    "basisStatus",
  ],
  additionalProperties: false,
} as const;

const AUTHORING_ATTACHMENTS_OUTPUT = {
  type: "object",
  properties: {
    schemaVersion: { const: "product-navigation-query/1.0" },
    status: {
      type: "string",
      enum: ["observed", "unavailable", "unattached", "unresolved"],
    },
    basis: BASIS,
    node: {
      type: "object",
      properties: {
        kind: NODE_KIND,
        id: ELEMENT_ID,
        label: { type: "string", minLength: 1 },
        definitionId: ELEMENT_ID,
        usageId: ELEMENT_ID,
        path: { type: "array", items: ELEMENT_ID, maxItems: 32 },
        expandable: { type: "boolean" },
      },
      required: ["kind", "id", "label", "definitionId", "path", "expandable"],
      additionalProperties: false,
    },
    workspaceRevision: { type: "integer", minimum: 0 },
    workspaceEventFingerprint: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    attachments: { type: "array", items: AUTHORING_ATTACHMENT },
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
  required: [
    "schemaVersion",
    "status",
    "node",
    "attachments",
    "nextCursor",
    "grants",
  ],
  additionalProperties: false,
} as const;

const projectProductNavigationAuthoringAttachmentsTool: MCPTool = {
  name: "project_product_navigation_authoring_attachments",
  description:
    "Read versioned ProjectSourceWorkspace authoring attachments of one exact SysML PartDefinition or PartUsage. The server selects the unique current Thread tip and architecture-capture/4.0, then lists active workspace heads for that exact target. Detached identities are omitted; source-removed stays visible. Not Thread evidence, not admission, not source closure. latest, snapshot, workspaceRevision, providers and runtimes are refused. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      node: NODE_QUERY,
      pageSize: {
        type: "integer",
        minimum: 1,
        maximum: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxPageSize,
      },
      cursor: {
        type: "string",
        minLength: 1,
        maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
        not: { const: "latest" },
      },
    },
    required: ["projectId", "node"],
    additionalProperties: false,
  },
  outputSchema: AUTHORING_ATTACHMENTS_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};
