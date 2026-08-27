import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { McpToolResult } from "../../../application/ports/out/mcp-tool-client.ts";
import type { MechanicalRequirement } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  buildOracleValues,
  callFeaConstraintOracle,
  FEA_METRIC_TO_CALCULIX,
  type FeaEvaluationContext,
  feaEvaluationsFromOracle,
  type FeaSolverMetrics,
  projectProofRequirementToOracle,
} from "./fea-oracle-adapter.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VERDICT_FP = "a".repeat(64);

const DISP_REQ: MechanicalRequirement = {
  id: "drip-tray-displacement",
  name: "DripTray max displacement",
  metric: "maximum-displacement",
  feature: "drip_tray_max_displacement",
  operator: "<=",
  limit: { value: 1.5, unit: "mm" },
};

const STRESS_REQ: MechanicalRequirement = {
  id: "drip-tray-von-mises",
  name: "DripTray max von Mises stress",
  metric: "maximum-von-mises-stress",
  feature: "drip_tray_max_von_mises",
  operator: "<=",
  limit: { value: 20_000_000, unit: "Pa" },
};

const SOLVER_METRICS: FeaSolverMetrics = {
  maxDisplacement: { value: 0.42, unit: "mm" },
  maxVonMises: { value: 15.3, unit: "MPa" },
};

const EVIDENCE_ID = "fea-verdict-artifact-id";

/** Thread ids differ from the proof-case ids on purpose — that is the point. */
const THREAD_REQUIREMENT_IDS = new Map([
  ["drip-tray-displacement", "requirement-abc123-drip_tray_max_displacement"],
  ["drip-tray-von-mises", "requirement-abc123-drip_tray_max_von_mises"],
]);

const EVALUATION_CONTEXT: FeaEvaluationContext = {
  verdictCaptureFp: VERDICT_FP,
  evaluatedAt: "2026-08-09T10:00:00.000Z",
  evidenceArtifactId: EVIDENCE_ID,
  observationIds: ["obs-displacement", "obs-von-mises"],
  threadRequirementIds: THREAD_REQUIREMENT_IDS,
};

// ---------------------------------------------------------------------------
// projectProofRequirementToOracle — THE CRITICAL PROJECTION
// ---------------------------------------------------------------------------

Deno.test(
  "projectProofRequirementToOracle sets metric to req.feature, not req.metric",
  () => {
    const oracle = projectProofRequirementToOracle(DISP_REQ);
    // The oracle metric must be the SysON featurePath, never the enum kind.
    assertEquals(oracle.metric, DISP_REQ.feature);
    assertEquals(oracle.metric, "drip_tray_max_displacement");
  },
);

Deno.test(
  "projectProofRequirementToOracle metric differs from req.metric for displacement",
  () => {
    const oracle = projectProofRequirementToOracle(DISP_REQ);
    // Assert they are different — mixing the two would produce an unresolvable constraint.
    assertEquals(oracle.metric !== DISP_REQ.metric, true);
  },
);

Deno.test(
  "projectProofRequirementToOracle metric differs from req.metric for von Mises stress",
  () => {
    const oracle = projectProofRequirementToOracle(STRESS_REQ);
    assertEquals(oracle.metric, STRESS_REQ.feature);
    assertEquals(oracle.metric !== STRESS_REQ.metric, true);
  },
);

Deno.test(
  "projectProofRequirementToOracle forwards id, name, operator and limit verbatim",
  () => {
    const oracle = projectProofRequirementToOracle(STRESS_REQ);
    assertEquals(oracle.id, STRESS_REQ.id);
    assertEquals(oracle.name, STRESS_REQ.name);
    assertEquals(oracle.operator, STRESS_REQ.operator);
    assertEquals(oracle.limit.value, STRESS_REQ.limit.value);
    assertEquals(oracle.limit.unit, STRESS_REQ.limit.unit);
  },
);

// ---------------------------------------------------------------------------
// FEA_METRIC_TO_CALCULIX — closed mapping
// ---------------------------------------------------------------------------

Deno.test("FEA_METRIC_TO_CALCULIX maps maximum-displacement to maxDisplacement / mm", () => {
  const entry = FEA_METRIC_TO_CALCULIX.get("maximum-displacement");
  assertEquals(entry?.field, "maxDisplacement");
  assertEquals(entry?.unit, "mm");
});

Deno.test(
  "FEA_METRIC_TO_CALCULIX maps maximum-von-mises-stress to maxVonMises / MPa",
  () => {
    const entry = FEA_METRIC_TO_CALCULIX.get("maximum-von-mises-stress");
    assertEquals(entry?.field, "maxVonMises");
    assertEquals(entry?.unit, "MPa");
  },
);

