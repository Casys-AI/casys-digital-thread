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
} from "../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { ResolvedRunPlanReader } from "../domain/project/resolved-run-plan-sealer.ts";
import { sha256Fingerprint } from "../domain/kernel/deterministic-json.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./project-control.ts";
import {
  UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
  UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
  uncertainWriterBasisReleaseIds,
  uncertainWriterBasisReleaseText,
} from "../domain/record/uncertain-writer-basis-release.ts";
import { LOCAL_YOLO_PROJECT_APPROVAL_MODE } from "./project-approval-mode.ts";
import { sampleTechnicalSourceAnalysisCaptureLocator } from "../testing/technical-source-capture-test-support.ts";
import {
  collectEngineeringActivities,
  stampEngineeringActivityIdentity,
} from "../domain/project/engineering-activity.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../domain/electrical/spice/admitted/run-proposal.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

const APPROVAL_ID = "approval:airframe-material:proposal-1";
const COMMON = {
  commandId: "chat-command-1",
  projectId: "chat-first-project",
  expectedRevision: 4,
  issuedAt: "2026-08-03T12:00:00.000Z",
};

const TECHNICAL_SOURCE_REFERENCE = sampleTechnicalSourceAnalysisCaptureLocator();

const TECHNICAL_SOURCE_CAPTURE_REVIEW = {
  schemaVersion: "technical-source-capture-review/4.0",
  reference: TECHNICAL_SOURCE_REFERENCE,
  parser: { status: "passed", profile: "profile.build123d" },
  levers: {
    status: "unresolved",
    code: "source.no-named-numeric-lever",
    levers: [],
    message:
      "This CAD source has no module-level named numeric literal that reaches result. A constructor photo is not a behave handle.",
  },
} as const;

const TECHNICAL_COMPILATION_ARGS = {
  projectId: "project.drip-tray",
  basis: {
    kind: "thread-snapshot",
    snapshotId: "snapshot.7",
    revision: 7,
    subjectId: "subject.drip-tray",
  },
  sourceRefs: [TECHNICAL_SOURCE_REFERENCE],
} as const;

Deno.test("technical source capture is conditional, exact, and has no project authority", async () => {
  const withoutCapture = new CapturingApp();
  registerProjectControlTools(
    withoutCapture as unknown as McpApp,
    dependencies(projectSnapshot()),
  );
  assertEquals(withoutCapture.hasTool("project_technical_source_capture"), false);

  const app = new CapturingApp();
  const calls: unknown[] = [];
  let projectReads = 0;
  registerProjectControlTools(
    app as unknown as McpApp,
    {
      ...dependencies(projectSnapshot()),
      projects: {
        get: () => {
          projectReads++;
          return Promise.resolve(projectSnapshot());
        },
        getRevision: () => {
          projectReads++;
          return Promise.resolve(projectSnapshot());
        },
      },
      technicalSourceCapture: {
        capture(command) {
          calls.push(command);
          return Promise.resolve(TECHNICAL_SOURCE_CAPTURE_REVIEW);
        },
      },
    },
  );

  assertEquals(app.hasTool("project_technical_source_capture"), true);
  assertEquals(app.hasTool("project_technical_compilation_preview"), false);
  const captureCommand = {
    projectId: "project.drip-tray",
    workspaceRevision: 2,
    attachmentId: "att.source.cad",
    attachmentRevision: 1,
  };
  const result = await app.handler("project_technical_source_capture")(
    captureCommand,
  ) as Record<string, unknown>;
  assert(result.structuredContent === TECHNICAL_SOURCE_CAPTURE_REVIEW);
  assertEquals(calls, [captureCommand]);
  assertEquals(projectReads, 0);
  assertStringIncludes(result.content as string, "parser status passed");
  assertStringIncludes(result.content as string, "CAD levers: unresolved");
  assertStringIncludes(result.content as string, "constructor photo");
  assertStringIncludes(result.content as string, "result.reference");
  assertStringIncludes(result.content as string, "not a SysML bind");
  assertStringIncludes(
    result.content as string,
    "no EngineeringProject or Thread state",
  );
  assertStringIncludes(result.content as string, "no MRTR decision");
  assertStringIncludes(result.content as string, "no execution authority");

  const tool = app.tool("project_technical_source_capture");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assertClosedTechnicalInputSchema(tool.outputSchema as Record<string, unknown>);
  assertEquals(
    Object.keys(
      (tool.outputSchema as { properties: Record<string, unknown> }).properties,
    ).sort(),
    ["levers", "parser", "reference", "schemaVersion"],
  );
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "attachmentId",
    "attachmentRevision",
    "projectId",
    "workspaceRevision",
  ]);
  assertEquals(schema.additionalProperties, false);
  assertEquals("sourceText" in (schema.properties as Record<string, unknown>), false);
  assertNoTechnicalAuthorityFields(schema);

  await assertRejects(
    () =>
      app.handler("project_technical_source_capture")({
        ...captureCommand,
        provider: "mcp-build123d",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): provider",
  );
  assertEquals(calls.length, 1);
});

