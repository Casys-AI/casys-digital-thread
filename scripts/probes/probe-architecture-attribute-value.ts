/**
 * A03 probe: one typed/valued architecture AttributeUsage shape against SysON.
 *
 * This is a disposable sandbox. It is not product authority and does not add
 * a unit to the requirements inventory. A syntax that inserts but does not
 * reread type/value/unit is `unresolved`, not an implementation hint.
 *
 * BOUNDED: one candidate shape per invocation, no retry loop.
 *
 * LIVE RESULT 2026-08-21 against 127.0.0.1:3009, sandbox deleted:
 *   inserted `attribute probeHandle : LengthValue = 1 [mm];`
 *   AttributeUsage id and label reread
 *   FeatureTyping.type reread `LengthValue`
 *   FeatureValue.value reread label `OperatorExpression` with no scalar and
 *   no unit
 *   status `unresolved` — do not open A04 on this shape
 *
 * USAGE:
 *   deno task probe:architecture-attribute-value
 *   deno task probe:architecture-attribute-value --endpoint=http://127.0.0.1:3009/mcp
 */

import { parseArgs } from "../lib/cli.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import type { McpToolClient } from "../../src/application/ports/out/mcp-tool-client.ts";

const DEFAULT_ENDPOINT = "http://127.0.0.1:3009/mcp";

export const ARCHITECTURE_ATTRIBUTE_TYPE_AQL =
  "aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureTyping)).type" as const;

export const ARCHITECTURE_ATTRIBUTE_VALUE_AQL =
  "aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureValue)).value" as const;

export const PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE = {
  id: "typed-value-length",
  partDefName: "ProbePart",
  attributeName: "probeHandle",
  sysmlType: "LengthValue",
  literal: "1",
  unit: "mm",
} as const;

export interface ProbeArchitectureAttributeValueOptions {
  readonly endpoint?: string;
  readonly client?: McpToolClient;
}

export type ProbeArchitectureAttributeValueStatus =
  | "ok"
  | "unresolved"
  | "syson_unavailable"
  | "probe_error";

export interface ProbeToolTrace {
  readonly name: string;
  readonly ok: boolean;
  readonly message?: string;
}

export interface ProbeArchitectureAttributeValueResult {
  readonly probe: "architecture-attribute-value";
  readonly endpoint: string;
  readonly shapeId: string;
  readonly insertedSysml: string;
  readonly status: ProbeArchitectureAttributeValueStatus;
  readonly sandboxProjectName: string;
  readonly sandboxEditingContextId?: string;
  readonly sandboxProjectDeleted?: boolean;
  readonly insertedElementId?: string;
  readonly attributeId?: string;
  readonly readback?: {
    readonly kind?: string;
    readonly label?: string;
    readonly typeLabel?: string;
    readonly valueText?: string;
    readonly unit?: string;
  };
  readonly tools: readonly ProbeToolTrace[];
  readonly message: string;
  readonly cleanupNote: string;
}

export function renderProbeArchitectureAttributeSysml(): string {
  const shape = PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE;
  return [
    `part def ${shape.partDefName} {`,
    `  private import SI::*;`,
    `  attribute ${shape.attributeName} : ${shape.sysmlType} = ${shape.literal} [${shape.unit}];`,
    `}`,
  ].join("\n");
}

