import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { OracleRequirement } from "../../../domain/kernel/proof-case.ts";
import type { AdmittedObservationSelection } from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import {
  callAdmittedObservationConstraintOracle,
  prepareAdmittedObservationOracleCall,
} from "./admitted-observation-syson-evaluator.ts";

const SELECTION: AdmittedObservationSelection = {
  outputSymbolId: "placeholder-output",
  role: "final",
  requirementElementId: "placeholder-requirement",
  declaredUnit: "unit-pending-source",
};

const REQUIREMENT: OracleRequirement = {
  id: "placeholder-requirement",
  name: "placeholder",
  metric: "placeholder-output",
  operator: "<=",
  limit: { value: 1, unit: "unit-pending-source" },
};

Deno.test(
  "identity unit match prepares a syson_constraint_evaluate request without converting units",
  () => {
    const prepared = prepareAdmittedObservationOracleCall([{
      selection: SELECTION,
      requirement: REQUIREMENT,
      observation: { value: 0, unit: "unit-pending-source" },
    }]);
    assertEquals(prepared.request.name, "syson_constraint_evaluate");
    assertEquals(prepared.unresolved, []);
    assertEquals(prepared.request.arguments.values["placeholder-output"], {
      value: 0,
      unit: "unit-pending-source",
    });
  },
);

Deno.test(
  "identity unit mismatch stays unresolved and is not converted for SysON",
  () => {
    const prepared = prepareAdmittedObservationOracleCall([{
      selection: SELECTION,
      requirement: REQUIREMENT,
      observation: { value: 0, unit: "K" },
    }]);
    assertEquals(prepared.dispatched, []);
    assertEquals(prepared.request.arguments.values, {});
    assertEquals(prepared.unresolved, [{
      requirementElementId: "placeholder-requirement",
      reason: "unit-identity-mismatch",
    }]);
  },
);

Deno.test(
  "evaluator records SysON unresolved instead of locally comparing observation to limit",
  async () => {
    const client = new RecordingSysonClient({
      results: [{
        constraintId: "placeholder-requirement",
        status: "unresolved",
      }],
    });
    const result = await callAdmittedObservationConstraintOracle(client, [{
      selection: SELECTION,
      requirement: REQUIREMENT,
      observation: { value: 0, unit: "unit-pending-source" },
    }]);
    assertEquals(client.calls.length, 1);
    assertEquals(client.calls[0]?.name, "syson_constraint_evaluate");
    assertEquals(result.outcomes.get("placeholder-requirement")?.status, "unresolved");
    assertEquals(result.capture.request.name, "syson_constraint_evaluate");
  },
);

Deno.test(
  "evaluator does not call SysON when every pair is unit-unresolved",
  async () => {
    const client = new RecordingSysonClient({ results: [] });
    const result = await callAdmittedObservationConstraintOracle(client, [{
      selection: SELECTION,
      requirement: REQUIREMENT,
      observation: { value: 0, unit: "K" },
    }]);
    assertEquals(client.calls.length, 0);
    assertEquals(result.outcomes.size, 0);
    assertEquals(result.capture.unresolved[0]?.reason, "unit-identity-mismatch");
  },
);

Deno.test("evaluator propagates a SysON transport failure", async () => {
  await assertRejects(
    () =>
      callAdmittedObservationConstraintOracle(new FailingSysonClient(), [{
        selection: SELECTION,
        requirement: REQUIREMENT,
        observation: { value: 0, unit: "unit-pending-source" },
      }]),
    Error,
    "SysON unavailable",
  );
});

class RecordingSysonClient {
  readonly calls: McpToolCall[] = [];
  constructor(private readonly content: Record<string, unknown>) {}
  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(call);
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
