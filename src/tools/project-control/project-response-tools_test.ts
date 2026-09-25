import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  type McpApp,
  type MCPTool,
  SchemaValidator,
  type ToolHandler,
} from "@casys/mcp-platform";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  ProjectResponseItem,
  ProjectResponseReadModel,
  ProjectResponseUseCase,
} from "../../application/ports/in/project-response/project-response.ts";
import { PROJECT_RESPONSE_SCHEMA } from "../../application/ports/in/project-response/project-response.ts";
import {
  presentProjectResponse,
  PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
  PROJECT_RESPONSE_TOOL_NAME,
  registerProjectResponseTools,
} from "./project-response-tools.ts";

Deno.test("project response tool is absent until the use case is composed", () => {
  const app = capturingApp();
  registerProjectResponseTools(app as unknown as McpApp, {});
  assertEquals(app.names, []);
});

Deno.test("project_response_read is a closed read-only tool without provider arguments", () => {
  const app = capturingApp();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: stubUseCase(),
  });
  assertEquals(app.names, [PROJECT_RESPONSE_TOOL_NAME]);
  const tool = app.tool(PROJECT_RESPONSE_TOOL_NAME);
  assertEquals(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown> & {
      projectId: { not: { const: string } };
    };
    dependentRequired: Record<string, string[]>;
  };
  assertEquals(schema.required, ["projectId"]);
  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.properties.projectId.not, { const: "latest" });
  assertEquals("provider" in schema.properties, false);
  assertEquals("runtime" in schema.properties, false);
  assertEquals("config" in schema.properties, false);
  assertEquals("snapshotId" in schema.properties, false);
  assertEquals(schema.dependentRequired.itemId, ["expectedBasis"]);
  assertEquals(schema.dependentRequired.afterItemId, ["expectedBasis"]);
  const output = tool.outputSchema as {
    oneOf: Array<{
      required: string[];
      properties: {
        view: { const: string };
        itemId?: unknown;
        items: { items?: unknown; maxItems?: number };
      };
    }>;
  };
  const itemView = output.oneOf.find((entry) =>
    entry.properties.view.const === "item"
  )!;
  const fullView = output.oneOf.find((entry) =>
    entry.properties.view.const === "full-evidence"
  )!;
  assertEquals(itemView.required.includes("itemId"), true);
  assertEquals(itemView.properties.items.maxItems, 1);
  assertEquals(itemView.properties.items.items, fullView.properties.items.items);
  assertEquals(
    (itemView.properties.items.items as { required: string[] }).required,
    ["item", "correspondence", "requirements", "clauseResponses", "gaps"],
  );
  const summaryView = output.oneOf.find((entry) =>
    entry.properties.view.const === "summary"
  )!;
  const summaryProperties = summaryView.properties as unknown as {
    schemaVersion: { const: string };
    items: { items: { required: string[] } };
  };
  assertEquals(summaryProperties.schemaVersion.const, "project-response/2.0");
  assertEquals(
    summaryProperties.items.items.required.includes("clauseResponseCount"),
    true,
  );
  assertStringIncludes(tool.description, "8KiB");
  assertStringIncludes(tool.description, "afterItemId");
  assertStringIncludes(tool.description, "expectedBasis");
  assertStringIncludes(tool.description, "Grants none");
  assertStringIncludes(tool.description, "soft budget");
  assertStringIncludes(tool.description, "without a retrieval handle");
});