Deno.test("FEA_METRIC_TO_CALCULIX contains exactly two entries", () => {
  assertEquals(FEA_METRIC_TO_CALCULIX.size, 2);
});

// ---------------------------------------------------------------------------
// buildOracleValues — closed mapping rejects unknown metrics
// ---------------------------------------------------------------------------

Deno.test(
  "buildOracleValues indexes values by req.feature using native CalculiX units",
  () => {
    const values = buildOracleValues(SOLVER_METRICS, [DISP_REQ, STRESS_REQ]);
    // Keyed by SysON featurePath, not by metric kind.
    assertEquals(values["drip_tray_max_displacement"]?.value, 0.42);
    assertEquals(values["drip_tray_max_displacement"]?.unit, "mm");
    assertEquals(values["drip_tray_max_von_mises"]?.value, 15.3);
    assertEquals(values["drip_tray_max_von_mises"]?.unit, "MPa");
  },
);

Deno.test(
  "buildOracleValues does not use req.metric as the key — key equals req.feature",
  () => {
    const values = buildOracleValues(SOLVER_METRICS, [DISP_REQ]);
    // The metric kind string must not appear as a key.
    assertEquals(values["maximum-displacement"], undefined);
    assertEquals(values[DISP_REQ.feature] !== undefined, true);
  },
);

Deno.test("buildOracleValues throws fail-closed for an unknown metric", () => {
  // Bypass the type system to simulate data corruption or a future extension gap.
  const badReq = {
    ...DISP_REQ,
    metric: "maximum-shear-stress",
  } as unknown as MechanicalRequirement;
  assertThrows(
    () => buildOracleValues(SOLVER_METRICS, [badReq]),
    Error,
    "unsupported metric",
  );
});

// ---------------------------------------------------------------------------
// callFeaConstraintOracle — integration with mock SysON client
// ---------------------------------------------------------------------------

/** Mock that returns a pre-built structuredContent verbatim. */
class MockSysonClient {
  constructor(private readonly content: Record<string, unknown>) {}
  callTool(): Promise<McpToolResult> {
    return Promise.resolve({
      structuredContent: structuredClone(this.content),
      text: "",
    });
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("not implemented in test"));
  }
}

class FailingSysonClient {
  callTool(): Promise<McpToolResult> {
    return Promise.reject(new Error("SysON unavailable"));
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("not implemented in test"));
  }
}

const PASS_RESPONSE = {
  results: [
    {
      constraintId: "drip-tray-displacement",
      status: "pass",
      computedValue: 0.42,
      threshold: 1.5,
      margin: 1.08,
      marginPercent: 72,
      unit: "mm",
    },
    {
      constraintId: "drip-tray-von-mises",
      status: "pass",
      computedValue: 15_000_000,
      threshold: 20_000_000,
      margin: 5_000_000,
      marginPercent: 25,
      unit: "Pa",
    },
  ],
};

Deno.test("callFeaConstraintOracle returns parsed outcomes keyed by requirement id", async () => {
  const client = new MockSysonClient(PASS_RESPONSE);
  const values = buildOracleValues(SOLVER_METRICS, [DISP_REQ, STRESS_REQ]);
  const outcomes = await callFeaConstraintOracle(
    client,
    [DISP_REQ, STRESS_REQ],
    values,
  );
  assertEquals(outcomes.get("drip-tray-displacement")?.status, "pass");
  assertEquals(outcomes.get("drip-tray-von-mises")?.status, "pass");
});

Deno.test("callFeaConstraintOracle propagates SysON network failure", async () => {
  const client = new FailingSysonClient();
  const values = buildOracleValues(SOLVER_METRICS, [DISP_REQ, STRESS_REQ]);
  await assertRejects(
    () => callFeaConstraintOracle(client, [DISP_REQ, STRESS_REQ], values),
    Error,
    "SysON unavailable",
  );
});

// ---------------------------------------------------------------------------
// feaEvaluationsFromOracle — pass status
// ---------------------------------------------------------------------------

function buildOutcomes(
  statuses: Array<["pass" | "fail", number, number] | ["error"] | ["unresolved"]>,
  reqs: MechanicalRequirement[],
): ReadonlyMap<
  string,
  import("../../shared/syson-constraint-oracle-outcome.ts").ParsedOracleResult
