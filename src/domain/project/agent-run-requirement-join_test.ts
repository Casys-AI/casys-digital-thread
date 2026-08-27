import { assertEquals } from "@std/assert";
import type {
  RequirementEvaluation,
  ThreadObservation,
} from "../thread/thread-snapshot.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "./engineering-project.ts";
import { engineeringActivityIdFromRootRevision } from "./engineering-activity.ts";
import {
  type AgentRunJoinThreadSnapshot,
  assembleAgentRunRequirementJoins,
} from "./agent-run-requirement-join.ts";

const AT = "2026-08-19T03:53:30.000Z";
const EVAL_ARTIFACT = "calculix-syson-evaluation-aaa";
const OTHER_EVAL_ARTIFACT = "calculix-syson-evaluation-bbb";

Deno.test("a completed @2 run copies the unique fresh Thread evaluation as join pass", () => {
  const evaluation = evaluationOf({ status: "pass" });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(feaRun(), feaWork()),
    threadMap([evaluation]),
  );

  assertEquals(presented.agentRuns[0]?.join, {
    status: "pass",
    evaluations: [evaluation],
  });
});

Deno.test("a completed @2 run with pass and fail evaluations rolls up to fail", () => {
  const pass = evaluationOf({ id: "eval-pass", status: "pass" });
  const fail = evaluationOf({
    id: "eval-fail",
    status: "fail",
    name: "maxVonMises evaluation",
  });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(feaRun(), feaWork()),
    threadMap([pass, fail]),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "fail");
  assertEquals(presented.agentRuns[0]?.join?.evaluations, [pass, fail]);
});

Deno.test("a completed @2 run without a matching fresh evaluation is unavailable", () => {
  const presented = assembleAgentRunRequirementJoins(
    projectWith(feaRun(), feaWork()),
    threadMap([
      evaluationOf({
        evidenceArtifactIds: [OTHER_EVAL_ARTIFACT],
      }),
    ]),
  );

  assertEquals(presented.agentRuns[0]?.join, {
    status: "unavailable",
    evaluations: [],
  });
});

Deno.test("a completed @2 run whose Thread is absent is unavailable", () => {
  const presented = assembleAgentRunRequirementJoins(
    projectWith(feaRun(), feaWork()),
    new Map(),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "unavailable");
});

Deno.test("a completed @2 run whose Thread identity mismatches is unavailable", () => {
  const presented = assembleAgentRunRequirementJoins(
    projectWith(feaRun(), feaWork()),
    new Map([[
      "thread-r8",
      thread({
        revision: 7,
        evaluations: [evaluationOf({ status: "pass" })],
      }),
    ]]),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "unavailable");
});

Deno.test("a stale Thread evaluation does not join", () => {
  const presented = assembleAgentRunRequirementJoins(
    projectWith(feaRun(), feaWork()),
    threadMap([
      evaluationOf({
        freshness: {
          status: "stale",
          changedAt: AT,
          reason: "superseded",
          invalidatedByChangeIds: ["later"],
        },
      }),
    ]),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "unavailable");
});

Deno.test("a queued join run omits join", () => {
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        status: "queued",
        startedAt: undefined,
        completedAt: undefined,
        resultSnapshot: undefined,
        evidenceRefs: [],
      },
      feaWork({ status: "in-progress" }),
    ),
    threadMap([evaluationOf({ status: "pass" })]),
  );

  assertEquals("join" in (presented.agentRuns[0] ?? {}), false);
});

Deno.test("a completed geometry run omits join even when the Thread has evaluations", () => {
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-geometry",
      },
      {
        ...feaWork(),
        id: "wi-geometry",
        operation: {
          id: "design.write-geometry",
          version: "1",
          bindings: [],
        },
      },
    ),
    threadMap([evaluationOf({ status: "pass" })]),
  );

  assertEquals(
    presented,
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-geometry",
      },
      {
        ...feaWork(),
        id: "wi-geometry",
        operation: {
          id: "design.write-geometry",
          version: "1",
          bindings: [],
        },
      },
    ),
  );
});

Deno.test("verify.run-fea-static-proof@1 hoists the Thread evaluation as join", () => {
  const evaluation = evaluationOf({ status: "pass" });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      feaRun(),
      feaWork({
        operation: {
          id: "verify.run-fea-static-proof",
          version: "1",
          bindings: [],
        },
      }),
    ),
    threadMap([evaluation]),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "pass");
  assertEquals(presented.agentRuns[0]?.join?.evaluations, [evaluation]);
});

