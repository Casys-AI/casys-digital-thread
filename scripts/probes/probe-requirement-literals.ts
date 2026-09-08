/**
 * Maintainer-only SysON probe for scalar requirement literal round-trip.
 *
 * This script verifies whether the pinned provider inserts and extracts the
 * exact scalar `probeValue <= 0.2 [mm]` as a literal. Alternate closed
 * spellings (`1 / 5 [mm]`, `2e-1 [mm]`) denote the same mathematical value.
 * `status: "ok"` requires exactly one extracted constraint, zero extract
 * errors, and the exact binary/ref/literal/operator/value/unit shape.
 *
 * Live 2026-09-08 loopback (mcp-syson): decimal `0.2 [mm]` and scientific
 * `2e-1 [mm]` produced no extracted constraint plus
 * `[lib/syson] Cannot parse literal value from 'LiteralRational'`. Fraction
 * `1 / 5 [mm]` extracted as a binary division, not a literal. All three
 * sandboxes deleted true. Decimal SysML spellings are therefore unavailable;
 * product thresholds stay safe integers (`200000 nm` for declared `0.2 mm`).
 *
 * This is probe infrastructure only. It does not change product grammar,
 * evaluate, or solve. Do not treat a green unit test as a live provider
 * result. CLI qualification exits nonzero unless status is ok AND
 * sandboxProjectDeleted is true.
 *
 * BOUNDED: one attempt per invocation, no retry loop.
 *
 * SANDBOX: the probe creates a dedicated SysON project named
 * `probe-requirement-literals-<uuid>` and deletes it with syson_project_delete
 * after a successful create (success or later failure). The output records
 * whether cleanup succeeded. If project creation outcome is unknown, the
 * exact sandbox name is preserved and the probe does not retry or guess a
 * delete. Do NOT run this probe against a production project.
 *
 * USAGE:
 *   deno task probe:requirement-literals --form=decimal
 *   deno task probe:requirement-literals --form=fraction
 *   deno task probe:requirement-literals --form=scientific
 *   deno task probe:requirement-literals --form=decimal --endpoint=http://127.0.0.1:3009/mcp
 */

import { parseArgs } from "../lib/cli.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import type { McpToolClient } from "../../src/application/ports/out/mcp-tool-client.ts";

export const DEFAULT_REQUIREMENT_LITERALS_ENDPOINT = "http://127.0.0.1:3009/mcp";

export const REQUIREMENT_LITERAL_FORM_IDS = [
  "decimal",
  "fraction",
  "scientific",
] as const;

export type RequirementLiteralForm = typeof REQUIREMENT_LITERAL_FORM_IDS[number];

export const PROBE_REQUIREMENT_LITERAL_PART_DEF = "ProbeRequirementLiterals";
export const PROBE_REQUIREMENT_LITERAL_CONSTRAINT = "probe_limit";
export const PROBE_REQUIREMENT_LITERAL_METRIC = "probeValue";
export const PROBE_REQUIREMENT_LITERAL_OPERATOR = "<=";
export const PROBE_REQUIREMENT_LITERAL_VALUE = 0.2;
export const PROBE_REQUIREMENT_LITERAL_UNIT = "mm";
export const PROBE_REQUIREMENT_LITERAL_TYPE = "LengthValue";

export const REQUIREMENT_LITERAL_FORMS = {
  decimal: {
    form: "decimal",
    literalText: "0.2",
  },
  fraction: {
    form: "fraction",
    literalText: "1 / 5",
  },
  scientific: {
    form: "scientific",
    literalText: "2e-1",
  },
} as const satisfies Record<
  RequirementLiteralForm,
  { readonly form: RequirementLiteralForm; readonly literalText: string }
>;

export interface ProbeRequirementLiteralsOptions {
  readonly form?: string;
  readonly endpoint?: string;
  /** Test seam — omit in production; defaults to HttpMcpToolClient. */
  readonly client?: McpToolClient;
}

