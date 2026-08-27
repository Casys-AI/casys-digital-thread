/**
 * Lean MCP read tools for SysML-first product navigation.
 *
 * Four composable queries. Workbench remains GET/SSE only.
 * Source bytes stay on project_source_* / project_resource_capture.
 */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProductNavigationUseCase } from "../../application/ports/in/product-navigation/product-navigation.ts";
import type {
  ProductNavigationBasis,
  ProductSearchQueryKind,
  ProductStructureSelection,
} from "../../application/ports/in/product-navigation/product-navigation-read-model.ts";
import {
  PRODUCT_EXPLORE_SCHEMA,
  PRODUCT_INSPECT_SCHEMA,
  PRODUCT_NAVIGATION_BOUNDS,
  PRODUCT_SEARCH_SCHEMA,
  PRODUCT_SOURCE_CLOSURE_SCHEMA,
} from "../../application/ports/in/product-navigation/product-navigation-read-model.ts";
import {
  parseProductStructureElementRef,
  parseProductStructureOccurrenceRef,
  type ProductStructureOccurrenceRef,
} from "../../domain/architecture/product-structure-ref.ts";
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

const ELEMENT_ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
} as const;

const ELEMENT_REF = {
  type: "object",
  properties: {
    elementKind: { enum: ["PartDefinition", "PartUsage"] },
    elementId: ELEMENT_ID,
  },
  required: ["elementKind", "elementId"],
  additionalProperties: false,
} as const;

const OCCURRENCE_REF = {
  type: "object",
  properties: {
    element: {
      type: "object",
      properties: {
        elementKind: { const: "PartUsage" },
        elementId: ELEMENT_ID,
      },
      required: ["elementKind", "elementId"],
      additionalProperties: false,
    },
    path: {
      type: "array",
      items: ELEMENT_ID,
      minItems: 1,
    },
  },
  required: ["element", "path"],
  additionalProperties: false,
} as const;

const SELECTION = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "element" },
        element: ELEMENT_REF,
      },
      required: ["kind", "element"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "occurrence" },
        occurrence: OCCURRENCE_REF,
      },
      required: ["kind", "occurrence"],
      additionalProperties: false,
    },
  ],
} as const;

const BASIS = {
  type: "object",
  properties: {
    projectId: PROJECT_ID,
    threadSnapshotId: ELEMENT_ID,
    threadRevision: { type: "integer", minimum: 1 },
    threadSubjectId: ELEMENT_ID,
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
    "threadSubjectId",
    "architectureArtifactId",
    "architectureFingerprint",
    "captureSchema",
  ],
  additionalProperties: false,
} as const;

const PAGE_SIZE = {
  type: "integer",
  minimum: 1,
  maximum: PRODUCT_NAVIGATION_BOUNDS.maxPageSize,
} as const;

const CURSOR = {
  type: "string",
  minLength: 1,
  maxLength: PRODUCT_NAVIGATION_BOUNDS.maxCursorLength,
  not: { const: "latest" },
} as const;

const STATUS = {
  type: "string",
  enum: ["observed", "unavailable", "unattached", "unresolved"],
} as const;

const DIAGNOSTIC = {
  type: "object",
  properties: {
    code: {
      enum: [
        "basis.stale",
        "basis.unavailable",
        "selection.unattached",
        "selection.invalid",
        "selection.expected-basis-required",
        "cursor.mismatch",
        "architecture.unresolved",
      ],
    },
    relation: { type: "string", minLength: 1 },
    recovery: { type: "string", minLength: 1 },
  },
  required: ["code", "relation", "recovery"],
  additionalProperties: false,
} as const;

const NODE = {
  type: "object",
  properties: {
    element: ELEMENT_REF,
    occurrence: OCCURRENCE_REF,
    typedDefinition: ELEMENT_REF,
    label: { type: "string", minLength: 1 },
    expandable: { type: "boolean" },
  },
  required: ["element", "label", "expandable"],
  additionalProperties: false,
} as const;

const SEARCH_HIT = {
  type: "object",
  properties: {
    element: ELEMENT_REF,
    label: { type: "string", minLength: 1 },
    match: { enum: ["exact-id", "label-token", "id-token"] },
  },
  required: ["element", "label", "match"],
  additionalProperties: false,
} as const;

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
    target: ELEMENT_REF,
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

