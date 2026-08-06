import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { EngineeringProjectCommandError } from "../../../domain/project/engineering-project-command-service.ts";
import { parseCm01DripTrayMechanicalProof } from "../../../domain/cm01/cm01-drip-tray-mechanical-proof.ts";
import {
  createThreadSnapshot,
  validateThreadSnapshot,
} from "../../../domain/thread/thread-snapshot-validation.ts";
import { captureCm01DripTrayMechanical } from "../../captures/cm01-drip-tray-mechanical-capture.ts";
import {
  callMechanicalConstraintOracle,
  CoffeeMachineCm01V3MechanicalRunExecutor,
  evaluationFromOracle,
  materializeCoffeeMachineCm01V3MechanicalSnapshot,
  type ParsedOracleResult,
  parseOracleOutcome,
} from "./coffee-machine-cm01-v3-mechanical-run-executor.ts";
import type { McpToolResult } from "../../mcp/http-mcp-tool-client.ts";
import type { OracleRequirement } from "../../../domain/analysis/proof-case.ts";

Deno.test("CM-01 V3 mechanical executor rejects human and foreign project commands before a provider call", async () => {
  const providers = {
    calls: 0,
    callTool() {
      this.calls++;
      return Promise.reject(new Error("must not call"));
    },
    callToolTextResult() {
      this.calls++;
      return Promise.reject(new Error("must not call"));
    },
  };
  const executor = new CoffeeMachineCm01V3MechanicalRunExecutor({
    projects: {
      get() {
        return Promise.resolve(undefined);
      },
    } as never,
    commands: {} as never,
    snapshots: {} as never,
    proof: proof(),
    syson: providers,
    build123d: providers,
    calculix: providers,
    attempts: {} as never,
    captures: {} as never,
    lease: {
      async withLease(
        _project: string,
        _run: string,
        callback: () => Promise<unknown>,
      ) {
        return await callback();
      },
    } as never,
  });
  const command = {
    commandId: "command",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: 1,
    issuedAt: "2026-08-03T16:00:00.000Z",
    runId: "run",
  };
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human" }, command),
    EngineeringProjectCommandError,
    "Only an authenticated agent",
  );
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent" }, command),
    EngineeringProjectCommandError,
    "does not exist",
  );
  assertEquals(providers.calls, 0);
});

Deno.test("CM-01 V3 mechanical materialization records only the CalculiX-attested STEP consumption", async () => {
  const capture = await captureCm01DripTrayMechanical(
    new StaticClient(exportResult()),
    new StaticClient(solveResult()),
    proof(),
    () => "2026-08-03T16:00:00.000Z",
  );
  const oracleResults = new Map<string, ParsedOracleResult>([
    [
      "assembly_max_displacement",
      {
        status: "pass",
        computedValue: 0.1,
        threshold: 1,
        margin: 0.9,
        marginPercent: 90,
        unit: "mm",
      },
    ],
    [
      "assembly_max_von_mises",
      {
        status: "pass",
        computedValue: 0.5,
        threshold: 20,
        margin: 19.5,
        marginPercent: 97.5,
        unit: "MPa",
      },
    ],
  ]);
  const materialized = await materializeCoffeeMachineCm01V3MechanicalSnapshot(
    baseSnapshot(),
    "run:mechanical",
    capture,
    "casys://test/mechanical-capture",
    proof(),
    oracleResults,
  );
  const step = materialized.snapshot.artifacts.find((artifact) =>
    artifact.name === "CM-01 V3 isolated DripTray STEP"
  )!;
  assertEquals(step.inputArtifactIds, []);
  assertEquals(
    materialized.snapshot.consumptions.filter((item) =>
      item.consumer.serverId === "build123d"
    ).length,
    0,
  );
  assertEquals(
    materialized.snapshot.consumptions.filter((item) =>
      item.consumer.serverId === "calculix" && item.artifactId === step.id
    ).length,
    1,
  );
});

