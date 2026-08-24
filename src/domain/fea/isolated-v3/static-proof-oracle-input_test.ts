import { assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { MechanicalRequirement } from "../seal-case/mechanical-proof-case.ts";
import {
  buildStaticProofOracleInput,
  evaluationsFromStaticProofOracle,
  STATIC_PROOF_METRIC_UNITS,
} from "./static-proof-oracle-input.ts";

const DISP: MechanicalRequirement = {
  id: "dl03-arm-displacement",
  name: "maximumDisplacement",
  metric: "maximum-displacement",
  feature: "maximumDisplacement",
  operator: "<=",
  limit: { value: 1.5, unit: "mm" },
};

const STRESS: MechanicalRequirement = {
  id: "dl03-arm-von-mises",
  name: "maximumVonMisesStress",
  metric: "maximum-von-mises-stress",
  feature: "maximumVonMisesStress",
  operator: "<=",
  limit: { value: 20_000_000, unit: "Pa" },
};

const METRICS = {
  maximumDisplacement: { value: 0.42, unit: "mm" },
  maximumVonMises: { value: 15.3, unit: "MPa" },
};

const VERDICT_FP = "a".repeat(64);

Deno.test("static proof oracle input is the closed two-metric payload without a provider name", () => {
  const input = buildStaticProofOracleInput(METRICS, [DISP, STRESS]);
  assertEquals(Object.keys(STATIC_PROOF_METRIC_UNITS), [
    "maximum-displacement",
    "maximum-von-mises-stress",
  ]);
  assertEquals(input.constraints.length, 2);
  assertEquals(input.constraints[0]?.expression.left.featurePath, [
    "maximumDisplacement",
  ]);
  assertEquals(input.constraints[1]?.expression.left.featurePath, [
    "maximumVonMisesStress",
  ]);
  assertEquals(input.values[DISP.feature], { value: 0.42, unit: "mm" });
  assertEquals(input.values[STRESS.feature], { value: 15.3, unit: "MPa" });
  const encoded = deterministicJson(input);
  assertEquals(encoded.includes("syson"), false);
  assertEquals(encoded.includes("syson_constraint_evaluate"), false);
  assertEquals(encoded.includes("McpToolClient"), false);
  assertEquals(encoded.includes("mcp-"), false);
});

Deno.test("static proof oracle input rejects an unsupported metric", () => {
  const bad = {
    ...DISP,
    metric: "maximum-principal-stress",
  } as unknown as MechanicalRequirement;
  assertThrows(
    () => buildStaticProofOracleInput(METRICS, [bad]),
    Error,
    "unsupported metric",
  );
});

Deno.test("static proof oracle evaluations keep pass/fail comparison and omit unresolved/error comparison", () => {
  const context = {
    verdictCaptureFp: VERDICT_FP,
    evaluatedAt: "2026-08-16T00:00:00.000Z",
    evidenceArtifactId: "eval-capture",
    observationIds: ["obs-disp", "obs-stress"],
    threadRequirementIds: new Map([
      [DISP.id, "thread-disp"],
      [STRESS.id, "thread-stress"],
    ]),
    evaluator: { serverId: "oracle", tool: "evaluate", runId: "capture:aa" },
  };
  const passFail = evaluationsFromStaticProofOracle(
    new Map([
      [DISP.id, {
        status: "pass",
        computedValue: 0.42,
        threshold: 1.5,
        margin: 1.08,
        unit: "mm",
      }],
      [STRESS.id, {
        status: "fail",
        computedValue: 25e6,
        threshold: 20e6,
        margin: -5e6,
        unit: "Pa",
      }],
    ]),
    [DISP, STRESS],
    context,
  );
  assertEquals(passFail[0]?.status, "pass");
  assertEquals(passFail[0]?.requirementId, "thread-disp");
  assertEquals(passFail[0]?.id, `thread-disp-evaluation-${VERDICT_FP}`);
  assertEquals(passFail[0]?.id.includes(DISP.id), false);
  assertEquals(passFail[0]?.comparison !== undefined, true);
  assertEquals(passFail[1]?.status, "fail");
  assertEquals(passFail[1]?.requirementId, "thread-stress");
  assertEquals(passFail[1]?.id, `thread-stress-evaluation-${VERDICT_FP}`);
  assertEquals(passFail[1]?.comparison !== undefined, true);

  const closed = evaluationsFromStaticProofOracle(
    new Map([
      [DISP.id, { status: "error" }],
      [STRESS.id, { status: "unresolved" }],
    ]),
    [DISP, STRESS],
    context,
  );
  assertEquals(closed[0]?.status, "error");
  assertEquals(closed[0]?.comparison, undefined);
  assertEquals(closed[1]?.status, "unresolved");
  assertEquals(closed[1]?.comparison, undefined);
});
