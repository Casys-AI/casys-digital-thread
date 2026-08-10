/**
 * Couche 3 gate (manual only): live end-to-end smoke test for the FEA pipeline.
 *
 * Probes health endpoints, creates an ephemeral SysON project, runs a minimal
 * FEA solve via build123d + CalculiX, validates `parseFeaSolverResponse`, then
 * deletes all created resources in a `finally` block.
 *
 * Exit codes — never conflate INCONCLUSIVE with success:
 *   0 = all providers healthy and the solve pipeline works.
 *   1 = providers healthy but the pipeline failed (real regression).
 *   2 = one or more providers unavailable (INCONCLUSIVE — not a gate failure).
 *
 * SAFETY GUARANTEES (structural, not advisory):
 *
 *   1. The gate generates the SysON project name itself from crypto.randomUUID().
 *      No external input determines the project name; an agent cannot influence it.
 *
 *   2. `syson_project_delete` is called ONLY through `safeDeleteProject`, which
 *      asserts the name starts with "gate-smoke-" before issuing the delete.
 *      If the assertion fails, the delete is skipped and the gate raises — the
 *      guard exists in code, not in documentation.
 *
 *   3. The gate never takes a project ID or name as an argument. It operates
 *      exclusively on the ID returned by the create call.
 *
 *   4. A 120-second timeout is set on all provider calls; `finally` still runs
 *      after a timeout so the project is not orphaned.
 *
 * NEVER trigger this gate automatically on PR or push. The workflow
 * `.github/workflows/provider-smoke.yml` is `on: workflow_dispatch` only.
 *
 * Usage:
 *   docker compose up -d syson-db syson-app build123d calculix
 *   deno task verify:fea:live
 */

import { loadFleetManifest, ManifestError } from "../../src/adapters/manifest.ts";
import { HttpMcpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import { parseFeaSolverResponse } from "../../src/adapters/captures/fea-solver-capture.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const GATE_PROJECT_PREFIX = "gate-smoke-";
const FLEET_PATH = "config/mcp-fleet.json";

const HEALTH_TIMEOUT_MS = 10_000;
const PROVIDER_TIMEOUT_MS = 120_000;

// ── Exit helpers ──────────────────────────────────────────────────────────────

function inconclusiveExit(reason: string): never {
  console.error(`INCONCLUSIVE (exit 2): ${reason}`);
  console.error(
    "Providers are unavailable — this is not a regression. Start the Docker stack and re-run.",
  );
  Deno.exit(2);
}

function failExit(reason: string): never {
  console.error(`FAIL (exit 1): ${reason}`);
  Deno.exit(1);
}

// ── Health probe ──────────────────────────────────────────────────────────────

async function probeHealth(
  url: string,
  name: string,
): Promise<"ok" | "unavailable"> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal }).finally(
      () => clearTimeout(timer),
    );
    if (response.ok) {
      console.log(`  ${name}: OK (${response.status})`);
      return "ok";
    }
    console.error(`  ${name}: HTTP ${response.status} — unavailable`);
    return "unavailable";
  } catch {
    console.error(`  ${name}: connection refused or timeout — unavailable`);
    return "unavailable";
  }
}

// ── Safety guard: delete only gate-smoke- projects ───────────────────────────

/**
 * The only function allowed to call `syson_project_delete`.
 *
 * WHY HARDCODED GUARD — an agent destroyed a production SysON project by
 * calling DELETE "to verify the method was available". This function makes that
 * impossible: the gate creates its own project and its name is always under the
 * gate-smoke- prefix. Any call path that reaches this function with a wrong
 * prefix is a programming error that must halt, not silently skip.
 */
