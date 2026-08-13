import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  McpApp,
  MCPTool,
  ToolHandler,
  ToolHandlerContext,
} from "@casys/mcp-server";
import type { EngineeringProjectCommandService } from "../application/use-cases/project/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type {
  ResolvedOperationPlanRef,
  ResolvedOperationPlanV2,
} from "../domain/analysis/resolved-operation-plan-v2.ts";
import type { ResolvedRunPlanReader } from "../domain/project/resolved-run-plan-sealer.ts";
import { sha256Fingerprint } from "../domain/kernel/deterministic-json.ts";
import {
  FileCaptureStore,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
  GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
} from "../adapters/captures/file-capture-store.ts";
import { PythonCadSourceAnalyzer } from "../adapters/analyzers/python-cad-source-analyzer.ts";
import { CaptureBackedProjectGeometryPreviewAdapter } from "../adapters/captures/capture-backed-project-geometry-preview-adapter.ts";
import { FileProjectReviewIntentStore } from "../adapters/stores/file-project-review-intent-store.ts";
import type { ProjectReviewIntent } from "../domain/project/project-review-intent.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./project-control.ts";
import { parseGeometryDecisionParameters } from "../domain/engineering/geometry-proposal.ts";
import {
  UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
  UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
  uncertainWriterBasisReleaseIds,
  uncertainWriterBasisReleaseText,
} from "../domain/project/uncertain-writer-basis-release.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
const APPROVAL_ID = "approval:airframe-material:proposal-1";
const COMMON = {
  commandId: "chat-command-1",
  projectId: "chat-first-project",
  expectedRevision: 4,
  issuedAt: "2026-08-03T12:00:00.000Z",
};

const GEOMETRY_PREVIEW_ARGS = {
  script: "from build123d import Box\nresult = Box(1, 1, 1)\n",
  architectureSnapshotId: "thread:r2",
  architectureSnapshotRevision: 2,
  architectureArtifactDigest: "b".repeat(64),
  exportFormats: ["gltf"],
};

function sourceAnalysisFor(directory: string) {
  return {
    sourceCaptures: new FileCaptureStore({
      ...GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
      directory: `${directory}/geometry-sources`,
    }),
    analysisCaptures: new FileCaptureStore({
      ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
      directory: `${directory}/source-analyses`,
    }),
    frontend: new PythonCadSourceAnalyzer(),
  } as const;
}

Deno.test("project_geometry_preview accepts scoped homonymous usages with distinct provider identities", async () => {
  const draftDirectory = await Deno.makeTempDir();
  const app = new CapturingApp();
  let providerCalls = 0;
  const sentinel = new Error("provider reached");
  try {
    registerProjectControlTools(
      app as unknown as McpApp,
      {
        ...dependencies(projectSnapshot()),
        geometryPreview: new CaptureBackedProjectGeometryPreviewAdapter({
          client: {
            callTool: () => {
              providerCalls++;
              return Promise.reject(sentinel);
            },
            callToolTextResult: () => Promise.reject(new Error("unexpected")),
          },
          draftCaptures: new FileCaptureStore({
            ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
            directory: draftDirectory,
          }),
          sourceAnalysis: sourceAnalysisFor(draftDirectory),
          build123dService: "mcp-build123d-sandbox",
        }),
      },
    );

    await assertRejects(
      async () => {
        await app.handler("project_geometry_preview")({
          ...GEOMETRY_PREVIEW_ARGS,
          exportFormats: ["step", "gltf"],
          components: [
            {
              elementId: "usage-left",
              usageName: "drive_motor",
              label: "Left motor",
            },
            {
              elementId: "usage-right",
              usageName: "drive_motor",
              label: "Right motor",
            },
          ],
          partExportFormats: ["step", "gltf", "stl"],
          partDefinitions: [{
            elementId: "definition-motor",
            label: "Motor",
            script: "from build123d import Cylinder\nresult = Cylinder(1, 2)\n",
          }],
          occurrences: [{
            usageElementId: "usage-left",
            partDefinitionElementId: "definition-motor",
            placement: { translationMm: [-2, 0, 0], rotationDeg: [0, 0, 0] },
          }, {
            usageElementId: "usage-right",
            partDefinitionElementId: "definition-motor",
            placement: { translationMm: [2, 0, 0], rotationDeg: [0, 0, 0] },
          }],
        }, clientContext());
      },
      Error,
      sentinel.message,
    );
    assertEquals(providerCalls, 1);
  } finally {
    await Deno.remove(draftDirectory, { recursive: true });
  }
});

Deno.test("project_geometry_preview v2 returns a reparsable exact bundle with predecessor and definition reuse", async () => {
  const draftDirectory = await Deno.makeTempDir();
  const app = new CapturingApp();
  const calls: Array<Record<string, unknown>> = [];
  try {
    registerProjectControlTools(
      app as unknown as McpApp,
      {
        ...dependencies(projectSnapshot()),
        geometryPreview: new CaptureBackedProjectGeometryPreviewAdapter({
          client: {
            callTool: (call) => {
              const args = call.arguments as Record<string, unknown>;
              calls.push(args);
              const name = String(args.name);
              const formats = args.formats as Array<"step" | "gltf">;
              const isDefinition = name.includes("-definition-");
              return Promise.resolve({
                structuredContent: {
                  schemaVersion: "1.0",
                  kind: "export",
                  metrics: {},
                  files: formats.map((format) => ({
                    format,
                    path: `/exports/${name}.${format === "gltf" ? "glb" : format}`,
                    bytes: 100,
                    sha256: isDefinition
                      ? (format === "step" ? "c" : "d").repeat(64)
                      : (format === "step" ? "a" : "b").repeat(64),
                    ...(format === "gltf" ? { viewer: "model-viewer" } : {}),
                  })),
                },
                text: "",
              });
            },
            callToolTextResult: () => Promise.reject(new Error("unexpected")),
          },
          draftCaptures: new FileCaptureStore({
            ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
            directory: draftDirectory,
          }),
          sourceAnalysis: sourceAnalysisFor(draftDirectory),
          build123dService: "mcp-build123d-sandbox",
          materializeAsset: () => Promise.resolve(),
          previewRunId: "preview:project-tool-v2",
        }),
      },
    );
    const result = await app.handler("project_geometry_preview")({
      ...GEOMETRY_PREVIEW_ARGS,
      exportFormats: ["step", "gltf"],
      predecessor: {
        artifactId: "geometry:legacy-exact",
        digest: "e".repeat(64),
      },
      components: [{ elementId: "usage-left", usageName: "left", label: "Left" }, {
        elementId: "usage-right",
        usageName: "right",
        label: "Right",
      }, {
        elementId: "usage-cover",
        usageName: "cover",
        label: "Cover",
      }],
      partExportFormats: ["step", "gltf"],
      partDefinitions: [{
        elementId: "definition-shared",
        label: "Shared",
        script: "from build123d import Box\nresult = Box(1, 1, 1)\n",
      }, {
        elementId: "definition-cover",
        label: "Cover",
        script: "from build123d import Cylinder\nresult = Cylinder(1, 2)\n",
      }],
      occurrences: [{
        usageElementId: "usage-left",
        partDefinitionElementId: "definition-shared",
        placement: { translationMm: [-1, 0, 0], rotationDeg: [0, 0, 0] },
      }, {
        usageElementId: "usage-right",
        partDefinitionElementId: "definition-shared",
        placement: { translationMm: [1, 0, 0], rotationDeg: [0, 0, 0] },
      }, {
        usageElementId: "usage-cover",
        partDefinitionElementId: "definition-cover",
        placement: { translationMm: [0, 0, 2], rotationDeg: [0, 0, 90] },
      }],
    }, clientContext());
    assertEquals(calls.length, 3);
    assertEquals(new Set(calls.map((call) => call.name)).size, 3);
    const structured = (result as { structuredContent: Record<string, unknown> })
      .structuredContent;
    const rawParameters = structured.decisionParameters as Array<{
      key: string;
      value: string | number | boolean;
    }>;
    const parsed = parseGeometryDecisionParameters(
      new Map(rawParameters.map(({ key, value }) => [key, value])),
    );
    assertEquals(parsed.manifest.schemaVersion, "geometry-manifest/2.0");
    if (parsed.manifest.schemaVersion !== "geometry-manifest/2.0") {
      throw new Error("expected v2 manifest");
    }
    assertEquals(parsed.manifest.predecessor, {
      artifactId: "geometry:legacy-exact",
      fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
    });
    assertEquals(parsed.manifest.partDefinitions.length, 2);
    assertEquals(parsed.manifest.occurrences.length, 3);
    assertEquals(
      parsed.manifest.occurrences.filter((occurrence) =>
        occurrence.partDefinitionElementId === "definition-shared"
      ).length,
      2,
    );
  } finally {
    await Deno.remove(draftDirectory, { recursive: true });
  }
});