export type ProbeRequirementLiteralsStatus =
  | "ok"
  | "not_literal"
  | "value_mismatch"
  | "unit_mismatch"
  | "operator_mismatch"
  | "feature_path_mismatch"
  | "shape_mismatch"
  | "extra_constraints"
  | "extract_errors"
  | "constraint_missing"
  | "extraction_failed"
  | "insertion_failed"
  | "syson_unavailable"
  | "probe_error"
  | "invalid_form";

export interface ProbeRequirementLiteralExpected {
  readonly rightKind: "literal";
  readonly value: number;
  readonly unit: string;
  readonly operator: "<=";
  readonly featurePath: readonly ["probeValue"];
}

export interface ProbeRequirementLiteralObserved {
  readonly expressionKind?: unknown;
  readonly leftKind?: unknown;
  readonly rightKind?: unknown;
  readonly value?: unknown;
  readonly unit?: unknown;
  readonly operator?: unknown;
  readonly featurePath?: unknown;
}

export interface ProbeRequirementLiteralsResult {
  readonly probe: "requirement-literals";
  readonly form?: string;
  readonly endpoint: string;
  readonly insertedSysml?: string;
  readonly status: ProbeRequirementLiteralsStatus;
  readonly sandboxProjectName?: string;
  readonly sandboxEditingContextId?: string;
  readonly sandboxProjectDeleted?: boolean;
  readonly insertedElementId?: string;
  readonly extractedConstraints: readonly unknown[];
  readonly extractErrors: readonly unknown[];
  readonly matchingConstraint?: unknown;
  readonly expected: ProbeRequirementLiteralExpected;
  readonly observed?: ProbeRequirementLiteralObserved;
  readonly message: string;
  readonly cleanupNote: string;
}

const EXPECTED: ProbeRequirementLiteralExpected = {
  rightKind: "literal",
  value: PROBE_REQUIREMENT_LITERAL_VALUE,
  unit: PROBE_REQUIREMENT_LITERAL_UNIT,
  operator: PROBE_REQUIREMENT_LITERAL_OPERATOR,
  featurePath: [PROBE_REQUIREMENT_LITERAL_METRIC],
};

const CLEANUP_NOTE =
  "The probe calls syson_project_delete after a successful create. " +
  "sandboxProjectDeleted reports whether the delete succeeded. " +
  "If project creation outcome is unknown, the sandbox name is preserved " +
  "and the probe does not retry.";

export function isRequirementLiteralForm(
  value: unknown,
): value is RequirementLiteralForm {
  return value === "decimal" || value === "fraction" || value === "scientific";
}

/** CLI qualification: ok extract plus proven sandbox delete. */
export function requirementLiteralProbeQualifies(
  result: ProbeRequirementLiteralsResult,
): boolean {
  return result.status === "ok" && result.sandboxProjectDeleted === true;
}

export function renderProbeRequirementLiteralSysml(
  form: RequirementLiteralForm,
): string {
  const literalText = REQUIREMENT_LITERAL_FORMS[form].literalText;
  return [
    `part def ${PROBE_REQUIREMENT_LITERAL_PART_DEF} {`,
    `  private import SI::*;`,
    `  attribute ${PROBE_REQUIREMENT_LITERAL_METRIC} : ${PROBE_REQUIREMENT_LITERAL_TYPE};`,
    `  constraint ${PROBE_REQUIREMENT_LITERAL_CONSTRAINT} { ${PROBE_REQUIREMENT_LITERAL_METRIC} ${PROBE_REQUIREMENT_LITERAL_OPERATOR} ${literalText} [${PROBE_REQUIREMENT_LITERAL_UNIT}] }`,
    `}`,
  ].join("\n");
}

/**
 * Run the literal round-trip probe and return a machine-readable result.
 *
 * The probe never retries — a single attempt per invocation is enough to
 * confirm or deny insertion/extraction fidelity. Invalid `--form` values are
 * refused before any provider I/O. Create failures leave the sandbox name in
 * the result and do not attempt delete.
 */
