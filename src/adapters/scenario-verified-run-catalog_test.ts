import { assert, assertEquals } from "@std/assert";
import type { ObservedRunCatalog, RunDetail, RunSummary } from "../domain/types.ts";
import type {
  ModelicaScenarioEvidence,
  ScenarioContractVerification,
} from "./scenario-contract-verifier.ts";
import {
  type ScenarioContractVerifierLike,
  ScenarioVerifiedRunCatalog,
} from "./scenario-verified-run-catalog.ts";

Deno.test("ScenarioVerifiedRunCatalog attaches a live SysON scenario contract and caches its summary", async () => {
  const source = new CatalogFixture(nominalRun());
  const verifier = new VerifierFixture(verification("pass"));
  const catalog = new ScenarioVerifiedRunCatalog({ source, verifier });

  const detail = await catalog.detail("modelica:run_coffee");

  assertEquals(verifier.calls, 1);
  assertEquals(detail?.status, "succeeded");
  assertEquals(detail?.verdictStatus, "passed");
  assertEquals(detail?.passedRequirements, 1);
  assertEquals(detail?.requirements, [{
    id: "scenario-target-temperature-reached",
    title: "Scenario target temperature reached",
    status: "pass",
    computed: { value: 94, unit: "degC", display: "94 degC" },
    limit: { value: 90, unit: "degC", display: "90 degC" },
    operator: ">=",
    margin: { value: 4, unit: "degC", display: "4 degC" },
    marginPercent: 4.44,
  }]);
  assertEquals(detail?.verification, {
    kind: "scenario_contract",
    title: "CoffeeMachine nominal scenario contract",
    source: "mcp-modelica/scenarios/heat-up-nominal.json",
    planId: "coffee-machine-nominal-v1",
    planSha256: PLAN_SHA,
  });
  assertEquals(detail?.stages.at(-1)?.tool, "syson_constraint_evaluate");
  assertEquals(detail?.stages.at(-1)?.status, "passed");
  assertEquals(detail?.evidence.at(-1), {
    id: `modelica:run_coffee:scenario-contract:coffee-machine-nominal-v1:${PLAN_SHA}`,
    kind: "verdict",
    label: "Live SysON verdict: CoffeeMachine nominal scenario contract",
    path: "config/verification-plans/coffee-machine-nominal-v1.json",
    sha256: PLAN_SHA,
    producedBy: "mcp-syson:syson_constraint_evaluate",
  });
  assert(
    detail?.warnings.some((warning) => warning.includes("not a product requirement")),
  );

  assertEquals(await catalog.list(), [{
    id: "modelica:run_coffee",
    name: "coffee-machine-v1 / heat-up-nominal",
    subject: "Modelica 0.1.0",
    status: "succeeded",
    verdictStatus: "passed",
    source: "observed",
    startedAt: "2026-07-30T13:38:54.311Z",
    completedAt: "2026-07-30T13:39:00.398Z",
    passedRequirements: 1,
    failedRequirements: 0,
    unresolvedRequirements: 0,
  }]);
  // list reads its cache; only a detail request invokes the live evaluator.
  assertEquals(verifier.calls, 1);
});

Deno.test("ScenarioVerifiedRunCatalog leaves mismatched evidence not_evaluated", async () => {
  const source = new CatalogFixture(nominalRun());
  const verifier = new VerifierFixture(undefined);
  const catalog = new ScenarioVerifiedRunCatalog({ source, verifier });

  const detail = await catalog.detail("modelica:run_coffee");

  assertEquals(verifier.calls, 1);
  assertEquals(detail?.verdictStatus, "not_evaluated");
  assertEquals(detail?.requirements, []);
  assertEquals(detail?.stages.length, 1);
});

Deno.test("ScenarioVerifiedRunCatalog does not evaluate an unsuccessful simulation", async () => {
  const run = nominalRun();
  run.status = "failed";
  const source = new CatalogFixture(run);
  const verifier = new VerifierFixture(verification("pass"));
  const catalog = new ScenarioVerifiedRunCatalog({ source, verifier });

  const detail = await catalog.detail("modelica:run_coffee");

  assertEquals(verifier.calls, 0);
  assertEquals(detail?.status, "failed");
  assertEquals(detail?.verdictStatus, "not_evaluated");
});

Deno.test("ScenarioVerifiedRunCatalog preserves Modelica evidence when SysON evaluation errors", async () => {
  const source = new CatalogFixture(nominalRun());
  const verifier: ScenarioContractVerifierLike = {
    verify: () => Promise.reject(new Error("SysON MCP request timed out.")),
  };
  const catalog = new ScenarioVerifiedRunCatalog({ source, verifier });

  const detail = await catalog.detail("modelica:run_coffee");

  assertEquals(detail?.status, "succeeded");
  assertEquals(detail?.verdictStatus, "error");
  assertEquals(detail?.measurements[0]?.value, {
    value: 94,
    unit: "degC",
    display: "94 degC",
  });
  assertEquals(detail?.evidence[0]?.sha256, "modelica-result-sha");
  assertEquals(detail?.requirements.at(-1), {
    id: "scenario-contract-evaluation",
    title: "Scenario contract evaluation",
    status: "error",
    message: "SysON MCP request timed out.",
  });
  assertEquals(detail?.stages.at(-1)?.status, "error");
});

