/**
 * D4 unit probe for `model.write-requirements@1`.
 *
 * This script verifies that a unit string produces a round-trippable SysML
 * attribute via syson_element_insert_sysml → syson_constraint_extract. Only
 * units whose round-trip has been confirmed here may be added to
 * UNIT_TO_SYSML_TYPE in src/domain/analysis/proof-case.ts.
 *
 * BOUNDED: one attempt per invocation, no retry loop.
 *
 * SANDBOX: the probe creates a dedicated SysON project named
 * `probe-requirement-units-<uuid>`. There is no syson_project_delete tool;
 * the output includes the editingContextId for the operator to delete
 * manually from the SysON UI. Do NOT run this probe against a production
 * project.
 *
 * ALREADY PROVEN UNITS:
 *   mm → LengthValue   (probe-requirements-2026-08-04, element d6793ccf)
 *   Pa → PressureValue (probe-requirements-2026-08-04, element d6793ccf)
 *
 * USAGE:
 *   deno task probe:requirement-units                     # probe default units
 *   deno task probe:requirement-units --unit=kg --type=MassValue  # probe a new unit
 *   deno task probe:requirement-units --endpoint=http://127.0.0.1:3009/mcp
 */

import { parseArgs } from "../lib/cli.ts";
import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import type { OracleRequirement } from "../../src/domain/analysis/proof-case.ts";

const DEFAULT_ENDPOINT = "http://127.0.0.1:3009/mcp";

export interface ProbeRequirementUnitsOptions {
  readonly endpoint?: string;
  /**
   * Unit to probe (default: "mm"). The probe inserts one requirement with this
   * unit and verifies the extraction round-trip.
   */
  readonly unit?: string;
  /**
   * SysML attribute type to use for the unit in the generated partDef
   * (e.g. "LengthValue" for "mm", "MassValue" for "kg"). If omitted, the
   * probe reuses the unit as the type name for structural testing only — the
   * result will be `type_mismatch` unless the type exists in SI.
   */
  readonly sysmlType?: string;
  /** Test seam — omit in production; defaults to HttpMcpToolClient. */
  readonly client?: McpToolClient;
}

export type ProbeRequirementUnitsStatus =
  | "ok"
  | "type_mismatch"
  | "extraction_failed"
  | "syson_unavailable"
  | "probe_error";

export interface ProbeUnitResult {
  readonly unit: string;
  readonly sysmlType: string;
  readonly status: ProbeRequirementUnitsStatus;
  readonly extractedUnit?: string;
  readonly message?: string;
}

export interface ProbeRequirementUnitsResult {
  readonly probe: "requirement-units";
  readonly endpoint: string;
  readonly sandboxProjectName: string;
  /**
   * editingContextId of the sandbox project, returned for manual cleanup.
   * There is no syson_project_delete tool; the operator must delete this
   * project from the SysON UI after reviewing the result.
   */
  readonly sandboxEditingContextId?: string;
  readonly units: readonly ProbeUnitResult[];
  readonly cleanupNote: string;
}

/**
 * Run the unit round-trip probe and return a machine-readable result.
 *
 * The probe never retries — a single attempt per invocation is enough to
 * confirm or deny the round-trip. Any transport error is mapped to
 * `{ status: "syson_unavailable" }` and the overall result is returned
 * without the sandbox cleanup.
 */