Deno.test("technical compilation preview forwards exact closed facts and passes through the ready review result", async () => {
  const withoutPreview = new CapturingApp();
  registerProjectControlTools(
    withoutPreview as unknown as McpApp,
    dependencies(projectSnapshot()),
  );
  assertEquals(
    withoutPreview.hasTool("project_technical_compilation_preview"),
    false,
  );

  const app = new CapturingApp();
  const calls: unknown[] = [];
  let projectReads = 0;
  const readyResult = {
    status: "ready-for-review",
    document: {
      schemaVersion: "technical-compilation/2.0",
      status: "ready-for-review",
      projections: [],
    },
    fingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
    gaps: [],
    draft: {
      schemaVersion: "technical-compilation-draft-reference/1.0",
      draftId: `technical-compilation:project.drip-tray:${"4".repeat(64)}`,
      projectId: "project.drip-tray",
      documentFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
      envelopeFingerprint: { algorithm: "sha256", digest: "5".repeat(64) },
    },
    decisionParameters: [{
      key: "technicalCompilation.draftId",
      label: "Technical compilation draft",
      value: `technical-compilation:project.drip-tray:${"4".repeat(64)}`,
    }],
  } as const;
  registerProjectControlTools(
    app as unknown as McpApp,
    {
      ...dependencies(projectSnapshot()),
      projects: {
        get: () => {
          projectReads++;
          return Promise.resolve(projectSnapshot());
        },
        getRevision: () => {
          projectReads++;
          return Promise.resolve(projectSnapshot());
        },
      },
      technicalCompilationPreview: {
        execute(command) {
          calls.push(command);
          return Promise.resolve(readyResult) as never;
        },
      },
    },
  );

  const result = await app.handler("project_technical_compilation_preview")(
    structuredClone(TECHNICAL_COMPILATION_ARGS),
  ) as Record<string, unknown>;
  assert(result.structuredContent === readyResult);
  assertEquals(calls, [TECHNICAL_COMPILATION_ARGS]);
  assertEquals(projectReads, 0);
  assertStringIncludes(result.content as string, "ready for review");
  assertStringIncludes(result.content as string, "only from decisionParameters");
  assertStringIncludes(result.content as string, "do not invent them");

  const tool = app.tool("project_technical_compilation_preview");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "basis",
    "projectId",
    "sourceRefs",
  ]);
  assertEquals(schema.additionalProperties, false);
  assertClosedTechnicalInputSchema(schema);
  assertNoTechnicalAuthorityFields(schema);

  await assertRejects(
    () =>
      app.handler("project_technical_compilation_preview")({
        ...structuredClone(TECHNICAL_COMPILATION_ARGS),
        toolName: "build123d_export",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): toolName",
  );
  await assertRejects(
    () =>
      app.handler("project_technical_compilation_preview")({
        ...structuredClone(TECHNICAL_COMPILATION_ARGS),
        bindings: [],
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): bindings",
  );
  const foreignReference = structuredClone(TECHNICAL_COMPILATION_ARGS);
  (foreignReference.sourceRefs[0] as unknown as Record<string, unknown>).path =
    "/tmp/code.py";
  await assertRejects(
    () =>
      app.handler("project_technical_compilation_preview")(
        foreignReference,
      ) as Promise<unknown>,
    TypeError,
    "unsupported field path",
  );
  const reviewAsReference = {
    ...structuredClone(TECHNICAL_COMPILATION_ARGS),
    sourceRefs: [structuredClone(TECHNICAL_SOURCE_CAPTURE_REVIEW)],
  };
  await assertRejects(
    () =>
      app.handler("project_technical_compilation_preview")(
        reviewAsReference,
      ) as Promise<unknown>,
    TypeError,
    "technical-source-capture-review envelope. Pass result.reference",
  );
  assertEquals(calls.length, 1);
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

Deno.test(
  "project_change_append forwards empty phases for existing-phase membership",
  async () => {
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
          calls.push({
            origin,
            command: command as unknown as Record<string, unknown>,
          });
          return Promise.resolve(snapshot);
        },
      }),
    );

    const change = {
      ...COMMON,
      commandId: "chat-change-append-existing-phase",
      baseSnapshot: head,
      phases: [],
      workItems: [{
        id: "seed-syson-model",
        phaseId: "baseline",
        owner: "agent",
        dependsOnWorkItemIds: ["establish-baseline"],
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
    ) as Record<string, unknown>;

    assertStringIncludes(result.content as string, "adds only reviewed work");
    assertEquals(calls, [{
      origin: { kind: "agent", actorId: "mcp:paired-chat@1" },
      command: {
        ...change,
        baseSnapshot: head,
      },
    }]);
  },
);

