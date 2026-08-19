/**
 * D4 unit probe for `model.write-requirements@1`.
 *
 * This script verifies that a unit string produces a round-trippable SysML
 * attribute via syson_element_insert_sysml → syson_constraint_extract. Only
 * units whose round-trip has been confirmed here may be added to
 * UNIT_TO_SYSML_TYPE in src/domain/kernel/proof-case.ts.
 *
 * BOUNDED: one attempt per invocation, no retry loop.
 *
 * SANDBOX: the probe creates a dedicated SysON project named
 * `probe-requirement-units-<uuid>` and deletes it with syson_project_delete
 * after the probe completes (success or failure). The output records whether
 * cleanup succeeded. Do NOT run this probe against a production project.
 *
 * ALREADY PROVEN UNITS (verified against SysON on 127.0.0.1:3009):
 *   mm → LengthValue   (probe-requirements-2026-08-04, element d6793ccf)
 *   Pa → PressureValue (probe-requirements-2026-08-04, element d6793ccf)
 *
 * USAGE:
 *   deno task probe:requirement-units                     # probe default units
 *   deno task probe:requirement-units --unit=kg --type=MassValue  # probe a new unit
 *   deno task probe:requirement-units --endpoint=http://127.0.0.1:3009/mcp
 */

import { parseArgs } from "../lib/cli.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import type { McpToolClient } from "../../src/application/ports/out/mcp-tool-client.ts";
import type { OracleRequirement } from "../../src/domain/kernel/proof-case.ts";

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
   * editingContextId of the sandbox project, retained for audit.
   * The probe calls syson_project_delete after completing; sandboxProjectDeleted
   * records whether the cleanup succeeded.
   */
  readonly sandboxEditingContextId?: string;
  /** True if syson_project_delete confirmed the sandbox was deleted. */
  readonly sandboxProjectDeleted?: boolean;
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
    (unit === "mm"
      ? "LengthValue"
      : unit === "Pa"
      ? "PressureValue"
      : unit === "kg"
      ? "MassValue"
      : unit === "W"
      ? "PowerValue"
      : unit === "V"
      ? "VoltageValue"
      : unit); // fallback — may fail if the type does not exist in SI

  const sandboxProjectName = `probe-requirement-units-${crypto.randomUUID()}`;
  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl: endpoint,
    timeoutMs: 60_000,
  });

  const cleanupNote = "The probe calls syson_project_delete after completing. " +
    "sandboxProjectDeleted reports whether the delete succeeded.";

  // Step 1 — create the sandbox project.
  let editingContextId: string;
  let projectId: string;
  try {
    const projectResult = await client.callTool({
      name: "syson_project_create",
      arguments: { name: sandboxProjectName },
    });
    const sc = projectResult.structuredContent;
    // syson_project_create returns { id, name, editingContextId }.
    // "id" is the project UUID used by syson_project_delete.
    if (
      typeof sc.editingContextId !== "string" || !sc.editingContextId.trim() ||
      typeof sc.id !== "string" || !sc.id.trim()
    ) {
      return {
        probe: "requirement-units",
        endpoint,
        sandboxProjectName,
        units: [
          unitResult(
            unit,
            sysmlType,
            "probe_error",
            "syson_project_create did not return editingContextId or id.",
          ),
        ],
        cleanupNote,
      };
    }
    editingContextId = sc.editingContextId as string;
    projectId = sc.id as string;
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
      return await withCleanup(
        client,
        projectId,
        {
          probe: "requirement-units",
          endpoint,
          sandboxProjectName,
          sandboxEditingContextId: editingContextId,
          units: [unitResult(
            unit,
            sysmlType,
            "probe_error",
            "syson_model_create did not return rootPackageId.",
          )],
          cleanupNote,
        },
      );
    }
    rootPackageId = sc.rootPackageId;
  } catch (error) {
    return await withCleanup(client, projectId, {
      probe: "requirement-units",
      endpoint,
      sandboxProjectName,
      sandboxEditingContextId: editingContextId,
      units: [
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
    });
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
    return await withCleanup(client, projectId, {
      probe: "requirement-units",
      endpoint,
      sandboxProjectName,
      sandboxEditingContextId: editingContextId,
      units: [
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
    });
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
      return await withCleanup(client, projectId, {
        probe: "requirement-units",
        endpoint,
        sandboxProjectName,
        sandboxEditingContextId: editingContextId,
        units: [
          unitResult(unit, sysmlType, "probe_error", "No children after insertion."),
        ],
        cleanupNote,
      });
    }
    // Find the part def by label.
    const match = children.find(
      (child: unknown) =>
        typeof child === "object" &&
        child !== null &&
        (child as Record<string, unknown>).label === testPartDefName,
    ) as Record<string, unknown> | undefined;
    if (!match || typeof match.id !== "string") {
      return await withCleanup(client, projectId, {
        probe: "requirement-units",
        endpoint,
        sandboxProjectName,
        sandboxEditingContextId: editingContextId,
        units: [
          unitResult(
            unit,
            sysmlType,
            "probe_error",
            `Could not find inserted element "${testPartDefName}" in children.`,
          ),
        ],
        cleanupNote,
      });
    }
    insertedElementId = match.id;
    void insertResult; // acknowledged, element identified by name
  } catch (error) {
    return await withCleanup(client, projectId, {
      probe: "requirement-units",
      endpoint,
      sandboxProjectName,
      sandboxEditingContextId: editingContextId,
      units: [
        unitResult(
          unit,
          sysmlType,
          "probe_error",
          `Insertion failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
      cleanupNote,
    });
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
      return await withCleanup(client, projectId, {
        probe: "requirement-units",
        endpoint,
        sandboxProjectName,
        sandboxEditingContextId: editingContextId,
        units: [
          unitResult(
            unit,
            sysmlType,
            "extraction_failed",
            "syson_constraint_extract returned no constraints.",
          ),
        ],
        cleanupNote,
      });
    }

    // The extracted constraint has structure { expression: { right: { unit } } }.
    // We look for a constraint whose threshold literal carries the unit.
    const probeConstraint = constraints.find(
      (c: unknown) =>
        typeof c === "object" && c !== null &&
        typeof (c as Record<string, unknown>).name === "string" &&
        ((c as Record<string, unknown>).name as string).includes("probe_limit"),
    ) as Record<string, unknown> | undefined;

    // Extract unit from the right-hand side literal.
    let extractedUnit: string | undefined;
    if (probeConstraint) {
      const expr = probeConstraint.expression as Record<string, unknown> | undefined;
      const right = expr?.right as Record<string, unknown> | undefined;
      if (right?.kind === "literal" && typeof right.unit === "string") {
        extractedUnit = right.unit;
      }
    }

    if (!probeConstraint) {
      return await withCleanup(client, projectId, {
        probe: "requirement-units",
        endpoint,
        sandboxProjectName,
        sandboxEditingContextId: editingContextId,
        units: [
          unitResult(
            unit,
            sysmlType,
            "extraction_failed",
            `Constraint "probe_limit" not found in extracted constraints. ` +
              `Got: ${
                JSON.stringify(constraints.map((c: unknown) =>
                  (c as Record<string, unknown>).name
                ))
              }`,
          ),
        ],
        cleanupNote,
      });
    }

    const status: ProbeRequirementUnitsStatus = extractedUnit === unit
      ? "ok"
      : "type_mismatch";
    return await withCleanup(client, projectId, {
      probe: "requirement-units",
      endpoint,
      sandboxProjectName,
      sandboxEditingContextId: editingContextId,
      units: [
        {
          unit,
          sysmlType,
          status,
          extractedUnit,
          message: status === "ok"
            ? `Unit "${unit}" round-trips correctly through SysON with type "${sysmlType}".`
            : `Expected unit "${unit}" but SysON returned "${
              String(extractedUnit)
            }". ` +
              `The mapping "${unit}" → "${sysmlType}" may be incorrect.`,
        },
      ],
      cleanupNote,
    });
  } catch (error) {
    return await withCleanup(client, projectId, {
      probe: "requirement-units",
      endpoint,
      sandboxProjectName,
      sandboxEditingContextId: editingContextId,
      units: [
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
    });
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

async function withCleanup(
  client: McpToolClient,
  projectId: string,
  result: ProbeRequirementUnitsResult,
): Promise<ProbeRequirementUnitsResult> {
  try {
    await client.callTool({
      name: "syson_project_delete",
      arguments: { project_id: projectId },
    });
    return { ...result, sandboxProjectDeleted: true };
  } catch {
    // Cleanup failure is not fatal — the probe result stands.
    return { ...result, sandboxProjectDeleted: false };
  }
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
