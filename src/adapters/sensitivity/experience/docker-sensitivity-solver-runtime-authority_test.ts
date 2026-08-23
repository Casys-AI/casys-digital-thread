import { assertEquals } from "@std/assert";
import type { ContainerObserver } from "../../../application/control-plane/ports.ts";
import type { DesiredServer } from "../../../application/control-plane/read-model/fleet-manifest.ts";
import type { ObservedContainer } from "../../../application/control-plane/read-model/fleet-observation.ts";
import { DockerSensitivitySolverRuntimeAuthority } from "./docker-sensitivity-solver-runtime-authority.ts";

const DIGEST = "a".repeat(64);
const IMAGE = `ghcr.io/casys/calculix@sha256:${DIGEST}`;
const EXPECTED = {
  imageReference: IMAGE,
  imageDigest: { algorithm: "sha256" as const, digest: DIGEST },
};
const SERVER: DesiredServer = {
  id: "calculix",
  displayName: "CalculiX",
  role: "solver",
  serviceName: "calculix",
  transport: "streamable-http",
  mcpUrl: "http://127.0.0.1:8080/mcp",
  healthUrl: "http://127.0.0.1:8080/health",
  image: IMAGE,
  required: true,
  expectedTools: ["calculix_solve_static"],
};

Deno.test("solver runtime authority accepts only the running exact pinned image", async () => {
  const exact = authority({
    runtimeAvailable: true,
    present: true,
    state: "running",
    health: "healthy",
    image: IMAGE,
  });
  const digestReported = authority({
    runtimeAvailable: true,
    present: true,
    state: "running",
    repoDigests: [IMAGE],
  });
  const drifted = authority({
    runtimeAvailable: true,
    present: true,
    state: "running",
    image: "ghcr.io/casys/calculix:latest",
  });
  const unavailable = authority({ runtimeAvailable: false, present: false });

  assertEquals(await exact.attest(EXPECTED), true);
  assertEquals(await digestReported.attest(EXPECTED), true);
  assertEquals(await drifted.attest(EXPECTED), false);
  assertEquals(await unavailable.attest(EXPECTED), false);
});

function authority(observed: ObservedContainer) {
  const observer: ContainerObserver = {
    observe: () => Promise.resolve(new Map([[SERVER.id, observed]])),
  };
  return new DockerSensitivitySolverRuntimeAuthority(observer, SERVER);
}