Deno.test("a completed sensitivity-base evaluation run hoists the Thread evaluation", () => {
  const evaluation = evaluationOf({
    evidenceArtifactIds: ["sensitivity-base-evaluation-aaa"],
  });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-sens-eval",
        evidenceRefs: [{
          kind: "artifact",
          id: "sensitivity-base-evaluation-aaa",
          snapshotId: "thread-r8",
          snapshotRevision: 8,
        }],
      },
      feaWork({
        id: "wi-sens-eval",
        operation: {
          id: "verify.evaluate-sensitivity-base",
          version: "1",
          bindings: [],
        },
      }),
    ),
    threadMap([evaluation]),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "pass");
  assertEquals(presented.agentRuns[0]?.join?.evaluations, [evaluation]);
});

Deno.test("assemble does not mutate the stored run", () => {
  const stored = projectWith(feaRun(), feaWork());
  assembleAgentRunRequirementJoins(stored, threadMap([evaluationOf({})]));
  assertEquals("join" in stored.agentRuns[0]!, false);
  assertEquals("observations" in stored.agentRuns[0]!, false);
});

Deno.test("a completed DFM run hoists Thread evaluations as join", () => {
  const evaluation = evaluationOf({
    evidenceArtifactIds: ["dfm-check-aaa"],
  });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-dfm",
        evidenceRefs: [{
          kind: "artifact",
          id: "dfm-check-aaa",
          snapshotId: "thread-r8",
          snapshotRevision: 8,
        }],
      },
      feaWork({
        id: "wi-dfm",
        kind: "industrialize",
        operation: {
          id: "industrialize.run-dfm-checks",
          version: "1",
          bindings: [],
        },
      }),
    ),
    threadMap([evaluation]),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "pass");
  assertEquals(presented.agentRuns[0]?.join?.evaluations, [evaluation]);
});

Deno.test("a completed sensitivity run hoists Thread observations", () => {
  const observation = observationOf({
    id: "sensitivity-base-maxDisplacement-aaa",
    metric: "maxDisplacement",
    artifactId: "sensitivity-study-aaa",
  });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-sens",
        evidenceRefs: [{
          kind: "artifact",
          id: "sensitivity-study-aaa",
          snapshotId: "thread-r8",
          snapshotRevision: 8,
        }],
      },
      feaWork({
        id: "wi-sens",
        kind: "review",
        operation: {
          id: "analyze.run-fea-sensitivity",
          version: "1",
          bindings: [],
        },
      }),
    ),
    threadMap([], [observation]),
  );

  assertEquals("join" in (presented.agentRuns[0] ?? {}), false);
  assertEquals(presented.agentRuns[0]?.observations, { items: [observation] });
});

Deno.test("a completed printability run hoists Thread observations", () => {
  const observation = observationOf({
    id: "print-overhang-area",
    metric: "overhang_area_mm2",
    artifactId: "printability-aaa",
    quantity: { value: 12.5, unit: "mm2" },
  });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-print",
        evidenceRefs: [{
          kind: "artifact",
          id: "printability-aaa",
          snapshotId: "thread-r8",
          snapshotRevision: 8,
        }],
      },
      feaWork({
        id: "wi-print",
        kind: "industrialize",
        operation: {
          id: "industrialize.observe-printability",
          version: "1",
          bindings: [],
        },
      }),
    ),
    threadMap([], [observation]),
  );

  assertEquals(presented.agentRuns[0]?.observations, { items: [observation] });
});

Deno.test("a completed print-estimate run hoists Thread observations", () => {
  const observation = observationOf({
    id: "print-time",
    metric: "print_time_s",
    artifactId: "print-estimate-aaa",
    quantity: { value: 3600, unit: "s" },
  });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-estimate",
        evidenceRefs: [{
          kind: "artifact",
          id: "print-estimate-aaa",
          snapshotId: "thread-r8",
          snapshotRevision: 8,
        }],
      },
      feaWork({
        id: "wi-estimate",
        kind: "industrialize",
        operation: {
          id: "industrialize.observe-print-estimate",
          version: "1",
          bindings: [],
        },
      }),
    ),
    threadMap([], [observation]),
  );

  assertEquals(presented.agentRuns[0]?.observations, { items: [observation] });
});

