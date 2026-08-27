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
    "build123d-sandbox",
    "calculix",
    "erpnext",
    "dfm",
    "tolerance",
    "prusaslicer",
    "spice",
  ]);
  assertEquals(manifest.servers[1].network?.exposure, "loopback-only");
  assertEquals(
    manifest.servers[1].trust?.level,
    "first-party-local-privileged",
  );
  assertEquals(manifest.servers[1].trust?.executesArbitraryCode, true);
  for (const serverId of ["build123d", "build123d-sandbox"]) {
    const build123d = manifest.servers.find((server) => server.id === serverId);
    assertEquals(build123d?.expectedTools, [
      "build123d_execute",
      "build123d_export",
      "build123d_observe_assembly_integrity",
    ]);
  }
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

  const calculix = manifest.servers.find((server) => server.id === "calculix");
  assertEquals(calculix?.expectedTools, [
    "calculix_solve_static",
    "calculix_solve_modal",
    "calculix_solve_buckling",
    "calculix_solve_creep",
    "calculix_solve_coupled_thermal",
    "calculix_solve_static_recorded",
    "calculix_run_get",
  ]);
  assertEquals(calculix?.network?.sharedVolumes, [
    "exports:/exports:ro",
    "casys-digital-thread-calculix-inputs:/inputs",
    "casys-digital-thread-calculix-runs:/var/lib/mcp-calculix-runs",
  ]);
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
      ["build123d-sandbox", "TOOLCHAIN_IMAGE"],
      ["calculix", "MCP_CALCULIX_IMAGE"],
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

Deno.test("CalculiX keeps durable evidence, read-only CAD, and private FEA staging distinct", async () => {
  const [composeSource, sensitivityCompositionSource] = await Promise.all([
    Deno.readTextFile("docker-compose.yml"),
    Deno.readTextFile("src/adapters/sensitivity/server-composition.ts"),
  ]);
  const compose = record(parseYaml(composeSource), "docker-compose.yml");
  const services = record(compose.services, "docker-compose.yml.services");
  const calculix = record(services["mcp-calculix"], "mcp-calculix");
  const environment = record(calculix.environment, "mcp-calculix.environment");

  assertEquals(calculix.command, undefined);
  assertEquals(environment.CALCULIX_RUNS_DIRECTORY, "/var/lib/mcp-calculix-runs");
  assertEquals(environment.CALCULIX_MAX_RECORDED_RUNS, "24");
  assertEquals(calculix.volumes, [
    "exports:/exports:ro",
    "calculix-inputs:/inputs",
    "calculix-runs:/var/lib/mcp-calculix-runs",
  ]);
  assertEquals(calculix.tmpfs, undefined);
  assertEquals(calculix.healthcheck, {
    test: ["CMD", "curl", "-fsS", "http://localhost:3015/health"],
    interval: "10s",
    timeout: "5s",
    retries: 6,
  });

  const volumes = record(compose.volumes, "docker-compose.yml.volumes");
  const inputs = record(volumes["calculix-inputs"], "calculix-inputs");
  assertEquals(
    inputs.name,
    "${CALCULIX_INPUTS_VOLUME:-casys-digital-thread-calculix-inputs}",
  );
  const runs = record(volumes["calculix-runs"], "calculix-runs");
  assertEquals(
    runs.name,
    "${CALCULIX_RUNS_VOLUME:-casys-digital-thread-calculix-runs}",
  );
  assert(
    /new DockerVolumeAssetStager\(\{\s+service: "mcp-calculix",\s+containerDirectory: "\/inputs",\s+\}\)/
      .test(sensitivityCompositionSource),
  );
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