Deno.test("ScenarioVerifiedRunCatalog never promotes a malformed SysON pass response", async () => {
  const malformed = verification("pass");
  const results = malformed.outcome.results as Array<Record<string, unknown>>;
  delete results[0].computedValue;
  const source = new CatalogFixture(nominalRun());
  const verifier = new VerifierFixture(malformed);
  const catalog = new ScenarioVerifiedRunCatalog({ source, verifier });

  const detail = await catalog.detail("modelica:run_coffee");

  assertEquals(detail?.status, "succeeded");
  assertEquals(detail?.verdictStatus, "error");
  assertEquals(detail?.requirements.at(-1)?.status, "error");
  assert(
    detail?.warnings.at(-1)?.includes("computedValue must be a finite number"),
  );
});

for (
  const [label, outcome, expectedMessage] of [
    [
      "duplicates a scenario condition",
      () => {
        const invalid = verification("pass");
        const results = invalid.outcome.results as Array<Record<string, unknown>>;
        results.push(structuredClone(results[0]));
        return invalid;
      },
      "SysON returned a duplicate scenario condition: scenario-target-temperature-reached.",
    ],
    [
      "omits every scenario condition",
      () => {
        const invalid = verification("pass");
        invalid.outcome.results = [];
        return invalid;
      },
      "syson_constraint_evaluate returned no comparison results.",
    ],
  ] as const
) {
  Deno.test(`ScenarioVerifiedRunCatalog rejects SysON output that ${label}`, async () => {
    const source = new CatalogFixture(nominalRun());
    const catalog = new ScenarioVerifiedRunCatalog({
      source,
      verifier: new VerifierFixture(outcome()),
    });

    const detail = await catalog.detail("modelica:run_coffee");

    assertEquals(detail?.verdictStatus, "error");
    assertEquals(detail?.requirements.at(-1), {
      id: "scenario-contract-evaluation",
      title: "Scenario contract evaluation",
      status: "error",
      message: expectedMessage,
    });
    assertEquals(detail?.evidence.length, 1);
    assert(detail?.warnings.at(-1)?.includes(expectedMessage));
  });
}

for (
  const [label, makeIncoherent] of [
    [
      "model",
      (value: ScenarioContractVerification) => ({
        ...value,
        evidence: {
          ...value.evidence,
          model: { ...value.evidence.model, version: "other-model-version" },
        },
      }),
    ],
    [
      "scenario",
      (value: ScenarioContractVerification) => ({
        ...value,
        evidence: {
          ...value.evidence,
          scenario: {
            ...value.evidence.scenario,
            sha256: "f".repeat(64),
          },
        },
      }),
    ],
  ] as const
) {
  Deno.test(
    `ScenarioVerifiedRunCatalog attaches an incoherent verifier ${label} identity as an error`,
    async () => {
      const source = new CatalogFixture(nominalRun());
      const catalog = new ScenarioVerifiedRunCatalog({
        source,
        verifier: new VerifierFixture(makeIncoherent(verification("pass"))),
      });

      const detail = await catalog.detail("modelica:run_coffee");

      assertEquals(detail?.verdictStatus, "error");
      assertEquals(detail?.requirements.at(-1), {
        id: "scenario-contract-evaluation",
        title: "Scenario contract evaluation",
        status: "error",
        message:
          "Scenario contract verifier returned evidence that does not match the observed Modelica run.",
      });
      assertEquals(detail?.evidence.length, 1);
      assertEquals(detail?.stages.at(-1)?.status, "error");
    },
  );
}

Deno.test("ScenarioVerifiedRunCatalog attaches an incoherent verifier plan as an error", async () => {
  const invalid = verification("pass");
  invalid.plan = {
    ...invalid.plan,
    scenario: { ...invalid.plan.scenario, sha256: "f".repeat(64) },
  };
  const source = new CatalogFixture(nominalRun());
  const catalog = new ScenarioVerifiedRunCatalog({
    source,
    verifier: new VerifierFixture(invalid),
  });

  const detail = await catalog.detail("modelica:run_coffee");

  assertEquals(detail?.verdictStatus, "error");
  assertEquals(detail?.requirements.at(-1), {
    id: "scenario-contract-evaluation",
    title: "Scenario contract evaluation",
    status: "error",
    message:
      "Scenario contract plan does not bind the observed Modelica model and scenario.",
  });
  assertEquals(detail?.evidence.length, 1);
});

