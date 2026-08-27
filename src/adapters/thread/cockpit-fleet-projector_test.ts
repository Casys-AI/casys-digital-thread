import { assertEquals } from "@std/assert";
import {
  projectCockpitFleet,
  projectCockpitFleetFromUnknown,
  readDeclaredCockpitFleet,
} from "./cockpit-fleet-projector.ts";

Deno.test("projectCockpitFleet copies declared identity fields only", () => {
  const extra = {
    id: "syson",
    displayName: "SysON",
    role: "System model",
    required: true,
    healthUrl: "http://127.0.0.1:3009/health",
    mcpUrl: "http://127.0.0.1:3009/mcp",
    image: "example@sha256:abc",
  };
  const projection = projectCockpitFleet([extra]);
  assertEquals(projection, {
    servers: [{
      id: "syson",
      displayName: "SysON",
      role: "System model",
      required: true,
    }],
  });
  assertEquals("healthUrl" in projection.servers[0], false);
});

Deno.test("projectCockpitFleetFromUnknown ignores console-only fields", () => {
  const projection = projectCockpitFleetFromUnknown({
    schemaVersion: "1.0",
    version: 1,
    servers: [{
      id: "syson",
      displayName: "SysON",
      role: "System model",
      required: true,
      healthUrl: "http://127.0.0.1:3009/health",
      expectedTools: ["syson_project_list"],
    }],
  });
  assertEquals(projection, {
    servers: [{
      id: "syson",
      displayName: "SysON",
      role: "System model",
      required: true,
    }],
  });
});

Deno.test("projectCockpitFleetFromUnknown refuses a server missing identity fields", () => {
  assertEquals(
    projectCockpitFleetFromUnknown({
      servers: [{ id: "syson", displayName: "SysON" }],
    }),
    undefined,
  );
});

Deno.test("readDeclaredCockpitFleet projects the workspace fleet manifest", async () => {
  const projection = await readDeclaredCockpitFleet("config/mcp-fleet.json");
  if (projection === undefined) {
    throw new Error("Expected the operator fleet manifest to project.");
  }
  assertEquals(projection.servers.some((server) => server.id === "syson"), true);
  assertEquals("healthUrl" in projection.servers[0], false);
});

Deno.test("readDeclaredCockpitFleet yields undefined when the file is missing", async () => {
  assertEquals(
    await readDeclaredCockpitFleet(
      "missing-fleet.json",
      () => Promise.reject(new Deno.errors.NotFound()),
    ),
    undefined,
  );
});

Deno.test("projectCockpitFleet preserves declared order and required flags", () => {
  const projection = projectCockpitFleet([
    {
      id: "build123d",
      displayName: "build123d",
      role: "Parametric CAD",
      required: true,
    },
    {
      id: "erpnext",
      displayName: "ERPNext",
      role: "Manufacturing records",
      required: false,
    },
  ]);
  assertEquals(projection.servers.map((server) => server.id), [
    "build123d",
    "erpnext",
  ]);
  assertEquals(projection.servers[1].required, false);
});