Deno.test(
  "project_plan_publish and project_change_append share predecessorRevisionId on planned work",
  () => {
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      dependencies(projectSnapshot()),
    );
    const publishItems = workItemSchema(
      app.tool("project_plan_publish").inputSchema,
    );
    const appendItems = workItemSchema(
      app.tool("project_change_append").inputSchema,
    );
    assertEquals(publishItems, appendItems);
    assertEquals(
      (publishItems.properties as Record<string, unknown>).predecessorRevisionId,
      { type: "string", minLength: 1 },
    );
    assertEquals(
      (publishItems.required as string[]).includes("predecessorRevisionId"),
      false,
    );
  },
);

Deno.test(
  "project_change_append forwards the exact predecessorRevisionId unchanged",
  async () => {
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
          calls.push({
            origin,
            command: command as unknown as Record<string, unknown>,
          });
          return Promise.resolve(snapshot);
        },
      }),
    );

    const change = {
      ...COMMON,
      commandId: "chat-change-append-predecessor",
      baseSnapshot: head,
      phases: [],
      workItems: [{
        id: "wi-spice-r18b",
        phaseId: "baseline",
        owner: "agent",
        dependsOnWorkItemIds: ["establish-baseline"],
        decisionIds: [],
        predecessorRevisionId: "establish-baseline",
        operation: spiceAdmissionOperation(head),
      }],
      requiredDecisions: [],
    };
    await app.handler("project_change_append")(change, clientContext());

    assertEquals(
      (calls[0]!.command.workItems as Array<Record<string, unknown>>)[0],
      change.workItems[0],
    );
  },
);

Deno.test(
  "project_change_append rejects empty or non-string predecessorRevisionId",
  async () => {
    const head = {
      snapshotId: "chat-first-thread:r1",
      revision: 1,
      subjectId: "chat-first-subject",
    };
    const snapshot = projectSnapshot({ threadSnapshots: [head] });
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      dependencies(snapshot, {
        appendChange: () => Promise.resolve(snapshot),
      }),
    );
    const valid = {
      id: "wi-spice-r18b",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: ["establish-baseline"],
      decisionIds: [],
      operation: spiceAdmissionOperation(head),
    };

    await assertRejects(
      async () => {
        await app.handler("project_change_append")({
          ...COMMON,
          commandId: "chat-change-append-empty-predecessor",
          baseSnapshot: head,
          phases: [],
          workItems: [{ ...valid, predecessorRevisionId: "" }],
          requiredDecisions: [],
        }, clientContext());
      },
      TypeError,
      "workItems[0].predecessorRevisionId must be a non-empty string",
    );
    await assertRejects(
      async () => {
        await app.handler("project_change_append")({
          ...COMMON,
          commandId: "chat-change-append-blank-predecessor",
          baseSnapshot: head,
          phases: [],
          workItems: [{ ...valid, predecessorRevisionId: "   " }],
          requiredDecisions: [],
        }, clientContext());
      },
      TypeError,
      "workItems[0].predecessorRevisionId must be a non-empty string",
    );
    await assertRejects(
      async () => {
        await app.handler("project_change_append")({
          ...COMMON,
          commandId: "chat-change-append-numeric-predecessor",
          baseSnapshot: head,
          phases: [],
          workItems: [{ ...valid, predecessorRevisionId: 18 }],
          requiredDecisions: [],
        }, clientContext());
      },
      TypeError,
      "workItems[0].predecessorRevisionId must be a non-empty string",
    );
  },
);