Deno.test("project_response_read default summary omits statements and stays under 8KiB", async () => {
  const app = capturingApp();
  const model = largeResponseModel(80);
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: (query) => {
        assertEquals(query.projectId, "project.response");
        assertEquals(query.expectedBasis, undefined);
        return Promise.resolve(model);
      },
    },
  });
  const result = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
  }) as {
    content: string;
    structuredContent: {
      view: string;
      items: Array<{ itemId: string; statement?: string }>;
      counts: { items: number; included: number; omitted: number };
      omission?: { afterItemId: string; omittedItemCount: number };
    };
  };
  assertEquals(result.structuredContent.view, "summary");
  assertEquals(
    result.structuredContent.items.every((row) => row.statement === undefined),
    true,
  );
  assertEquals(result.structuredContent.counts.items, 80);
  assertEquals(
    new TextEncoder().encode(deterministicJson(result.structuredContent))
      .byteLength <= PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
    true,
  );
  if (result.structuredContent.counts.omitted > 0) {
    assertEquals(
      result.structuredContent.omission?.omittedItemCount,
      result.structuredContent.counts.omitted,
    );
    assertEquals(
      result.structuredContent.omission?.afterItemId,
      result.structuredContent.items.at(-1)?.itemId,
    );
    assertStringIncludes(result.content, "afterItemId");
  }
  assertStringIncludes(result.content, "not clause satisfaction");
});

Deno.test("project_response_read named item detail requires the exact expected basis", async () => {
  const app = capturingApp();
  const model = sampleAvailableModel();
  let seen: unknown;
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: (query) => {
        seen = query;
        return Promise.resolve(model);
      },
    },
  });
  await assertRejects(
    () =>
      app.handle(PROJECT_RESPONSE_TOOL_NAME, {
        projectId: "project.response",
        itemId: "objective",
      }),
    TypeError,
    "expectedBasis is required",
  );
  const result = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
    itemId: "objective",
  }) as {
    structuredContent: {
      view: string;
      itemId: string;
      items: Array<{ item: { statement: string }; correspondence: string }>;
    };
  };
  assertEquals(seen, {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
  });
  assertEquals(result.structuredContent.view, "item");
  assertEquals(result.structuredContent.itemId, "objective");
  assertEquals(result.structuredContent.items.length, 1);
  assertEquals(
    result.structuredContent.items[0]?.item.statement,
    "Keep every approved clause reviewable.",
  );
  assertEquals(result.structuredContent.items[0]?.correspondence, "native");
});

Deno.test("project_response_read refuses a stale expected basis without mixing revisions", async () => {
  const app = capturingApp();
  const current = sampleAvailableModel();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: (query) => {
        if (
          query.expectedBasis &&
          query.expectedBasis.projectRevision !== current.basis?.projectRevision
        ) {
          return Promise.resolve({
            schemaVersion: PROJECT_RESPONSE_SCHEMA,
            status: "unavailable",
            basis: current.basis,
            items: [],
            historicalClauseResponses: [],
            diagnostics: [{
              code: "basis.stale",
              message:
                "The expected project-response basis does not match the current readable basis.",
            }],
            grants: "none",
          });
        }
        return Promise.resolve(current);
      },
    },
  });
  const stale = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
    expectedBasis: { ...sampleBasis(), projectRevision: 1 },
  }) as {
    content: string;
    structuredContent: {
      status: string;
      items: unknown[];
      diagnostics: Array<{ code: string }>;
    };
  };
  assertEquals(stale.structuredContent.status, "unavailable");
  assertEquals(stale.structuredContent.items, []);
  assertEquals(stale.structuredContent.diagnostics[0]?.code, "basis.stale");
  assertStringIncludes(stale.content, "structured diagnostics");
  for (const evidence of ["summary", "full-evidence"]) {
    const continuation = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
      projectId: "project.response",
      expectedBasis: { ...sampleBasis(), projectRevision: 1 },
      afterItemId: "objective",
      evidence,
    }) as {
      structuredContent: {
        status: string;
        view: string;
        items: unknown[];
        diagnostics: Array<{ code: string }>;
      };
    };
    assertEquals(continuation.structuredContent.status, "unavailable");
    assertEquals(continuation.structuredContent.view, evidence);
    assertEquals(continuation.structuredContent.items, []);
    assertEquals(continuation.structuredContent.diagnostics[0]?.code, "basis.stale");
  }
});

