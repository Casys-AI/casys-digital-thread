import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { loadFleetManifest, ManifestError, validateFleetManifest } from "./manifest.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "./first-party-capability-runtime-launch-groups.ts";

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
    assertEquals(build123d?.expectedViews, [
      "ui://mcp-build123d/results-viewer",
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
    "calculix_mesh_preflight",
    "calculix_solve_static",
    "calculix_solve_modal",
    "calculix_solve_buckling",
    "calculix_solve_creep",
    "calculix_solve_coupled_thermal",
    "calculix_solve_static_recorded",
    "calculix_run_get",
  ]);
  assertEquals(calculix?.network?.sharedVolumes, [
    "calculix-inputs:/inputs",
    "calculix-runs:/var/lib/mcp-calculix-runs",
  ]);
  assertEquals(calculix?.network?.composeNetwork, undefined);
  assertEquals(calculix?.healthUrl, undefined);
  assertEquals(calculix?.required, false);
});

Deno.test("CalculiX desired identity pins the published 0.8.2 index, labels, and timeout ceiling", async () => {
  const raw = JSON.parse(await Deno.readTextFile("config/mcp-fleet.json")) as {
    servers: Array<Record<string, unknown>>;
  };
  const calculix = raw.servers.find((server) => server.id === "calculix");
  assert(calculix, "fleet manifest is missing CalculiX");
  assertEquals(
    calculix.image,
    "ghcr.io/casys-ai/mcp-calculix@sha256:ea933089d0941dd7c45d7e00a825be64c412edbb334a05dc568745ce885abfc8",
  );
  assertEquals(calculix.providerIdentity, {
    version: "0.8.2",
    revision: "6fb30a75c4876ad469cc472ffa8ca691e0a6b58b",
    imageIndexDigest:
      "ea933089d0941dd7c45d7e00a825be64c412edbb334a05dc568745ce885abfc8",
    ociLabels: {
      "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-calculix",
      "org.opencontainers.image.title": "mcp-calculix",
      "org.opencontainers.image.version": "0.8.2",
      "org.opencontainers.image.revision": "6fb30a75c4876ad469cc472ffa8ca691e0a6b58b",
    },
    contractFingerprint:
      "8e8b5c007299818908d424413483addf7fdde5928175c80d2817232b85839ed4",
    ordinarySolveTimeoutMaxMs: 120000,
  });
});

Deno.test("Build123d desired identities pin the dedicated 0.6.1 multi-arch provider contract", async () => {
  const raw = JSON.parse(await Deno.readTextFile("config/mcp-fleet.json")) as {
    servers: Array<Record<string, unknown>>;
  };
  const expectedImage =
    "ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d";
  const expectedIdentity = {
    releaseTag: "v0.6.1",
    version: "0.6.1",
    revision: "beaeb648a979437cce8676da103a39d9eb312290",
    imageIndexDigest:
      "765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
    platformManifests: {
      "linux/amd64": "e040ee6385df909d481ac58ec290a1b13f50ca40b0e48eec58949fb5efde8309",
      "linux/arm64": "420d9ba94b71605443ee59cc1160f94e17ead0c5b6a3f5e7a80f76dffa1ea84b",
    },
    ociLabels: {
      "org.opencontainers.image.created": "2026-08-28T16:59:19Z",
      "org.opencontainers.image.description": "Qualified Build123d MCP provider",
      "org.opencontainers.image.licenses": "MIT",
      "org.opencontainers.image.revision": "beaeb648a979437cce8676da103a39d9eb312290",
      "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-build123d",
      "org.opencontainers.image.title": "mcp-build123d",
      "org.opencontainers.image.url": "https://github.com/denoland/deno_docker",
      "org.opencontainers.image.version": "0.6.1",
    },
    contractFingerprint:
      "43801a71a10eb91959b616947b6ca028fa2ca05e8bf010159180fbf1067f68fa",
  };
  for (const id of ["build123d", "build123d-sandbox"]) {
    const build123d = raw.servers.find((server) => server.id === id);
    assert(build123d, `fleet manifest is missing ${id}`);
    assertEquals(build123d.image, expectedImage);
    assertEquals(build123d.providerIdentity, expectedIdentity);
  }
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
      ["build123d", "MCP_BUILD123D_IMAGE"],
      ["build123d-sandbox", "MCP_BUILD123D_IMAGE"],
      ["spice", "MCP_SPICE_IMAGE"],
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

  const syson = record(services["mcp-syson"], "docker-compose.yml.services.mcp-syson");
  assertEquals(syson.command, ["--port=3009", "--hostname=0.0.0.0"]);
  assertEquals(
    composeImageDefault(syson.image, "mcp-syson", "MCP_SYSON_IMAGE").defaultImage,
    "ghcr.io/casys-ai/mcp-syson@sha256:87eee6e35a636124d5ba6911492a245d69edcdf1ba67575676c22a0e9d7ce65e",
  );

  for (const serviceName of ["mcp-build123d", "mcp-build123d-sandbox"]) {
    const build123d = record(services[serviceName], serviceName);
    assertEquals(build123d.command, undefined);
  }
});

Deno.test("CalculiX sensitivity is absent from root Compose and has one sealed private capability group", async () => {
  const [composeSource, sensitivityCompositionSource] = await Promise.all([
    Deno.readTextFile("docker-compose.yml"),
    Deno.readTextFile("src/adapters/sensitivity/server-composition.ts"),
  ]);
  const compose = record(parseYaml(composeSource), "docker-compose.yml");
  const services = record(compose.services, "docker-compose.yml.services");
  assertEquals("mcp-calculix" in services, false);
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find(
    (candidate) => candidate.id === "casys-mcp-calculix",
  );
  assert(group, "CalculiX launch group is absent");
  const descriptor = JSON.parse(group.compose.content) as {
    services: { "mcp-calculix": Record<string, unknown> };
  };
  const calculix = descriptor.services["mcp-calculix"];
  assertEquals(calculix.command, ["http"]);
  assertEquals(calculix.healthcheck, undefined);
  assertEquals(calculix.volumes, [
    "calculix-inputs:/inputs",
    "calculix-runs:/var/lib/mcp-calculix-runs",
  ]);
  assertEquals(calculix.ports, ["127.0.0.1:3015:3015"]);
  assertEquals(group.security, "reviewed");
  assertEquals(/DockerVolumeAssetStager/.test(sensitivityCompositionSource), false);
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

Deno.test("validateFleetManifest accepts a provider without a published health endpoint", () => {
  const { healthUrl: _healthUrl, ...server } = serverFixture();
  const manifest = validateFleetManifest({
    version: 1,
    servers: [server],
  });

  assertEquals(manifest.servers[0]?.healthUrl, undefined);
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
