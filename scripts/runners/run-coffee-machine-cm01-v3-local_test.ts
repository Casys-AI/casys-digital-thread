import { assertEquals, assertRejects } from "@std/assert";
import {
  CM01_V3_LOCAL_EXECUTION_ACKNOWLEDGEMENT,
  coffeeMachineCm01V3StateDirectories,
  runCoffeeMachineCm01V3Local,
} from "./run-coffee-machine-cm01-v3-local.ts";

Deno.test("CM-01 V3 local runner keeps isolated stores below its new report directory", () => {
  const directories = coffeeMachineCm01V3StateDirectories({
    outputDirectory: "state/local/cm01-v3-local-runs/example",
    stateScope: "isolated",
  });

  assertEquals(directories, {
    projects: "state/local/cm01-v3-local-runs/example/projects",
    snapshots: "state/local/cm01-v3-local-runs/example/thread-snapshots",
    baselineCaptures: "state/local/cm01-v3-local-runs/example/approved-brief-captures",
    sysonSeedCaptures: "state/local/cm01-v3-local-runs/example/syson-seed-captures",
    sysonSeedAttempts: "state/local/cm01-v3-local-runs/example/syson-seed-attempts",
    architectureCaptures:
      "state/local/cm01-v3-local-runs/example/architecture-captures",
    architectureAttempts:
      "state/local/cm01-v3-local-runs/example/architecture-attempts",
    cadCaptures: "state/local/cm01-v3-local-runs/example/cad-captures",
    cadAttempts: "state/local/cm01-v3-local-runs/example/cad-attempts",
    thermalCaptures: "state/local/cm01-v3-local-runs/example/thermal-captures",
    thermalAttempts: "state/local/cm01-v3-local-runs/example/thermal-attempts",
    erpBomCaptures: "state/local/cm01-v3-local-runs/example/erp-bom-captures",
    erpBomRunCaptures: "state/local/cm01-v3-local-runs/example/erp-bom-run-captures",
    oracleRequirementsSeedCaptures:
      "state/local/cm01-v3-local-runs/example/oracle-requirements-seed-captures",
    mechanicalCaptures: "state/local/cm01-v3-local-runs/example/mechanical-captures",
    mechanicalAttempts: "state/local/cm01-v3-local-runs/example/mechanical-attempts",
    sensitivityCaptures: "state/local/cm01-v3-local-runs/example/sensitivity-captures",
    sensitivityAttempts: "state/local/cm01-v3-local-runs/example/sensitivity-attempts",
    liveUpdates: "state/local/cm01-v3-local-runs/example/live-updates",
    leases: "state/local/cm01-v3-local-runs/example/leases",
  });
});

Deno.test("CM-01 V3 canonical runner uses the exact server.ts state stores", () => {
  const directories = coffeeMachineCm01V3StateDirectories({
    outputDirectory: "state/local/cm01-v3-local-runs/example",
    stateScope: "canonical",
  });

  assertEquals(directories, {
    projects: "state/local/engineering-projects",
    snapshots: "state/local/thread-snapshots",
    baselineCaptures: "state/local/approved-brief-captures",
    sysonSeedCaptures: "state/local/syson-model-seed-captures",
    sysonSeedAttempts: "state/local/syson-model-seed-attempts",
    architectureCaptures: "state/local/coffee-machine-cm01-v3-architecture-captures",
    architectureAttempts: "state/local/coffee-machine-cm01-v3-architecture-attempts",
    cadCaptures: "state/local/cm01-semantic-cad-captures",
    cadAttempts: "state/local/cm01-semantic-cad-attempts",
    thermalCaptures: "state/local/cm01-nominal-modelica-captures",
    thermalAttempts: "state/local/cm01-nominal-modelica-attempts",
    erpBomCaptures: "state/local/cm01-erpnext-bom-captures",
    erpBomRunCaptures: "state/local/cm01-erpnext-bom-run-captures",
    oracleRequirementsSeedCaptures: "state/local/oracle-requirements-seed-captures",
    mechanicalCaptures: "state/local/cm01-drip-tray-mechanical-captures",
    mechanicalAttempts: "state/local/cm01-drip-tray-mechanical-attempts",
    sensitivityCaptures: "state/local/sensitivity-study-captures",
    sensitivityAttempts: "state/local/sensitivity-run-attempts",
    liveUpdates: "state/local/live-thread-updates",
    leases: "state/local/engineering-project-run-leases",
  });
});

Deno.test("CM-01 V3 canonical runner refuses persistence before creating a report", async () => {
  const root = await Deno.makeTempDir();
  const outputDirectory = `${root}/report`;
  try {
    await assertRejects(
      () =>
        runCoffeeMachineCm01V3Local({
          execute: true,
          acknowledgement: CM01_V3_LOCAL_EXECUTION_ACKNOWLEDGEMENT,
          outputDirectory,
          stateScope: "canonical",
        }),
      Error,
      "canonical-acknowledge=PERSIST_CM01_V3_CANONICAL_PROJECT",
    );
    await assertRejects(() => Deno.stat(outputDirectory), Deno.errors.NotFound);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