const ATTACHMENT = {
  type: "object",
  properties: {
    group: { enum: ["sources", "geometry", "physics", "requirements"] },
    kind: { enum: ["source-file", "artifact", "requirement"] },
    id: { type: "string", minLength: 1 },
    label: { type: "string" },
  },
  required: ["group", "kind", "id", "label"],
  additionalProperties: false,
} as const;

const ATTACHMENTS = {
  type: "object",
  properties: {
    sources: { type: "array", items: ATTACHMENT },
    geometry: { type: "array", items: ATTACHMENT },
    physics: { type: "array", items: ATTACHMENT },
    requirements: { type: "array", items: ATTACHMENT },
  },
  required: ["sources", "geometry", "physics", "requirements"],
  additionalProperties: false,
} as const;

const READY_ACTION = {
  oneOf: [
    {
      type: "object",
      properties: {
        status: { const: "ready" },
        kind: { const: "read-attachment" },
        tool: { const: "project_source_attachment_read" },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            workspaceRevision: { type: "integer", minimum: 0 },
            attachmentId: ELEMENT_ID,
            attachmentRevision: { type: "integer", minimum: 1 },
          },
          required: [
            "projectId",
            "workspaceRevision",
            "attachmentId",
            "attachmentRevision",
          ],
          additionalProperties: false,
        },
      },
      required: ["status", "kind", "tool", "arguments"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "ready" },
        kind: { const: "read-source-file" },
        tool: { const: "project_source_file_read" },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            workspaceRevision: { type: "integer", minimum: 0 },
            fileId: ELEMENT_ID,
            fileRevision: { type: "integer", minimum: 1 },
          },
          required: [
            "projectId",
            "workspaceRevision",
            "fileId",
            "fileRevision",
          ],
          additionalProperties: false,
        },
      },
      required: ["status", "kind", "tool", "arguments"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "ready" },
        kind: { const: "read-source-closure" },
        tool: { const: "project_source_closure" },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            expectedBasis: BASIS,
            selection: SELECTION,
            workspaceRevision: { type: "integer", minimum: 1 },
            attachmentId: ELEMENT_ID,
            attachmentRevision: { type: "integer", minimum: 1 },
          },
          required: [
            "projectId",
            "expectedBasis",
            "selection",
            "workspaceRevision",
            "attachmentId",
            "attachmentRevision",
          ],
          additionalProperties: false,
        },
      },
      required: ["status", "kind", "tool", "arguments"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "ready" },
        kind: { const: "capture-technical-source" },
        tool: { const: "project_technical_source_capture" },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            workspaceRevision: { type: "integer", minimum: 1 },
            attachmentId: ELEMENT_ID,
            attachmentRevision: { type: "integer", minimum: 1 },
          },
          required: [
            "projectId",
            "workspaceRevision",
            "attachmentId",
            "attachmentRevision",
          ],
          additionalProperties: false,
        },
      },
      required: ["status", "kind", "tool", "arguments"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "ready" },
        kind: { const: "explore-selection" },
        tool: { const: "project_product_explore" },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            expectedBasis: BASIS,
            selection: OCCURRENCE_REF,
          },
          required: ["projectId", "expectedBasis", "selection"],
          additionalProperties: false,
        },
      },
      required: ["status", "kind", "tool", "arguments"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "ready" },
        kind: { const: "inspect-selection" },
        tool: { const: "project_product_inspect" },
        arguments: {
          type: "object",
          properties: {
            projectId: PROJECT_ID,
            expectedBasis: BASIS,
            selection: SELECTION,
          },
          required: ["projectId", "expectedBasis", "selection"],
          additionalProperties: false,
        },
      },
      required: ["status", "kind", "tool", "arguments"],
      additionalProperties: false,
    },
  ],
} as const;