Deno.test(
  "decoded SPICE successor revisions remain one activity after command-service stamping",
  async () => {
    const head = {
      snapshotId: "chat-first-thread:r1",
      revision: 1,
      subjectId: "chat-first-subject",
    };
    const snapshot = projectSnapshot({ threadSnapshots: [head] });
    const app = new CapturingApp();
    let decodedWorkItems: readonly {
      readonly id: string;
      readonly predecessorRevisionId?: string;
    }[] = [];
    registerProjectControlTools(
      app as unknown as McpApp,
      dependencies(snapshot, {
        appendChange: (_origin, command) => {
          decodedWorkItems = command.workItems;
          return Promise.resolve(snapshot);
        },
      }),
    );

    const spice = spiceAdmissionOperation(head);
    await app.handler("project_change_append")({
      ...COMMON,
      commandId: "chat-change-append-spice-revisions",
      baseSnapshot: head,
      phases: [{
        id: "physics-spice",
        name: "Admitted SPICE",
        description: "Circuit-only admitted SPICE execution.",
      }],
      workItems: [{
        id: "wi-spice-r18",
        phaseId: "physics-spice",
        owner: "agent",
        dependsOnWorkItemIds: ["establish-baseline"],
        decisionIds: [],
        operation: spice,
      }, {
        id: "wi-spice-r18b",
        phaseId: "physics-spice",
        owner: "agent",
        dependsOnWorkItemIds: ["establish-baseline"],
        decisionIds: [],
        predecessorRevisionId: "wi-spice-r18",
        operation: spice,
      }],
      requiredDecisions: [],
    }, clientContext());

    assertEquals(
      decodedWorkItems.map((item) => ({
        id: item.id,
        predecessorRevisionId: item.predecessorRevisionId,
      })),
      [
        { id: "wi-spice-r18", predecessorRevisionId: undefined },
        { id: "wi-spice-r18b", predecessorRevisionId: "wi-spice-r18" },
      ],
    );

    const { stamped, issues } = stampEngineeringActivityIdentity(
      snapshot.workItems,
      decodedWorkItems,
    );
    assertEquals(issues, []);
    const activities = collectEngineeringActivities(
      decodedWorkItems.map((item) => ({
        id: item.id,
        ...stamped.get(item.id)!,
      })),
    );
    assertEquals(activities, [{
      id: "activity:wi-spice-r18",
      rootRevisionId: "wi-spice-r18",
      revisionIds: ["wi-spice-r18", "wi-spice-r18b"],
    }]);
  },
);

