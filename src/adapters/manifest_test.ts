import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { loadFleetManifest, ManifestError, validateFleetManifest } from "./manifest.ts";

Deno.test("loadFleetManifest accepts the workspace manifest and preserves posture", async () => {
  const manifest = await loadFleetManifest("config/mcp-fleet.json");
  assertEquals(manifest.version, 1);
  assertEquals(manifest.servers.map((server) => server.id), [
    "syson",
    "build123d",
    "calculix",
  ]);
  assertEquals(manifest.servers[1].network?.exposure, "loopback-only");
  assertEquals(
    manifest.servers[1].trust?.level,
    "first-party-local-privileged",
  );
  assertEquals(manifest.servers[1].trust?.executesArbitraryCode, true);
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
