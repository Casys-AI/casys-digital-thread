import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  McpToolCall,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { OracleRequirement } from "../../../domain/kernel/proof-case.ts";
import type { AdmittedObservationSelection } from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import {
  type AdmittedObservationOraclePair,
  callAdmittedObservationConstraintOracle,
  prepareAdmittedObservationOracleCall,
} from "./admitted-observation-syson-evaluator.ts";

const SYSML_REQUIREMENT_ELEMENT_ID = "placeholder-requirement";
const THREAD_REQUIREMENT_ID = "thread-placeholder-requirement";

const SELECTION: AdmittedObservationSelection = {
  outputSymbolId: "placeholder-output",
  role: "final",
  requirementElementId: SYSML_REQUIREMENT_ELEMENT_ID,
  requirementMetric: "placeholder-output",
  declaredUnit: "unit-pending-source",
};

const REQUIREMENT: OracleRequirement = {
  id: SYSML_REQUIREMENT_ELEMENT_ID,
  name: "placeholder",
  metric: "placeholder-output",
  operator: "<=",
  limit: { value: 1, unit: "unit-pending-source" },
};

const PAIR: AdmittedObservationOraclePair = {
  selection: SELECTION,
  requirement: REQUIREMENT,
  threadRequirementId: THREAD_REQUIREMENT_ID,
  observation: { value: 0, unit: "unit-pending-source" },
};

Deno.test(
  "identity unit match prepares a syson_constraint_evaluate request without converting units",
  () => {
    const prepared = prepareAdmittedObservationOracleCall([PAIR]);
    assertEquals(prepared.request.name, "syson_constraint_evaluate");
    assertEquals(prepared.unresolved, []);
    assertEquals(prepared.request.arguments.values["placeholder-output"], {
      value: 0,
      unit: "unit-pending-source",
    });
    assertEquals(
      prepared.request.arguments.constraints[0]?.id,
      SYSML_REQUIREMENT_ELEMENT_ID,
    );
  },
);

Deno.test(
  "identity unit mismatch stays unresolved and is not converted for SysON",
  () => {
    const prepared = prepareAdmittedObservationOracleCall([{
      ...PAIR,
      observation: { value: 0, unit: "K" },
    }]);
    assertEquals(prepared.dispatched, []);
    assertEquals(prepared.request.arguments.values, {});
    assertEquals(prepared.unresolved, [{
      requirementElementId: SYSML_REQUIREMENT_ELEMENT_ID,
      reason: "unit-identity-mismatch",
    }]);
  },
);

Deno.test(
  "evaluator refuses an OracleRequirement id that is not the exact selection RequirementUsage",
  () => {
    assertThrows(
      () =>
        prepareAdmittedObservationOracleCall([{
          ...PAIR,
          requirement: { ...REQUIREMENT, id: THREAD_REQUIREMENT_ID },
        }]),
      TypeError,
      "is not the exact selection RequirementUsage",
    );
  },
);

Deno.test(
  "evaluator keys SysON by the SysML selection id when the Thread record id differs",
  () => {
    const prepared = prepareAdmittedObservationOracleCall([PAIR]);
    assertEquals(
      prepared.request.arguments.constraints[0]?.id,
      SELECTION.requirementElementId,
    );
    assertEquals(
      prepared.dispatched[0]?.threadRequirementId,
      THREAD_REQUIREMENT_ID,
    );
    assertEquals(
      prepared.dispatched[0]?.requirement.id ===
        prepared.dispatched[0]?.threadRequirementId,
      false,
    );
  },
);

Deno.test(
  "evaluator records SysON unresolved instead of locally comparing observation to limit",
  async () => {
    const client = new RecordingSysonClient({
      results: [{
        constraintId: SYSML_REQUIREMENT_ELEMENT_ID,
        status: "unresolved",
      }],
    });
    const result = await callAdmittedObservationConstraintOracle(client, [PAIR]);
    assertEquals(client.calls.length, 1);
    assertEquals(client.calls[0]?.name, "syson_constraint_evaluate");
    const constraints = client.calls[0]?.arguments?.constraints as
      | Array<{ id?: string }>
      | undefined;
    assertEquals(constraints?.[0]?.id, SYSML_REQUIREMENT_ELEMENT_ID);
    assertEquals(
      result.outcomes.get(SYSML_REQUIREMENT_ELEMENT_ID)?.status,
      "unresolved",
    );
    assertEquals(result.outcomes.get(THREAD_REQUIREMENT_ID), undefined);
    assertEquals(result.capture.request.name, "syson_constraint_evaluate");
  },
);

Deno.test(
  "evaluator does not call SysON when every pair is unit-unresolved",
  async () => {
    const client = new RecordingSysonClient({ results: [] });
    const result = await callAdmittedObservationConstraintOracle(client, [{
      ...PAIR,
      observation: { value: 0, unit: "K" },
    }]);
    assertEquals(client.calls.length, 0);
    assertEquals(result.outcomes.size, 0);
    assertEquals(result.capture.unresolved[0]?.reason, "unit-identity-mismatch");
  },
);

Deno.test("evaluator propagates a SysON transport failure", async () => {
  await assertRejects(
    () => callAdmittedObservationConstraintOracle(new FailingSysonClient(), [PAIR]),
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