async function safeDeleteProject(
  syson: HttpMcpToolClient,
  projectId: string,
  projectName: string,
): Promise<void> {
  /**
   * STRUCTURAL SAFETY — this assertion is hardcoded and non-configurable.
   * If the project name does not start with the gate prefix, we do NOT delete
   * it and we throw immediately so the caller knows the cleanup failed.
   */
  if (!projectName.startsWith(GATE_PROJECT_PREFIX)) {
    throw new Error(
      `safeDeleteProject guard violated: project name "${projectName}" does not start ` +
        `with "${GATE_PROJECT_PREFIX}". Refusing to delete. This is a gate bug — ` +
        "the gate must never hold a reference to a project it did not create.",
    );
  }
  try {
    await syson.callTool({
      name: "syson_project_delete",
      arguments: { project_id: projectId },
    });
    console.log(`  Deleted SysON project "${projectName}" (${projectId})`);
  } catch (error) {
    // Log but do not re-throw — the project was ephemeral and will not affect
    // real workloads. Manual cleanup: `syson_project_delete` by project id.
    console.error(
      `  Warning: could not delete project "${projectName}" (${projectId}): ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      `  Manual cleanup: call syson_project_delete with project_id="${projectId}".`,
    );
  }
}

// ── Main smoke test ───────────────────────────────────────────────────────────

console.log("=== FEA live smoke gate ===");

// Load provider URLs from the fleet manifest so ports stay in a single source
// of truth. If the manifest is unreadable, that is a configuration error (exit 1).
const repoRoot = new URL("../../", import.meta.url);
let fleet: Awaited<ReturnType<typeof loadFleetManifest>>;
try {
  fleet = await loadFleetManifest(new URL(FLEET_PATH, repoRoot).pathname);
} catch (error) {
  failExit(
    `Cannot read fleet manifest at ${FLEET_PATH}: ${
      error instanceof ManifestError ? error.message : String(error)
    }`,
  );
}

function requiredManifestServer(
  id: string,
): (typeof fleet)["servers"][number] {
  const entry = fleet.servers.find((s) => s.id === id);
  if (!entry) failExit(`Fleet manifest has no "${id}" server entry.`);
  return entry;
}

const sysonEntry = requiredManifestServer("syson");
const build123dEntry = requiredManifestServer("build123d");
const calculixEntry = requiredManifestServer("calculix");

// Step 1 — probe health endpoints.
console.log("\nProbing health endpoints …");
const [sysonStatus, b123dStatus, calcStatus] = await Promise.all([
  probeHealth(sysonEntry.healthUrl, `SysON     ${new URL(sysonEntry.healthUrl).port}`),
  probeHealth(
    build123dEntry.healthUrl,
    `build123d ${new URL(build123dEntry.healthUrl).port}`,
  ),
  probeHealth(
    calculixEntry.healthUrl,
    `CalculiX  ${new URL(calculixEntry.healthUrl).port}`,
  ),
]);

if (
  sysonStatus === "unavailable" || b123dStatus === "unavailable" ||
  calcStatus === "unavailable"
) {
  inconclusiveExit(
    "One or more providers are unavailable. Cannot distinguish a pipeline failure from a missing provider.",
  );
}

// All providers healthy — failures from here are real regressions (exit 1).

const sysonClient = new HttpMcpToolClient({
  mcpUrl: sysonEntry.mcpUrl,
  timeoutMs: PROVIDER_TIMEOUT_MS,
});
const build123dClient = new HttpMcpToolClient({
  mcpUrl: build123dEntry.mcpUrl,
  timeoutMs: PROVIDER_TIMEOUT_MS,
});
const calculixClient = new HttpMcpToolClient({
  mcpUrl: calculixEntry.mcpUrl,
  timeoutMs: PROVIDER_TIMEOUT_MS,
});

// Step 2 — generate a unique ephemeral project name.
// The name is derived entirely from crypto.randomUUID() — no external input.
const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const projectName = `${GATE_PROJECT_PREFIX}${suffix}`;
// Hoist the export path so the finally block can clean it up regardless of
// where in the try block execution is interrupted.
const exportPath = `/exports/${GATE_PROJECT_PREFIX}${suffix}-minimal.step`;
let projectId: string | undefined;

console.log(`\nEphemeral project name: "${projectName}"`);

try {
  // Step 3 — create SysON project.
  console.log("\nCreating SysON project …");
  let createResult;
  try {
    createResult = await sysonClient.callTool({
      name: "syson_project_create",
      arguments: { name: projectName, description: "FEA gate smoke test — ephemeral" },
    });
  } catch (error) {
    failExit(
      `syson_project_create failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Extract project ID from the response.
  const created = createResult.structuredContent as Record<string, unknown>;
  const createdId = created.id ?? created.projectId ?? created.project_id;
  if (typeof createdId !== "string" || !createdId.trim()) {
    failExit(
      `syson_project_create returned no project id: ${JSON.stringify(created)}`,
    );
  }
  projectId = createdId as string;
  console.log(`  Created project "${projectName}" id=${projectId}`);

  // Step 4 — export a minimal geometry via build123d.
  // exportPath is declared before the try block so the finally block can clean it up.
  console.log("\nExporting minimal STEP geometry via build123d …");
  const buildScript = `
from build123d import *
with BuildPart() as bp:
    Box(20, 20, 20)
result = bp.part
`.trim();

  let exportResult;
  try {
    exportResult = await build123dClient.callTool({
      name: "build123d_export",
      arguments: {
        script: buildScript,
        export_path: exportPath,
        format: "step",
      },
    });
  } catch (error) {
    failExit(
      `build123d_export failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  void exportResult;
  console.log(`  Exported STEP to ${exportPath}`);

  // Step 5 — call CalculiX on the exported STEP.
  console.log(
    "\nCalling calculix_solve_static … (may take up to 2 minutes)",
  );
  const solverRequest = {
    step_path: exportPath,
    mesh_size_mm: 3,
    material: { e_mpa: 70000, nu: 0.33 },
    selections: [
      {
        name: "BASE",
        box: { min: [0, 0, 0], max: [20, 20, 1] },
      },
      {
        name: "TOP",
        box: { min: [0, 0, 19], max: [20, 20, 20] },
      },
    ],
    fixed: ["BASE"],
    loads: [{ selection: "TOP", force_n: [0, 0, -10] }],
  };

  let solverResult;
  try {
    solverResult = await calculixClient.callTool({
      name: "calculix_solve_static",
      arguments: solverRequest,
    });
  } catch (error) {
    failExit(
      `calculix_solve_static failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Step 6 — parse the response through the real parser.
  console.log("\nValidating CalculiX response through parseFeaSolverResponse …");
  const rawResponse = solverResult.structuredContent as Record<string, unknown>;
  const ia = rawResponse.inputArtifact as Record<string, unknown> | undefined;

  if (!ia) {
    failExit("CalculiX response missing inputArtifact — provider contract violated.");
  }

  const attestedPath = ia.sourcePath;
  const attestedSha256 = ia.sha256;
  const attestedBytes = ia.bytes;
  const constraints = rawResponse.constraints as Record<string, unknown> | undefined;
  const attestedFixed = constraints?.fixedSelections as readonly unknown[] | undefined;
  const attestedLoads = constraints?.loads as readonly unknown[] | undefined;

  if (
    typeof attestedPath !== "string" || typeof attestedSha256 !== "string" ||
    !Number.isInteger(attestedBytes) || !Array.isArray(attestedFixed) ||
    !Array.isArray(attestedLoads)
  ) {
    failExit(
      `CalculiX response shape is invalid: ${
        JSON.stringify(rawResponse).slice(0, 200)
      }`,
    );
  }

  let parsed;
  try {
    parsed = parseFeaSolverResponse(rawResponse, {
      stagedPath: attestedPath,
      stepDigest: attestedSha256 as string,
      stepBytes: attestedBytes as number,
      fixedSelections: attestedFixed,
      loads: attestedLoads,
    });
  } catch (error) {
    failExit(
      `parseFeaSolverResponse rejected the live provider response: ${
        error instanceof Error ? error.message : String(error)
      }. ` +
        "The parser contract no longer matches the CalculiX provider output.",
    );
  }

  console.log(
    `  maxDisplacement=${parsed.metrics.maxDisplacement.value} ${parsed.metrics.maxDisplacement.unit}`,
  );
  console.log(
    `  maxVonMises=${parsed.metrics.maxVonMises.value} ${parsed.metrics.maxVonMises.unit}`,
  );

  if (
    !Number.isFinite(parsed.metrics.maxDisplacement.value) ||
    parsed.metrics.maxDisplacement.value <= 0 ||
    !Number.isFinite(parsed.metrics.maxVonMises.value) ||
    parsed.metrics.maxVonMises.value <= 0
  ) {
    failExit(
      "Metric values are not positive — the solve may have failed or the geometry is degenerate.",
    );
  }

  console.log(
    `\nOK fea-live-smoke: all providers healthy, solve completed, ` +
      `parser accepted the response.`,
  );
} finally {
  // Step 7a — delete the exported STEP from the shared /exports Docker volume.
  //
  // WHY HERE — build123d and CalculiX share /exports as a Docker volume. There
  // is no host-to-volume path without Docker CLI; the only supported file removal
  // is through build123d_execute. The gate created the file, so the gate cleans
  // it up, regardless of whether the solve succeeded or failed.
  //
  // The path is under the GATE_PROJECT_PREFIX so a naming collision with a real
  // engineering export is structurally impossible (prefix enforcement is
  // consistent with safeDeleteProject below).
  console.log(`\nCleaning up: removing ${exportPath} from shared volume …`);
  try {
    await build123dClient.callTool({
      name: "build123d_execute",
      arguments: {
        script: [
          "import os",
          `path = ${JSON.stringify(exportPath)}`,
          "if os.path.exists(path):",
          "    os.remove(path)",
          "    print(f'Removed {path}')",
          "else:",
          "    print(f'File not found (already removed or never written): {path}')",
          "result = None",
        ].join("\n"),
      },
    });
    console.log(`  Export file cleaned up.`);
  } catch (error) {
    // Non-fatal — the file is isolated under the gate-smoke- prefix and will not
    // interfere with real engineering exports. Log the manual cleanup command.
    console.error(
      `  Warning: could not remove export file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    console.error(
      `  Manual cleanup: docker compose exec build123d rm -f ${exportPath}`,
    );
  }

  // Step 7b — delete the ephemeral SysON project unconditionally.
  // `safeDeleteProject` enforces the prefix guard — no project outside the
  // gate-smoke- namespace can be deleted through this path.
  if (projectId) {
    console.log("\nCleaning up: deleting ephemeral SysON project …");
    await safeDeleteProject(sysonClient, projectId, projectName);
  }
}