Deno.test("a completed @2 run hoists matching CalculiX observations next to join", () => {
  const evaluation = evaluationOf({ status: "pass" });
  const observation = observationOf({
    id: "calculix-observation-result-wh01",
    metric: "maxDisplacement",
    artifactId: "calculix-result-json-aaa",
    quantity: { value: 0.00662, unit: "mm" },
  });
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        evidenceRefs: [
          ...feaRun().evidenceRefs,
          {
            kind: "artifact",
            id: "calculix-result-json-aaa",
            snapshotId: "thread-r8",
            snapshotRevision: 8,
          },
        ],
      },
      feaWork(),
    ),
    threadMap([evaluation], [observation]),
  );

  assertEquals(presented.agentRuns[0]?.join?.status, "pass");
  assertEquals(presented.agentRuns[0]?.observations, { items: [observation] });
});

Deno.test("an observational run whose Thread is absent is unavailable", () => {
  const presented = assembleAgentRunRequirementJoins(
    projectWith(
      {
        ...feaRun(),
        workItemId: "wi-sens",
        evidenceRefs: [{
          kind: "artifact",
          id: "sensitivity-study-aaa",
          snapshotId: "thread-r8",
          snapshotRevision: 8,
        }],
      },
      feaWork({
        id: "wi-sens",
        operation: {
          id: "analyze.run-fea-sensitivity",
          version: "1",
          bindings: [],
        },
      }),
    ),
    new Map(),
  );

  assertEquals(presented.agentRuns[0]?.observations, {
    status: "unavailable",
    items: [],
  });
});

function projectWith(
  run: EngineeringAgentRun,
  work: EngineeringWorkItem,
): EngineeringProjectSnapshot {
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

function feaWork(
  overrides: Partial<EngineeringWorkItem> = {},
): EngineeringWorkItem {
  const id = overrides.id ?? "wi-fea";
  return {
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
    ...overrides,
    id,
    activityId: engineeringActivityIdFromRootRevision(id),
  };
}

function feaRun(): EngineeringAgentRun {
  return {
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
    }],
    resultSnapshot: {
      snapshotId: "thread-r8",
      revision: 8,
      subjectId: "s",
    },
  };
}

function threadMap(
  evaluations: readonly RequirementEvaluation[],
  observations: readonly ThreadObservation[] = [],
): Map<string, AgentRunJoinThreadSnapshot> {
  return new Map([["thread-r8", thread({ evaluations, observations })]]);
}

function thread(
  overrides: Partial<AgentRunJoinThreadSnapshot>,
): AgentRunJoinThreadSnapshot {
  return {
    id: "thread-r8",
    revision: 8,
    subject: { id: "s" },
    evaluations: [],
    observations: [],
    ...overrides,
  };
}

function observationOf(
  spec: {
    readonly id: string;
    readonly metric: string;
    readonly artifactId: string;
    readonly quantity?: { readonly value: number; readonly unit: string };
  },
): ThreadObservation {
  return {
    id: spec.id,
    name: spec.metric,
    metric: spec.metric,
    quantity: spec.quantity ?? { value: 0.00662, unit: "mm" },
    source: {
      operation: {
        serverId: "calculix",
        tool: "recorded-static",
        runId: "r-1",
      },
      artifactIds: [spec.artifactId],
      capturedAt: AT,
    },
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
  };
}

function evaluationOf(
  overrides: Partial<RequirementEvaluation>,
): RequirementEvaluation {
  return {
    id: "wh01-hook-deflection-evaluation-aaa",
    name: "maxDisplacement evaluation",
    requirementId: "requirement-maxDisplacement",
    observationIds: ["obs-1"],
    status: "pass",
    evaluatedAt: AT,
    evaluator: {
      serverId: "syson",
      tool: "syson_constraint_evaluate",
      runId: "capture:aaa",
    },
    evidenceArtifactIds: [EVAL_ARTIFACT],
    message: "The observed value is within the reviewed concept limit.",
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
    comparison: {
      observationId: "obs-1",
      actual: { value: 0.00662, unit: "mm" },
      operator: "<=",
      limit: { value: 2, unit: "mm" },
      normalizedUnit: "mm",
      margin: { value: 1.99338, unit: "mm" },
    },
    ...overrides,
  };
}
