/**
 * Host tool plans derived from the fleet manifest (#56).
 *
 * The fleet file is the single source of truth for provider identity; this
 * factory validates the exact entry and refuses anything else. No tag,
 * alias, non-loopback endpoint, or uncovered platform can become a plan.
 */
import fleetManifest from "../../../config/mcp-fleet.json" with { type: "json" };
import type { McpToolResult } from "../../../src/application/ports/out/mcp-tool-client.ts";
import type { ToolRuntimePlan } from "./preparation.ts";

const BUILD123D_TOOL_ID = "build123d";
const BUILD123D_CONTAINER_PORT = 3014;
const BUILD123D_SMOKE_TIMEOUT_MS = 120_000;
const BUILD123D_READINESS_TIMEOUT_MS = 120_000;
const MACOS_DOCKER_DESKTOP_DMG = "https://desktop.docker.com/mac/main/arm64/Docker.dmg";
const MACOS_DOCKER_DESKTOP_DMG_INTEL =
  "https://desktop.docker.com/mac/main/amd64/Docker.dmg";
const DOCKER_DEVELOPER_ID = "Developer ID Application: Docker Inc.";

export interface Build123dHostPlanInput {
  readonly workdir: string;
  /** Defaults to the loopback port in the fleet mcpUrl. */
  readonly hostPort?: number;
}

/**
 * Builds the validated host plan for the fleet-pinned Build123d provider.
 * Throws a TypeError naming the exact divergence for any unexpected entry.
 */
export function build123dHostPlan(input: Build123dHostPlanInput): ToolRuntimePlan {
  const servers = Array.isArray(
      (fleetManifest as { servers?: unknown }).servers,
    )
    ? ((fleetManifest as { servers: unknown[] }).servers)
    : [];
  const entry = servers.filter((server) =>
    typeof server === "object" && server !== null &&
    (server as { id?: unknown }).id === BUILD123D_TOOL_ID
  );
  if (entry.length !== 1) {
    throw new TypeError(
      `Fleet manifest must declare exactly one "${BUILD123D_TOOL_ID}" server.`,
    );
  }
  const server = entry[0] as Record<string, unknown>;
  const image = stringField(server, "image");
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new TypeError("Fleet build123d image must be digest-pinned.");
  }
  const mcpUrl = loopbackHttpUrl(stringField(server, "mcpUrl"), "mcpUrl");
  const healthUrl = loopbackHttpUrl(stringField(server, "healthUrl"), "healthUrl");
  if (server.transport !== "streamable-http") {
    throw new TypeError("Fleet build123d transport must be streamable-http.");
  }
  const expectedTools = server.expectedTools;
  if (
    !Array.isArray(expectedTools) || expectedTools.length === 0 ||
    !expectedTools.every((tool): tool is string => typeof tool === "string")
  ) {
    throw new TypeError("Fleet build123d must declare non-empty expectedTools.");
  }
  if (!expectedTools.includes("build123d_execute")) {
    throw new TypeError("Fleet build123d must expect build123d_execute.");
  }
  const identity = server.providerIdentity;
  if (typeof identity !== "object" || identity === null) {
    throw new TypeError("Fleet build123d must declare providerIdentity.");
  }
  const manifests = (identity as { platformManifests?: unknown }).platformManifests;
  if (
    typeof manifests !== "object" || manifests === null ||
    !isHex64((manifests as Record<string, unknown>)["linux/amd64"]) ||
    !isHex64((manifests as Record<string, unknown>)["linux/arm64"])
  ) {
    throw new TypeError(
      "Fleet build123d must declare linux/amd64 and linux/arm64 platform manifests.",
    );
  }
  const hostPort = input.hostPort ?? mcpUrl.port;
  if (!Number.isSafeInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
    throw new TypeError("Host plan hostPort override must be a valid port.");
  }
  // #57: the fleet URL is identity, not an address. Runtime endpoints
  // derive from the host-allocated port; fleet paths are preserved.
  const runtimeMcpUrl = new URL(mcpUrl.href);
  runtimeMcpUrl.port = String(hostPort);
  const runtimeHealthUrl = new URL(healthUrl.href);
  runtimeHealthUrl.port = String(hostPort);
  const version = (identity as { version?: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new TypeError("Fleet build123d must declare providerIdentity.version.");
  }
  return {
    toolId: BUILD123D_TOOL_ID,
    displayName: "Build123d",
    imageRef: image,
    providerVersion: version,
    platform: hostPlatform(),
    projectName: "casys-host-build123d",
    serviceName: "mcp-build123d",
    hostPort,
    containerPort: BUILD123D_CONTAINER_PORT,
    volumeName: "casys-host-build123d-exports",
    mcpUrl: runtimeMcpUrl.href,
    healthUrl: runtimeHealthUrl.href,
    expectedTools,
    smoke: {
      tool: "build123d_execute",
      args: {
        script: "from build123d import *\nresult = Box(10, 10, 10)",
        timeout_ms: 60_000,
      },
      timeoutMs: BUILD123D_SMOKE_TIMEOUT_MS,
      verify: verifyBuild123dSmoke,
    },
    readinessTimeoutMs: BUILD123D_READINESS_TIMEOUT_MS,
    workdir: input.workdir,
    macOSInstall: {
      dmgUrl: Deno.build.arch === "x86_64"
        ? MACOS_DOCKER_DESKTOP_DMG_INTEL
        : MACOS_DOCKER_DESKTOP_DMG,
      expectedAuthority: DOCKER_DEVELOPER_ID,
      daemonWaitMs: 180_000,
    },
  };
}

/**
 * Exact smoke expectations, measured against provider v0.7.0: a 10 mm box
 * yields 1000 mm³, 6 faces, 12 edges. Returns an error message or undefined.
 */
export function verifyBuild123dSmoke(result: McpToolResult): string | undefined {
  const content = result.structuredContent as Record<string, unknown>;
  if (content.kind !== "execution") return `kind is ${JSON.stringify(content.kind)}`;
  const metrics = content.metrics;
  if (typeof metrics !== "object" || metrics === null) return "metrics missing";
  const values = metrics as Record<string, unknown>;
  if (values.solids !== 1) return `solids is ${JSON.stringify(values.solids)}`;
  if (values.faces !== 6) return `faces is ${JSON.stringify(values.faces)}`;
  if (values.edges !== 12) return `edges is ${JSON.stringify(values.edges)}`;
  if (
    typeof values.volume_mm3 !== "number" || Math.abs(values.volume_mm3 - 1000) > 1e-6
  ) {
    return `volume_mm3 is ${JSON.stringify(values.volume_mm3)}`;
  }
  return undefined;
}

function hostPlatform(): "linux/amd64" | "linux/arm64" {
  if (Deno.build.arch === "aarch64") return "linux/arm64";
  if (Deno.build.arch === "x86_64") return "linux/amd64";
  throw new TypeError(
    `Host architecture ${Deno.build.arch} is not covered by the pinned provider manifests.`,
  );
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Fleet build123d must declare ${key}.`);
  }
  return value;
}

function loopbackHttpUrl(value: string, key: string): { href: string; port: number } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Fleet build123d ${key} must be an absolute URL.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new TypeError(`Fleet build123d ${key} must be loopback HTTP(S).`);
  }
  const port = url.port === ""
    ? (url.protocol === "https:" ? 443 : 80)
    : Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`Fleet build123d ${key} must carry a valid port.`);
  }
  return { href: url.href, port };
}

function isHex64(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