export async function probeRequirementLiterals(
  options: ProbeRequirementLiteralsOptions = {},
): Promise<ProbeRequirementLiteralsResult> {
  const endpoint = options.endpoint ?? DEFAULT_REQUIREMENT_LITERALS_ENDPOINT;
  const requestedForm = options.form;

  if (!isRequirementLiteralForm(requestedForm)) {
    return {
      probe: "requirement-literals",
      form: requestedForm,
      endpoint,
      status: "invalid_form",
      extractedConstraints: [],
      extractErrors: [],
      expected: EXPECTED,
      message: `form must be one of ${REQUIREMENT_LITERAL_FORM_IDS.join("|")}; ` +
        "arbitrary SysML text is refused.",
      cleanupNote: CLEANUP_NOTE,
    };
  }

  const form = requestedForm;
  const insertedSysml = renderProbeRequirementLiteralSysml(form);
  const sandboxProjectName = `probe-requirement-literals-${crypto.randomUUID()}`;
  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl: endpoint,
    timeoutMs: 60_000,
  });
  const base = {
    probe: "requirement-literals" as const,
    form,
    endpoint,
    insertedSysml,
    sandboxProjectName,
    expected: EXPECTED,
    cleanupNote: CLEANUP_NOTE,
  };

  let editingContextId: string;
  let projectId: string;
  try {
    const created = await client.callTool({
      name: "syson_project_create",
      arguments: { name: sandboxProjectName },
    });
    const sc = created.structuredContent;
    if (
      typeof sc.editingContextId !== "string" || !sc.editingContextId.trim() ||
      typeof sc.id !== "string" || !sc.id.trim()
    ) {
      return {
        ...base,
        status: "probe_error",
        extractedConstraints: [],
        extractErrors: [],
        message: "syson_project_create did not return editingContextId or id. " +
          "Project creation outcome is unknown; the sandbox name is preserved.",
      };
    }
    editingContextId = sc.editingContextId;
    projectId = sc.id;
  } catch (error) {
    return {
      ...base,
      status: "syson_unavailable",
      extractedConstraints: [],
      extractErrors: [],
      message: `Could not reach SysON at ${endpoint}: ${errorText(error)}. ` +
        "Project creation outcome is unknown; the sandbox name is preserved " +
        "and the probe does not retry.",
    };
  }

  try {
    const model = await client.callTool({
      name: "syson_model_create",
      arguments: {
        editing_context_id: editingContextId,
        name: "ProbeModel",
        create_root_package: true,
      },
    });
    const rootPackageId = model.structuredContent.rootPackageId;
    if (typeof rootPackageId !== "string" || !rootPackageId.trim()) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "probe_error",
        sandboxEditingContextId: editingContextId,
        extractedConstraints: [],
        extractErrors: [],
        message: "syson_model_create did not return rootPackageId.",
      });
    }

    try {
      await client.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: editingContextId,
          parent_id: rootPackageId,
          sysml_text: insertedSysml,
        },
      });
    } catch (error) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "insertion_failed",
        sandboxEditingContextId: editingContextId,
        extractedConstraints: [],
        extractErrors: [],
        message: `Insertion failed: ${errorText(error)}`,
      });
    }

    const children = await client.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: rootPackageId,
      },
    });
    const partDef = findInsertedPartDef(children.structuredContent.children);
    if (!partDef) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "insertion_failed",
        sandboxEditingContextId: editingContextId,
        extractedConstraints: [],
        extractErrors: [],
        message:
          `Could not find inserted element "${PROBE_REQUIREMENT_LITERAL_PART_DEF}" ` +
          "in children.",
      });
    }

    let extractContent: Readonly<Record<string, unknown>>;
    try {
      const extractResult = await client.callTool({
        name: "syson_constraint_extract",
        arguments: {
          editing_context_id: editingContextId,
          element_id: partDef.id,
        },
      });
      extractContent = extractResult.structuredContent;
    } catch (error) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "extraction_failed",
        sandboxEditingContextId: editingContextId,
        insertedElementId: partDef.id,
        extractedConstraints: [],
        extractErrors: [],
        message: `syson_constraint_extract failed: ${errorText(error)}`,
      });
    }

    const extractedConstraints = Array.isArray(extractContent.constraints)
      ? extractContent.constraints as readonly unknown[]
      : [];
    const extractErrors = Array.isArray(extractContent.errors)
      ? extractContent.errors as readonly unknown[]
      : [];

    if (!Array.isArray(extractContent.constraints)) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "extraction_failed",
        sandboxEditingContextId: editingContextId,
        insertedElementId: partDef.id,
        extractedConstraints,
        extractErrors,
        message: "syson_constraint_extract returned no constraints array.",
      });
    }

    const classified = classifyExtractedConstraints(
      extractedConstraints,
      extractErrors,
    );
    return await withCleanup(client, projectId, {
      ...base,
      status: classified.status,
      sandboxEditingContextId: editingContextId,
      insertedElementId: partDef.id,
      extractedConstraints,
      extractErrors,
      matchingConstraint: classified.matchingConstraint,
      observed: classified.observed,
      message: classified.message,
    });
  } catch (error) {
    return await withCleanup(client, projectId, {
      ...base,
      status: "probe_error",
      sandboxEditingContextId: editingContextId,
      extractedConstraints: [],
      extractErrors: [],
      message: errorText(error),
    });
  }
}

