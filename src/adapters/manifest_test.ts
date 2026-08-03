import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { loadFleetManifest, ManifestError, validateFleetManifest } from "./manifest.ts";

Deno.test("loadFleetManifest accepts the workspace manifest and preserves posture", async () => {
  const manifest = await loadFleetManifest("config/mcp-fleet.json");
  assertEquals(manifest.version, 1);
  assertEquals(manifest.servers.map((server) => server.id), [
    "syson",
    "build123d",
    "calculix",
    "modelica",
    "erpnext",
  ]);
  assertEquals(manifest.servers[1].network?.exposure, "loopback-only");
  assertEquals(
    manifest.servers[1].trust?.level,
    "first-party-local-privileged",
  );
  assertEquals(manifest.servers[1].trust?.executesArbitraryCode, true);
  const erpnext = manifest.servers.find((server) => server.id === "erpnext");
  assertEquals(erpnext?.expectedTools, [
    "erpnext_bom_list",
    "erpnext_bom_get",
    "erpnext_item_get",
    "erpnext_work_order_list",
    "erpnext_job_card_list",
  ]);
  assertEquals(erpnext?.expectedViews, [
    "ui://mcp-erpnext/doclist-viewer",
  ]);
  assertEquals(erpnext?.trust?.level, "first-party-local-privileged");
  assertEquals(erpnext?.trust?.executesArbitraryCode, false);
});

Deno.test("toolchain Compose defaults remain in parity with fleet desired images", async () => {
  const [manifest, composeSource] = await Promise.all([
    loadFleetManifest("config/mcp-fleet.json"),
    Deno.readTextFile("docker-compose.yml"),
  ]);
  const compose = record(parseYaml(composeSource), "docker-compose.yml");
  const services = record(compose.services, "docker-compose.yml.services");

  for (
    const [serverId, imageVariable] of [
      ["syson", "MCP_SYSON_IMAGE"],
      ["build123d", "TOOLCHAIN_IMAGE"],
      ["calculix", "TOOLCHAIN_IMAGE"],
    ] as const
  ) {
    const server = manifest.servers.find((candidate) => candidate.id === serverId);
    assert(server, `fleet manifest is missing ${serverId}`);

    const service = record(
      services[server.serviceName],
      `docker-compose.yml.services.${server.serviceName}`,
    );
    assertEquals(
      composeImageDefault(service.image, server.serviceName, imageVariable)
        .defaultImage,
      server.image,
      `${server.serviceName} Compose default must match ${serverId} fleet image`,
    );
  }
});

Deno.test("validateFleetManifest ignores documentation extensions", () => {
  const manifest = validateFleetManifest({
    version: 1,
    documentation: { owner: "systems" },
    servers: [serverFixture()],
  });
  assertEquals(manifest.servers.length, 1);
  assertEquals(manifest.servers[0].id, "test");
});

Deno.test("loadFleetManifest reports path and JSON errors", async () => {
  const error = await assertRejects(
    () =>
      loadFleetManifest("broken.json", {
        readTextFile: () => Promise.resolve("{"),
      }),
    ManifestError,
  );
  assertStringIncludes(error.message, "broken.json");
  assertStringIncludes(error.message, "Invalid JSON");
});

Deno.test("validateFleetManifest rejects duplicate ids", () => {
  assertThrows(
    () =>
      validateFleetManifest({
        version: 1,
        servers: [serverFixture(), serverFixture()],
      }),
    ManifestError,
    "Duplicate server id",
  );
});

function serverFixture() {
  return {
    id: "test",
    displayName: "Test",
    role: "test",
    serviceName: "mcp-test",
    transport: "streamable-http",
    mcpUrl: "http://127.0.0.1:3999/mcp",
    healthUrl: "http://127.0.0.1:3999/health",
    image: "example.test/toolchain:1",
    required: true,
    expectedTools: ["test_read"],
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${path} must be an object`,
  );
  return value as Record<string, unknown>;
}

function composeImageDefault(
  image: unknown,
  serviceName: string,
  imageVariable: string,
): { readonly imageVariable: string; readonly defaultImage: string } {
  assert(
    typeof image === "string",
    `${serviceName}.image must be a string`,
  );
  const match = new RegExp(`^\\$\\{${imageVariable}:-(.+)\\}$`).exec(image);
  assert(
    match,
    `${serviceName}.image must use ${imageVariable} with a committed default`,
  );
  return { imageVariable, defaultImage: match[1]! };
}