Deno.test("project_response_read continuation and full-evidence stay on the exact basis", async () => {
  const app = capturingApp();
  const model = largeResponseModel(12);
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: (query) => {
        assertEquals(query.expectedBasis, sampleBasis());
        return Promise.resolve(model);
      },
    },
  });
  const first = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
  }) as {
    structuredContent: {
      items: Array<{ itemId: string }>;
      omission?: {
        afterItemId: string;
        retrieval: { arguments: { afterItemId: string; evidence?: string } };
      };
    };
  };
  const afterItemId = first.structuredContent.omission?.afterItemId ??
    first.structuredContent.items.at(-1)?.itemId;
  if (first.structuredContent.omission) {
    assertEquals(
      first.structuredContent.omission.retrieval.arguments.evidence,
      "summary",
    );
  }
  const next = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
    afterItemId,
  }) as {
    structuredContent: {
      view: string;
      items: Array<{ itemId: string }>;
      counts: { omitted: number };
    };
  };
  assertEquals(next.structuredContent.view, "summary");
  const seen = new Set([
    ...first.structuredContent.items.map((row) => row.itemId),
    ...next.structuredContent.items.map((row) => row.itemId),
  ]);
  assertEquals(seen.has("item-01"), true);
  const full = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
    evidence: "full-evidence",
  }) as {
    structuredContent: {
      view: string;
      items: Array<{ item: { statement: string } }>;
    };
  };
  assertEquals(full.structuredContent.view, "full-evidence");
  assertEquals(
    full.structuredContent.items[0]?.item.statement.includes("Clause"),
    true,
  );
});

Deno.test("project_response_read summary stays bounded when one diagnostic exceeds 8KiB", async () => {
  const huge = "y".repeat(9000);
  const model: ProjectResponseReadModel = {
    ...sampleAvailableModel(),
    diagnostics: [{
      code: "correspondence.trace-gap",
      message: huge,
    }],
  };
  const presented = presentProjectResponse(model, {
    query: { projectId: "project.response" },
    evidence: "summary",
  });
  assertEquals(presented.view, "summary");
  assertEquals(presented.status, "available");
  assertEquals(
    new TextEncoder().encode(deterministicJson(presented)).byteLength <=
      PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
    true,
  );
  assertEquals(presented.diagnostics.length, 0);
  assertEquals(presented.diagnosticOmission?.omittedDiagnosticCount, 1);
  assertEquals(
    presented.diagnosticOmission?.retrieval?.arguments.evidence,
    "full-evidence",
  );
  assertEquals(presented.items.length >= 1, true);

  const app = capturingApp();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: () => Promise.resolve(model),
    },
  });
  const full = await app.handle(
    PROJECT_RESPONSE_TOOL_NAME,
    presented.diagnosticOmission!.retrieval!.arguments,
  ) as {
    structuredContent: {
      view: string;
      diagnostics: Array<{ code: string; message: string }>;
    };
  };
  assertEquals(full.structuredContent.view, "full-evidence");
  assertEquals(full.structuredContent.diagnostics, model.diagnostics);
});

