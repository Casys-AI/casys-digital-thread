import { assert, assertEquals } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import type { EngineeringProjectCommandService } from "../application/use-cases/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../domain/project/engineering-project.ts";
import type { EngineeringAgentRunView } from "../domain/project/agent-run-requirement-join.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./project-control.ts";

const AT = "2026-08-19T03:53:30.000Z";
const EVAL_ARTIFACT = "calculix-syson-evaluation-aaa";

Deno.test("project_snapshot hoists Thread evaluations onto a completed @2 run", async () => {
  const snapshot = joinProject();
  const evaluation = {
    id: "eval-1",
    name: "maxDisplacement evaluation",
    requirementId: "requirement-maxDisplacement",
    observationIds: ["obs-1"],
    status: "pass" as const,
    evaluatedAt: AT,
    evaluator: {
      serverId: "syson",
      tool: "syson_constraint_evaluate",
      runId: "capture:aaa",
    },
    evidenceArtifactIds: [EVAL_ARTIFACT],
    message: "The observed value is within the reviewed concept limit.",
    freshness: {
      status: "fresh" as const,
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
    comparison: {
      observationId: "obs-1",
      actual: { value: 0.00662, unit: "mm" },
      operator: "<=" as const,
      limit: { value: 2, unit: "mm" },
      normalizedUnit: "mm",
      margin: { value: 1.99338, unit: "mm" },
    },
  };
  const app = new CapturingApp();
  registerProjectControlTools(app as unknown as McpApp, {
    ...controlDeps(snapshot),
    threadSnapshots: {
      get: (snapshotId) =>
        Promise.resolve(
          snapshotId === "thread-r8"
            ? {
              id: "thread-r8",
              revision: 8,
              subject: { id: "s" },
              evaluations: [evaluation],
              observations: [{
                id: "calculix-observation-result",
                name: "maxDisplacement measured by CalculiX",
                metric: "maxDisplacement",
                quantity: { value: 0.00662, unit: "mm" },
                source: {
                  operation: {
                    serverId: "calculix",
                    tool: "recorded-static",
                    runId: "r-1",
                  },
                  artifactIds: ["calculix-result-json-aaa"],
                  capturedAt: AT,
                },
                freshness: {
                  status: "fresh" as const,
                  changedAt: AT,
                  invalidatedByChangeIds: [],
                },
              }],
            }
            : undefined,
        ),
    },
  });

  const result = await app.handler("project_snapshot")({
    projectId: "p",
  }) as {
    structuredContent: EngineeringProjectSnapshot & {
      agentRuns: EngineeringAgentRunView[];
    };
  };

  assertEquals(result.structuredContent.agentRuns[0]?.join, {
    status: "pass",
    evaluations: [evaluation],
  });
  assertEquals(
    result.structuredContent.agentRuns[0]?.observations?.items?.[0]?.metric,
    "maxDisplacement",
  );
  assertEquals("join" in snapshot.agentRuns[0]!, false);
  assertEquals("observations" in snapshot.agentRuns[0]!, false);
});

Deno.test("project_snapshot omits join when no Thread store is wired", async () => {
  const snapshot = joinProject();
  const app = new CapturingApp();
  registerProjectControlTools(app as unknown as McpApp, controlDeps(snapshot));

  const result = await app.handler("project_snapshot")({
    projectId: "p",
  }) as { structuredContent: EngineeringProjectSnapshot };

  assertEquals(result.structuredContent, snapshot);
});

function joinProject(): EngineeringProjectSnapshot {
  const work: EngineeringWorkItem = {
    id: "wi-fea",
    activityId: "activity:wi-fea",
    phaseId: "phase-fea",
    title: "Run recorded FEA",
    description: "Recorded CalculiX static proof.",
    kind: "verify",
    operation: { id: "verify.run-fea-static-proof", version: "2", bindings: [] },
    status: "completed",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  };
  const run: EngineeringAgentRun = {
    id: "run:fea",
    workItemId: "wi-fea",
    status: "completed",
    summary: "Completed recorded CalculiX static proof.",
    queuedAt: AT,
    startedAt: AT,
    completedAt: AT,
    evidenceRefs: [{
      kind: "artifact",
      id: EVAL_ARTIFACT,
      snapshotId: "thread-r8",
      snapshotRevision: 8,
    }, {
      kind: "artifact",
      id: "calculix-result-json-aaa",
      snapshotId: "thread-r8",
      snapshotRevision: 8,
    }],
    resultSnapshot: {
      snapshotId: "thread-r8",
      revision: 8,
      subjectId: "s",
    },
  };
  return {
    schemaVersion: "4.0",
    id: "p:r1",
    revision: 1,
    generatedAt: AT,
    project: {
      id: "p",
      name: "P",
      subjectId: "s",
      objective: { title: "t", statement: "s" },
    },
    threadSnapshots: [{
      snapshotId: "thread-r8",
      revision: 8,
      subjectId: "s",
    }],
    phases: [],
    workItems: [work],
    agentRuns: [run],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function controlDeps(
  snapshot: EngineeringProjectSnapshot,
): ProjectControlToolDependencies {
  return {
    projects: {
      get: () => Promise.resolve(snapshot),
      getRevision: () => Promise.resolve(snapshot),
    },
    commands: {
      queueRun: () => Promise.resolve(snapshot),
    } as unknown as EngineeringProjectCommandService,
  };
}

class CapturingApp {
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(_tool: MCPTool, handler: ToolHandler): void {
    this.#handlers.set(_tool.name, handler);
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler, `Expected ${name} handler to be registered.`);
    return handler;
  }
}
