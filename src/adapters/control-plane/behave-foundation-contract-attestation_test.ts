import { assertEquals } from "@std/assert";
import type { BehaveFoundationHostObservation } from "../../application/control-plane/read-model/behave-foundation-doctor.ts";
import { createLocalCalculixIsolatedExecutionServerOptions } from "../fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import { loadFleetManifest } from "./manifest.ts";
import { loadWorkspaceBehaveFoundationCensus } from "./behave-foundation-census.ts";
import { attestBehaveFoundationContracts } from "./behave-foundation-contract-attestation.ts";

Deno.test("Behave attestation reaches contract-attested only after exact cache and full MCP discovery", async () => {
  const [census, fleet] = await fixtures();
  const calls: string[] = [];
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, true),
    fleet,
    attestor: { fetch: fleetFetch(fleet, calls) },
  });

  assertEquals(report.mutatesRuntime, false);
  assertEquals(report.evidenceLevel, "contract-attested");
  assertEquals(report.verticalQualification, "not-observed");
  assertEquals(
    report.requiredMcpContracts.map((contract) => contract.target),
    ["mcp-syson", "mcp-build123d-sandbox"],
  );
  assertEquals(
    report.requiredMcpContracts.map((contract) => contract.expected.server),
    [
      { name: "mcp-syson", version: "0.6.0" },
      { name: "mcp-build123d", version: "0.5.0" },
    ],
  );
  assertEquals(calls.some((method) => method === "tools/call"), false);
});

Deno.test("Behave attestation does not promote a discovery result without exact material", async () => {
  const [census, fleet] = await fixtures();
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, false),
    fleet,
    attestor: { fetch: fleetFetch(fleet, []) },
  });

  assertEquals(report.evidenceLevel, "declared");
  assertEquals(
    report.requiredMcpContracts.every((contract) =>
      contract.evidenceLevel === "contract-attested"
    ),
    true,
  );
});

Deno.test("Behave attestation refuses a healthy lookalike service", async () => {
  const [census, fleet] = await fixtures();
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, true),
    fleet,
    attestor: {
      fetch: fleetFetch(fleet, [], {
        "mcp-syson": { name: "mcp-build123d", version: "0.5.0" },
      }),
    },
  });

  assertEquals(report.evidenceLevel, "cached-exact");
  assertEquals(report.requiredMcpContracts[0]?.health, "healthy");
  assertEquals(report.requiredMcpContracts[0]?.serverMatchesExpected, false);
  assertEquals(report.requiredMcpContracts[0]?.evidenceLevel, "declared");
});

Deno.test("Behave attestation requires the exact set of mandatory materials", async () => {
  const [census, fleet] = await fixtures();
  const actualIds = [
    ...census.materials.slice(0, -1).map((material) => material.id),
    "unrelated-material",
  ];
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, true, actualIds),
    fleet,
    attestor: { fetch: fleetFetch(fleet, []) },
  });

  assertEquals(actualIds.length, census.materials.length);
  assertEquals(report.evidenceLevel, "declared");
});

async function fixtures() {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  return await Promise.all([
    loadWorkspaceBehaveFoundationCensus({
      calculix: {
        imageReference: calculix.profile.imageReference,
        policyFingerprint: calculix.profile.policy.fingerprint,
      },
    }),
    loadFleetManifest("config/mcp-fleet.json"),
  ]);
}

function host(
  census: Awaited<ReturnType<typeof loadWorkspaceBehaveFoundationCensus>>,
  cached: boolean,
  cachedExactMaterialIds?: readonly string[],
): BehaveFoundationHostObservation {
  const ids = cached
    ? cachedExactMaterialIds ?? census.materials.map((material) => material.id)
    : [];
  return {
    schemaVersion: "behave-foundation-host-observation/0.3",
    mutatesRuntime: false,
    platform: "linux/arm64",
    prerequisites: [],
    images: [],
    cachedExactMaterialIds: ids,
    materialObservations: [],
    blockers: [],
  };
}

function fleetFetch(
  fleet: Awaited<ReturnType<typeof loadFleetManifest>>,
  calls: string[],
  serverInfoOverrides: Readonly<Record<string, { name: string; version: string }>> = {},
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return Promise.resolve(Response.json({ status: "ok" }));
    }
    const body = JSON.parse(String(init?.body)) as { method: string };
    calls.push(body.method);
    const server = fleet.servers.find((item) => item.mcpUrl === url);
    if (!server) throw new Error(`No fleet server for ${url}`);
    if (body.method === "server/discover") {
      return Promise.resolve(rpc({
        supportedVersions: ["2026-07-28"],
        serverInfo: serverInfoOverrides[server.serviceName] ??
          expectedServerInfo(server.id),
      }));
    }
    if (body.method === "tools/list") {
      return Promise.resolve(rpc({
        tools: server.expectedTools.map((name) => ({
          name,
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        })),
      }));
    }
    if (body.method === "resources/list") {
      return Promise.resolve(
        rpc({ resources: (server.expectedViews ?? []).map((uri) => ({ uri })) }),
      );
    }
    throw new Error(`Unexpected method ${body.method}`);
  }) as typeof fetch;
}

function expectedServerInfo(id: string): { name: string; version: string } {
  if (id === "syson") return { name: "mcp-syson", version: "0.6.0" };
  if (id === "build123d-sandbox") {
    return { name: "mcp-build123d", version: "0.5.0" };
  }
  throw new Error(`No Behave endpoint identity for ${id}`);
}

function rpc(result: Record<string, unknown>): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { resultType: "complete", ...result },
  });
}