Deno.test("evaluationFromOracle builds a pass evaluation with the oracle normalizedUnit", () => {
  const freshness = baseFreshness();
  const req = displacementRequirement(freshness);
  const obs = { id: "obs-disp", quantity: { value: 0.1, unit: "mm" } };
  const evaluator = {
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    runId: "run:t",
  };
  const oracleResult: ParsedOracleResult = {
    status: "pass",
    computedValue: 0.1,
    threshold: 1,
    margin: 0.9,
    marginPercent: 90,
    unit: "mm",
  };
  const ev = evaluationFromOracle(
    req,
    obs,
    oracleResult,
    evaluator,
    "solve",
    "2026-08-04T00:00:00.000Z",
    freshness,
  );
  assertEquals(ev.status, "pass");
  assertEquals(ev.comparison?.normalizedUnit, "mm");
  assertEquals(ev.comparison?.actual, { value: 0.1, unit: "mm" });
  assertEquals(ev.comparison?.limit, { value: 1, unit: "mm" });
  assertEquals(ev.comparison?.margin, { value: 0.9, unit: "mm" });
  assertEquals(ev.evaluator.serverId, "syson");
  assertEquals(ev.evaluator.tool, "syson_constraint_evaluate");
});

Deno.test("evaluationFromOracle propagates oracle fail status without recomputing locally", () => {
  const freshness = baseFreshness();
  const req = displacementRequirement(freshness);
  const obs = { id: "obs-disp", quantity: { value: 1.5, unit: "mm" } };
  const evaluator = {
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    runId: "run:t",
  };
  const oracleResult: ParsedOracleResult = {
    status: "fail",
    computedValue: 1.5,
    threshold: 1,
    margin: -0.5,
    marginPercent: -50,
    unit: "mm",
  };
  const ev = evaluationFromOracle(
    req,
    obs,
    oracleResult,
    evaluator,
    "solve",
    "2026-08-04T00:00:00.000Z",
    freshness,
  );
  assertEquals(ev.status, "fail");
  assertEquals(ev.comparison?.normalizedUnit, "mm");
  assertEquals(ev.comparison?.actual, { value: 1.5, unit: "mm" });
});

Deno.test("evaluationFromOracle propagates oracle error status without a comparison field", () => {
  const freshness = baseFreshness();
  const req = displacementRequirement(freshness);
  const obs = { id: "obs-disp", quantity: { value: 0.1, unit: "mm" } };
  const evaluator = {
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    runId: "run:t",
  };
  const oracleResult: ParsedOracleResult = { status: "error" };
  const ev = evaluationFromOracle(
    req,
    obs,
    oracleResult,
    evaluator,
    "solve",
    "2026-08-04T00:00:00.000Z",
    freshness,
  );
  assertEquals(ev.status, "error");
  assertEquals(ev.comparison, undefined);
});

Deno.test("evaluationFromOracle propagates oracle unresolved status without a comparison field", () => {
  const freshness = baseFreshness();
  const req = displacementRequirement(freshness);
  const obs = { id: "obs-disp", quantity: { value: 0.1, unit: "mm" } };
  const evaluator = {
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    runId: "run:t",
  };
  const oracleResult: ParsedOracleResult = { status: "unresolved" };
  const ev = evaluationFromOracle(
    req,
    obs,
    oracleResult,
    evaluator,
    "solve",
    "2026-08-04T00:00:00.000Z",
    freshness,
  );
  assertEquals(ev.status, "unresolved");
  assertEquals(ev.comparison, undefined);
});

Deno.test("parseOracleOutcome rejects a response without a results array", () => {
  const reqs = [singleOracleReq()];
  assertThrows(
    () => parseOracleOutcome({}, reqs),
    Error,
    "must be an array",
  );
  assertThrows(
    () => parseOracleOutcome({ results: "not-array" }, reqs),
    Error,
    "must be an array",
  );
});

Deno.test("parseOracleOutcome rejects a unit mismatch in the oracle response", () => {
  const reqs = [singleOracleReq()];
  // Oracle returns "m" instead of the expected "mm".
  assertThrows(
    () =>
      parseOracleOutcome(
        {
          results: [{
            constraintId: "assembly_max_displacement",
            status: "pass",
            computedValue: 0.0001,
            threshold: 0.001,
            margin: 0.0009,
            marginPercent: 90,
            unit: "m",
          }],
        },
        reqs,
      ),
    Error,
    'must equal "mm"',
  );
});