Deno.test("project_geometry_preview v2 rejects incomplete and duplicate definition identity before provider", async () => {
  for (const defect of ["missing-occurrences", "duplicate-definition"] as const) {
    const draftDirectory = await Deno.makeTempDir();
    const app = new CapturingApp();
    let providerCalls = 0;
    try {
      registerProjectControlTools(
        app as unknown as McpApp,
        {
          ...dependencies(projectSnapshot()),
          geometryPreview: new CaptureBackedProjectGeometryPreviewAdapter({
            client: {
              callTool: () => {
                providerCalls++;
                return Promise.reject(new Error("must not dispatch"));
              },
              callToolTextResult: () => Promise.reject(new Error("unexpected")),
            },
            draftCaptures: new FileCaptureStore({
              ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
              directory: draftDirectory,
            }),
            sourceAnalysis: sourceAnalysisFor(draftDirectory),
            build123dService: "mcp-build123d-sandbox",
          }),
        },
      );
      const definitions = [{
        elementId: "definition-shared",
        label: "Shared",
        script: "from build123d import Box\nresult = Box(1, 1, 1)\n",
      }];
      if (defect === "duplicate-definition") definitions.push({ ...definitions[0]! });
      await assertRejects(
        async () =>
          await app.handler("project_geometry_preview")({
            ...GEOMETRY_PREVIEW_ARGS,
            exportFormats: ["step"],
            components: [{
              elementId: "usage-one",
              usageName: "one",
              label: "One",
            }],
            partExportFormats: ["step"],
            partDefinitions: definitions,
            ...(defect === "missing-occurrences" ? {} : {
              occurrences: [{
                usageElementId: "usage-one",
                partDefinitionElementId: "definition-shared",
                placement: {
                  translationMm: [0, 0, 0],
                  rotationDeg: [0, 0, 0],
                },
              }],
            }),
          }, clientContext()),
        Error,
      );
      assertEquals(providerCalls, 0, defect);
    } finally {
      await Deno.remove(draftDirectory, { recursive: true });
    }
  }
});

Deno.test("project_geometry_preview rejects a duplicate provider element before dispatch", async () => {
  const draftDirectory = await Deno.makeTempDir();
  const app = new CapturingApp();
  let providerCalls = 0;
  try {
    registerProjectControlTools(
      app as unknown as McpApp,
      {
        ...dependencies(projectSnapshot()),
        geometryPreview: new CaptureBackedProjectGeometryPreviewAdapter({
          client: {
            callTool: () => {
              providerCalls++;
              return Promise.reject(new Error("must not dispatch"));
            },
            callToolTextResult: () => Promise.reject(new Error("unexpected")),
          },
          draftCaptures: new FileCaptureStore({
            ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
            directory: draftDirectory,
          }),
          sourceAnalysis: sourceAnalysisFor(draftDirectory),
          build123dService: "mcp-build123d-sandbox",
        }),
      },
    );

    await assertRejects(
      async () => {
        await app.handler("project_geometry_preview")({
          ...GEOMETRY_PREVIEW_ARGS,
          components: [
            { elementId: "usage-shared", usageName: "leftMotor", label: "Left" },
            { elementId: "usage-shared", usageName: "rightMotor", label: "Right" },
          ],
        }, clientContext());
      },
      TypeError,
      "duplicate elementId",
    );
    assertEquals(providerCalls, 0);
  } finally {
    await Deno.remove(draftDirectory, { recursive: true });
  }
});

Deno.test("project_agent_run_plan_get is absent without a reader and follows only a stamped run reference", async () => {
  const withoutReader = new CapturingApp();
  registerProjectControlTools(
    withoutReader as unknown as McpApp,
    dependencies(projectSnapshot()),
  );
  assertEquals(withoutReader.hasTool("project_agent_run_plan_get"), false);

  const fixture = await resolvedPlanInspectionFixture();
  const app = new CapturingApp();
  let readerCalls = 0;
  let currentReads = 0;
  let revisionReads = 0;
  let mutationCalls = 0;
  const reader: ResolvedRunPlanReader = {
    read(ref) {
      readerCalls++;
      assertEquals(ref, fixture.ref);
      return Promise.resolve(fixture.plan);
    },
  };
  registerProjectControlTools(
    app as unknown as McpApp,
    {
      ...dependencies(fixture.current, {
        queueRun: () => {
          mutationCalls++;
          return Promise.resolve(fixture.current);
        },
      }),
      projects: {
        get: () => {
          currentReads++;
          return Promise.resolve(fixture.current);
        },
        getRevision: () => {
          revisionReads++;
          return Promise.resolve(fixture.queueBasis);
        },
      },
      runPlanReader: reader,
    },
  );
  assertEquals(app.hasTool("project_agent_run_plan_get"), true);
  const tool = app.tool("project_agent_run_plan_get");
  assertEquals(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "projectId",
    "runId",
  ]);
  assertEquals(tool.inputSchema.additionalProperties, false);

  const result = await app.handler("project_agent_run_plan_get")({
    projectId: fixture.current.project.id,
    runId: fixture.runId,
  }) as { structuredContent: { reference: ResolvedOperationPlanRef } };
  assertEquals(result.structuredContent.reference, fixture.ref);
  assertEquals(readerCalls, 1);
  assertEquals(currentReads, 1);
  assertEquals(revisionReads, 1);
  assertEquals(mutationCalls, 0);

  const divergent = structuredClone(fixture.current);
  (divergent.commandReceipts![0]!.queuedRun as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  }).resolvedOperationPlan = {
    ...fixture.ref,
    fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    casUri: `casys://resolved-operation-plan/sha256/${"d".repeat(64)}`,
  };
  const divergentApp = new CapturingApp();
  registerProjectControlTools(
    divergentApp as unknown as McpApp,
    {
      ...dependencies(divergent),
      projects: {
        get: () => Promise.resolve(divergent),
        getRevision: () => Promise.resolve(fixture.queueBasis),
      },
      runPlanReader: reader,
    },
  );
  await assertRejects(
    () =>
      divergentApp.handler("project_agent_run_plan_get")({
        projectId: divergent.project.id,
        runId: fixture.runId,
      }) as Promise<unknown>,
    TypeError,
    "cross-bound",
  );

  const missing = structuredClone(fixture.current);
  delete (missing.agentRuns[0] as { resolvedOperationPlan?: unknown })
    .resolvedOperationPlan;
  const missingApp = new CapturingApp();
  registerProjectControlTools(
    missingApp as unknown as McpApp,
    { ...dependencies(missing), runPlanReader: reader },
  );
  await assertRejects(
    () =>
      missingApp.handler("project_agent_run_plan_get")({
        projectId: missing.project.id,
        runId: fixture.runId,
      }) as Promise<unknown>,
    TypeError,
    "has no resolved-operation-plan",
  );

  const forgedApp = new CapturingApp();
  registerProjectControlTools(
    forgedApp as unknown as McpApp,
    {
      ...dependencies(fixture.current),
      projects: {
        get: () => Promise.resolve(fixture.current),
        getRevision: () => Promise.resolve(fixture.queueBasis),
      },
      runPlanReader: {
        read: () =>
          Promise.resolve({
            ...fixture.plan,
            run: { ...fixture.plan.run, runId: "run:forged" },
          }),
      },
    },
  );
  await assertRejects(
    () =>
      forgedApp.handler("project_agent_run_plan_get")({
        projectId: fixture.current.project.id,
        runId: fixture.runId,
      }) as Promise<unknown>,
    TypeError,
    "does not bind the exact inspected run",
  );
});

