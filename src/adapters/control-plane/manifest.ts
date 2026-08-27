import type {
  DesiredServer,
  FleetManifest,
} from "../../application/control-plane/read-model/fleet-manifest.ts";

/** Desired MCP fleet state for the control-plane. Not a human page. */
export interface ManifestLoaderOptions {
  readTextFile?: (path: string) => Promise<string>;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Load and validate desired state. Unknown fields are intentionally ignored so
 * the workspace manifest can carry documentation without coupling the server
 * to it.
 */
export async function loadFleetManifest(
  path: string,
  options: ManifestLoaderOptions = {},
): Promise<FleetManifest> {
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch (error) {
    throw new ManifestError(
      `Unable to read fleet manifest at ${path}: ${errorMessage(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ManifestError(`Invalid JSON in ${path}: ${errorMessage(error)}`);
  }

  return validateFleetManifest(parsed);
}

export function validateFleetManifest(value: unknown): FleetManifest {
  const root = record(value, "manifest");
  if (root.version !== 1) {
    throw new ManifestError("manifest.version must be 1");
  }
  if (!Array.isArray(root.servers) || root.servers.length === 0) {
    throw new ManifestError("manifest.servers must be a non-empty array");
  }

  const servers = root.servers.map((server, index) =>
    validateServer(server, `manifest.servers[${index}]`)
  );
  const ids = new Set<string>();
  for (const server of servers) {
    if (ids.has(server.id)) {
      throw new ManifestError(`Duplicate server id: ${server.id}`);
    }
    ids.add(server.id);
  }

  return {
    schemaVersion: optionalLiteral(root.schemaVersion, "1.0"),
    version: 1,
    servers,
  };
}

function validateServer(value: unknown, path: string): DesiredServer {
  const input = record(value, path);
  const id = nonEmptyString(input.id, `${path}.id`);
  const transport = literal(
    input.transport,
    "streamable-http",
    `${path}.transport`,
  );
  const mcpUrl = url(input.mcpUrl, `${path}.mcpUrl`);
  const healthUrl = url(input.healthUrl, `${path}.healthUrl`);
  const expectedTools = stringArray(input.expectedTools, `${path}.expectedTools`);

  const expectedViews = input.expectedViews === undefined
    ? undefined
    : stringArray(input.expectedViews, `${path}.expectedViews`);
  const network = input.network === undefined
    ? undefined
    : validateNetwork(input.network, `${path}.network`);
  const trust = input.trust === undefined
    ? undefined
    : validateTrust(input.trust, `${path}.trust`);

  return {
    id,
    displayName: nonEmptyString(input.displayName, `${path}.displayName`),
    role: nonEmptyString(input.role, `${path}.role`),
    serviceName: nonEmptyString(input.serviceName, `${path}.serviceName`),
    transport,
    mcpUrl,
    healthUrl,
    image: nonEmptyString(input.image, `${path}.image`),
    required: boolean(input.required, `${path}.required`),
    expectedTools,
    expectedViews,
    network,
    trust,
  };
}

function validateNetwork(
  value: unknown,
  path: string,
): NonNullable<DesiredServer["network"]> {
  const input = record(value, path);
  return {
    exposure: oneOf(
      input.exposure,
      ["loopback", "loopback-only", "private", "public"] as const,
      `${path}.exposure`,
    ),
    composeNetwork: optionalString(
      input.composeNetwork,
      `${path}.composeNetwork`,
    ),
    sharedVolumes: input.sharedVolumes === undefined
      ? undefined
      : stringArray(input.sharedVolumes, `${path}.sharedVolumes`),
    upstreams: input.upstreams === undefined
      ? undefined
      : stringArray(input.upstreams, `${path}.upstreams`),
  };
}

function validateTrust(
  value: unknown,
  path: string,
): NonNullable<DesiredServer["trust"]> {
  const input = record(value, path);
  return {
    level: oneOf(
      input.level,
      [
        "first-party-local",
        "first-party-local-privileged",
        "first-party-remote",
        "third-party",
      ] as const,
      `${path}.level`,
    ),
    executesArbitraryCode: boolean(
      input.executesArbitraryCode,
      `${path}.executesArbitraryCode`,
    ),
    notes: input.notes === undefined
      ? undefined
      : stringArray(input.notes, `${path}.notes`),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ManifestError(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ManifestError(`${path} must be a boolean`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ManifestError(`${path} must be an array of strings`);
  }
  return [...new Set(value)];
}

function url(value: unknown, path: string): string {
  const text = nonEmptyString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ManifestError(`${path} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ManifestError(`${path} must use http or https`);
  }
  return parsed.toString();
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected) {
    throw new ManifestError(`${path} must be "${expected}"`);
  }
  return expected;
}

function optionalLiteral<T extends string>(
  value: unknown,
  expected: T,
): T | undefined {
  if (value === undefined) return undefined;
  return literal(value, expected, "manifest.schemaVersion");
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ManifestError(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