Deno.test("parseOracleOutcome rejects a malformed result item", () => {
  const reqs = [singleOracleReq()];
  assertThrows(
    () =>
      parseOracleOutcome(
        {
          results: [{ constraintId: "assembly_max_displacement", status: "invalid" }],
        },
        reqs,
      ),
    Error,
    "must be pass|fail|error|unresolved",
  );
});

Deno.test("callMechanicalConstraintOracle forwards oracle pass result for displacement", async () => {
  const sysonClient = new OracleClient({
    results: [
      {
        constraintId: "assembly_max_displacement",
        status: "pass",
        computedValue: 0.1,
        threshold: 1,
        margin: 0.9,
        marginPercent: 90,
        unit: "mm",
      },
      {
        constraintId: "assembly_max_von_mises",
        status: "pass",
        computedValue: 0.5,
        threshold: 20,
        margin: 19.5,
        marginPercent: 97.5,
        unit: "MPa",
      },
    ],
  });
  const capture = await captureCm01DripTrayMechanical(
    new StaticClient(exportResult()),
    new StaticClient(solveResult()),
    proof(),
    () => "2026-08-04T00:00:00.000Z",
  );
  const results = await callMechanicalConstraintOracle(sysonClient, capture, proof());
  const disp = results.get("assembly_max_displacement")!;
  const vm = results.get("assembly_max_von_mises")!;
  assertEquals(disp.status, "pass");
  assertEquals(vm.status, "pass");
  if (disp.status === "pass") assertEquals(disp.unit, "mm");
  if (vm.status === "pass") assertEquals(vm.unit, "MPa");
});

Deno.test("callMechanicalConstraintOracle propagates oracle error result without throwing", async () => {
  const sysonClient = new OracleClient({
    results: [
      { constraintId: "assembly_max_displacement", status: "error" },
      { constraintId: "assembly_max_von_mises", status: "unresolved" },
    ],
  });
  const capture = await captureCm01DripTrayMechanical(
    new StaticClient(exportResult()),
    new StaticClient(solveResult()),
    proof(),
    () => "2026-08-04T00:00:00.000Z",
  );
  const results = await callMechanicalConstraintOracle(sysonClient, capture, proof());
  assertEquals(results.get("assembly_max_displacement")?.status, "error");
  assertEquals(results.get("assembly_max_von_mises")?.status, "unresolved");
});

Deno.test(
  "materializeCoffeeMachineCm01V3MechanicalSnapshot fail verdict produces a validated snapshot with named violations and proposed actions",
  async () => {
    const capture = await captureCm01DripTrayMechanical(
      new StaticClient(exportResult()),
      new StaticClient(solveResult()),
      proof(),
      () => "2026-08-03T16:00:00.000Z",
    );
    const oracleResults = new Map<string, ParsedOracleResult>([
      [
        "assembly_max_displacement",
        {
          status: "fail",
          computedValue: 1.5,
          threshold: 1,
          margin: -0.5,
          marginPercent: -50,
          unit: "mm",
        },
      ],
      [
        "assembly_max_von_mises",
        {
          status: "fail",
          computedValue: 25.0,
          threshold: 20,
          margin: -5.0,
          marginPercent: -25,
          unit: "MPa",
        },
      ],
    ]);
    const materialized = await materializeCoffeeMachineCm01V3MechanicalSnapshot(
      baseSnapshot(),
      "run:mechanical:fail",
      capture,
      "casys://test/mechanical-capture-fail",
      proof(),
      oracleResults,
    );

    // Must not throw — the validator enforces every invariant, including
    // fail→violation and violation→proposedAction symmetry rules.
    validateThreadSnapshot(materialized.snapshot);

    assertEquals(materialized.snapshot.violations.length, 2);
    assertEquals(materialized.snapshot.proposedActions.length, 2);

    for (const v of materialized.snapshot.violations) {
      assertEquals(v.status, "open");
      const addressed = materialized.snapshot.proposedActions.some((a) =>
        a.addressesViolationIds.includes(v.id)
      );
      assertEquals(
        addressed,
        true,
        `open violation ${v.id} must have a proposed action`,
      );
      const causeLink = materialized.snapshot.provenance.some(
        (link) =>
          link.relation === "caused_by" &&
          link.from.kind === "violation" &&
          link.from.id === v.id &&
          link.to.kind === "evaluation" &&
          link.to.id === v.evaluationId,
      );
      assertEquals(
        causeLink,
        true,
        `violation ${v.id} must have a caused_by provenance link`,
      );
    }
  },
);