Deno.test("project_agent_run_queue derives its server-owned run command from one ready work item", async () => {
  const snapshot = projectSnapshot();
  const app = new CapturingApp();
  const calls: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      queueRun: (origin, command) => {
        calls.push({ origin, command: command as unknown as Record<string, unknown> });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const handler = app.handler("project_agent_run_queue");
  const result = await handler(
    { ...COMMON, workItemId: "establish-baseline" },
    clientContext(),
  ) as Record<string, unknown>;

  assertStringIncludes(result.content as string, "server derived the run id");
  assertEquals(calls, [{
    origin: { kind: "agent", actorId: "mcp:paired-chat@1" },
    command: {
      ...COMMON,
      runId: "run:chat-command-1",
      workItemId: "establish-baseline",
      summary:
        "Execute reviewed operation baseline.from-approved-brief@1 for Establish the engineering baseline.",
      basis: snapshot.plan!.basis,
    },
  }]);

  const tool = app.tool("project_agent_run_queue");
  const schema = tool.inputSchema as Record<string, unknown>;
  const serialized = JSON.stringify(schema);
  for (
    const forbidden of [
      "provider",
      "toolName",
      "mcpUrl",
      "runId",
      "summary",
      "basis",
      "resultSnapshot",
      "evidenceRefs",
      "queuedRun",
    ]
  ) {
    assertEquals(
      serialized.includes(forbidden),
      false,
      `${forbidden} must be server-owned`,
    );
  }
});

Deno.test("project_change_append anchors an append-only change to the exact current thread head", async () => {
  const head = {
    snapshotId: "chat-first-thread:r1",
    revision: 1,
    subjectId: "chat-first-subject",
  };
  const snapshot = projectSnapshot({ threadSnapshots: [head] });
  const app = new CapturingApp();
  const calls: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      appendChange: (origin, command) => {
        calls.push({ origin, command: command as unknown as Record<string, unknown> });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const change = {
    ...COMMON,
    commandId: "chat-change-append-1",
    baseSnapshot: head,
    phases: [{
      id: "architecture",
      name: "System architecture",
      description: "Create the first reviewable SysON system architecture.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "architecture.seed-syson-model",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  };
  const result = await app.handler("project_change_append")(
    change,
    clientContext(),
  ) as Record<
    string,
    unknown
  >;

  assertStringIncludes(result.content as string, "adds only reviewed work");
  assertEquals(calls, [{
    origin: { kind: "agent", actorId: "mcp:paired-chat@1" },
    command: {
      ...change,
      baseSnapshot: head,
    },
  }]);
  const tool = app.tool("project_change_append");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "baseSnapshot",
    "commandId",
    "expectedRevision",
    "issuedAt",
    "phases",
    "projectId",
    "requiredDecisions",
    "workItems",
  ]);
  const serialized = JSON.stringify(schema);
  for (
    const forbidden of [
      "provider",
      "toolName",
      "mcpUrl",
      "runId",
      "summary",
      "basis",
      "resultSnapshot",
      "evidenceRefs",
    ]
  ) {
    assertEquals(
      serialized.includes(forbidden),
      false,
      `${forbidden} must not be accepted by the append-only change tool`,
    );
  }

  await assertRejects(
    async () => {
      await app.handler("project_change_append")({
        ...change,
        baseSnapshot: { ...head, revision: 2 },
      }, clientContext());
    },
    TypeError,
    "exactly equal the current project thread head",
  );
  assertEquals(calls.length, 1);
});

Deno.test("project decision approval and rejection require a verified human elicitation retry", async () => {
  const snapshot = projectSnapshot({ withDecision: true });
  const app = new CapturingApp();
  const approved: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  const rejected: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      approveDecision: (origin, command) => {
        approved.push({
          origin,
          command: command as unknown as Record<string, unknown>,
        });
        return Promise.resolve(snapshot);
      },
      rejectDecision: (origin, command) => {
        rejected.push({
          origin,
          command: command as unknown as Record<string, unknown>,
        });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const args = {
    ...COMMON,
    decisionId: "airframe-material",
    inputFingerprint: FINGERPRINT,
    rationale: "The person accepted this trade-off in the paired conversation.",
  };
  const approve = app.handler("project_decision_approve");
  const first = await approve(args, clientContext()) as Record<string, unknown>;
  assertEquals(first.resultType, "input_required");
  const request = (first.inputRequests as Record<string, unknown>)
    .decision_confirmation as Record<string, unknown>;
  assertEquals(request.method, "elicitation/create");
  assertStringIncludes(
    (request.params as Record<string, unknown>).message as string,
    "Composite airframe",
  );
  assertStringIncludes(
    (request.params as Record<string, unknown>).message as string,
    '"key":"material"',
  );
  assertEquals(approved, []);

  await assertRejects(
    async () => {
      await approve(args, {
        ...clientContext(),
        retryVerified: false,
        inputResponses: {
          decision_confirmation: { action: "accept", content: { confirmed: true } },
        },
      });
    },
    TypeError,
    "verified signed request state",
  );
  assertEquals(approved, []);

  const accepted = await approve(args, {
    ...clientContext(),
    retryVerified: true,
    inputResponses: {
      decision_confirmation: { action: "accept", content: { confirmed: true } },
    },
  }) as Record<string, unknown>;
  assertStringIncludes(
    accepted.content as string,
    "paired MCP host reported approval",
  );
  assertEquals(approved, [{
    origin: { kind: "human", actorId: "mcp-elicitation:paired-chat@1" },
    command: {
      ...args,
      inputFingerprint: FINGERPRINT,
    },
  }]);

  const reject = app.handler("project_decision_reject");
  const rejectedFirst = await reject(args, clientContext()) as Record<string, unknown>;
  assertEquals(rejectedFirst.resultType, "input_required");
  await reject(args, {
    ...clientContext(),
    retryVerified: true,
    inputResponses: {
      decision_confirmation: { action: "accept", content: { confirmed: true } },
    },
  });
  assertEquals(rejected, [{
    origin: { kind: "human", actorId: "mcp-elicitation:paired-chat@1" },
    command: {
      ...args,
      inputFingerprint: FINGERPRINT,
    },
  }]);
});

Deno.test("decision elicitation renders the complete parameter array as injective canonical JSON", async () => {
  const elicit = async (
    parameters: NonNullable<
      EngineeringProjectSnapshot["decisions"][number]["proposal"]
    >["parameters"],
  ): Promise<string> => {
    const base = projectSnapshot({ withDecision: true });
    const snapshot: EngineeringProjectSnapshot = {
      ...base,
      decisions: base.decisions.map((decision) => ({
        ...decision,
        proposal: decision.proposal ? { ...decision.proposal, parameters } : undefined,
      })),
    };
    const app = new CapturingApp();
    registerProjectControlTools(app as unknown as McpApp, dependencies(snapshot));
    const result = await app.handler("project_decision_approve")({
      ...COMMON,
      decisionId: "airframe-material",
      inputFingerprint: FINGERPRINT,
      rationale: "Review exact parameters.",
    }, clientContext()) as Record<string, unknown>;
    const request = (result.inputRequests as Record<string, unknown>)
      .decision_confirmation as Record<string, unknown>;
    return (request.params as Record<string, unknown>).message as string;
  };

  // Both arrays rendered as `label: value; ...` used to collide.
  const messageA = await elicit([
    { key: "first", label: "a", value: "b; c: d" },
  ]);
  const messageB = await elicit([
    { key: "second", label: "a: b; c", value: "d" },
  ]);
  assertEquals(messageA === messageB, false);
  assertStringIncludes(
    messageA,
    'Exact parameters: [{"key":"first","label":"a","value":"b; c: d"}]',
  );
  assertStringIncludes(messageB, '"key":"second"');
  assertStringIncludes(await elicit([]), "Exact parameters: []");
});

Deno.test("project_decision_propose applies the server-fixed basis-release contract without the failed writer grammar", async () => {
  const snapshot = {
    ...basisReleaseSnapshot(),
    threadSnapshots: [
      RELEASE_BASIS,
      {
        snapshotId: "chat-first-subject:thread:r8",
        revision: 8,
        subjectId: RELEASE_BASIS.subjectId,
      },
    ],
  };
  const proposed: unknown[] = [];
  const app = new CapturingApp();
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      proposeDecision: (_origin, command) => {
        proposed.push(command);
        return Promise.resolve(snapshot);
      },
    }),
  );
  const parameters = basisReleaseParameters();
  const args = {
    ...COMMON,
    decisionId: "decision:uncertain-write-release:run:failed-writer",
    proposal: { summary: "Release this exact reviewed basis.", parameters },
  };
  await app.handler("project_decision_propose")(args, clientContext());
  assertEquals(proposed.length, 1);
  assertEquals(
    (proposed[0] as { baseSnapshot: unknown }).baseSnapshot,
    {
      snapshotId: RELEASE_BASIS.snapshotId,
      revision: RELEASE_BASIS.revision,
      subjectId: RELEASE_BASIS.subjectId,
    },
  );

  await assertRejects(
    () =>
      app.handler("project_decision_propose")({
        ...args,
        proposal: {
          ...args.proposal,
          parameters: parameters.map((parameter) =>
            parameter.key === "snapshotId"
              ? { ...parameter, value: "forged:snapshot" }
              : parameter
          ),
        },
      }, clientContext()) as Promise<unknown>,
    Error,
    'Basis-release parameter "snapshotId" must equal the exact persisted value',
  );
  assertEquals(proposed.length, 1);
});

Deno.test("decision elicitation spells out the exact evidence targets the approval seals", async () => {
  const targets = (
    refs: EngineeringProjectSnapshot["decisions"][number]["inputEvidenceRefs"],
  ): EngineeringProjectSnapshot => {
    const snapshot = projectSnapshot({ withDecision: true });
    return {
      ...snapshot,
      decisions: snapshot.decisions.map((decision) => ({
        ...decision,
        inputEvidenceRefs: refs,
      })),
    };
  };
  const elicit = async (
    snapshot: EngineeringProjectSnapshot,
  ): Promise<string> => {
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      dependencies(snapshot),
    );
    const first = await app.handler("project_decision_approve")({
      ...COMMON,
      decisionId: "airframe-material",
      inputFingerprint: FINGERPRINT,
      rationale: "The person accepted this trade-off in the paired conversation.",
    }, clientContext()) as Record<string, unknown>;
    const request = (first.inputRequests as Record<string, unknown>)
      .decision_confirmation as Record<string, unknown>;
    return (request.params as Record<string, unknown>).message as string;
  };

  const refA = {
    snapshotId: "chat-first-subject:thread:r7",
    snapshotRevision: 7,
    kind: "artifact",
    id: "drip-eval-a",
  } as const;
  const refB = { ...refA, id: "drip-eval-b" } as const;

  const messageA = await elicit(targets([refA]));
  assertStringIncludes(
    messageA,
    'Exact evidence targets: [{"id":"drip-eval-a","kind":"artifact",' +
      '"snapshotId":"chat-first-subject:thread:r7","snapshotRevision":7}]',
  );

  // Two proposals differing only by their sealed targets must never present
  // the same text to the approver — otherwise the human seals a choice they
  // cannot see and the target selection silently belongs to the agent.
  const messageB = await elicit(targets([refB]));
  assertStringIncludes(messageB, "drip-eval-b");
  assertEquals(messageA === messageB, false);

  // IDs are only constrained to be non-empty, so an ID may embed whatever
  // separator a naive rendering would use. These two target sets collide
  // under `kind id @ snapshot rN; ...` formatting; canonical JSON keeps the
  // rendering injective.
  const forged = (first: string, second: string) =>
    targets([
      { snapshotId: "S", snapshotRevision: 1, kind: "artifact", id: first },
      { snapshotId: "S", snapshotRevision: 1, kind: "artifact", id: second },
    ]);
  const collisionA = await elicit(forged("x", "y @ S r1; artifact z"));
  const collisionB = await elicit(forged("x @ S r1; artifact y", "z"));
  assertEquals(collisionA === collisionB, false);

  const messageEmpty = await elicit(targets([]));
  assertEquals(messageEmpty.includes("Exact evidence targets"), false);
});