const BLOCKED_ACTION = {
  oneOf: [
    {
      type: "object",
      properties: {
        status: { const: "blocked" },
        kind: {
          enum: [
            "read-attachment",
            "read-source-file",
            "read-source-closure",
            "capture-technical-source",
            "explore-selection",
            "inspect-selection",
          ],
        },
        code: { const: "action.different-basis" },
        recovery: { type: "string", minLength: 1 },
        recoveryAction: {
          type: "object",
          properties: {
            tool: { const: "project_source_attachment_recross" },
            arguments: {
              type: "object",
              properties: {
                projectId: PROJECT_ID,
                expectedWorkspaceRevision: { type: "integer", minimum: 0 },
                attachments: {
                  type: "array",
                  minItems: 1,
                  maxItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      attachmentId: ELEMENT_ID,
                      activeAttachmentRevision: { type: "integer", minimum: 1 },
                    },
                    required: ["attachmentId", "activeAttachmentRevision"],
                    additionalProperties: false,
                  },
                },
              },
              required: [
                "projectId",
                "expectedWorkspaceRevision",
                "attachments",
              ],
              additionalProperties: false,
            },
            callerSupplied: {
              type: "array",
              items: { const: "mutationId" },
              minItems: 1,
              maxItems: 1,
            },
          },
          required: ["tool", "arguments", "callerSupplied"],
          additionalProperties: false,
        },
      },
      required: ["status", "kind", "code", "recovery", "recoveryAction"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "blocked" },
        kind: {
          enum: [
            "read-attachment",
            "read-source-file",
            "read-source-closure",
            "capture-technical-source",
            "explore-selection",
            "inspect-selection",
          ],
        },
        code: { enum: ["action.source-removed", "action.file-head-missing"] },
        recovery: { type: "string", minLength: 1 },
      },
      required: ["status", "kind", "code", "recovery"],
      additionalProperties: false,
    },
  ],
} as const;

const ACTION = { oneOf: [READY_ACTION, BLOCKED_ACTION] } as const;

const CLOSURE_FILE = {
  type: "object",
  properties: {
    fileId: ELEMENT_ID,
    fileRevision: { type: "integer", minimum: 1 },
    role: { type: "string", minLength: 1 },
    resourceUri: { type: "string", minLength: 1 },
    resourceFingerprint: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
  },
  required: [
    "fileId",
    "fileRevision",
    "role",
    "resourceUri",
    "resourceFingerprint",
  ],
  additionalProperties: false,
} as const;

const CLOSURE_EDGE = {
  type: "object",
  properties: {
    from: {
      type: "object",
      properties: {
        fileId: ELEMENT_ID,
        fileRevision: { type: "integer", minimum: 1 },
      },
      required: ["fileId", "fileRevision"],
      additionalProperties: false,
    },
    to: {
      type: "object",
      properties: {
        fileId: ELEMENT_ID,
        fileRevision: { type: "integer", minimum: 1 },
      },
      required: ["fileId", "fileRevision"],
      additionalProperties: false,
    },
  },
  required: ["from", "to"],
  additionalProperties: false,
} as const;

const EXPLORE_OUTPUT = {
  type: "object",
  properties: {
    schemaVersion: { const: PRODUCT_EXPLORE_SCHEMA },
    status: STATUS,
    basis: BASIS,
    diagnostics: { type: "array", items: DIAGNOSTIC },
    focus: NODE,
    breadcrumbs: { type: "array", items: NODE },
    parent: NODE,
    children: { type: "array", items: NODE },
    selections: {
      type: "object",
      properties: {
        focus: SELECTION,
        parent: SELECTION,
        children: { type: "array", items: OCCURRENCE_REF },
      },
      required: ["focus", "children"],
      additionalProperties: false,
    },
    nextCursor: { anyOf: [CURSOR, { type: "null" }] },
    grants: { const: "none" },
  },
  required: [
    "schemaVersion",
    "status",
    "diagnostics",
    "breadcrumbs",
    "children",
    "nextCursor",
    "grants",
  ],
  additionalProperties: false,
} as const;