function classifyExtractedConstraints(
  constraints: readonly unknown[],
  extractErrors: readonly unknown[],
): {
  readonly status: ProbeRequirementLiteralsStatus;
  readonly matchingConstraint?: unknown;
  readonly observed?: ProbeRequirementLiteralObserved;
  readonly message: string;
} {
  if (extractErrors.length !== 0) {
    return {
      status: "extract_errors",
      matchingConstraint: constraints.find(isProbeLimitConstraint),
      observed: observeFirstConstraint(constraints),
      message: `syson_constraint_extract returned ${extractErrors.length} error(s).`,
    };
  }
  if (constraints.length === 0) {
    return {
      status: "extraction_failed",
      message: "syson_constraint_extract returned no constraints.",
    };
  }
  if (constraints.length !== 1) {
    return {
      status: "extra_constraints",
      matchingConstraint: constraints.find(isProbeLimitConstraint),
      observed: observeFirstConstraint(constraints),
      message: `Expected exactly one extracted constraint, got ${constraints.length}.`,
    };
  }

  const matchingConstraint = constraints[0];
  if (!isProbeLimitConstraint(matchingConstraint)) {
    return {
      status: "constraint_missing",
      matchingConstraint,
      observed: observeConstraint(matchingConstraint),
      message: `Constraint "${PROBE_REQUIREMENT_LITERAL_CONSTRAINT}" not found in ` +
        `extracted constraints. Got: ${
          JSON.stringify(constraints.map(constraintName))
        }`,
    };
  }

  const observed = observeConstraint(matchingConstraint);
  if (observed.expressionKind !== "binary" || observed.leftKind !== "ref") {
    return {
      status: "shape_mismatch",
      matchingConstraint,
      observed,
      message: `Expected binary/ref constraint shape but extract returned ` +
        `expression.kind ${JSON.stringify(observed.expressionKind)} and ` +
        `left.kind ${JSON.stringify(observed.leftKind)}.`,
    };
  }
  if (observed.operator !== PROBE_REQUIREMENT_LITERAL_OPERATOR) {
    return {
      status: "operator_mismatch",
      matchingConstraint,
      observed,
      message:
        `Expected operator "${PROBE_REQUIREMENT_LITERAL_OPERATOR}" but extract ` +
        `returned ${JSON.stringify(observed.operator)}.`,
    };
  }
  if (!featurePathSurvives(observed.featurePath)) {
    return {
      status: "feature_path_mismatch",
      matchingConstraint,
      observed,
      message: `Expected feature path ${
        JSON.stringify(EXPECTED.featurePath)
      } but extract returned ${JSON.stringify(observed.featurePath)}.`,
    };
  }
  if (observed.rightKind !== "literal") {
    return {
      status: "not_literal",
      matchingConstraint,
      observed,
      message: `Expected right.kind "literal" but extract returned ` +
        `${JSON.stringify(observed.rightKind)}.`,
    };
  }
  if (observed.value !== PROBE_REQUIREMENT_LITERAL_VALUE) {
    return {
      status: "value_mismatch",
      matchingConstraint,
      observed,
      message: `Expected right.value ${PROBE_REQUIREMENT_LITERAL_VALUE} but extract ` +
        `returned ${JSON.stringify(observed.value)}.`,
    };
  }
  if (observed.unit !== PROBE_REQUIREMENT_LITERAL_UNIT) {
    return {
      status: "unit_mismatch",
      matchingConstraint,
      observed,
      message: `Expected right.unit "${PROBE_REQUIREMENT_LITERAL_UNIT}" but extract ` +
        `returned ${JSON.stringify(observed.unit)}.`,
    };
  }
  return {
    status: "ok",
    matchingConstraint,
    observed,
    message:
      `Form round-trips as literal ${PROBE_REQUIREMENT_LITERAL_VALUE} [${PROBE_REQUIREMENT_LITERAL_UNIT}].`,
  };
}