Deno.test(
  "materializeCoffeeMachineCm01V3MechanicalSnapshot pass verdict produces a validated snapshot with no violations and no proposed actions",
  async () => {
    const capture = await captureCm01DripTrayMechanical(
      new StaticClient(exportResult()),
      new StaticClient(solveResult()),
      proof(),
      () => "2026-08-03T16:00:00.000Z",
    );
    const oracleResults = new Map<string, ParsedOracleResult>([
      [
        "assembly_max_displacement",
        {
          status: "pass",
          computedValue: 0.1,
          threshold: 1,
          margin: 0.9,
          marginPercent: 90,
          unit: "mm",
        },
      ],
      [
        "assembly_max_von_mises",
        {
          status: "pass",
          computedValue: 0.5,
          threshold: 20,
          margin: 19.5,
          marginPercent: 97.5,
          unit: "MPa",
        },
      ],
    ]);
    const materialized = await materializeCoffeeMachineCm01V3MechanicalSnapshot(
      baseSnapshot(),
      "run:mechanical:pass",
      capture,
      "casys://test/mechanical-capture-pass",
      proof(),
      oracleResults,
    );

    validateThreadSnapshot(materialized.snapshot);
    assertEquals(materialized.snapshot.violations.length, 0);
    assertEquals(materialized.snapshot.proposedActions.length, 0);
  },
);

Deno.test(
  "materializeCoffeeMachineCm01V3MechanicalSnapshot unresolved verdict produces a validated snapshot without violations — unresolved is publishable",
  async () => {
    const capture = await captureCm01DripTrayMechanical(
      new StaticClient(exportResult()),
      new StaticClient(solveResult()),
      proof(),
      () => "2026-08-03T16:00:00.000Z",
    );
    const oracleResults = new Map<string, ParsedOracleResult>([
      ["assembly_max_displacement", { status: "unresolved" }],
      ["assembly_max_von_mises", { status: "unresolved" }],
    ]);
    const materialized = await materializeCoffeeMachineCm01V3MechanicalSnapshot(
      baseSnapshot(),
      "run:mechanical:unresolved",
      capture,
      "casys://test/mechanical-capture-unresolved",
      proof(),
      oracleResults,
    );

    // An unresolved evaluation is a first-class state, not a failure. The
    // snapshot must pass validateThreadSnapshot, proving that a snapshot
    // carrying an unresolved oracle verdict is publishable.
    validateThreadSnapshot(materialized.snapshot);
    assertEquals(materialized.snapshot.violations.length, 0);
    assertEquals(materialized.snapshot.proposedActions.length, 0);
    assertEquals(
      materialized.snapshot.evaluations.every((ev) => ev.status === "unresolved"),
      true,
    );
  },
);