> {
  const map = new Map<
    string,
    import("../../shared/syson-constraint-oracle-outcome.ts").ParsedOracleResult
  >();
  for (let i = 0; i < reqs.length; i++) {
    const entry = statuses[i]!;
    const req = reqs[i]!;
    if (entry[0] === "pass" || entry[0] === "fail") {
      const [status, computedValue, threshold] = entry;
      map.set(req.id, {
        status,
        computedValue,
        threshold,
        margin: threshold - computedValue,
        marginPercent: ((threshold - computedValue) / threshold) * 100,
        unit: req.limit.unit,
      });
    } else {
      map.set(req.id, { status: entry[0] });
    }
  }
  return map;
}

Deno.test(
  "feaEvaluationsFromOracle pass verdict carries comparison and correct status",
  () => {
    const outcomes = buildOutcomes([["pass", 0.42, 1.5], ["pass", 15e6, 20e6]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    const evals = feaEvaluationsFromOracle(
      outcomes,
      [DISP_REQ, STRESS_REQ],
      EVALUATION_CONTEXT,
    );
    assertEquals(evals.length, 2);
    const disp = evals[0]!;
    assertEquals(disp.status, "pass");
    assertEquals(disp.comparison !== undefined, true);
    assertEquals(disp.comparison?.actual.value, 0.42);
  },
);

Deno.test(
  "feaEvaluationsFromOracle fail verdict carries comparison and correct status",
  () => {
    const outcomes = buildOutcomes([["fail", 2.0, 1.5], ["fail", 25e6, 20e6]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    const evals = feaEvaluationsFromOracle(
      outcomes,
      [DISP_REQ, STRESS_REQ],
      EVALUATION_CONTEXT,
    );
    const disp = evals[0]!;
    assertEquals(disp.status, "fail");
    assertEquals(disp.comparison !== undefined, true);
  },
);

Deno.test(
  "feaEvaluationsFromOracle error verdict has no comparison — validateThreadSnapshot invariant",
  () => {
    const outcomes = buildOutcomes([["error"], ["error"]], [DISP_REQ, STRESS_REQ]);
    const evals = feaEvaluationsFromOracle(
      outcomes,
      [DISP_REQ, STRESS_REQ],
      EVALUATION_CONTEXT,
    );
    const disp = evals[0]!;
    assertEquals(disp.status, "error");
    // comparison must be absent; its presence would cause unexpected_comparison in
    // validateThreadSnapshot and prevent the snapshot from being published.
    assertEquals(disp.comparison, undefined);
  },
);

Deno.test(
  "feaEvaluationsFromOracle unresolved verdict has no comparison — validateThreadSnapshot invariant",
  () => {
    const outcomes = buildOutcomes([["unresolved"], ["unresolved"]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    const evals = feaEvaluationsFromOracle(
      outcomes,
      [DISP_REQ, STRESS_REQ],
      EVALUATION_CONTEXT,
    );
    const disp = evals[0]!;
    assertEquals(disp.status, "unresolved");
    assertEquals(disp.comparison, undefined);
  },
);

// ---------------------------------------------------------------------------
// feaEvaluationsFromOracle — ID namespace: content-addressed, never truncated
// ---------------------------------------------------------------------------

Deno.test(
  "feaEvaluationsFromOracle evaluation IDs embed the full 64-hex verdictCaptureFp",
  () => {
    const outcomes = buildOutcomes([["pass", 0.42, 1.5], ["pass", 15e6, 20e6]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    const evals = feaEvaluationsFromOracle(
      outcomes,
      [DISP_REQ, STRESS_REQ],
      EVALUATION_CONTEXT,
    );
    const disp = evals[0]!;
    const stress = evals[1]!;
    assertEquals(
      disp.id,
      `${THREAD_REQUIREMENT_IDS.get(DISP_REQ.id)}-evaluation-${VERDICT_FP}`,
    );
    assertEquals(
      stress.id,
      `${THREAD_REQUIREMENT_IDS.get(STRESS_REQ.id)}-evaluation-${VERDICT_FP}`,
    );
    // Full 64-hex suffix present — fingerprint is never truncated.
    assertEquals(disp.id.endsWith(VERDICT_FP), true);
    assertEquals(disp.id.split("-evaluation-")[1]?.length, 64);
  },
);

Deno.test(
  "feaEvaluationsFromOracle rejects a truncated verdictCaptureFp",
  () => {
    const badContext: FeaEvaluationContext = {
      ...EVALUATION_CONTEXT,
      verdictCaptureFp: "a".repeat(32), // only 32 chars — truncated
    };
    const outcomes = buildOutcomes([["pass", 0.42, 1.5], ["pass", 15e6, 20e6]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    assertThrows(
      () => feaEvaluationsFromOracle(outcomes, [DISP_REQ, STRESS_REQ], badContext),
      TypeError,
      "sha256 64-lowercase-hex",
    );
  },
);

Deno.test(
  "feaEvaluationsFromOracle rejects an uppercase verdictCaptureFp",
  () => {
    const badContext: FeaEvaluationContext = {
      ...EVALUATION_CONTEXT,
      verdictCaptureFp: "A".repeat(64), // uppercase — not a valid lowercase hex digest
    };
    const outcomes = buildOutcomes([["pass", 0.42, 1.5], ["pass", 15e6, 20e6]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    assertThrows(
      () => feaEvaluationsFromOracle(outcomes, [DISP_REQ, STRESS_REQ], badContext),
      TypeError,
      "sha256 64-lowercase-hex",
    );
  },
);

Deno.test(
  "feaEvaluationsFromOracle sets evaluator to syson/syson_constraint_evaluate",
  () => {
    const outcomes = buildOutcomes([["pass", 0.42, 1.5], ["pass", 15e6, 20e6]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    const evals = feaEvaluationsFromOracle(
      outcomes,
      [DISP_REQ, STRESS_REQ],
      EVALUATION_CONTEXT,
    );
    const ev = evals[0]!;
    assertEquals(ev.evaluator.serverId, "syson");
    assertEquals(ev.evaluator.tool, "syson_constraint_evaluate");
  },
);

Deno.test(
  "feaEvaluationsFromOracle throws when observationIds list is shorter than requirements",
  () => {
    const shortContext: FeaEvaluationContext = {
      ...EVALUATION_CONTEXT,
      observationIds: ["obs-displacement"], // missing second
      threadRequirementIds: THREAD_REQUIREMENT_IDS,
    };
    const outcomes = buildOutcomes([["pass", 0.42, 1.5], ["pass", 15e6, 20e6]], [
      DISP_REQ,
      STRESS_REQ,
    ]);
    assertThrows(
      () => feaEvaluationsFromOracle(outcomes, [DISP_REQ, STRESS_REQ], shortContext),
      Error,
      "observationIds[1] is missing",
    );
  },
);

Deno.test(
  "feaEvaluationsFromOracle throws when oracle outcome is missing for a requirement id",
  () => {
    // Outcomes map is empty — no matching id.
    const emptyOutcomes = new Map<
      string,
      import("../../shared/syson-constraint-oracle-outcome.ts").ParsedOracleResult
    >();
    assertThrows(
      () =>
        feaEvaluationsFromOracle(emptyOutcomes, [DISP_REQ], {
          ...EVALUATION_CONTEXT,
          observationIds: ["obs-displacement"],
          threadRequirementIds: THREAD_REQUIREMENT_IDS,
        }),
      Error,
      "oracle outcome missing",
    );
  },
);

Deno.test(
  "feaEvaluationsFromOracle names the thread requirement, never the proof-case id",
  () => {
    const [displacement] = feaEvaluationsFromOracle(
      new Map([["drip-tray-displacement", {
        status: "pass" as const,
        computedValue: 0.42,
        threshold: 1.5,
        margin: 1.08,
        marginPercent: 72,
        unit: "mm",
      }]]),
      [DISP_REQ],
      { ...EVALUATION_CONTEXT, observationIds: ["obs-displacement"] },
    );

    // A proof case names its requirements locally; the snapshot names them
    // after the sealed artifact they were traced from. An evaluation that
    // keeps the local id evaluates a subject the snapshot does not contain,
    // and the whole publication is rejected — with no run left to inspect.
    assertEquals(
      displacement.requirementId,
      "requirement-abc123-drip_tray_max_displacement",
    );
    assertEquals(
      displacement.id,
      "requirement-abc123-drip_tray_max_displacement-evaluation-" + VERDICT_FP,
    );
    assertEquals(displacement.id.includes(DISP_REQ.id), false);
  },
);

Deno.test(
  "feaEvaluationsFromOracle refuses a requirement it cannot resolve in the thread",
  () => {
    assertThrows(
      () =>
        feaEvaluationsFromOracle(
          new Map([["drip-tray-displacement", {
            status: "pass" as const,
            computedValue: 0.42,
            threshold: 1.5,
            margin: 1.08,
            marginPercent: 72,
            unit: "mm",
          }]]),
          [DISP_REQ],
          {
            ...EVALUATION_CONTEXT,
            observationIds: ["obs-displacement"],
            threadRequirementIds: new Map(),
          },
        ),
      Error,
      "no thread requirement resolved",
    );
  },
);