function observeFirstConstraint(
  constraints: readonly unknown[],
): ProbeRequirementLiteralObserved | undefined {
  return constraints.length === 0 ? undefined : observeConstraint(constraints[0]);
}

function isProbeLimitConstraint(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" &&
    name.includes(PROBE_REQUIREMENT_LITERAL_CONSTRAINT);
}

function constraintName(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return (value as Record<string, unknown>).name;
}

function observeConstraint(
  constraint: unknown,
): ProbeRequirementLiteralObserved {
  if (!constraint || typeof constraint !== "object" || Array.isArray(constraint)) {
    return {};
  }
  const expression = (constraint as Record<string, unknown>).expression;
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
    return {};
  }
  const expr = expression as Record<string, unknown>;
  const left = expr.left;
  const right = expr.right;
  const leftRecord = left && typeof left === "object" && !Array.isArray(left)
    ? left as Record<string, unknown>
    : undefined;
  const rightRecord = right && typeof right === "object" && !Array.isArray(right)
    ? right as Record<string, unknown>
    : undefined;
  return {
    expressionKind: expr.kind,
    leftKind: leftRecord?.kind,
    operator: expr.op,
    featurePath: leftRecord?.featurePath,
    rightKind: rightRecord?.kind,
    value: rightRecord?.value,
    unit: rightRecord?.unit,
  };
}

function featurePathSurvives(featurePath: unknown): boolean {
  return Array.isArray(featurePath) &&
    featurePath.length === 1 &&
    featurePath[0] === PROBE_REQUIREMENT_LITERAL_METRIC;
}

function findInsertedPartDef(
  children: unknown,
): { readonly id: string } | undefined {
  if (!Array.isArray(children)) return undefined;
  const match = children.find((child) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) return false;
    const record = child as Record<string, unknown>;
    return record.label === PROBE_REQUIREMENT_LITERAL_PART_DEF &&
      typeof record.id === "string" &&
      record.id.trim() !== "";
  }) as Record<string, unknown> | undefined;
  return match && typeof match.id === "string" ? { id: match.id } : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withCleanup(
  client: McpToolClient,
  projectId: string,
  result: ProbeRequirementLiteralsResult,
): Promise<ProbeRequirementLiteralsResult> {
  try {
    const deleted = await client.callTool({
      name: "syson_project_delete",
      arguments: { project_id: projectId },
    });
    return {
      ...result,
      sandboxProjectDeleted: deleted.structuredContent.deleted === true,
    };
  } catch {
    return { ...result, sandboxProjectDeleted: false };
  }
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await probeRequirementLiterals({
    endpoint: args["endpoint"],
    form: args["form"],
  });
  console.log(JSON.stringify(result, null, 2));
  if (!requirementLiteralProbeQualifies(result)) {
    Deno.exitCode = 1;
  }
}