Deno.test("project queued-run cancellation requires a verified human elicitation retry", async () => {
  const snapshot = queuedRunSnapshot();
  const app = new CapturingApp();
  const cancellations: Array<{ origin: unknown; command: Record<string, unknown> }> =
    [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      cancelQueuedRun: (origin, command) => {
        cancellations.push({
          origin,
          command: command as unknown as Record<string, unknown>,
        });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const args = {
    ...COMMON,
    runId: "run:queued-before-cancellation",
    rationale: "The reviewed work was superseded before any agent claim.",
  };
  const cancel = app.handler("project_agent_run_cancel");
  const first = await cancel(args, clientContext()) as Record<string, unknown>;
  assertEquals(first.resultType, "input_required");
  const request = (first.inputRequests as Record<string, unknown>)
    .run_cancellation_confirmation as Record<string, unknown>;
  assertEquals(request.method, "elicitation/create");
  assertStringIncludes(
    (request.params as Record<string, unknown>).message as string,
    "has not been claimed or executed",
  );
  assertEquals(cancellations, []);

  await assertRejects(
    async () => {
      await cancel(args, {
        ...clientContext(),
        retryVerified: false,
        inputResponses: {
          run_cancellation_confirmation: {
            action: "accept",
            content: { confirmed: true },
          },
        },
      });
    },
    TypeError,
    "verified signed request state",
  );
  assertEquals(cancellations, []);

  const accepted = await cancel(args, {
    ...clientContext(),
    retryVerified: true,
    inputResponses: {
      run_cancellation_confirmation: {
        action: "accept",
        content: { confirmed: true },
      },
    },
  }) as Record<string, unknown>;
  assertStringIncludes(accepted.content as string, "human cancellation");
  assertEquals(cancellations, [{
    origin: { kind: "human", actorId: "mcp-elicitation:paired-chat@1" },
    command: args,
  }]);

  const tool = app.tool("project_agent_run_cancel");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "commandId",
    "expectedRevision",
    "issuedAt",
    "projectId",
    "rationale",
    "runId",
  ]);
  const serialized = JSON.stringify(schema);
  for (
    const forbidden of [
      "provider",
      "toolName",
      "summary",
      "basis",
      "resultSnapshot",
      "evidenceRefs",
      "cancelledRun",
    ]
  ) {
    assertEquals(
      serialized.includes(forbidden),
      false,
      `${forbidden} must be server-owned`,
    );
  }
});

Deno.test("project unstarted supersession requires a verified human MRTR retry", async () => {
  const snapshot = unstartedSupersessionSnapshot();
  const app = new CapturingApp();
  const calls: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      supersedeUnstartedWorkItem: (origin, command) => {
        calls.push({ origin, command: command as unknown as Record<string, unknown> });
        return Promise.resolve(snapshot);
      },
    }),
  );
  const args = {
    ...COMMON,
    workItemId: "seal-v1",
    predecessorDecisionId: "seal-v1-decision",
    successorWorkItemId: "seal-v2",
    successorDecisionId: "seal-v2-decision",
    rationale: "The V1 seal was never queued; V2 is the reviewed replacement.",
  };
  const supersede = app.handler("project_work_item_supersede_unstarted");
  const first = await supersede(args, clientContext()) as Record<string, unknown>;
  assertEquals(first.resultType, "input_required");
  assertEquals(calls, []);
  const request = (first.inputRequests as Record<string, unknown>)
    .unstarted_work_item_supersession_confirmation as Record<string, unknown>;
  assertEquals(request.method, "elicitation/create");
  assertStringIncludes(
    (request.params as Record<string, unknown>).message as string,
    "no agent run, provider call, or ThreadSnapshot will be created",
  );
  await assertRejects(
    async () => {
      await supersede(args, {
        ...clientContext(),
        retryVerified: false,
        inputResponses: {
          unstarted_work_item_supersession_confirmation: {
            action: "accept",
            content: { confirmed: true },
          },
        },
      });
    },
    TypeError,
    "verified signed request state",
  );
  assertEquals(calls, []);
  await supersede(args, {
    ...clientContext(),
    retryVerified: true,
    inputResponses: {
      unstarted_work_item_supersession_confirmation: {
        action: "accept",
        content: { confirmed: true },
      },
    },
  });
  assertEquals(calls, [{
    origin: { kind: "human", actorId: "mcp-elicitation:paired-chat@1" },
    command: args,
  }]);
  const schema = app.tool("project_work_item_supersede_unstarted")
    .inputSchema as Record<
      string,
      unknown
    >;
  const serialized = JSON.stringify(schema);
  for (const forbidden of ["provider", "toolName", "resultSnapshot", "evidenceRefs"]) {
    assertEquals(serialized.includes(forbidden), false, `${forbidden} is server-owned`);
  }
});