Deno.test("project_response_read summary bounds many TRACE GAP diagnostics without dropping items", async () => {
  const app = capturingApp();
  const model: ProjectResponseReadModel = {
    ...largeResponseModel(24),
    diagnostics: traceGapDiagnostics(80, "artifact ".repeat(40)),
  };
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: () => Promise.resolve(model),
    },
  });
  const first = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
  }) as {
    structuredContent: {
      status: string;
      view: string;
      items: Array<{ itemId: string }>;
      diagnostics: Array<{ code: string; message: string }>;
      counts: {
        items: number;
        diagnostics: number;
        diagnosticsIncluded: number;
        diagnosticsOmitted: number;
      };
      omission?: {
        retrieval: { arguments: Record<string, unknown> };
      };
      diagnosticOmission: {
        omittedDiagnosticCount: number;
        retrieval: { arguments: Record<string, unknown> };
      };
    };
  };
  assertEquals(first.structuredContent.status, "available");
  assertEquals(first.structuredContent.view, "summary");
  assertEquals(
    new TextEncoder().encode(deterministicJson(first.structuredContent))
      .byteLength <= PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
    true,
  );
  assertEquals(first.structuredContent.counts.diagnostics, 80);
  assertEquals(
    first.structuredContent.counts.diagnosticsIncluded,
    first.structuredContent.diagnostics.length,
  );
  assertEquals(
    first.structuredContent.diagnosticOmission.omittedDiagnosticCount >= 1,
    true,
  );
  assertEquals(
    first.structuredContent.diagnosticOmission.retrieval.arguments.evidence,
    "full-evidence",
  );
  assertEquals(
    first.structuredContent.diagnostics.every((item) =>
      item.message ===
        model.diagnostics.find((candidate) =>
          candidate.code === item.code && candidate.message === item.message
        )?.message
    ),
    true,
  );

  const seen = new Set<string>();
  let argumentsForPage: Record<string, unknown> = {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
  };
  for (let page = 0; page < 24; page++) {
    const result = await app.handle(
      PROJECT_RESPONSE_TOOL_NAME,
      argumentsForPage,
    ) as {
      structuredContent: {
        view: string;
        items: Array<{ itemId: string }>;
        omission?: { retrieval: { arguments: Record<string, unknown> } };
      };
    };
    assertEquals(result.structuredContent.view, "summary");
    assertEquals(
      new TextEncoder().encode(deterministicJson(result.structuredContent))
        .byteLength <= PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
      true,
    );
    for (const row of result.structuredContent.items) {
      assertEquals(seen.has(row.itemId), false);
      seen.add(row.itemId);
    }
    if (!result.structuredContent.omission) break;
    argumentsForPage = result.structuredContent.omission.retrieval.arguments;
  }
  assertEquals(seen.size, 24);
  for (const item of model.items) {
    assertEquals(seen.has(item.item.id), true);
  }

  const full = await app.handle(
    PROJECT_RESPONSE_TOOL_NAME,
    first.structuredContent.diagnosticOmission.retrieval.arguments,
  ) as {
    structuredContent: {
      view: string;
      diagnostics: Array<{ code: string; message: string }>;
    };
  };
  assertEquals(full.structuredContent.view, "full-evidence");
  assertEquals(full.structuredContent.diagnostics, model.diagnostics);
});

Deno.test("project_response_read stale model with many diagnostics does not advertise current-basis retrieval", () => {
  const current = sampleAvailableModel();
  const presented = presentProjectResponse({
    schemaVersion: PROJECT_RESPONSE_SCHEMA,
    status: "unavailable",
    basis: current.basis,
    items: [],
    historicalClauseResponses: [],
    diagnostics: [
      {
        code: "basis.stale",
        message:
          "The expected project-response basis does not match the current readable basis.",
      },
      ...traceGapDiagnostics(40, "z".repeat(400)),
    ],
    grants: "none",
  }, {
    query: {
      projectId: "project.response",
      expectedBasis: { ...sampleBasis(), projectRevision: 1 },
    },
    evidence: "summary",
  });
  assertEquals(presented.status, "unavailable");
  assertEquals(presented.basis, current.basis);
  assertEquals(presented.view, "summary");
  assertEquals(presented.items, []);
  assertEquals(
    presented.diagnostics.some((item) => item.code === "basis.stale"),
    true,
  );
  assertEquals(
    new TextEncoder().encode(deterministicJson(presented)).byteLength <=
      PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
    true,
  );
  assertEquals(
    (presented.diagnosticOmission?.omittedDiagnosticCount ?? 0) >= 1,
    true,
  );
  assertEquals(presented.diagnosticOmission?.retrieval, undefined);
  assertEquals(
    JSON.stringify(presented).includes('"tool":"project_response_read"'),
    false,
  );
  assertEquals(
    presented.counts?.diagnosticsOmitted,
    presented.diagnosticOmission?.omittedDiagnosticCount,
  );
});