Deno.test("project_plan_publish still rejects an empty phases array", async () => {
  const app = new CapturingApp();
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(projectSnapshot()),
  );

  await assertRejects(
    async () => {
      await app.handler("project_plan_publish")({
        ...COMMON,
        commandId: "chat-plan-publish-empty-phases",
        startingPoint: "idea-or-spec",
        phases: [],
        workItems: [{
          id: "establish-baseline",
          phaseId: "baseline",
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: [],
          operation: {
            id: "baseline.from-approved-brief",
            version: "1",
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
        }],
        requiredDecisions: [],
      }, clientContext());
    },
    TypeError,
    "phases must be a non-empty array",
  );
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

Deno.test("local YOLO auto-approves only positive MRTR decisions through the canonical command service", async () => {
  const snapshot = projectSnapshot({ withDecision: true });
  const approved: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  const rejected: unknown[] = [];
  const app = new CapturingApp();
  registerProjectControlTools(
    app as unknown as McpApp,
    {
      ...dependencies(snapshot, {
        approveDecision: (origin, command) => {
          approved.push({
            origin,
            command: command as unknown as Record<string, unknown>,
          });
          return Promise.resolve(snapshot);
        },
        rejectDecision: (origin, command) => {
          rejected.push({ origin, command });
          return Promise.resolve(snapshot);
        },
      }),
      approvalMode: LOCAL_YOLO_PROJECT_APPROVAL_MODE,
    },
  );
  const args = {
    ...COMMON,
    decisionId: "airframe-material",
    inputFingerprint: FINGERPRINT,
    rationale: "Use the reviewed carbon composite proposal.",
  };

  const accepted = await app.handler("project_decision_approve")(
    args,
    clientContext(),
  ) as Record<string, unknown>;
  assertStringIncludes(accepted.content as string, "YOLO local startup opt-in");
  assertEquals(approved, [{
    origin: { kind: "human", actorId: "local-yolo:startup-opt-in" },
    command: {
      ...args,
      inputFingerprint: FINGERPRINT,
      rationale:
        "YOLO local startup opt-in auto-approved positive MRTR decision airframe-material without MCP elicitation. Caller rationale: Use the reviewed carbon composite proposal.",
    },
  }]);

  const rejectResult = await app.handler("project_decision_reject")(
    args,
    clientContext(),
  ) as Record<string, unknown>;
  assertEquals(rejectResult.resultType, "input_required");
  assertEquals(rejected, []);
});

Deno.test("local YOLO auto-cancels a queued unclaimed run", async () => {
  const cancellationApp = new CapturingApp();
  const queued = queuedRunSnapshot();
  const cancellations: Array<{ origin: unknown; command: Record<string, unknown> }> =
    [];
  registerProjectControlTools(cancellationApp as unknown as McpApp, {
    ...dependencies(queued, {
      cancelQueuedRun: (origin, command) => {
        cancellations.push({
          origin,
          command: command as unknown as Record<string, unknown>,
        });
        return Promise.resolve(queued);
      },
    }),
    approvalMode: LOCAL_YOLO_PROJECT_APPROVAL_MODE,
  });
  const cancellation = await cancellationApp.handler("project_agent_run_cancel")({
    ...COMMON,
    runId: "run:queued-before-cancellation",
    rationale: "Cancel this queued run.",
  }, clientContext()) as Record<string, unknown>;
  assertStringIncludes(cancellation.content as string, "YOLO local startup opt-in");
  assertEquals(cancellations, [{
    origin: { kind: "human", actorId: "local-yolo:startup-opt-in" },
    command: {
      ...COMMON,
      runId: "run:queued-before-cancellation",
      rationale:
        "YOLO local startup opt-in auto-approved queued-run cancellation run:queued-before-cancellation without MCP elicitation. Caller rationale: Cancel this queued run.",
    },
  }]);
});

Deno.test(
  "local YOLO auto-abandons work items through the canonical command service without elicitation",
  async () => {
    const snapshot = projectSnapshot({ withDecision: true });
    const abandonments: Array<{ origin: unknown; command: Record<string, unknown> }> =
      [];
    const app = new CapturingApp();
    registerProjectControlTools(app as unknown as McpApp, {
      ...dependencies(snapshot, {
        abandonWorkItems: (origin, command) => {
          abandonments.push({
            origin,
            command: command as unknown as Record<string, unknown>,
          });
          const workItemIds = command.workItemIds;
          const decisionIds = command.decisionIds;
          return Promise.resolve({
            ...snapshot,
            revision: snapshot.revision + 1,
            workItems: snapshot.workItems.map((item) =>
              workItemIds.includes(item.id)
                ? { ...item, status: "abandoned" as const }
                : item
            ),
            decisions: snapshot.decisions.map((decision) =>
              decisionIds.includes(decision.id)
                ? { ...decision, status: "abandoned" as const }
                : decision
            ),
          });
        },
      }),
      approvalMode: LOCAL_YOLO_PROJECT_APPROVAL_MODE,
    });
    const args = {
      ...COMMON,
      workItemIds: ["establish-baseline"],
      decisionIds: ["airframe-material"],
      rationale: "Drop this unused path.",
    };
    const abandoned = await app.handler("project_work_item_abandon")(
      args,
      clientContext(),
    ) as Record<string, unknown>;
    assertEquals(abandoned.resultType, undefined);
    assertEquals(abandoned.inputRequests, undefined);
    assertStringIncludes(abandoned.content as string, "YOLO local startup opt-in");
    assertStringIncludes(
      abandoned.content as string,
      "No inputResponses or retryVerified value was fabricated",
    );
    assertStringIncludes(
      abandoned.content as string,
      "No agent run, provider call, or ThreadSnapshot was created",
    );
    assertEquals(abandonments, [{
      origin: { kind: "human", actorId: "local-yolo:startup-opt-in" },
      command: {
        ...args,
        rationale:
          "YOLO local startup opt-in auto-approved positive work-item abandonment establish-baseline without MCP elicitation. Caller rationale: Drop this unused path.",
      },
    }]);
    const structured = abandoned.structuredContent as EngineeringProjectSnapshot;
    assertEquals(
      structured.workItems.find((item) => item.id === "establish-baseline")?.status,
      "abandoned",
    );
    assertEquals(
      structured.decisions.find((decision) => decision.id === "airframe-material")
        ?.status,
      "abandoned",
    );
    assertEquals(structured.threadSnapshots, []);
    assertEquals(structured.agentRuns, []);
    assertEquals(
      structured.workItems.find((item) => item.id === "establish-baseline")
        ?.evidenceRefs,
      [],
    );
  },
);

Deno.test(
  "interactive work-item abandonment still elicits and does not abandon",
  async () => {
    const snapshot = projectSnapshot({ withDecision: true });
    const abandonments: Array<{ origin: unknown; command: Record<string, unknown> }> =
      [];
    const app = new CapturingApp();
    registerProjectControlTools(
      app as unknown as McpApp,
      dependencies(snapshot, {
        abandonWorkItems: (origin, command) => {
          abandonments.push({
            origin,
            command: command as unknown as Record<string, unknown>,
          });
          return Promise.resolve(snapshot);
        },
      }),
    );
    const args = {
      ...COMMON,
      workItemIds: ["establish-baseline"],
      decisionIds: ["airframe-material"],
      rationale: "Drop this unused path.",
    };
    const abandon = app.handler("project_work_item_abandon");
    const first = await abandon(args, clientContext()) as Record<string, unknown>;
    assertEquals(first.resultType, "input_required");
    const request = (first.inputRequests as Record<string, unknown>)
      .work_item_abandonment_confirmation as Record<string, unknown>;
    assertEquals(request.method, "elicitation/create");
    assertStringIncludes(
      (request.params as Record<string, unknown>).message as string,
      "no agent run, provider call, or ThreadSnapshot will be created",
    );
    assertEquals(abandonments, []);

    await assertRejects(
      async () => {
        await abandon(args, {
          ...clientContext(),
          retryVerified: false,
          inputResponses: {
            work_item_abandonment_confirmation: {
              action: "accept",
              content: { confirmed: true },
            },
          },
        });
      },
      TypeError,
      "verified signed request state",
    );
    assertEquals(abandonments, []);
  },
);

Deno.test(
  "local YOLO executes a human-only queued run through the registered executor with the persisted human origin",
  async () => {
    const snapshot = humanOnlyQueuedRunSnapshot();
    const executions: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
    const app = new CapturingApp();
    registerProjectControlTools(app as unknown as McpApp, {
      ...dependencies(snapshot),
      approvalMode: LOCAL_YOLO_PROJECT_APPROVAL_MODE,
      runExecutor: {
        execute: (origin, command) => {
          executions.push({
            origin,
            command: command as unknown as Record<string, unknown>,
          });
          return Promise.resolve(snapshot);
        },
      },
    });
    const args = {
      ...COMMON,
      runId: "run:queued-before-cancellation",
    };
    const execution = await app.handler("project_agent_run_execute")(
      args,
      clientContext(),
    ) as Record<string, unknown>;
    assertEquals(execution.resultType, undefined);
    assertEquals(execution.inputRequests, undefined);
    assertStringIncludes(execution.content as string, "YOLO local startup opt-in");
    assertStringIncludes(
      execution.content as string,
      "No inputResponses or retryVerified value was fabricated.",
    );
    assertEquals(executions, [{
      origin: { kind: "human", actorId: "local-yolo:startup-opt-in" },
      command: args,
    }]);
  },
);

Deno.test(
  "interactive human-only queued-run execution still elicits and does not execute",
  async () => {
    const snapshot = humanOnlyQueuedRunSnapshot();
    const executions: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
    const app = new CapturingApp();
    registerProjectControlTools(app as unknown as McpApp, {
      ...dependencies(snapshot),
      runExecutor: {
        execute: (origin, command) => {
          executions.push({
            origin,
            command: command as unknown as Record<string, unknown>,
          });
          return Promise.resolve(snapshot);
        },
      },
    });
    const execution = await app.handler("project_agent_run_execute")({
      ...COMMON,
      runId: "run:queued-before-cancellation",
    }, clientContext()) as Record<string, unknown>;
    assertEquals(execution.resultType, "input_required");
    assertEquals(executions, []);
  },
);

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

function assertClosedTechnicalInputSchema(schema: Record<string, unknown>): void {
  if (schema.type === "object") {
    assertEquals(
      schema.additionalProperties,
      false,
      "Every technical MCP object schema must reject unknown fields.",
    );
  }
  const properties = schema.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const value of Object.values(properties)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        assertClosedTechnicalInputSchema(value as Record<string, unknown>);
      }
    }
  }
  const items = schema.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    assertClosedTechnicalInputSchema(items as Record<string, unknown>);
  }
  for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
    const candidates = schema[keyword];
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        assertClosedTechnicalInputSchema(candidate as Record<string, unknown>);
      }
    }
  }
}