Deno.test("project review intent tools list and acknowledge exact pending intent without changing project truth", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-review-intent-mcp-" });
  const journal = new FileProjectReviewIntentStore(directory);
  const snapshot = projectSnapshot({ withDecision: true });
  const pending: ProjectReviewIntent = {
    intentId: "intent-airframe-validate",
    projectId: snapshot.project.id,
    expectedRevision: snapshot.revision,
    decisionId: "airframe-material",
    approvalId: APPROVAL_ID,
    inputFingerprint: FINGERPRINT,
    action: "validate",
    submittedAt: "2026-08-09T03:15:00.000Z",
  };
  try {
    await journal.append(pending);
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      { ...dependencies(snapshot), reviewIntents: journal },
    );

    const snapshotResult = await app.handler("project_snapshot")({
      projectId: snapshot.project.id,
    }) as {
      content: string;
      structuredContent: EngineeringProjectSnapshot;
    };
    assertStringIncludes(snapshotResult.content, "1 actionable intent");
    assertStringIncludes(snapshotResult.content, "1 pending agent receipt");
    assertStringIncludes(snapshotResult.content, "project_review_intent_list");
    assertEquals(snapshotResult.structuredContent, snapshot);

    const listResult = await app.handler("project_review_intent_list")({
      projectId: snapshot.project.id,
    }) as {
      structuredContent: {
        projectId: string;
        projectRevision: number;
        count: number;
        records: Array<{ intent: ProjectReviewIntent; state: string }>;
      };
    };
    assertEquals(listResult.structuredContent, {
      projectId: snapshot.project.id,
      projectRevision: snapshot.revision,
      count: 1,
      records: [{ intent: pending, state: "pending" }],
    });

    const acknowledge = app.handler("project_review_intent_acknowledge");
    await assertRejects(
      async () => {
        await acknowledge({
          projectId: snapshot.project.id,
          expectedRevision: snapshot.revision,
          intentId: pending.intentId,
          decisionId: pending.decisionId,
          approvalId: pending.approvalId,
          inputFingerprint: pending.inputFingerprint,
          action: "request-revision",
        }, clientContext());
      },
      TypeError,
      "does not match the exact project revision, decision, approval, fingerprint, and action",
    );
    assertEquals(
      (await journal.list(snapshot.project.id))[0]?.acknowledgement,
      undefined,
    );

    const acknowledgedResult = await acknowledge({
      projectId: snapshot.project.id,
      expectedRevision: snapshot.revision,
      intentId: pending.intentId,
      decisionId: pending.decisionId,
      approvalId: pending.approvalId,
      inputFingerprint: pending.inputFingerprint,
      action: pending.action,
    }, clientContext()) as {
      content: string;
      structuredContent: {
        projectId: string;
        projectRevision: number;
        state: string;
        record: {
          intent: ProjectReviewIntent;
          acknowledgement: {
            intentId: string;
            projectId: string;
            acknowledgedAt: string;
            acknowledgedBy: string;
          };
        };
        rationale: string;
        nextTool: string;
      };
    };
    assertStringIncludes(acknowledgedResult.content, "No EngineeringProjectSnapshot");
    assertStringIncludes(acknowledgedResult.content, "project_decision_approve");
    assertEquals(Object.keys(acknowledgedResult.structuredContent).sort(), [
      "nextTool",
      "projectId",
      "projectRevision",
      "rationale",
      "record",
      "state",
    ]);
    assertEquals(
      acknowledgedResult.structuredContent.rationale,
      "Workbench review requested validation without an additional reviewer comment.",
    );
    assertEquals(acknowledgedResult.structuredContent.projectId, snapshot.project.id);
    assertEquals(acknowledgedResult.structuredContent.projectRevision, 4);
    assertEquals(acknowledgedResult.structuredContent.state, "acknowledged");
    assertEquals(
      acknowledgedResult.structuredContent.nextTool,
      "project_decision_approve",
    );
    assertEquals(acknowledgedResult.structuredContent.record.intent, pending);
    assertEquals(
      acknowledgedResult.structuredContent.record.acknowledgement.intentId,
      pending.intentId,
    );
    assertEquals(
      acknowledgedResult.structuredContent.record.acknowledgement.acknowledgedBy,
      "mcp:paired-chat@1",
    );
    assertEquals(
      (await app.handler("project_snapshot")({ projectId: snapshot.project.id }) as {
        structuredContent: EngineeringProjectSnapshot;
      }).structuredContent,
      snapshot,
    );
    const restartedApp = new CapturingApp();
    registerProjectControlTools(
      restartedApp as unknown as McpApp,
      { ...dependencies(snapshot), reviewIntents: journal },
    );
    const after = await restartedApp.handler("project_review_intent_list")({
      projectId: snapshot.project.id,
    }) as {
      structuredContent: {
        count: number;
        records: Array<{
          intent: ProjectReviewIntent;
          acknowledgement?: { acknowledgedBy: string; acknowledgedAt: string };
          state: string;
        }>;
      };
    };
    assertEquals(after.structuredContent.count, 1);
    assertEquals(after.structuredContent.records[0]?.state, "acknowledged");
    assertEquals(
      after.structuredContent.records[0]?.acknowledgement,
      acknowledgedResult.structuredContent.record.acknowledgement,
    );
    const restartedSnapshot = await restartedApp.handler("project_snapshot")({
      projectId: snapshot.project.id,
    }) as { content: string; structuredContent: EngineeringProjectSnapshot };
    assertStringIncludes(restartedSnapshot.content, "1 actionable intent");
    assertStringIncludes(restartedSnapshot.content, "1 acknowledged");
    assertEquals(restartedSnapshot.structuredContent, snapshot);

    const retry = await restartedApp.handler("project_review_intent_acknowledge")({
      projectId: snapshot.project.id,
      expectedRevision: snapshot.revision,
      intentId: pending.intentId,
      decisionId: pending.decisionId,
      approvalId: pending.approvalId,
      inputFingerprint: pending.inputFingerprint,
      action: pending.action,
    }, clientContext()) as { content: string; structuredContent: unknown };
    assertStringIncludes(retry.content, "already acknowledged by mcp:paired-chat@1 at");
    assertEquals(retry.structuredContent, acknowledgedResult.structuredContent);

    const changedProject = {
      ...snapshot,
      id: "chat-first-project:project:r5",
      revision: 5,
    } satisfies EngineeringProjectSnapshot;
    const changedApp = new CapturingApp();
    registerProjectControlTools(
      changedApp as unknown as McpApp,
      { ...dependencies(changedProject), reviewIntents: journal },
    );
    const drifted = await changedApp.handler("project_review_intent_list")({
      projectId: snapshot.project.id,
    }) as {
      structuredContent: {
        projectId: string;
        projectRevision: number;
        count: number;
        records: unknown[];
      };
    };
    assertEquals(drifted.structuredContent.count, 1);
    assertEquals(drifted.structuredContent.projectRevision, 5);
    const changedSnapshot = await changedApp.handler("project_snapshot")({
      projectId: snapshot.project.id,
    }) as { content: string; structuredContent: EngineeringProjectSnapshot };
    assertStringIncludes(changedSnapshot.content, "1 actionable intent");
    assertEquals(changedSnapshot.structuredContent, changedProject);
    const driftedRetry = await changedApp.handler(
      "project_review_intent_acknowledge",
    )({
      projectId: snapshot.project.id,
      expectedRevision: snapshot.revision,
      intentId: pending.intentId,
      decisionId: pending.decisionId,
      approvalId: pending.approvalId,
      inputFingerprint: pending.inputFingerprint,
      action: pending.action,
    }, clientContext()) as {
      content: string;
      structuredContent: Record<string, unknown>;
    };
    assertStringIncludes(driftedRetry.content, "current revision 5");
    assertEquals(driftedRetry.structuredContent, {
      projectId: snapshot.project.id,
      projectRevision: 5,
      state: "acknowledged",
      record: acknowledgedResult.structuredContent.record,
      rationale: acknowledgedResult.structuredContent.rationale,
      nextTool: "project_decision_approve",
    });

    const replacedProject = {
      ...changedProject,
      id: "chat-first-project:project:r6",
      revision: 6,
      decisions: changedProject.decisions.map((decision) => ({
        ...decision,
        inputFingerprint: {
          algorithm: "sha256" as const,
          digest: "b".repeat(64),
        },
      })),
    } satisfies EngineeringProjectSnapshot;
    const replacedApp = new CapturingApp();
    registerProjectControlTools(
      replacedApp as unknown as McpApp,
      { ...dependencies(replacedProject), reviewIntents: journal },
    );
    const resolved = await replacedApp.handler("project_review_intent_list")({
      projectId: snapshot.project.id,
    }) as {
      structuredContent: {
        projectId: string;
        projectRevision: number;
        count: number;
        records: unknown[];
      };
    };
    assertEquals(resolved.structuredContent, {
      projectId: snapshot.project.id,
      projectRevision: 6,
      count: 0,
      records: [],
    });

    assertEquals(app.tool("project_review_intent_list").annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assertEquals(app.tool("project_review_intent_acknowledge").annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("project review intent acknowledgement returns the exact reviewer comment as reject rationale", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-review-comment-mcp-" });
  const journal = new FileProjectReviewIntentStore(directory);
  const snapshot = projectSnapshot({ withDecision: true });
  const comment =
    "  Raise the lamp clearance to 30 mm, then show me the exact preview.  ";
  const intent: ProjectReviewIntent = {
    intentId: "intent-airframe-revision-comment",
    projectId: snapshot.project.id,
    expectedRevision: snapshot.revision,
    decisionId: "airframe-material",
    approvalId: APPROVAL_ID,
    inputFingerprint: FINGERPRINT,
    action: "request-revision",
    comment,
    submittedAt: "2026-08-09T03:18:00.000Z",
  };
  try {
    await journal.append(intent);
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      { ...dependencies(snapshot), reviewIntents: journal },
    );
    const result = await app.handler("project_review_intent_acknowledge")({
      projectId: intent.projectId,
      expectedRevision: intent.expectedRevision,
      intentId: intent.intentId,
      decisionId: intent.decisionId,
      approvalId: intent.approvalId,
      inputFingerprint: intent.inputFingerprint,
      action: intent.action,
    }, clientContext()) as {
      structuredContent: {
        projectId: string;
        projectRevision: number;
        state: string;
        record: {
          intent: ProjectReviewIntent;
          acknowledgement: {
            intentId: string;
            projectId: string;
            acknowledgedAt: string;
            acknowledgedBy: string;
          };
        };
        rationale: string;
        nextTool: string;
      };
    };
    assertEquals(result.structuredContent, {
      projectId: snapshot.project.id,
      projectRevision: snapshot.revision,
      state: "acknowledged",
      record: {
        intent,
        acknowledgement: (await journal.list(snapshot.project.id))[0]!
          .acknowledgement!,
      },
      rationale: comment,
      nextTool: "project_decision_reject",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("project review intent acknowledgement refuses a replaced proposal fingerprint", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-review-intent-stale-" });
  const journal = new FileProjectReviewIntentStore(directory);
  const revisionFour = projectSnapshot({ withDecision: true });
  const intent: ProjectReviewIntent = {
    intentId: "intent-stale-airframe",
    projectId: revisionFour.project.id,
    expectedRevision: revisionFour.revision,
    decisionId: "airframe-material",
    approvalId: APPROVAL_ID,
    inputFingerprint: FINGERPRINT,
    action: "request-revision",
    comment: "Please revise the exact material proposal.",
    submittedAt: "2026-08-09T03:20:00.000Z",
  };
  try {
    await journal.append(intent);
    const current = {
      ...revisionFour,
      id: "chat-first-project:project:r5",
      revision: 5,
      decisions: revisionFour.decisions.map((decision) => ({
        ...decision,
        inputFingerprint: {
          algorithm: "sha256" as const,
          digest: "b".repeat(64),
        },
      })),
    } satisfies EngineeringProjectSnapshot;
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      { ...dependencies(current), reviewIntents: journal },
    );

    await assertRejects(
      async () => {
        await app.handler("project_review_intent_acknowledge")({
          projectId: intent.projectId,
          expectedRevision: intent.expectedRevision,
          intentId: intent.intentId,
          decisionId: intent.decisionId,
          approvalId: intent.approvalId,
          inputFingerprint: intent.inputFingerprint,
          action: intent.action,
        }, clientContext());
      },
      TypeError,
      "same input fingerprint at current project revision 5",
    );
    assertEquals((await journal.list(intent.projectId))[0]?.acknowledgement, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("project review intent cannot replay across a same-fingerprint reproposal with a new approval", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-review-reproposal-" });
  const journal = new FileProjectReviewIntentStore(directory);
  const original = projectSnapshot({ withDecision: true });
  const intent: ProjectReviewIntent = {
    intentId: "intent-old-approval-attempt",
    projectId: original.project.id,
    expectedRevision: original.revision,
    decisionId: "airframe-material",
    approvalId: APPROVAL_ID,
    inputFingerprint: FINGERPRINT,
    action: "validate",
    submittedAt: "2026-08-09T03:25:00.000Z",
  };
  try {
    await journal.append(intent);
    const successorApprovalId = "approval:airframe-material:proposal-2";
    const current = {
      ...original,
      id: "chat-first-project:project:r5",
      revision: 5,
      decisions: original.decisions.map((decision) => ({
        ...decision,
        approvalIds: [...decision.approvalIds, successorApprovalId],
      })),
      approvals: [
        ...original.approvals.map((approval) => ({
          ...approval,
          status: "rejected" as const,
          decidedAt: "2026-08-09T03:24:00.000Z",
          decidedBy: "human:reviewer",
          decidedByOrigin: "human" as const,
          rationale: "Propose the same content again as a new attempt.",
        })),
        {
          ...original.approvals[0],
          id: successorApprovalId,
          status: "pending" as const,
          requestedAt: "2026-08-09T03:25:00.000Z",
        },
      ],
    } satisfies EngineeringProjectSnapshot;
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      { ...dependencies(current), reviewIntents: journal },
    );

    const listed = await app.handler("project_review_intent_list")({
      projectId: current.project.id,
    }) as {
      structuredContent: {
        projectId: string;
        projectRevision: number;
        count: number;
        records: unknown[];
      };
    };
    assertEquals(listed.structuredContent, {
      projectId: current.project.id,
      projectRevision: current.revision,
      count: 0,
      records: [],
    });
    await assertRejects(
      () =>
        app.handler("project_review_intent_acknowledge")({
          projectId: intent.projectId,
          expectedRevision: intent.expectedRevision,
          intentId: intent.intentId,
          decisionId: intent.decisionId,
          approvalId: intent.approvalId,
          inputFingerprint: intent.inputFingerprint,
          action: intent.action,
        }, clientContext()) as Promise<unknown>,
      TypeError,
      "is not the exact pending approval attempt",
    );
    assertEquals((await journal.list(intent.projectId))[0]?.acknowledgement, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("project review intent tools keep readable legacy 1.0 records non-actionable", async () => {
  const directory = await Deno.makeTempDir({ prefix: "project-review-legacy-" });
  const snapshot = projectSnapshot({ withDecision: true });
  const legacy = {
    intentId: "intent-legacy-without-approval",
    projectId: snapshot.project.id,
    expectedRevision: snapshot.revision,
    decisionId: "airframe-material",
    inputFingerprint: FINGERPRINT,
    action: "validate" as const,
    submittedAt: "2026-08-09T03:10:00.000Z",
  };
  try {
    await Deno.writeTextFile(
      `${directory}/project-review-intents.jsonl`,
      `${
        JSON.stringify({
          schemaVersion: "project-review-intent-event/1.0",
          kind: "intent",
          intent: legacy,
        })
      }\n`,
    );
    const journal = new FileProjectReviewIntentStore(directory);
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      { ...dependencies(snapshot), reviewIntents: journal },
    );

    const listed = await app.handler("project_review_intent_list")({
      projectId: snapshot.project.id,
    }) as { structuredContent: { count: number; records: unknown[] } };
    assertEquals(listed.structuredContent.count, 0);
    assertEquals(listed.structuredContent.records, []);
    await assertRejects(
      () =>
        app.handler("project_review_intent_acknowledge")({
          projectId: legacy.projectId,
          expectedRevision: legacy.expectedRevision,
          intentId: legacy.intentId,
          decisionId: legacy.decisionId,
          approvalId: APPROVAL_ID,
          inputFingerprint: legacy.inputFingerprint,
          action: legacy.action,
        }, clientContext()) as Promise<unknown>,
      TypeError,
      "is legacy and has no exact approval binding",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler, `Expected ${name} handler to be registered.`);
    return handler;
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    assert(tool, `Expected ${name} tool to be registered.`);
    return tool;
  }

  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }
}

function dependencies(
  snapshot: EngineeringProjectSnapshot,
  commandOverrides: Partial<EngineeringProjectCommandService> = {},
): ProjectControlToolDependencies {
  return {
    projects: {
      get: () => Promise.resolve(snapshot),
      getRevision: () => Promise.resolve(snapshot),
    },
    commands: {
      queueRun: () => Promise.resolve(snapshot),
      approveDecision: () => Promise.resolve(snapshot),
      rejectDecision: () => Promise.resolve(snapshot),
      ...commandOverrides,
    } as unknown as EngineeringProjectCommandService,
  };
}

function clientContext(): ToolHandlerContext {
  return {
    toolName: "test",
    clientInfo: { name: "paired-chat", version: "1" },
  };
}

async function resolvedPlanInspectionFixture(): Promise<{
  readonly current: EngineeringProjectSnapshot;
  readonly queueBasis: EngineeringProjectSnapshot;
  readonly plan: ResolvedOperationPlanV2;
  readonly ref: ResolvedOperationPlanRef;
  readonly runId: string;
}> {
  const threadBasis = {
    kind: "thread-snapshot" as const,
    snapshotId: "chat-first-subject:thread:r7",
    revision: 7,
    subjectId: "chat-first-subject",
  };
  const runId = "run:inspect-modelica-plan";
  const workItem = {
    id: "simulate-modelica-recorded",
    phaseId: "simulation",
    title: "Recorded Modelica simulation",
    description: "One test-only recorded Modelica operation.",
    kind: "simulate" as const,
    operation: {
      id: "simulate.run-modelica-scenario",
      version: "2",
      bindings: [],
    },
    status: "in-progress" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: ["decision:modelica-method"],
    blockerIds: [],
  };
  const decision = {
    id: "decision:modelica-method",
    phaseId: "simulation",
    title: "Qualified Modelica method",
    question: "Approve the qualified method for this recorded Modelica scenario?",
    status: "approved" as const,
    requestedAt: "2026-08-03T11:50:00.000Z",
    inputFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
    inputEvidenceRefs: [],
    approvalIds: ["approval:modelica-method"],
    proposal: {
      summary: "Use the reviewed recorded Modelica method.",
      parameters: [],
      proposedAt: "2026-08-03T11:50:00.000Z",
      proposedBy: { id: "agent:paired-chat", origin: "agent" as const },
    },
  };
  const approval = {
    id: "approval:modelica-method",
    decisionId: decision.id,
    status: "approved" as const,
    requestedAt: "2026-08-03T11:51:00.000Z",
    decidedAt: "2026-08-03T11:52:00.000Z",
    decidedBy: "human:owner",
    rationale: "The qualified recorded method is approved.",
    decidedByOrigin: "human" as const,
    inputFingerprint: decision.inputFingerprint,
    inputEvidenceRefs: [],
  };
  const queueBasis = {
    ...projectSnapshot({ threadSnapshots: [threadBasis] }),
    workItems: [workItem],
    decisions: [decision],
    approvals: [approval],
  } as unknown as EngineeringProjectSnapshot;
  const ref: ResolvedOperationPlanRef = {
    schemaVersion: "resolved-operation-plan-ref/1.0",
    planId: runId,
    fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
    byteCount: 256,
    casUri: `casys://resolved-operation-plan/sha256/${"f".repeat(64)}`,
  };
  const plan: ResolvedOperationPlanV2 = {
    schemaVersion: "resolved-operation-plan/2.0",
    id: runId,
    run: {
      projectId: queueBasis.project.id,
      runId,
      workItemId: workItem.id,
      inputFingerprint: FINGERPRINT,
      queueBasisProject: {
        snapshotId: queueBasis.id,
        revision: queueBasis.revision,
        fingerprint: await sha256Fingerprint(queueBasis),
      },
    },
    workItem: {
      id: workItem.id,
      operation: { id: workItem.operation.id, version: workItem.operation.version },
      operationFingerprint: await sha256Fingerprint(workItem.operation),
    },
    authorization: {
      kind: "human-mrtr-and-qualified-method",
      mrtr: {
        decisionId: decision.id,
        decisionInputFingerprint: decision.inputFingerprint,
        approvalId: approval.id,
        approvalFingerprint: await sha256Fingerprint(approval),
      },
      methodQualification: {
        id: "qualified-modelica-thermal",
        version: "2.1",
        fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      },
    },
    basis: {
      kind: "thread-snapshot",
      snapshotId: threadBasis.snapshotId,
      revision: threadBasis.revision,
      subjectId: threadBasis.subjectId,
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    },
    sources: [{
      bindingName: "modelSource",
      role: "model-source",
      threadRef: {
        snapshotId: threadBasis.snapshotId,
        snapshotRevision: threadBasis.revision,
        kind: "artifact",
        id: "artifact:modelica-source",
      },
      artifact: {
        fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
        byteCount: 42,
        mediaType: "text/plain",
        casUri: `casys://modelica-source/sha256/${"e".repeat(64)}`,
      },
    }, {
      bindingName: "methodManifest",
      role: "provider-manifest",
      threadRef: {
        snapshotId: threadBasis.snapshotId,
        snapshotRevision: threadBasis.revision,
        kind: "artifact",
        id: "artifact:modelica-provider-manifest",
      },
      artifact: {
        fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        byteCount: 43,
        mediaType: "application/json",
        casUri: `casys://modelica-provider-manifest/sha256/${"c".repeat(64)}`,
      },
    }, {
      bindingName: "simulationCase",
      role: "simulation-case",
      threadRef: {
        snapshotId: threadBasis.snapshotId,
        snapshotRevision: threadBasis.revision,
        kind: "artifact",
        id: "artifact:simulation-case",
      },
      artifact: {
        fingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
        byteCount: 44,
        mediaType: "application/json",
        casUri: `casys://simulation-case-capture/sha256/${"9".repeat(64)}`,
      },
    }],
    action: {
      kind: "dynamic-system-simulation",
      provider: {
        id: "mcp-modelica",
        contract: { id: "resumable", version: "2.1" },
      },
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      normalizer: {
        id: "modelica-run-normalizer",
        version: "2.1",
        authority: "exact-provider-manifest",
      },
      requestId: "request.inspect-modelica-plan",
      input: {
        simulationCase: {
          id: "case:modelica-thermal",
          fingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
          sourceBinding: "simulationCase",
        },
        providerManifestFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        methodManifestSourceBinding: "methodManifest",
        scenarioStartTimeSeconds: 0,
        effectiveTimeoutMs: 30_000,
      },
    },
    expectedProviderResources: {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: {
        id: "mcp-modelica.resumable-artifacts",
        version: "2.1",
      },
      parameterSchema: "absent",
    },
    recovery: {
      policy: "mcp-modelica.resumable-recovery@2.1",
      requestId: "request.inspect-modelica-plan",
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
  const current = {
    ...queueBasis,
    id: "chat-first-project:project:r5",
    revision: 5,
    generatedAt: "2026-08-03T12:05:00.000Z",
    agentRuns: [{
      id: runId,
      workItemId: workItem.id,
      status: "queued",
      summary: "Queued recorded Modelica simulation.",
      queuedAt: "2026-08-03T12:05:00.000Z",
      basis: threadBasis,
      inputFingerprint: FINGERPRINT,
      evidenceRefs: [],
      statusHistory: [{
        commandId: "queue:inspect-modelica-plan",
        status: "queued",
        at: "2026-08-03T12:05:00.000Z",
        actor: { id: "agent:paired-chat", origin: "agent" },
        summary: "Queued recorded Modelica simulation.",
      }],
      resolvedOperationPlan: ref,
    }],
    commandReceipts: [{
      commandId: "queue:inspect-modelica-plan",
      type: "agent-run.queue",
      actor: { id: "agent:paired-chat", origin: "agent" },
      issuedAt: "2026-08-03T12:05:00.000Z",
      appliedAt: "2026-08-03T12:05:00.000Z",
      requestFingerprint: FINGERPRINT,
      resultingSnapshot: { snapshotId: "chat-first-project:project:r5", revision: 5 },
      queuedRun: { runId, workItemId: workItem.id, resolvedOperationPlan: ref },
    }],
  } as unknown as EngineeringProjectSnapshot;
  return { current, queueBasis, plan, ref, runId };
}

function projectSnapshot(
  options: {
    withDecision?: boolean;
    threadSnapshots?: EngineeringProjectSnapshot["threadSnapshots"];
  } = {},
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "3.0",
    id: "chat-first-project:project:r4",
    revision: 4,
    generatedAt: "2026-08-03T12:00:00.000Z",
    project: {
      id: "chat-first-project",
      name: "Chat-first project",
      subjectId: "chat-first-subject",
      objective: { title: "Objective", statement: "Test chat-first control." },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis: {
        kind: "approved-brief",
        projectId: "chat-first-project",
        projectSnapshotId: "chat-first-project:project:r3",
        projectRevision: 3,
        briefId: "brief-1",
        briefSnapshotId: "brief-1:r1",
        briefRevision: 1,
        approvedBriefFingerprint: FINGERPRINT,
      },
      publishedAt: "2026-08-03T11:59:00.000Z",
      publishedBy: { id: "agent:paired-chat", origin: "agent" },
    },
    threadSnapshots: options.threadSnapshots ?? [],
    phases: [],
    workItems: [{
      id: "establish-baseline",
      phaseId: "baseline",
      title: "Establish the engineering baseline",
      description: "Create the first bounded baseline.",
      kind: "define",
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
      status: "ready",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [],
    decisions: options.withDecision
      ? [{
        id: "airframe-material",
        phaseId: "architecture",
        title: "Composite airframe",
        question: "Should the first demonstrator use a composite airframe?",
        status: "proposed",
        requestedAt: "2026-08-03T11:58:00.000Z",
        inputFingerprint: FINGERPRINT,
        inputEvidenceRefs: [],
        approvalIds: [APPROVAL_ID],
        proposal: {
          summary: "Use a composite airframe for the first demonstrator.",
          parameters: [{
            key: "material",
            label: "Material",
            value: "Carbon composite",
          }],
          proposedAt: "2026-08-03T11:58:00.000Z",
          proposedBy: { id: "agent:paired-chat", origin: "agent" },
        },
      }]
      : [],
    approvals: options.withDecision
      ? [{
        id: APPROVAL_ID,
        decisionId: "airframe-material",
        status: "pending",
        requestedAt: "2026-08-03T11:58:00.000Z",
        inputFingerprint: FINGERPRINT,
        inputEvidenceRefs: [],
      }]
      : [],
    blockers: [],
    commandReceipts: [],
  };
}

function unstartedSupersessionSnapshot(): EngineeringProjectSnapshot {
  const snapshot = structuredClone(projectSnapshot()) as Mutable<
    EngineeringProjectSnapshot
  >;
  const predecessor = snapshot.workItems[0]!;
  predecessor.id = "seal-v1";
  predecessor.phaseId = "modelica";
  predecessor.status = "waiting-for-decision";
  predecessor.operation = {
    id: "simulate.seal-simulation-case",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
  predecessor.decisionIds = ["seal-v1-decision"];
  const successor: Mutable<EngineeringProjectSnapshot>["workItems"][number] = {
    ...structuredClone(predecessor),
    id: "seal-v2",
    title: "Qualified Modelica seal V2",
    status: "ready" as const,
    operation: {
      id: "simulate.seal-simulation-case",
      version: "2",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
    decisionIds: ["seal-v2-decision"],
  };
  snapshot.workItems.push(successor);
  snapshot.decisions = [
    {
      id: "seal-v1-decision",
      phaseId: "modelica",
      title: "Legacy seal V1",
      question: "Approve the legacy seal?",
      status: "proposed",
      requestedAt: "2026-08-03T11:58:00.000Z",
      inputFingerprint: FINGERPRINT,
      inputEvidenceRefs: [],
      approvalIds: ["seal-v1-approval"],
      proposal: {
        summary: "Legacy V1 seal.",
        parameters: [{ key: "case", label: "Case", value: "v1" }],
        proposedAt: "2026-08-03T11:58:00.000Z",
        proposedBy: { id: "agent:paired-chat", origin: "agent" },
      },
    },
    {
      id: "seal-v2-decision",
      phaseId: "modelica",
      title: "Qualified seal V2",
      question: "Approve the qualified seal?",
      status: "approved",
      requestedAt: "2026-08-03T11:58:00.000Z",
      inputFingerprint: FINGERPRINT,
      inputEvidenceRefs: [],
      approvalIds: ["seal-v2-approval"],
      proposal: {
        summary: "Qualified V2 seal.",
        parameters: [{ key: "case", label: "Case", value: "v2" }],
        proposedAt: "2026-08-03T11:58:00.000Z",
        proposedBy: { id: "agent:paired-chat", origin: "agent" },
      },
    },
  ];
  snapshot.approvals = [
    {
      id: "seal-v1-approval",
      decisionId: "seal-v1-decision",
      status: "pending",
      requestedAt: "2026-08-03T11:58:00.000Z",
      inputFingerprint: FINGERPRINT,
      inputEvidenceRefs: [],
    },
    {
      id: "seal-v2-approval",
      decisionId: "seal-v2-decision",
      status: "approved",
      requestedAt: "2026-08-03T11:58:00.000Z",
      decidedAt: "2026-08-03T11:59:00.000Z",
      decidedBy: "operator",
      decidedByOrigin: "human",
      rationale: "Approved qualified replacement.",
      inputFingerprint: FINGERPRINT,
      inputEvidenceRefs: [],
    },
  ];
  return snapshot;
}

const RELEASE_BASIS = {
  kind: "thread-snapshot" as const,
  snapshotId: "chat-first-subject:thread:r7",
  revision: 7,
  subjectId: "chat-first-subject",
};

function basisReleaseParameters() {
  const ids = uncertainWriterBasisReleaseIds("run:failed-writer");
  return [
    {
      key: "releaseAction",
      label: "Action",
      value: UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
    },
    {
      key: "releaseOutcome",
      label: "Outcome",
      value: UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
    },
    { key: "failedRunId", label: "Failed run", value: "run:failed-writer" },
    {
      key: "failureCode",
      label: "Failure",
      value: "model-write-architecture-provider-outcome-unknown",
    },
    { key: "subjectId", label: "Subject", value: RELEASE_BASIS.subjectId },
    { key: "snapshotId", label: "Snapshot", value: RELEASE_BASIS.snapshotId },
    { key: "revision", label: "Revision", value: RELEASE_BASIS.revision },
    { key: "blockerId", label: "Blocker", value: ids.blockerId },
    {
      key: "reconciliationDecisionId",
      label: "Reconciliation",
      value: "decision:reconcile",
    },
    {
      key: "reconciliationOutcome",
      label: "Reconciliation outcome",
      value: "write-effect-accepted",
    },
    {
      key: "releaseAttestation",
      label: "Attestation",
      value: "Provider state was reviewed.",
    },
  ];
}

function basisReleaseSnapshot(): EngineeringProjectSnapshot {
  const base = projectSnapshot({ threadSnapshots: [RELEASE_BASIS] });
  const ids = uncertainWriterBasisReleaseIds("run:failed-writer");
  const text = uncertainWriterBasisReleaseText("run:failed-writer");
  const failedWork = {
    id: "work:failed-writer",
    phaseId: "architecture",
    title: "Failed writer",
    description: "Terminal uncertain architecture writer.",
    kind: "architect" as const,
    operation: { id: "model.write-architecture", version: "1", bindings: [] },
    status: "ready" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [] as string[],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [ids.blockerId],
  };
  return {
    ...base,
    phases: [{
      id: "architecture",
      name: "Architecture",
      order: 1,
      description: "Architecture phase.",
      workItemIds: [failedWork.id],
      requiredDecisionIds: [ids.decisionId],
      evidenceRefs: [],
    }],
    workItems: [failedWork],
    agentRuns: [{
      id: "run:failed-writer",
      workItemId: failedWork.id,
      status: "failed",
      summary: "Provider outcome unknown.",
      queuedAt: "2026-08-03T11:00:00.000Z",
      basis: RELEASE_BASIS,
      evidenceRefs: [],
      failure: {
        code: "model-write-architecture-provider-outcome-unknown",
        message: "Provider outcome unknown.",
      },
      uncertainWriterReconciliation: {
        kind: "uncertain-writer-resolved",
        outcome: "write-effect-accepted",
        reconciledAt: "2026-08-03T11:30:00.000Z",
        reconciledBy: { id: "operator", origin: "human" },
        decisionId: "decision:reconcile",
        providerInspectionAttestation: "Provider history shows the write.",
      },
    }],
    decisions: [{
      id: ids.decisionId,
      phaseId: "architecture",
      title: text.decisionTitle,
      question: text.decisionQuestion,
      status: "required",
      requestedAt: "2026-08-03T11:30:00.000Z",
      inputEvidenceRefs: [],
      approvalIds: [],
    }],
    approvals: [],
    blockers: [{
      id: ids.blockerId,
      phaseId: "architecture",
      title: text.blockerTitle,
      description: text.blockerDescription,
      kind: "tool-failure",
      status: "open",
      openedAt: "2026-08-03T11:30:00.000Z",
      workItemIds: [failedWork.id],
      decisionIds: [ids.decisionId],
    }],
  };
}

function queuedRunSnapshot(): EngineeringProjectSnapshot {
  const snapshot = projectSnapshot();
  return {
    ...snapshot,
    workItems: snapshot.workItems.map((item) => ({
      ...item,
      status: item.id === "establish-baseline" ? "in-progress" as const : item.status,
    })),
    agentRuns: [{
      id: "run:queued-before-cancellation",
      workItemId: "establish-baseline",
      status: "queued",
      summary: "Execute the reviewed documentary baseline.",
      queuedAt: "2026-08-03T12:00:00.000Z",
      basis: snapshot.plan!.basis,
      inputFingerprint: FINGERPRINT,
      evidenceRefs: [],
      statusHistory: [{
        commandId: "queue-before-cancellation",
        status: "queued",
        at: "2026-08-03T12:00:00.000Z",
        actor: { id: "mcp:paired-chat@1", origin: "agent" },
        summary: "Execute the reviewed documentary baseline.",
      }],
    }],
  };
}