Deno.test("project_response_read unavailable summary does not fabricate a diagnostic retrieval basis", () => {
  const presented = presentProjectResponse({
    schemaVersion: PROJECT_RESPONSE_SCHEMA,
    status: "unavailable",
    items: [],
    historicalClauseResponses: [],
    diagnostics: traceGapDiagnostics(40, "z".repeat(400)),
    grants: "none",
  }, {
    query: { projectId: "project.response" },
    evidence: "summary",
  });
  assertEquals(presented.status, "unavailable");
  assertEquals(presented.basis, undefined);
  assertEquals(
    new TextEncoder().encode(deterministicJson(presented)).byteLength <=
      PROJECT_RESPONSE_SUMMARY_MAX_BYTES,
    true,
  );
  assertEquals(
    (presented.diagnosticOmission?.omittedDiagnosticCount ?? 0) >= 1,
    true,
  );
  assertEquals(presented.diagnosticOmission?.retrieval, undefined);
});

Deno.test("project_response_read full-evidence continuation keeps the requested page mode", async () => {
  const app = capturingApp();
  const model = pagedFullEvidenceModel();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: () => Promise.resolve(model),
    },
  });
  const first = await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
    projectId: "project.response",
    expectedBasis: sampleBasis(),
    evidence: "full-evidence",
  }) as {
    structuredContent: {
      view: string;
      items: Array<{ item: { id: string } }>;
      omission: {
        omittedItemCount: number;
        retrieval: {
          tool: string;
          arguments: Record<string, unknown>;
        };
      };
    };
  };
  assertEquals(first.structuredContent.view, "full-evidence");
  assertEquals(first.structuredContent.items.length >= 1, true);
  assertEquals(first.structuredContent.omission.omittedItemCount >= 1, true);
  assertEquals(
    first.structuredContent.omission.retrieval.arguments.evidence,
    "full-evidence",
  );
  const next = await app.handle(
    PROJECT_RESPONSE_TOOL_NAME,
    first.structuredContent.omission.retrieval.arguments,
  ) as {
    structuredContent: {
      view: string;
      items: Array<{ item: { id: string } }>;
    };
  };
  assertEquals(next.structuredContent.view, "full-evidence");
  const firstIds = new Set(
    first.structuredContent.items.map((row) => row.item.id),
  );
  const nextIds = next.structuredContent.items.map((row) => row.item.id);
  assertEquals(nextIds.length >= 1, true);
  assertEquals(nextIds.some((id) => firstIds.has(id)), false);
});

Deno.test("project_response_read published results match the declared outputSchema", async () => {
  const app = capturingApp();
  const model = sampleAvailableModel();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: {
      ...stubUseCase(),
      read: (query) => {
        if (
          query.expectedBasis &&
          query.expectedBasis.projectRevision !== model.basis?.projectRevision
        ) {
          return Promise.resolve({
            schemaVersion: PROJECT_RESPONSE_SCHEMA,
            status: "unavailable",
            basis: model.basis,
            items: [],
            historicalClauseResponses: [],
            diagnostics: [
              {
                code: "basis.stale",
                message:
                  "The expected project-response basis does not match the current readable basis.",
              },
              ...traceGapDiagnostics(40, "z".repeat(400)),
            ],
            grants: "none",
          });
        }
        return Promise.resolve(model);
      },
    },
  });
  const schema = app.tool(PROJECT_RESPONSE_TOOL_NAME).outputSchema;
  const compiled = new SchemaValidator().compileSchema(
    schema as Record<string, unknown>,
  );
  const published = [
    await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
      projectId: "project.response",
    }),
    await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
      projectId: "project.response",
      expectedBasis: sampleBasis(),
      itemId: "objective",
    }),
    await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
      projectId: "project.response",
      expectedBasis: sampleBasis(),
      evidence: "full-evidence",
    }),
    await app.handle(PROJECT_RESPONSE_TOOL_NAME, {
      projectId: "project.response",
      expectedBasis: { ...sampleBasis(), projectRevision: 1 },
    }),
  ] as Array<{ structuredContent: Record<string, unknown> }>;
  for (const result of published) {
    const checked = compiled.validate(result.structuredContent);
    assertEquals(checked.valid, true, JSON.stringify(checked.errors));
    assertEquals(
      result.structuredContent.schemaVersion,
      PROJECT_RESPONSE_SCHEMA,
    );
  }
  assertEquals(PROJECT_RESPONSE_SCHEMA, "project-response/2.0");
  const missingItemId = { ...published[1].structuredContent };
  delete missingItemId.itemId;
  assertEquals(compiled.validate(missingItemId).valid, false);
  const invalidNested = structuredClone(published[2].structuredContent);
  const rows = invalidNested.items as Array<{ item: { kind: string } }>;
  rows[0].item.kind = "invented-kind";
  assertEquals(compiled.validate(invalidNested).valid, false);
});

