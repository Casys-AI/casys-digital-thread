/** Private MCP adapter for the reviewed Modelica capability set. */

import type { SimulationCase } from "../../../domain/analysis/simulation-case.ts";
import type {
  DynamicSystemDispatchRecord,
  DynamicSystemRun,
  DynamicSystemSimulationPlan,
  DynamicSystemSimulator,
  SimulationCaseIdentity,
  SimulationMethodCatalog,
  SimulationPlanResolver,
  SimulationRunReader,
} from "../../../domain/analysis/simulation-capabilities.ts";
import { DynamicSystemResponseError } from "../../../domain/analysis/simulation-capabilities.ts";
import { EngineeringProjectCommandError } from "../../../domain/project/engineering-project-command-service.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import {
  assertSimulateMatchesRunGet,
  canonicalizeSimulateEnvelope,
  parseModelicaRunRecord,
  parseSimulateEnvelopeMinimal,
} from "../../captures/modelica-scenario-run-capture.ts";

const METHOD_CATALOG_TOOL = "modelica_kit_list";
const SIMULATE_TOOL = "modelica_simulate";
const RUN_READER_TOOL = "modelica_run_get";

export class McpModelicaProvider
  implements
    SimulationMethodCatalog,
    SimulationPlanResolver,
    DynamicSystemSimulator,
    SimulationRunReader {
  constructor(private readonly client: McpToolClient) {}

  async assertMethodAvailable(simulationCase: SimulationCase): Promise<void> {
    const result = await this.client.callTool({
      name: METHOD_CATALOG_TOOL,
      arguments: {},
    });
    validateModelicaMethodCatalogRecord(result.structuredContent, simulationCase);
  }

  resolve(simulationCase: SimulationCase): DynamicSystemSimulationPlan {
    return {
      exactDispatchRecord: lowerModelicaSimulationCase(simulationCase),
      readbackOperation: {
        serverId: "modelica",
        operationId: RUN_READER_TOOL,
      },
    };
  }

  async simulate(
    plan: DynamicSystemSimulationPlan,
  ): Promise<DynamicSystemDispatchRecord> {
    const result = await this.client.callTool({
      name: SIMULATE_TOOL,
      arguments: plan.exactDispatchRecord,
    });
    try {
      const minimal = parseSimulateEnvelopeMinimal(result.structuredContent);
      return {
        providerRunId: minimal.runId,
        status: minimal.status,
        exactProviderRecord: structuredClone(result.structuredContent),
        canonicalProviderRecordText: canonicalizeSimulateEnvelope(
          result.structuredContent,
        ),
      };
    } catch (error) {
      throw new DynamicSystemResponseError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  normalizeRecordedRun(
    exactProviderRecord: unknown,
    expected: SimulationCaseIdentity,
  ): DynamicSystemRun {
    return parseModelicaRunRecord(exactProviderRecord, expected);
  }

  async readRun(
    providerRunId: string,
    expected: SimulationCaseIdentity,
  ): Promise<DynamicSystemRun> {
    const result = await this.client.callTool({
      name: RUN_READER_TOOL,
      arguments: { run_id: providerRunId },
    });
    return this.normalizeRecordedRun(result.structuredContent, expected);
  }

  assertDispatchMatchesReadback(
    canonicalDispatchRecordText: string,
    run: DynamicSystemRun,
  ): void {
    assertSimulateMatchesRunGet(canonicalDispatchRecordText, run);
  }
}

/** Exact provider lowering. Kept here so executors never know wire field names. */
export type ModelicaSimulationDispatchArguments = Readonly<{
  readonly model_id: string;
  readonly scenario_id: string;
  readonly parameter_overrides: Readonly<
    Record<string, { readonly value: number; readonly unit: string }>
  >;
  readonly timeout_ms: number;
}>;

export function lowerModelicaSimulationCase(
  simulationCase: SimulationCase,
): ModelicaSimulationDispatchArguments {
  const entries: Array<
    readonly [string, { readonly value: number; readonly unit: string }]
  > = [];
  const seen = new Set<string>();
  for (
    const parameter of [...simulationCase.parameters].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    )
  ) {
    if (seen.has(parameter.id)) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case contains duplicate parameter id "${parameter.id}".`,
      );
    }
    seen.add(parameter.id);
    entries.push([
      parameter.id,
      { value: parameter.value, unit: parameter.unit },
    ]);
  }
  return {
    model_id: simulationCase.kit.modelId,
    scenario_id: simulationCase.scenario.id,
    parameter_overrides: Object.fromEntries(entries),
    timeout_ms: simulationCase.timeoutMs,
  };
}

/** Fail-closed parser for the qualified-method catalogue provider record. */
export function validateModelicaMethodCatalogRecord(
  structuredContent: unknown,
  simulationCase: SimulationCase,
): void {
  if (
    typeof structuredContent !== "object" ||
    structuredContent === null ||
    !Array.isArray((structuredContent as Record<string, unknown>).kits)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "modelica_kit_list did not return a valid response with a kits array.",
    );
  }

  const kits = (structuredContent as { kits: unknown[] }).kits;
  const kit = kits.find((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const value = candidate as Record<string, unknown>;
    return value.id === simulationCase.kit.modelId &&
      value.version === simulationCase.kit.modelVersion;
  });
  if (!kit) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Kit "${simulationCase.kit.modelId}" v"${simulationCase.kit.modelVersion}" ` +
        "is not present in modelica_kit_list. Ensure the kit is approved and loaded.",
    );
  }

  const method = kit as Record<string, unknown>;
  if (!Array.isArray(method.parameters)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Kit "${simulationCase.kit.modelId}" has no parameters array in kit_list.`,
    );
  }
  for (const parameter of simulationCase.parameters) {
    const declared = method.parameters.find(
      (candidate) =>
        typeof candidate === "object" && candidate !== null &&
        (candidate as Record<string, unknown>).id === parameter.id,
    ) as Record<string, unknown> | undefined;
    if (!declared) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Kit parameter "${parameter.id}" is absent from kit_list.`,
      );
    }
    if (declared.unit !== parameter.unit) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Kit parameter "${parameter.id}" unit "${declared.unit}" differs from ` +
          `case unit "${parameter.unit}".`,
      );
    }
    const minimum = Number(declared.minimum);
    const maximum = Number(declared.maximum);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Kit parameter "${parameter.id}" has invalid bounds: min=${minimum} max=${maximum}.`,
      );
    }
    if (parameter.value < minimum || parameter.value > maximum) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Case parameter "${parameter.id}" value ${parameter.value} is outside kit bounds ` +
          `[${minimum}, ${maximum}].`,
      );
    }
  }

  if (!Array.isArray(method.produced_metrics)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Kit "${simulationCase.kit.modelId}" has no produced_metrics array in kit_list.`,
    );
  }
  for (const metric of simulationCase.expectedMetrics) {
    const declared = method.produced_metrics.find(
      (candidate) =>
        typeof candidate === "object" && candidate !== null &&
        (candidate as Record<string, unknown>).id === metric.id,
    ) as Record<string, unknown> | undefined;
    if (!declared) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Expected metric "${metric.id}" is absent from kit produced_metrics.`,
      );
    }
    if (declared.unit !== metric.unit) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Kit metric "${metric.id}" unit "${declared.unit}" differs from ` +
          `case expected unit "${metric.unit}".`,
      );
    }
  }
}
