/**
 * Host-owned runtime binding state for app-managed providers (#57).
 *
 * One JSON document per tool beside the preparation intent. It records the
 * actual allocated loopback binding (never provider identity: image pins
 * stay in the fleet manifest and intent). Atomic tmp-file + rename writes;
 * a corrupt binding fails closed so reconcile replaces rather than reuses
 * an uncertain address.
 */

export const TOOL_RUNTIME_BINDING_SCHEMA = "desktop-tool-runtime-binding/1.0" as const;

export interface ToolRuntimeBinding {
  readonly schema: typeof TOOL_RUNTIME_BINDING_SCHEMA;
  readonly toolId: string;
  readonly hostPort: number;
  readonly mcpUrl: string;
  readonly healthUrl: string;
  readonly updatedAt: string;
}

export function bindingFileName(toolId: string): string {
  return `tool-runtime-${toolId}.binding.json`;
}

export function loopbackHttpUrl(port: number, path: "/mcp" | "/health"): string {
  return `http://127.0.0.1:${port}${path}`;
}

export async function loadToolRuntimeBinding(
  directory: string,
  toolId: string,
): Promise<ToolRuntimeBinding | undefined> {
  const path = `${directory}/${bindingFileName(toolId)}`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Tool runtime binding is corrupt: ${path} is not valid JSON.`);
  }
  return validateBinding(parsed, path);
}

export async function saveToolRuntimeBinding(
  directory: string,
  binding: Omit<ToolRuntimeBinding, "schema">,
): Promise<void> {
  await Deno.mkdir(directory, { recursive: true });
  const document: ToolRuntimeBinding = {
    schema: TOOL_RUNTIME_BINDING_SCHEMA,
    ...binding,
  };
  validateBinding(document, "(new binding)");
  const path = `${directory}/${bindingFileName(binding.toolId)}`;
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(document, null, 2));
  await Deno.rename(tmp, path);
}

export async function clearToolRuntimeBinding(
  directory: string,
  toolId: string,
): Promise<void> {
  try {
    await Deno.remove(`${directory}/${bindingFileName(toolId)}`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

function validateBinding(value: unknown, path: string): ToolRuntimeBinding {
  const fail = (detail: string): never => {
    throw new Error(`Tool runtime binding is corrupt: ${path} ${detail}.`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== TOOL_RUNTIME_BINDING_SCHEMA) fail("has an unknown schema");
  if (typeof record.toolId !== "string" || record.toolId === "") {
    fail("names no tool");
  }
  if (
    !Number.isSafeInteger(record.hostPort) ||
    (record.hostPort as number) < 1 ||
    (record.hostPort as number) > 65535
  ) {
    fail("carries an invalid host port");
  }
  for (const key of ["mcpUrl", "healthUrl"] as const) {
    const url = record[key];
    if (typeof url !== "string") fail(`carries no ${key}`);
    let parsed: URL;
    try {
      parsed = new URL(url as string);
    } catch {
      fail(`carries an invalid ${key}`);
    }
    if (
      parsed!.protocol !== "http:" || parsed!.hostname !== "127.0.0.1" ||
      parsed!.port !== String(record.hostPort)
    ) {
      fail(`carries a ${key} outside the bound loopback port`);
    }
  }
  if (typeof record.updatedAt !== "string" || record.updatedAt === "") {
    fail("carries no timestamp");
  }
  return {
    schema: TOOL_RUNTIME_BINDING_SCHEMA,
    toolId: record.toolId as string,
    hostPort: record.hostPort as number,
    mcpUrl: record.mcpUrl as string,
    healthUrl: record.healthUrl as string,
    updatedAt: record.updatedAt as string,
  };
}