const SEARCH_OUTPUT = {
  type: "object",
  properties: {
    schemaVersion: { const: PRODUCT_SEARCH_SCHEMA },
    status: STATUS,
    basis: BASIS,
    diagnostics: { type: "array", items: DIAGNOSTIC },
    matches: { type: "array", items: SEARCH_HIT },
    nextCursor: { anyOf: [CURSOR, { type: "null" }] },
    grants: { const: "none" },
  },
  required: [
    "schemaVersion",
    "status",
    "diagnostics",
    "matches",
    "nextCursor",
    "grants",
  ],
  additionalProperties: false,
} as const;

const INSPECT_OUTPUT = {
  type: "object",
  properties: {
    schemaVersion: { const: PRODUCT_INSPECT_SCHEMA },
    status: STATUS,
    basis: BASIS,
    diagnostics: { type: "array", items: DIAGNOSTIC },
    selectedElement: ELEMENT_REF,
    selectedOccurrence: OCCURRENCE_REF,
    typedDefinition: {
      type: "object",
      properties: {
        relation: { const: "typed_by" },
        element: ELEMENT_REF,
        label: { type: "string", minLength: 1 },
      },
      required: ["relation", "element", "label"],
      additionalProperties: false,
    },
    definitionScopedEvidence: {
      type: "object",
      properties: {
        status: { enum: ["observed", "unattached"] },
        relation: { enum: ["typed_by", "selected-element"] },
        definition: ELEMENT_REF,
        attachments: ATTACHMENTS,
      },
      required: ["status", "relation", "definition", "attachments"],
      additionalProperties: false,
    },
    authoringAttachments: {
      type: "object",
      properties: {
        workspaceRevision: { type: "integer", minimum: 0 },
        workspaceEventFingerprint: {
          type: "string",
          pattern: "^sha256:[a-f0-9]{64}$",
        },
        attachments: { type: "array", items: AUTHORING_ATTACHMENT },
        nextCursor: { anyOf: [CURSOR, { type: "null" }] },
      },
      required: ["attachments", "nextCursor"],
      additionalProperties: false,
    },
    occurrences: {
      type: "object",
      properties: {
        occurrences: { type: "array", items: NODE },
        nextCursor: { anyOf: [CURSOR, { type: "null" }] },
      },
      required: ["occurrences", "nextCursor"],
      additionalProperties: false,
    },
    applicableActions: { type: "array", items: ACTION },
    grants: { const: "none" },
  },
  required: [
    "schemaVersion",
    "status",
    "diagnostics",
    "authoringAttachments",
    "occurrences",
    "applicableActions",
    "grants",
  ],
  additionalProperties: false,
} as const;

const CLOSURE_OUTPUT = {
  type: "object",
  properties: {
    schemaVersion: { const: PRODUCT_SOURCE_CLOSURE_SCHEMA },
    status: STATUS,
    basis: BASIS,
    diagnostics: { type: "array", items: DIAGNOSTIC },
    workspaceRevision: { type: "integer", minimum: 0 },
    workspaceEventFingerprint: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    attachmentId: ELEMENT_ID,
    attachmentRevision: { type: "integer", minimum: 1 },
    closureFingerprint: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    entries: {
      type: "array",
      maxItems: PRODUCT_NAVIGATION_BOUNDS.maxPageSize,
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "file" },
              fileId: CLOSURE_FILE.properties.fileId,
              fileRevision: CLOSURE_FILE.properties.fileRevision,
              role: CLOSURE_FILE.properties.role,
              resourceUri: CLOSURE_FILE.properties.resourceUri,
              resourceFingerprint: CLOSURE_FILE.properties.resourceFingerprint,
            },
            required: [
              "kind",
              "fileId",
              "fileRevision",
              "role",
              "resourceUri",
              "resourceFingerprint",
            ],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "edge" },
              from: CLOSURE_EDGE.properties.from,
              to: CLOSURE_EDGE.properties.to,
            },
            required: ["kind", "from", "to"],
            additionalProperties: false,
          },
        ],
      },
    },
    fileCount: { type: "integer", minimum: 0 },
    edgeCount: { type: "integer", minimum: 0 },
    nextCursor: { anyOf: [CURSOR, { type: "null" }] },
    grants: { const: "none" },
  },
  required: [
    "schemaVersion",
    "status",
    "diagnostics",
    "entries",
    "fileCount",
    "edgeCount",
    "nextCursor",
    "grants",
  ],
  additionalProperties: false,
} as const;