export async function probeArchitectureAttributeValue(
  options: ProbeArchitectureAttributeValueOptions = {},
): Promise<ProbeArchitectureAttributeValueResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const sandboxProjectName =
    `probe-architecture-attribute-value-${crypto.randomUUID()}`;
  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl: endpoint,
    timeoutMs: 60_000,
  });
  const insertedSysml = renderProbeArchitectureAttributeSysml();
  const tools: ProbeToolTrace[] = [];
  const cleanupNote =
    "The probe calls syson_project_delete after completing. sandboxProjectDeleted reports whether the delete succeeded.";
  const base = {
    probe: "architecture-attribute-value" as const,
    endpoint,
    shapeId: PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE.id,
    insertedSysml,
    sandboxProjectName,
    cleanupNote,
  };

  let editingContextId: string;
  let projectId: string;
  try {
    const created = await client.callTool({
      name: "syson_project_create",
      arguments: { name: sandboxProjectName },
    });
    tools.push({ name: "syson_project_create", ok: true });
    const sc = created.structuredContent;
    if (
      typeof sc.editingContextId !== "string" || !sc.editingContextId.trim() ||
      typeof sc.id !== "string" || !sc.id.trim()
    ) {
      return {
        ...base,
        status: "probe_error",
        tools,
        message: "syson_project_create did not return editingContextId or id.",
      };
    }
    editingContextId = sc.editingContextId;
    projectId = sc.id;
  } catch (error) {
    tools.push({
      name: "syson_project_create",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ...base,
      status: "syson_unavailable",
      tools,
      message: `Could not reach SysON at ${endpoint}.`,
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
    tools.push({ name: "syson_model_create", ok: true });
    const rootPackageId = model.structuredContent.rootPackageId;
    if (typeof rootPackageId !== "string" || !rootPackageId.trim()) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "probe_error",
        sandboxEditingContextId: editingContextId,
        tools,
        message: "syson_model_create did not return rootPackageId.",
      });
    }

    await client.callTool({
      name: "syson_element_insert_sysml",
      arguments: {
        editing_context_id: editingContextId,
        parent_id: rootPackageId,
        sysml_text: insertedSysml,
      },
    });
    tools.push({ name: "syson_element_insert_sysml", ok: true });

    const children = await client.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: rootPackageId,
      },
    });
    tools.push({ name: "syson_element_children", ok: true });
    const partDef = findChild(
      children.structuredContent.children,
      "PartDefinition",
      PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE.partDefName,
    );
    if (!partDef) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "unresolved",
        sandboxEditingContextId: editingContextId,
        tools,
        message: "Inserted SysML did not reread as the expected PartDefinition.",
      });
    }

    const owned = await client.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: partDef.id,
      },
    });
    tools.push({ name: "syson_element_children", ok: true });
    const attribute = findChild(
      owned.structuredContent.children,
      "AttributeUsage",
      PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE.attributeName,
    );
    if (!attribute) {
      return await withCleanup(client, projectId, {
        ...base,
        status: "unresolved",
        sandboxEditingContextId: editingContextId,
        insertedElementId: partDef.id,
        tools,
        message: "Inserted SysML did not reread as the expected AttributeUsage.",
      });
    }

    const got = await client.callTool({
      name: "syson_element_get",
      arguments: {
        editing_context_id: editingContextId,
        element_id: attribute.id,
      },
    });
    tools.push({ name: "syson_element_get", ok: true });
    const typeQuery = await queryAql(
      client,
      editingContextId,
      attribute.id,
      ARCHITECTURE_ATTRIBUTE_TYPE_AQL,
      tools,
    );
    const valueQuery = await queryAql(
      client,
      editingContextId,
      attribute.id,
      ARCHITECTURE_ATTRIBUTE_VALUE_AQL,
      tools,
    );

    const typeLabel = firstLabel(typeQuery);
    const valueText = firstLiteral(valueQuery) ?? firstLabel(valueQuery);
    const unit = firstUnit(valueQuery);
    const readback = {
      kind: typeof got.structuredContent.kind === "string"
        ? got.structuredContent.kind
        : undefined,
      label: typeof got.structuredContent.label === "string"
        ? got.structuredContent.label
        : undefined,
      typeLabel,
      valueText,
      unit,
    };
    const complete = typeLabel === PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE.sysmlType &&
      valueText === PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE.literal &&
      unit === PROBE_ARCHITECTURE_ATTRIBUTE_SHAPE.unit;
    return await withCleanup(client, projectId, {
      ...base,
      status: complete ? "ok" : "unresolved",
      sandboxEditingContextId: editingContextId,
      insertedElementId: partDef.id,
      attributeId: attribute.id,
      readback,
      tools,
      message: complete
        ? "Typed/valued AttributeUsage round-tripped type, value and unit."
        : "AttributeUsage reread is missing exact type, value or unit; treat as unresolved.",
    });
  } catch (error) {
    tools.push({
      name: tools.at(-1)?.name ?? "probe",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
    return await withCleanup(client, projectId, {
      ...base,
      status: "probe_error",
      sandboxEditingContextId: editingContextId,
      tools,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function findChild(
  children: unknown,
  kindSuffix: string,
  label: string,
): { readonly id: string; readonly kind: string; readonly label: string } | undefined {
  if (!Array.isArray(children)) return undefined;
  const matches = children.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    if (
      typeof record.id !== "string" || !record.id ||
      typeof record.kind !== "string" ||
      typeof record.label !== "string"
    ) {
      return [];
    }
    const kind = record.kind;
    if (!kind.endsWith(kindSuffix) && kind !== kindSuffix) return [];
    if (record.label !== label) return [];
    return [{ id: record.id, kind, label: record.label }];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

async function queryAql(
  client: McpToolClient,
  editingContextId: string,
  objectId: string,
  expression: string,
  tools: ProbeToolTrace[],
): Promise<unknown> {
  try {
    const result = await client.callTool({
      name: "syson_query_aql",
      arguments: {
        editing_context_id: editingContextId,
        object_id: objectId,
        expression,
      },
    });
    tools.push({ name: "syson_query_aql", ok: true, message: expression });
    return result.structuredContent;
  } catch (error) {
    tools.push({
      name: "syson_query_aql",
      ok: false,
      message: `${expression}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return undefined;
  }
}

function firstLabel(content: unknown): string | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return undefined;
  }
  const results = (content as Record<string, unknown>).results;
  if (!Array.isArray(results) || results.length !== 1) return undefined;
  const first = results[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return typeof first === "string" || typeof first === "number"
      ? String(first)
      : undefined;
  }
  const label = (first as Record<string, unknown>).label;
  return typeof label === "string" ? label : undefined;
}

function firstLiteral(content: unknown): string | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return undefined;
  }
  const results = (content as Record<string, unknown>).results;
  if (!Array.isArray(results) || results.length !== 1) return undefined;
  const first = results[0];
  if (typeof first === "string" || typeof first === "number") return String(first);
  if (!first || typeof first !== "object" || Array.isArray(first)) return undefined;
  const record = first as Record<string, unknown>;
  if (typeof record.value === "string" || typeof record.value === "number") {
    return String(record.value);
  }
  if (typeof record.literal === "string" || typeof record.literal === "number") {
    return String(record.literal);
  }
  return undefined;
}

function firstUnit(content: unknown): string | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return undefined;
  }
  const results = (content as Record<string, unknown>).results;
  if (!Array.isArray(results) || results.length !== 1) return undefined;
  const first = results[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return undefined;
  const unit = (first as Record<string, unknown>).unit;
  return typeof unit === "string" ? unit : undefined;
}

async function withCleanup(
  client: McpToolClient,
  projectId: string,
  result: ProbeArchitectureAttributeValueResult,
): Promise<ProbeArchitectureAttributeValueResult> {
  try {
    await client.callTool({
      name: "syson_project_delete",
      arguments: { project_id: projectId },
    });
    return { ...result, sandboxProjectDeleted: true };
  } catch {
    return { ...result, sandboxProjectDeleted: false };
  }
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await probeArchitectureAttributeValue({
    endpoint: args["endpoint"],
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ok" && result.status !== "syson_unavailable") {
    Deno.exitCode = 1;
  }
}