export async function probeRequirementUnits(
  options: ProbeRequirementUnitsOptions = {},
): Promise<ProbeRequirementUnitsResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const unit = options.unit ?? "mm";
  const sysmlType = options.sysmlType ??
    (unit === "mm" ? "LengthValue" : unit === "Pa" ? "PressureValue" : unit); // fallback — may fail if the type does not exist in SI

  const sandboxProjectName = `probe-requirement-units-${crypto.randomUUID()}`;
  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl: endpoint,
    timeoutMs: 60_000,
  });

  const cleanupNote =
    "The sandbox project cannot be deleted programmatically (no syson_project_delete tool). " +
    "Delete it from the SysON UI using the editingContextId returned in this result.";

  // Step 1 — create the sandbox project.
  let editingContextId: string;
  try {
    const projectResult = await client.callTool({
      name: "syson_project_create",
      arguments: { name: sandboxProjectName },
    });
    const sc = projectResult.structuredContent;
    if (typeof sc.editingContextId !== "string" || !sc.editingContextId.trim()) {
      return {
        probe: "requirement-units",
        endpoint,
        sandboxProjectName,
        units: [
          unitResult(
            unit,
            sysmlType,
            "probe_error",
            "syson_project_create did not return editingContextId.",
          ),
        ],
        cleanupNote,
      };
    }
    editingContextId = sc.editingContextId;
  } catch (error) {
    return {
      probe: "requirement-units",
      endpoint,
      sandboxProjectName,
      units: [
        unitResult(
          unit,
          sysmlType,
          "syson_unavailable",
          `Could not reach SysON at ${endpoint}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      ],
      cleanupNote,
    };
  }

  // Step 2 — create a model with a root package.
  let rootPackageId: string;
  try {
    const modelResult = await client.callTool({
      name: "syson_model_create",
      arguments: {
        editing_context_id: editingContextId,
        name: "ProbeModel",
        create_root_package: true,
      },
    });
    const sc = modelResult.structuredContent;
    if (typeof sc.rootPackageId !== "string" || !sc.rootPackageId.trim()) {
      return sandboxCreated(
        endpoint,
        sandboxProjectName,
        editingContextId,
        [unitResult(
          unit,
          sysmlType,
          "probe_error",
          "syson_model_create did not return rootPackageId.",
        )],
        cleanupNote,
      );
    }
    rootPackageId = sc.rootPackageId;
  } catch (error) {
    return sandboxCreated(
      endpoint,
      sandboxProjectName,
      editingContextId,
      [
        unitResult(
          unit,
          sysmlType,
          "probe_error",
          `syson_model_create failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      ],
      cleanupNote,
    );
  }

  // Step 3 — render the test requirement and insert it.
  const testPartDefName = "ProbeRequirementsTest";
  const testRequirement: OracleRequirement = {
    id: "probeValue",
    name: "Probe value",
    metric: "probeValue",
    operator: "<=",
    limit: { value: 1.0, unit },
  };

  let sysmlText: string;
  try {
    // We bypass the normal UNIT_TO_SYSML_TYPE guard by manually rendering the
    // SysML text, since this probe is testing whether a NEW unit type works.
    sysmlText = renderProbePartDef(testPartDefName, testRequirement, sysmlType);
  } catch (error) {
    return sandboxCreated(
      endpoint,
      sandboxProjectName,
      editingContextId,
      [
        unitResult(
          unit,
          sysmlType,
          "probe_error",
          `SysML render failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      ],
      cleanupNote,
    );
  }

  let insertedElementId: string;
  try {
    const insertResult = await client.callTool({
      name: "syson_element_insert_sysml",
      arguments: {
        editing_context_id: editingContextId,
        parent_id: rootPackageId,
        sysml_text: sysmlText,
      },
    });
    // Identify the newly inserted element by reading the package's children.
    const childrenResult = await client.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: rootPackageId,
      },
    });
    const children = childrenResult.structuredContent.children;
    if (!Array.isArray(children) || children.length === 0) {
      return sandboxCreated(
        endpoint,
        sandboxProjectName,
        editingContextId,
        [unitResult(unit, sysmlType, "probe_error", "No children after insertion.")],
        cleanupNote,
      );
    }
    // Find the part def by label.
    const match = children.find(
      (child: unknown) =>
        typeof child === "object" &&
        child !== null &&
        (child as Record<string, unknown>).label === testPartDefName,
    ) as Record<string, unknown> | undefined;
    if (!match || typeof match.id !== "string") {
      return sandboxCreated(
        endpoint,
        sandboxProjectName,
        editingContextId,
        [
          unitResult(
            unit,
            sysmlType,
            "probe_error",
            `Could not find inserted element "${testPartDefName}" in children.`,
          ),
        ],
        cleanupNote,
      );
    }
    insertedElementId = match.id;
    void insertResult; // acknowledged, element identified by name
  } catch (error) {
    return sandboxCreated(
      endpoint,
      sandboxProjectName,
      editingContextId,
      [
        unitResult(
          unit,
          sysmlType,
          "probe_error",
          `Insertion failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
      cleanupNote,
    );
  }

  // Step 4 — extract and verify the constraint round-trip.
  try {
    const extractResult = await client.callTool({
      name: "syson_constraint_extract",
      arguments: {
        editing_context_id: editingContextId,
        element_id: insertedElementId,
      },
    });
    const constraints = extractResult.structuredContent.constraints;
    if (!Array.isArray(constraints) || constraints.length === 0) {
      return sandboxCreated(
        endpoint,
        sandboxProjectName,
        editingContextId,
        [
          unitResult(
            unit,
            sysmlType,
            "extraction_failed",
            "syson_constraint_extract returned no constraints.",
          ),
        ],
        cleanupNote,
      );
    }
    // Find the probe constraint (metric = "probeValue").
    const probeConstraint = constraints.find(
      (c: unknown) =>
        Array.isArray((c as Record<string, unknown>).featurePath) &&
        ((c as Record<string, unknown>).featurePath as string[])[0] === "probeValue",
    ) as Record<string, unknown> | undefined;

    if (!probeConstraint) {
      return sandboxCreated(
        endpoint,
        sandboxProjectName,
        editingContextId,
        [
          unitResult(
            unit,
            sysmlType,
            "extraction_failed",
            `Constraint "probeValue" not found in extracted constraints.`,
          ),
        ],
        cleanupNote,
      );
    }

    const extractedUnit = typeof probeConstraint.unit === "string"
      ? probeConstraint.unit
      : undefined;
    const status: ProbeRequirementUnitsStatus = extractedUnit === unit
      ? "ok"
      : "type_mismatch";
    return sandboxCreated(
      endpoint,
      sandboxProjectName,
      editingContextId,
      [
        {
          unit,
          sysmlType,
          status,
          extractedUnit,
          message: status === "ok"
            ? `Unit "${unit}" round-trips correctly through SysON with type "${sysmlType}".`
            : `Expected unit "${unit}" but SysON returned "${extractedUnit}". ` +
              `The mapping "${unit}" → "${sysmlType}" may be incorrect.`,
        },
      ],
      cleanupNote,
    );
  } catch (error) {
    return sandboxCreated(
      endpoint,
      sandboxProjectName,
      editingContextId,
      [
        unitResult(
          unit,
          sysmlType,
          "extraction_failed",
          `syson_constraint_extract failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      ],
      cleanupNote,
    );
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Render a minimal SysML v2 partDef for probe purposes.
 *
 * Unlike renderOracleRequirementsSysml, this function accepts an arbitrary
 * sysmlType string — it is the probe's job to discover whether that type
 * exists and round-trips, so we must bypass the UNIT_TO_SYSML_TYPE guard.
 */
function renderProbePartDef(
  partDefName: string,
  req: OracleRequirement,
  sysmlType: string,
): string {
  return [
    `part def ${partDefName} {`,
    `  private import SI::*;`,
    `  attribute ${req.metric} : ${sysmlType};`,
    `  constraint probe_limit { ${req.metric} ${req.operator} ${req.limit.value} [${req.limit.unit}] }`,
    `}`,
  ].join("\n");
}

function unitResult(
  unit: string,
  sysmlType: string,
  status: ProbeRequirementUnitsStatus,
  message: string,
): ProbeUnitResult {
  return { unit, sysmlType, status, message };
}

function sandboxCreated(
  endpoint: string,
  sandboxProjectName: string,
  sandboxEditingContextId: string,
  units: readonly ProbeUnitResult[],
  cleanupNote: string,
): ProbeRequirementUnitsResult {
  return {
    probe: "requirement-units",
    endpoint,
    sandboxProjectName,
    sandboxEditingContextId,
    units,
    cleanupNote,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await probeRequirementUnits({
    endpoint: args["endpoint"],
    unit: args["unit"],
    sysmlType: args["type"],
  });
  console.log(JSON.stringify(result, null, 2));
  const failed = result.units.some(
    (u) => u.status !== "ok" && u.status !== "syson_unavailable",
  );
  if (failed) Deno.exitCode = 1;
}