export function registerProjectProductNavigationTools(
  app: McpApp,
  dependencies: ProjectProductNavigationToolDependencies,
): void {
  if (!dependencies.productNavigation) return;
  const navigation = dependencies.productNavigation;

  app.registerTool(projectProductExploreTool, async (args) => {
    const result = await navigation.explore({
      projectId: String(args.projectId),
      ...(args.expectedBasis ? { expectedBasis: basisArg(args.expectedBasis) } : {}),
      ...(args.selection ? { selection: occurrenceArg(args.selection) } : {}),
      ...(args.pageSize === undefined ? {} : { pageSize: Number(args.pageSize) }),
      ...(args.cursor === undefined ? {} : { cursor: String(args.cursor) }),
    });
    return {
      content: contentFor(result.status, "explore"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductSearchTool, async (args) => {
    const result = await navigation.search({
      projectId: String(args.projectId),
      ...(args.expectedBasis ? { expectedBasis: basisArg(args.expectedBasis) } : {}),
      query: searchQueryArg(args.query),
      ...(args.pageSize === undefined ? {} : { pageSize: Number(args.pageSize) }),
      ...(args.cursor === undefined ? {} : { cursor: String(args.cursor) }),
    });
    return {
      content: contentFor(result.status, "search"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectProductInspectTool, async (args) => {
    const result = await navigation.inspect({
      projectId: String(args.projectId),
      expectedBasis: basisArg(args.expectedBasis),
      selection: selectionArg(args.selection),
      ...(args.pageSize === undefined ? {} : { pageSize: Number(args.pageSize) }),
      ...(args.cursor === undefined ? {} : { cursor: String(args.cursor) }),
      ...(args.occurrencesPageSize === undefined
        ? {}
        : { occurrencesPageSize: Number(args.occurrencesPageSize) }),
      ...(args.occurrencesCursor === undefined
        ? {}
        : { occurrencesCursor: String(args.occurrencesCursor) }),
    });
    return {
      content: contentFor(result.status, "inspect"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });

  app.registerTool(projectSourceClosureTool, async (args) => {
    const result = await navigation.sourceClosure({
      projectId: String(args.projectId),
      expectedBasis: basisArg(args.expectedBasis),
      selection: selectionArg(args.selection),
      workspaceRevision: Number(args.workspaceRevision),
      attachmentId: String(args.attachmentId),
      attachmentRevision: Number(args.attachmentRevision),
      ...(args.pageSize === undefined ? {} : { pageSize: Number(args.pageSize) }),
      ...(args.cursor === undefined ? {} : { cursor: String(args.cursor) }),
    });
    return {
      content: contentFor(result.status, "source closure"),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

function basisArg(value: unknown): ProductNavigationBasis {
  const rec = value as ProductNavigationBasis;
  return {
    projectId: String(rec.projectId),
    threadSnapshotId: String(rec.threadSnapshotId),
    threadRevision: Number(rec.threadRevision),
    threadSubjectId: String(rec.threadSubjectId),
    architectureArtifactId: String(rec.architectureArtifactId),
    architectureFingerprint: String(rec.architectureFingerprint),
    captureSchema: "architecture-capture/4.0",
  };
}

function occurrenceArg(value: unknown): ProductStructureOccurrenceRef {
  return parseProductStructureOccurrenceRef(value, "$selection");
}

function selectionArg(value: unknown): ProductStructureSelection {
  const rec = value as { kind?: string; element?: unknown; occurrence?: unknown };
  if (rec.kind === "element") {
    return {
      kind: "element",
      element: parseProductStructureElementRef(rec.element, "$selection.element"),
    };
  }
  return {
    kind: "occurrence",
    occurrence: parseProductStructureOccurrenceRef(
      rec.occurrence,
      "$selection.occurrence",
    ),
  };
}

function searchQueryArg(value: unknown): ProductSearchQueryKind {
  const rec = value as { kind?: string; elementId?: string; text?: string };
  if (rec.kind === "exact-id") {
    return { kind: "exact-id", elementId: String(rec.elementId) };
  }
  return { kind: "text", text: String(rec.text) };
}

function contentFor(status: string, surface: string): string {
  if (status === "observed") {
    return `Product ${surface} recrossed the exact current architecture-capture/4.0 basis. Grants none.`;
  }
  if (status === "unavailable") {
    return `Product ${surface} is unavailable. A stale expected basis republishes the current basis and never becomes historical navigation. Grants none.`;
  }
  return `Product ${surface} is ${status}. Exact SysML identities and the architecture basis are required; latest and labels are refused. Grants none.`;
}

const projectProductExploreTool: MCPTool = {
  name: "project_product_explore",
  description:
    "Start SysML product-structure exploration from a projectId, or continue from one exact occurrence pinned to the published architecture basis. Returns focus, breadcrumbs, parent, a bounded page of immediate children, the exact basis, and pasteable selections. Stateless: no persisted focus. latest, labels, providers and runtimes are refused. Grants none. Workbench remains GET/SSE only.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      expectedBasis: BASIS,
      selection: OCCURRENCE_REF,
      pageSize: PAGE_SIZE,
      cursor: CURSOR,
    },
    required: ["projectId"],
    additionalProperties: false,
    dependentRequired: {
      selection: ["expectedBasis"],
    },
  },
  outputSchema: EXPLORE_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductSearchTool: MCPTool = {
  name: "project_product_search",
  description:
    "Discover exact SysML element identities in the current architecture-capture/4.0. Query kind exact-id matches one element id without expanding the occurrence tree. Query kind text matches normalized label and id tokens only to discover; labels never join or authorize. Every hit is an exact PartDefinition or PartUsage ref. Paginated. latest is refused. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      expectedBasis: BASIS,
      query: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "exact-id" },
              elementId: ELEMENT_ID,
            },
            required: ["kind", "elementId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "text" },
              text: {
                type: "string",
                minLength: 1,
                maxLength: PRODUCT_NAVIGATION_BOUNDS.maxSearchTextLength,
                not: { const: "latest" },
              },
            },
            required: ["kind", "text"],
            additionalProperties: false,
          },
        ],
      },
      pageSize: PAGE_SIZE,
      cursor: CURSOR,
    },
    required: ["projectId", "query"],
    additionalProperties: false,
  },
  outputSchema: SEARCH_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectProductInspectTool: MCPTool = {
  name: "project_product_inspect",
  description:
    "Inspect one exact SysML element or occurrence selection pinned to the published architecture basis. A PartUsage remains that usage and is never reduced to its typed PartDefinition. Thread evidence is definition-scoped and labelled as such. Authoring attachment heads stay element-level, bounded, and unmerged. Ready actions are complete calls to this server only. Grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      expectedBasis: BASIS,
      selection: SELECTION,
      pageSize: PAGE_SIZE,
      cursor: {
        type: "string",
        minLength: 1,
        maxLength: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
        not: { const: "latest" },
      },
      occurrencesPageSize: PAGE_SIZE,
      occurrencesCursor: CURSOR,
    },
    required: ["projectId", "expectedBasis", "selection"],
    additionalProperties: false,
  },
  outputSchema: INSPECT_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectSourceClosureTool: MCPTool = {
  name: "project_source_closure",
  description:
    "Read the technical dependency closure of one versioned authoring attachment from an exact selected element or occurrence plus exact attachment revision. PartUsage keeps its usage id. The server recrosses that exact workspace snapshot; a detached, source-removed, foreign-target or different-basis attachment stays unattached or unavailable. Bounded page. Grants none. Not admission.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      expectedBasis: BASIS,
      selection: SELECTION,
      workspaceRevision: { type: "integer", minimum: 1 },
      attachmentId: ELEMENT_ID,
      attachmentRevision: { type: "integer", minimum: 1 },
      pageSize: PAGE_SIZE,
      cursor: CURSOR,
    },
    required: [
      "projectId",
      "expectedBasis",
      "selection",
      "workspaceRevision",
      "attachmentId",
      "attachmentRevision",
    ],
    additionalProperties: false,
  },
  outputSchema: CLOSURE_OUTPUT,
  annotations: READ_ONLY_ANNOTATIONS,
};