function assertNoTechnicalAuthorityFields(schema: Record<string, unknown>): void {
  const forbidden = new Set([
    "provider",
    "tool",
    "toolName",
    "arguments",
    "args",
    "path",
    "mcpUrl",
    "endpoint",
    "credentials",
  ]);
  const properties = schema.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [name, value] of Object.entries(properties)) {
      assert(!forbidden.has(name), `${name} must remain server-owned`);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        assertNoTechnicalAuthorityFields(value as Record<string, unknown>);
      }
    }
  }
  const items = schema.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    assertNoTechnicalAuthorityFields(items as Record<string, unknown>);
  }
}

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
      cancelQueuedRun: () => Promise.resolve(snapshot),
      abandonWorkItems: () => Promise.resolve(snapshot),
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
  const runId = "run:inspect-fea-plan";
  const workItem = {
    id: "verify-fea-isolated",
    activityId: "activity:verify-fea-isolated",
    phaseId: "verification",
    title: "Isolated CalculiX static proof",
    description: "One test-only isolated FEA operation.",
    kind: "verify" as const,
    operation: {
      id: "verify.run-fea-static-proof",
      version: "3",
      bindings: [],
    },
    status: "in-progress" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: ["decision:fea-method"],
    blockerIds: [],
  };
  const decision = {
    id: "decision:fea-method",
    phaseId: "verification",
    title: "Qualified CalculiX method",
    question: "Approve the qualified isolated CalculiX method?",
    status: "approved" as const,
    requestedAt: "2026-08-03T11:50:00.000Z",
    inputFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
    inputEvidenceRefs: [],
    approvalIds: ["approval:fea-method"],
    proposal: {
      summary: "Use the reviewed isolated CalculiX method.",
      parameters: [],
      proposedAt: "2026-08-03T11:50:00.000Z",
      proposedBy: { id: "agent:paired-chat", origin: "agent" as const },
    },
  };
  const approval = {
    id: "approval:fea-method",
    decisionId: decision.id,
    status: "approved" as const,
    requestedAt: "2026-08-03T11:51:00.000Z",
    decidedAt: "2026-08-03T11:52:00.000Z",
    decidedBy: "human:owner",
    rationale: "The qualified isolated method is approved.",
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
  const proofFingerprint = { algorithm: "sha256" as const, digest: "c".repeat(64) };
  const profileFingerprint = { algorithm: "sha256" as const, digest: "e".repeat(64) };
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
        id: "qualified-calculix-isolated-static-proof",
        version: "1.0",
        fingerprint: profileFingerprint,
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
      bindingName: "proofCase",
      role: "proof-case",
      threadRef: {
        snapshotId: threadBasis.snapshotId,
        snapshotRevision: threadBasis.revision,
        kind: "artifact",
        id: "artifact.fea-proof-case",
      },
      artifact: {
        fingerprint: proofFingerprint,
        byteCount: 127,
        mediaType: "application/json",
        casUri: `casys://fea-proof-case-capture/sha256/${proofFingerprint.digest}`,
      },
    }, {
      bindingName: "geometry",
      role: "geometry-source",
      threadRef: {
        snapshotId: threadBasis.snapshotId,
        snapshotRevision: threadBasis.revision,
        kind: "artifact",
        id: "artifact.geometry-step",
      },
      artifact: {
        fingerprint: { algorithm: "sha256", digest: "8".repeat(64) },
        byteCount: 128,
        mediaType: "model/step",
        casUri: `casys://thread-asset/sha256/${"8".repeat(64)}`,
      },
    }],
    action: {
      kind: "isolated-static-structural-analysis",
      executor: {
        id: "casys-local-microsandbox",
        contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
        profileFingerprint,
      },
      lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
      requestId: "request.calculix.local.1",
      input: {
        proofCase: {
          id: "drip-tray-static",
          fingerprint: proofFingerprint,
          sourceBinding: "proofCase",
        },
        geometrySourceBinding: "geometry",
        effectiveElementOrder: 2,
        effectiveTimeoutMs: 60_000,
      },
    },
    expectedProviderResources: {
      receiptSchema: "isolated-code-execution-receipt-record/1.0",
      evidenceSchema: "calculix-isolated-static-evidence/1.0",
      resourceProfile: {
        id: "calculix-isolated.static-artifacts",
        version: "1.0",
      },
    },
    recovery: {
      policy: "calculix-isolated-generation-recovery@1.0",
      requestId: "request.calculix.local.1",
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
      summary: "Queued isolated CalculiX static proof.",
      queuedAt: "2026-08-03T12:05:00.000Z",
      basis: threadBasis,
      inputFingerprint: FINGERPRINT,
      evidenceRefs: [],
      statusHistory: [{
        commandId: "queue:inspect-fea-plan",
        status: "queued",
        at: "2026-08-03T12:05:00.000Z",
        actor: { id: "agent:paired-chat", origin: "agent" },
        summary: "Queued isolated CalculiX static proof.",
      }],
      resolvedOperationPlan: ref,
    }],
    commandReceipts: [{
      commandId: "queue:inspect-fea-plan",
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

function workItemSchema(inputSchema: MCPTool["inputSchema"]): Record<string, unknown> {
  const properties = (inputSchema as Record<string, unknown>).properties as Record<
    string,
    unknown
  >;
  const workItems = properties.workItems as Record<string, unknown>;
  return workItems.items as Record<string, unknown>;
}

function spiceAdmissionOperation(
  head: { snapshotId: string; revision: number },
) {
  return {
    id: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id,
    version: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version,
    bindings: [{
      name: "compilationAdmission",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: head.snapshotId,
          snapshotRevision: head.revision,
          kind: "artifact" as const,
          id: "spice-admission",
        },
      },
    }],
  };
}

function projectSnapshot(
  options: {
    withDecision?: boolean;
    threadSnapshots?: EngineeringProjectSnapshot["threadSnapshots"];
  } = {},
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
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
      activityId: "activity:establish-baseline",
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
    activityId: "activity:work:failed-writer",
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

function humanOnlyQueuedRunSnapshot(): EngineeringProjectSnapshot {
  const snapshot = queuedRunSnapshot();
  return {
    ...snapshot,
    workItems: snapshot.workItems.map((item) =>
      item.id === "establish-baseline"
        ? {
          ...item,
          operation: {
            id: "record.reconcile-uncertain-writer",
            version: "1",
            bindings: [],
          },
        }
        : item
    ),
  };
}
