/**
 * Lean MCP read tools for SysML-first product navigation.
 *
 * Lean composable queries, not one dump. Workbench remains GET/SSE only.
 * Source bytes stay on project_source_* / project_resource_capture.
 */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProductNavigationUseCase } from "../../application/ports/in/product-navigation/product-navigation.ts";
import { PROJECT_ID, READ_ONLY_ANNOTATIONS } from "./mcp-tool-schemas.ts";

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
      fileId: String(args.fileId),
      fileRevision: Number(args.fileRevision),
    });
    return {
      content: contentFor(result.status, "source closure"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
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
    "Read the technical dependency closure of one source file after it is an exact attachment of a selected SysML node. Name projectId, the semantic node, fileId and fileRevision from context attachments. The server recrosses the current architecture and workspace; a file that is not attached stays unattached. The workspace DAG is not product navigation. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      node: NODE_QUERY,
      fileId: ELEMENT_ID,
      fileRevision: { type: "integer", minimum: 1 },
    },
    required: ["projectId", "node", "fileId", "fileRevision"],
    additionalProperties: false,
  },
  outputSchema: QUERY_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};