Deno.test("project_response_read rejects latest aliases and mixed continuation keys", async () => {
  const app = capturingApp();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: stubUseCase(),
  });
  await assertRejects(
    () =>
      app.handle(PROJECT_RESPONSE_TOOL_NAME, {
        projectId: "latest",
      }),
    TypeError,
    "latest",
  );
  await assertRejects(
    () =>
      app.handle(PROJECT_RESPONSE_TOOL_NAME, {
        projectId: "project.response",
        expectedBasis: sampleBasis(),
        itemId: "objective",
        afterItemId: "assumption",
      }),
    TypeError,
    "cannot be combined",
  );
});

function sampleBasis() {
  return {
    projectId: "project.response",
    projectRevision: 7,
    brief: {
      briefId: "brief.response",
      snapshotId: "brief.response:r3",
      revision: 3,
    },
    thread: {
      snapshotId: "thread.response:r4",
      revision: 4,
      subjectId: "subject.response",
    },
  };
}

function sampleAvailableModel(): ProjectResponseReadModel {
  return {
    schemaVersion: PROJECT_RESPONSE_SCHEMA,
    status: "available",
    basis: sampleBasis(),
    items: [
      responseItem(
        "objective",
        "objective",
        "native",
        "Keep every approved clause reviewable.",
      ),
      responseItem(
        "assumption",
        "assumption",
        "unresolved",
        "The enclosure stays unpainted.",
      ),
    ],
    diagnostics: [],
    historicalClauseResponses: [],
    grants: "none",
  };
}

function traceGapDiagnostics(
  count: number,
  message: string,
): ProjectResponseReadModel["diagnostics"] {
  const diagnostics: ProjectResponseReadModel["diagnostics"][number][] = [];
  for (let index = 1; index <= count; index++) {
    diagnostics.push({
      code: "correspondence.trace-gap",
      message: `TRACE GAP capture-${String(index).padStart(3, "0")}: ${message}`,
    });
  }
  return diagnostics;
}

function pagedFullEvidenceModel(): ProjectResponseReadModel {
  const statement = `Clause ${"evidence ".repeat(500)}`;
  return {
    schemaVersion: PROJECT_RESPONSE_SCHEMA,
    status: "available",
    basis: sampleBasis(),
    items: [
      responseItem("page-a", "objective", "unresolved", statement),
      responseItem("page-b", "assumption", "unresolved", statement),
      responseItem("page-c", "exclusion", "unresolved", statement),
    ],
    diagnostics: [],
    historicalClauseResponses: [],
    grants: "none",
  };
}

function largeResponseModel(count: number): ProjectResponseReadModel {
  const items: ProjectResponseItem[] = [];
  for (let index = 1; index <= count; index++) {
    const id = `item-${String(index).padStart(2, "0")}`;
    items.push(responseItem(
      id,
      index % 2 === 0 ? "assumption" : "success-criterion",
      index % 3 === 0 ? "documentary" : "unresolved",
      `Clause ${id} ${"statement ".repeat(80)}`,
    ));
  }
  return {
    schemaVersion: PROJECT_RESPONSE_SCHEMA,
    status: "available",
    basis: sampleBasis(),
    items,
    diagnostics: [],
    historicalClauseResponses: [],
    grants: "none",
  };
}