const PLAN_SHA = "2208a36ee6c2bae10422550ad032f43e7720fe25833152840bc9b80da2ed8b7d";

class CatalogFixture implements ObservedRunCatalog {
  constructor(private readonly run: RunDetail) {}

  list(): Promise<readonly RunSummary[]> {
    const {
      id,
      name,
      subject,
      status,
      verdictStatus,
      source,
      startedAt,
      completedAt,
      passedRequirements,
      failedRequirements,
      unresolvedRequirements,
    } = this.run;
    return Promise.resolve([{
      id,
      name,
      subject,
      status,
      verdictStatus,
      source,
      startedAt,
      completedAt,
      passedRequirements,
      failedRequirements,
      unresolvedRequirements,
    }]);
  }

  detail(id: string): Promise<RunDetail | undefined> {
    return Promise.resolve(id === this.run.id ? structuredClone(this.run) : undefined);
  }
}

class VerifierFixture implements ScenarioContractVerifierLike {
  calls = 0;

  constructor(private readonly result: ScenarioContractVerification | undefined) {}

  verify(
    _evidence: ModelicaScenarioEvidence,
  ): Promise<ScenarioContractVerification | undefined> {
    this.calls++;
    return Promise.resolve(this.result);
  }
}

function nominalRun(): RunDetail {
  return {
    id: "modelica:run_coffee",
    name: "coffee-machine-v1 / heat-up-nominal",
    subject: "Modelica 0.1.0",
    status: "succeeded",
    verdictStatus: "not_evaluated",
    source: "observed",
    startedAt: "2026-07-30T13:38:54.311Z",
    completedAt: "2026-07-30T13:39:00.398Z",
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Observed OpenModelica simulation evidence.",
    stages: [{
      id: "modelica-simulation",
      title: "OpenModelica simulation",
      serverId: "modelica",
      tool: "modelica_simulate",
      status: "succeeded",
      summary: "Simulation completed.",
      inputs: {},
      outputs: {},
    }],
    measurements: [{
      id: "water_temperature_max",
      label: "Maximum water temperature",
      value: { value: 94, unit: "degC", display: "94 degC" },
    }],
    provenance: [],
    warnings: [],
    requirements: [],
    evidence: [{
      id: "modelica:run_coffee:0:result",
      kind: "result",
      label: "Simulation result",
      path: "casys://modelica/runs/run_coffee/result.csv",
      sha256: "modelica-result-sha",
      producedBy: "mcp-modelica",
    }],
    modelicaEvidence: {
      runId: "run_coffee",
      fingerprint: "run-fingerprint",
      model: {
        id: "coffee-machine-v1",
        version: "0.1.0",
        sha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
      },
      scenario: {
        id: "heat-up-nominal",
        sha256: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
      },
    },
  };
}

function verification(status: "pass" | "fail"): ScenarioContractVerification {
  const constraint = {
    id: "scenario-target-temperature-reached",
    name: "Scenario target temperature reached",
    expression: {
      kind: "binary" as const,
      op: ">=" as const,
      left: { kind: "ref" as const, featurePath: ["water_temperature_max"] as const },
      right: { kind: "literal" as const, value: 90, unit: "degC" },
    },
  };
  return {
    plan: {
      path: "config/verification-plans/coffee-machine-nominal-v1.json",
      sha256: PLAN_SHA,
      schemaVersion: "1.0",
      id: "coffee-machine-nominal-v1",
      title: "CoffeeMachine nominal scenario contract",
      version: "1.0.0",
      provisional: true,
      source: {
        kind: "versioned-modelica-scenario",
        sourcePath: "mcp-modelica/scenarios/heat-up-nominal.json",
        targetTemperature: { value: 90, unit: "degC" },
        horizon: { value: 900, unit: "s" },
      },
      model: {
        id: "coffee-machine-v1",
        version: "0.1.0",
        sha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
      },
      scenario: {
        id: "heat-up-nominal",
        sha256: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
      },
      constraints: [constraint],
    },
    evidence: {
      runId: "run_coffee",
      model: {
        id: "coffee-machine-v1",
        version: "0.1.0",
        sha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
      },
      scenario: {
        id: "heat-up-nominal",
        sha256: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
      },
    },
    request: {
      tool: "syson_constraint_evaluate",
      arguments: {
        constraints: [constraint],
        values: { water_temperature_max: { value: 94, unit: "degC" } },
      },
    },
    outcome: {
      results: [{
        constraintId: "scenario-target-temperature-reached",
        constraintName: "Scenario target temperature reached",
        status,
        computedValue: 94,
        threshold: 90,
        margin: 4,
        marginPercent: 4.44,
        unit: "degC",
      }],
      summary: {
        total: 1,
        pass: status === "pass" ? 1 : 0,
        fail: status === "fail" ? 1 : 0,
        error: 0,
        unresolved: 0,
      },
    },
  };
}
