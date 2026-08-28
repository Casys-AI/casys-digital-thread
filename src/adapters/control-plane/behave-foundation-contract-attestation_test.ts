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
    attestor: { fetch: fleetFetch(fleet, calls), fingerprint: releaseFingerprint },
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
      { name: "mcp-syson", version: "0.8.3" },
      { name: "mcp-build123d", version: "0.6.1" },
    ],
  );
  assertEquals(report.sysonRelease.labelsMatchExpected, true);
  assertEquals(report.build123dRelease.labelsMatchExpected, true);
  assertEquals(report.requiredMcpContracts[0]?.runtimeContractMatchesExpected, true);
  assertEquals(calls.some((method) => method === "tools/call"), false);
});

Deno.test("Behave attestation does not promote a discovery result without exact material", async () => {
  const [census, fleet] = await fixtures();
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, false),
    fleet,
    attestor: { fetch: fleetFetch(fleet, []), fingerprint: releaseFingerprint },
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
        "mcp-syson": { name: "mcp-build123d", version: "0.6.1" },
      }),
      fingerprint: releaseFingerprint,
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
    attestor: { fetch: fleetFetch(fleet, []), fingerprint: releaseFingerprint },
  });

  assertEquals(actualIds.length, census.materials.length);
  assertEquals(report.evidenceLevel, "declared");
});

Deno.test("Behave attestation rejects a mismatched SysON runtime-contract fingerprint", async () => {
  const [census, fleet] = await fixtures();
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, true),
    fleet,
    attestor: {
      fetch: fleetFetch(fleet, []),
      fingerprint: () => Promise.resolve(mismatchFingerprint()),
    },
  });

  assertEquals(report.evidenceLevel, "cached-exact");
  assertEquals(report.requiredMcpContracts[0]?.runtimeContractMatchesExpected, false);
});

Deno.test("Behave attestation rejects an exact image without the released SysON labels", async () => {
  const [census, fleet] = await fixtures();
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, true, undefined, {
      "org.opencontainers.image.version": "0.8.2",
    }),
    fleet,
    attestor: { fetch: fleetFetch(fleet, []), fingerprint: releaseFingerprint },
  });

  assertEquals(report.evidenceLevel, "cached-exact");
  assertEquals(report.sysonRelease.labelsMatchExpected, false);
});

Deno.test("Behave attestation rejects an exact Build123d image without the released labels", async () => {
  const [census, fleet] = await fixtures();
  const report = await attestBehaveFoundationContracts({
    census,
    host: host(census, true, undefined, {}, {
      "org.opencontainers.image.revision": "not-the-release-revision",
    }),
    fleet,
    attestor: { fetch: fleetFetch(fleet, []), fingerprint: releaseFingerprint },
  });

  assertEquals(report.evidenceLevel, "cached-exact");
  assertEquals(report.build123dRelease.labelsMatchExpected, false);
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
  sysonLabelOverrides: Readonly<Record<string, string>> = {},
  build123dLabelOverrides: Readonly<Record<string, string>> = {},
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
    materialObservations: cached
      ? [{
        materialId: "mcp-syson",
        expectedReference:
          "ghcr.io/casys-ai/mcp-syson@sha256:87eee6e35a636124d5ba6911492a245d69edcdf1ba67575676c22a0e9d7ce65e",
        status: "cached-exact",
        matchedRepoDigest:
          "ghcr.io/casys-ai/mcp-syson@sha256:87eee6e35a636124d5ba6911492a245d69edcdf1ba67575676c22a0e9d7ce65e",
        observedReference:
          "ghcr.io/casys-ai/mcp-syson@sha256:87eee6e35a636124d5ba6911492a245d69edcdf1ba67575676c22a0e9d7ce65e",
        labels: {
          "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-syson",
          "org.opencontainers.image.revision":
            "cf22348d1f91ba7329e0dbc04db814bca32ff17e",
          "org.opencontainers.image.version": "0.8.3",
          ...sysonLabelOverrides,
        },
        detail: "fixture",
      }, {
        materialId: "mcp-build123d-sandbox",
        expectedReference:
          "ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
        status: "cached-exact",
        matchedRepoDigest:
          "ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
        observedReference:
          "ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
        labels: {
          "org.opencontainers.image.created": "2026-08-28T16:59:19Z",
          "org.opencontainers.image.description": "Qualified Build123d MCP provider",
          "org.opencontainers.image.licenses": "MIT",
          "org.opencontainers.image.revision":
            "beaeb648a979437cce8676da103a39d9eb312290",
          "org.opencontainers.image.source":
            "https://github.com/Casys-AI/mcp-build123d",
          "org.opencontainers.image.title": "mcp-build123d",
          "org.opencontainers.image.url": "https://github.com/denoland/deno_docker",
          "org.opencontainers.image.version": "0.6.1",
          ...build123dLabelOverrides,
        },
        detail: "fixture",
      }]
      : [],
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
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push(body.method);
    const server = fleet.servers.find((item) => item.mcpUrl === url);
    if (!server) throw new Error(`No fleet server for ${url}`);
    if (body.method === "server/discover") {
      return Promise.resolve(rpc(body.id, {
        supportedVersions: ["2026-07-28"],
        serverInfo: serverInfoOverrides[server.serviceName] ??
          expectedServerInfo(server.id),
      }));
    }
    if (body.method === "tools/list") {
      return Promise.resolve(rpc(body.id, {
        tools: server.expectedTools.map((name) => ({
          name,
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        })),
      }));
    }
    if (body.method === "resources/list") {
      return Promise.resolve(
        rpc(body.id, {
          resources: (server.expectedViews ?? []).map((uri) => ({ uri })),
        }),
      );
    }
    if (body.method === "resources/read") {
      return Promise.resolve(rpc(body.id, {
        contents: [{
          uri: "ui://mcp-syson/model-explorer-viewer",
          mimeType: "text/html;profile=mcp-app",
          text: "Model Explorer",
        }],
      }));
    }
    throw new Error(`Unexpected method ${body.method}`);
  }) as typeof fetch;
}

function expectedServerInfo(id: string): { name: string; version: string } {
  if (id === "syson") return { name: "mcp-syson", version: "0.8.3" };
  if (id === "build123d-sandbox") {
    return { name: "mcp-build123d", version: "0.6.1" };
  }
  throw new Error(`No Behave endpoint identity for ${id}`);
}

function releaseFingerprint(value: unknown) {
  if (Array.isArray(value) && value.length === 31) {
    return Promise.resolve(fingerprint(
      "faa2a2615fa7b8152ed8f2f3c654c5f095a8dee9ba0debf34008bcee8dd4400c",
    ));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const server = record.serverInfo as Record<string, unknown> | undefined;
    if (server?.version === "0.8.3") {
      return Promise.resolve(fingerprint(
        "58d41a8e20f8030701fc07eb02b3f4ab11d7dff9c3b468a01c2201e8b69f9db8",
      ));
    }
    if (Array.isArray(record.contents)) {
      return Promise.resolve(fingerprint(
        "0621f51beb776e35387349112d4cda6052b298ea39213d8a09d017027cce26b3",
      ));
    }
  }
  return Promise.resolve(mismatchFingerprint());
}

function fingerprint(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function mismatchFingerprint() {
  return fingerprint("0".repeat(64));
}

function rpc(id: number, result: Record<string, unknown>): Response {
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: { resultType: "complete", ...result },
  });
}