function responseItem(
  id: string,
  kind: ProjectResponseItem["item"]["kind"],
  correspondence: ProjectResponseItem["correspondence"],
  statement: string,
): ProjectResponseItem {
  return {
    item: {
      id,
      kind,
      statement,
      sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
    },
    correspondence,
    requirements: correspondence === "native"
      ? [{
        threadRequirementId: `req-${id}`,
        requirementsArtifactId: `capture-${id}`,
        traceArtifactId: `trace-${id}`,
        origin: "native",
        sourceBrief: sampleBasis().brief,
        sourceItemId: id,
        sourceState: "unchanged",
        applicability: "current",
        evaluations: [{
          evaluationId: `eval-${id}`,
          status: "pass",
          applicability: "current",
          observationIds: ["obs-1"],
          evidenceArtifactIds: ["ev-1"],
          evaluatedAt: "2026-09-13T00:00:00.000Z",
          freshness: {
            status: "fresh",
            changedAt: "2026-09-13T00:00:00.000Z",
            invalidatedByChangeIds: [],
          },
        }],
      }]
      : [],
    clauseResponses: [],
    gaps: correspondence === "unresolved"
      ? [{ code: "correspondence.missing", message: "No exact mapping." }]
      : [],
  };
}

function stubUseCase(): ProjectResponseUseCase {
  return {
    read: () =>
      Promise.resolve({
        schemaVersion: PROJECT_RESPONSE_SCHEMA,
        status: "unavailable",
        items: [],
        historicalClauseResponses: [],
        diagnostics: [],
        grants: "none",
      }),
    project: () => Promise.reject(new Error("MCP must not call project()")),
  };
}

function capturingApp() {
  const names: string[] = [];
  const tools = new Map<string, MCPTool>();
  const handlers = new Map<string, ToolHandler>();
  return {
    names,
    tool: (name: string) => tools.get(name)!,
    registerTool(tool: MCPTool, handler: ToolHandler) {
      names.push(tool.name);
      tools.set(tool.name, tool);
      handlers.set(tool.name, handler);
    },
    handle(
      name: string,
      args: Record<string, unknown>,
    ): Promise<unknown> {
      return Promise.resolve(handlers.get(name)!(args, {} as never));
    },
  };
}

Deno.test("public clause source schema requires exactly the discriminator's identity", () => {
  const app = capturingApp();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: stubUseCase(),
  });
  const output = app.tool(PROJECT_RESPONSE_TOOL_NAME).outputSchema as {
    oneOf: Array<
      {
        properties: {
          view: { const: string };
          items: {
            items: {
              properties: {
                clauseResponses: {
                  items: {
                    properties: { sourceRefs: { items: Record<string, unknown> } };
                  };
                };
              };
            };
          };
        };
      }
    >;
  };
  const full = output.oneOf.find((entry) =>
    entry.properties.view.const === "full-evidence"
  );
  const schema =
    full!.properties.items.items.properties.clauseResponses.items.properties.sourceRefs
      .items;
  const validate = new SchemaValidator().compileSchema({
    type: "object",
    properties: { source: schema },
    required: ["source"],
    additionalProperties: false,
  });
  for (
    const source of [
      {
        kind: "agent-resource",
        uri: "casys://agent-resource-capture/sha256/" + "a".repeat(64),
      },
      { kind: "thread-artifact", artifactId: "artifact.synthetic.source" },
    ]
  ) assertEquals(validate.validate({ source }).valid, true);
  for (
    const source of [
      null,
      {},
      { kind: "future" },
      { kind: "agent-resource" },
      { kind: "agent-resource", uri: "casys://synthetic/source" },
      { kind: "thread-artifact" },
      { kind: "agent-resource", artifactId: "artifact.synthetic.source" },
      { kind: "thread-artifact", uri: "casys://synthetic/source" },
      {
        kind: "agent-resource",
        uri: "casys://synthetic/source",
        artifactId: "artifact.synthetic.source",
      },
      { kind: "thread-artifact", artifactId: "artifact.synthetic.source", extra: true },
    ]
  ) assertEquals(validate.validate({ source }).valid, false);
});