Deno.test("callMechanicalConstraintOracle rejects malformed oracle structuredContent fail-closed", async () => {
  const sysonClient = new OracleClient({ not_results: [] });
  const capture = await captureCm01DripTrayMechanical(
    new StaticClient(exportResult()),
    new StaticClient(solveResult()),
    proof(),
    () => "2026-08-04T00:00:00.000Z",
  );
  await assertRejects(
    () => callMechanicalConstraintOracle(sysonClient, capture, proof()),
    Error,
    "must be an array",
  );
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseFreshness() {
  return {
    status: "fresh" as const,
    changedAt: "2026-08-04T00:00:00.000Z",
    invalidatedByChangeIds: [] as string[],
  };
}

function displacementRequirement(freshness: ReturnType<typeof baseFreshness>) {
  return {
    id: "req-displacement",
    name: "Maximum displacement",
    statement: "assembly_max_displacement <= 1 [mm]",
    version: "cm01-v3",
    criterion: {
      metric: "assembly_max_displacement",
      operator: "<=" as const,
      limit: { value: 1, unit: "mm" },
    },
    trace: {
      sourceArtifactId: "proof-artifact",
      elementId: "req-displacement",
      targetArtifactIds: ["step-artifact"],
    },
    freshness,
  };
}

function singleOracleReq(): OracleRequirement {
  return {
    id: "assembly_max_displacement",
    name: "DripTray maximum displacement limit",
    metric: "assembly_max_displacement",
    operator: "<=",
    limit: { value: 1, unit: "mm" },
  };
}

function baseSnapshot() {
  const at = "2026-08-03T15:00:00.000Z";
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  return createThreadSnapshot({
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r1:test-base",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      kind: "system",
      version: "test",
      modelArtifactId: "test-model",
    },
    freshness: { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "test-base",
      name: "Test V3 baseline",
      status: "applied" as const,
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "test-model-created",
        kind: "created" as const,
        target: { kind: "artifact" as const, id: "test-model" },
        summary: "Create test model.",
        afterFingerprint: fingerprint,
      }],
    },
    artifacts: [{
      id: "test-model",
      name: "Test CM-01 model",
      kind: "sysml-model" as const,
      version: "test",
      fingerprint,
      producer: { serverId: "syson", tool: "test", runId: "test" },
      inputArtifactIds: [],
      freshness: {
        status: "fresh" as const,
        changedAt: at,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "test-model-change",
      relation: "changes" as const,
      from: { kind: "change" as const, id: "test-model-created" },
      to: { kind: "artifact" as const, id: "test-model" },
      rationale: "Test baseline created the model.",
    }],
    proposedActions: [],
  });
}

const STEP_SHA = "ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84";
function exportResult() {
  return {
    text: "",
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: [{
        format: "step",
        path: "/exports/coffee-machine-cm01-v3-drip-tray.step",
        bytes: 15490,
        sha256: STEP_SHA,
      }],
    },
  };
}
function solveResult() {
  return {
    text: "",
    structuredContent: {
      schemaVersion: "2.0",
      kind: "static-solve",
      inputArtifact: {
        path: "/tmp/input.step",
        sourcePath: "/exports/coffee-machine-cm01-v3-drip-tray.step",
        sha256: STEP_SHA,
        bytes: 15490,
      },
      mesh: {
        nodes: 100,
        elements: 50,
        nodesPerSelection: { PART: 100, FIXED: 10, LOADED: 10 },
      },
      constraints: {
        fixedSelections: ["FIXED"],
        loads: [{ selection: "LOADED", forceN: [0, 0, -100] }],
      },
      metrics: {
        maxDisplacement: { value: 0.1, unit: "mm", nodeId: 1, vectorMm: [0, 0, -0.1] },
        maxVonMises: { value: 0.5, unit: "MPa", elementId: 1 },
      },
    },
  };
}

class StaticClient {
  constructor(private readonly result: McpToolResult) {}
  callTool(): Promise<McpToolResult> {
    return Promise.resolve(structuredClone(this.result));
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("not implemented in test"));
  }
}

/** Mock syson client that returns a fixed structuredContent for syson_constraint_evaluate. */
class OracleClient {
  constructor(private readonly content: Record<string, unknown>) {}
  callTool(): Promise<McpToolResult> {
    return Promise.resolve({
      structuredContent: this.content,
      text: "",
    });
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("not implemented in test"));
  }
}

function proof() {
  return parseCm01DripTrayMechanicalProof({
    schemaVersion: "cm01-v3-drip-tray-static-proof/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-static-proof",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    evidenceBoundary: "concept only",
    geometry: { widthMm: 190, depthMm: 135, heightMm: 28 },
    material: { eMpa: 2200, nu: 0.35 },
    meshSizeMm: 5,
    fixed: { name: "FIXED", box: { min: [-96, 66.5, -15], max: [96, 68.5, 15] } },
    loaded: {
      name: "LOADED",
      box: { min: [-96, -68.5, -15], max: [96, -66.5, 15] },
      forceN: [0, 0, -100],
    },
    limits: { maximumDisplacementMm: 1, maximumVonMisesMpa: 20 },
  });
}