Deno.test("public V2 clause sourceRefs schema enforces the 1-8 domain bound", () => {
  const app = capturingApp();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: stubUseCase(),
  });
  const output = app.tool(PROJECT_RESPONSE_TOOL_NAME).outputSchema as {
    oneOf: Array<
      {
        properties: {
          view: { const: string };
          items: {
            items: {
              properties: {
                clauseResponses: {
                  items: {
                    properties: {
                      sourceRefs: {
                        minItems?: number;
                        maxItems?: number;
                        items: Record<string, unknown>;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      }
    >;
  };
  const full = output.oneOf.find((entry) =>
    entry.properties.view.const === "full-evidence"
  );
  const sourceRefs =
    full!.properties.items.items.properties.clauseResponses.items.properties
      .sourceRefs;
  assertEquals(sourceRefs.minItems, 1);
  assertEquals(sourceRefs.maxItems, 8);
  const validate = new SchemaValidator().compileSchema({
    type: "object",
    properties: { sourceRefs },
    required: ["sourceRefs"],
    additionalProperties: false,
  });
  const one = {
    kind: "thread-artifact",
    artifactId: "artifact.synthetic.source",
  };
  assertEquals(validate.validate({ sourceRefs: [one] }).valid, true);
  assertEquals(validate.validate({ sourceRefs: [] }).valid, false);
  assertEquals(
    validate.validate({ sourceRefs: Array.from({ length: 9 }, () => one) })
      .valid,
    false,
  );
});

Deno.test("removed clause-response answers stay out of default summary and appear in full-evidence", () => {
  const model: ProjectResponseReadModel = {
    ...sampleAvailableModel(),
    historicalClauseResponses: [{
      artifactId: "documentary-clause-response-retired",
      revision: 1,
      sourceItemId: "retired-exclusion",
      sourceBrief: sampleBasis().brief,
      sourceState: "removed",
      applicability: "historical",
      recordingStatus: "proposal",
      authorKind: "agent",
      scope: "context",
      answer: "Historical retired answer must not enter the default summary.",
      sourceRefs: [{
        kind: "agent-resource",
        uri: "casys://agent-resource-capture/sha256/" + "a".repeat(64),
      }],
    }],
  };
  const summary = presentProjectResponse(model, {
    query: { projectId: "project.response" },
    evidence: "summary",
  });
  assertEquals(summary.view, "summary");
  assertEquals(summary.historicalClauseResponses, undefined);
  assertEquals(summary.counts?.removedClauseResponseCount, 1);
  assertEquals(
    JSON.stringify(summary).includes("Historical retired answer must not enter"),
    false,
  );
  const full = presentProjectResponse(model, {
    query: { projectId: "project.response", expectedBasis: sampleBasis() },
    evidence: "full-evidence",
  });
  assertEquals(full.view, "full-evidence");
  assertEquals(full.historicalClauseResponses?.length, 1);
  assertEquals(
    full.historicalClauseResponses?.[0]?.answer,
    "Historical retired answer must not enter the default summary.",
  );
  assertEquals(full.historicalClauseResponses?.[0]?.sourceState, "removed");
  assertEquals(full.historicalClauseResponses?.[0]?.applicability, "historical");
  const app = capturingApp();
  registerProjectResponseTools(app as unknown as McpApp, {
    projectResponse: stubUseCase(),
  });
  const validate = new SchemaValidator().compileSchema(
    app.tool(PROJECT_RESPONSE_TOOL_NAME).outputSchema!,
  );
  assertEquals(validate.validate({ ...full }).valid, true);
  const currentItem = full.items[0] as ProjectResponseItem;
  assertEquals(
    validate.validate({
      ...full,
      items: [{
        ...currentItem,
        clauseResponses: [{
          ...full.historicalClauseResponses?.[0],
          sourceItemId: currentItem.item.id,
          sourceState: "removed",
          applicability: "current",
        }],
      }],
    }).valid,
    false,
  );
  for (
    const changed of [
      { applicability: "current" },
      { sourceState: "unchanged" },
      { sourceRefs: [] },
    ]
  ) {
    assertEquals(
      validate.validate({
        ...full,
        historicalClauseResponses: [{
          ...full.historicalClauseResponses?.[0],
          ...changed,
        }],
      }).valid,
      false,
    );
  }
  assertEquals(
    full.items.every((item) =>
      (item as ProjectResponseItem).item.id !== "retired-exclusion"
    ),
    true,
  );
});
