/**
 * Couche 3 gate (manual only): live end-to-end smoke test for the FEA pipeline.
 *
 * Probes health endpoints, validates the SysON MCP-to-GraphQL path with a
 * read-only project-list query, runs a minimal FEA solve via build123d +
 * CalculiX, validates `parseFeaSolverResponse`, then deletes the one ephemeral
 * STEP in a `finally` block.
 *
 * Exit codes — never conflate INCONCLUSIVE with success:
 *   0 = all providers healthy and the solve pipeline works.
 *   1 = providers healthy but the pipeline failed (real regression).
 *   2 = one or more providers unavailable (INCONCLUSIVE — not a gate failure).
 *
 * SAFETY GUARANTEES (structural, not advisory):
 *
 *   1. The only SysON tool call is `syson_project_list` with a locally random,
 *      impossible filter and `first: 1`. It is read-only and must return an
 *      empty page; no real project metadata is consumed or logged.
 *
 *   2. The gate generates the STEP basename itself from crypto.randomUUID().
 *      No external input determines the export path.
 *
 *   3. The only mutation is one bounded `build123d_export`; CalculiX is
 *      stateless and the exact STEP path is removed in a guaranteed `finally`.
 *
 *   4. A cleanup failure forces exit 1 even after a successful solve.
 *
 * NEVER trigger this gate automatically on PR or push. The workflow
 * `.github/workflows/provider-smoke.yml` is `on: workflow_dispatch` only.
 *
 * Usage:
 *   docker compose up -d syson-db syson-app mcp-syson mcp-build123d mcp-calculix
 *   deno task verify:fea:live
 */

import {
  loadFleetManifest,
  ManifestError,
} from "../../src/adapters/control-plane/manifest.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import { parseFeaSolverResponse } from "../../src/adapters/sensitivity/live-fea/fea-solver-capture.ts";
import {
  ephemeralFeaExportCleanupScript,
  validateEphemeralFeaExportCleanup,
} from "./fea-build123d-cleanup.ts";
import {
  LIVE_SMOKE_BOX_DIMENSIONS_MM,
  LIVE_SMOKE_MESH_SIZE_MM,
  liveSmokeSelections,
} from "./fea-provider-smoke-inputs.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const GATE_EXPORT_PREFIX = "gate-smoke-";
const FLEET_PATH = "config/mcp-fleet.json";

const HEALTH_TIMEOUT_MS = 10_000;
const PROVIDER_TIMEOUT_MS = 120_000;

// ── Exit helpers ──────────────────────────────────────────────────────────────

export class FeaSmokeGateExit extends Error {
  constructor(readonly exitCode: 1 | 2) {
    super(`FEA smoke gate exited with status ${exitCode}.`);
    this.name = "FeaSmokeGateExit";
  }
}

export async function settleFeaSmokeGate(
  run: () => Promise<void>,
  setExitCode: (code: 1 | 2) => void = (code) => {
    Deno.exitCode = code;
  },
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FeaSmokeGateExit) {
      setExitCode(error.exitCode);
      return;
    }
    console.error(
      `FAIL (exit 1): unexpected smoke-gate error: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }`,
    );
    setExitCode(1);
  }
}

function inconclusiveExit(reason: string): never {
  console.error(`INCONCLUSIVE (exit 2): ${reason}`);
  console.error(
    "Providers are unavailable — this is not a regression. Start the Docker stack and re-run.",
  );
  throw new FeaSmokeGateExit(2);
}

function failExit(reason: string): never {
  console.error(`FAIL (exit 1): ${reason}`);
  throw new FeaSmokeGateExit(1);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the bounded response from `syson_project_list` with an impossible
 * random filter and `first: 1`. This proves the MCP-to-GraphQL read path without
 * granting mutation authority or exposing real project metadata.
 */
export function validateSysonProjectListProbe(
  content: Readonly<Record<string, unknown>>,
): void {
  if (!Array.isArray(content.projects)) {
    throw new Error("syson_project_list returned no projects array.");
  }
  if (content.projects.length !== 0) {
    throw new Error(
      "syson_project_list unexpectedly matched the random read-only probe filter.",
    );
  }

  if (!isRecord(content.pageInfo)) {
    throw new Error("syson_project_list returned no pageInfo object.");
  }
  const { count, hasNextPage, endCursor } = content.pageInfo;
  if (count !== 0) {
    throw new Error("syson_project_list pageInfo.count is not zero.");
  }
  if (hasNextPage !== false) {
    throw new Error("syson_project_list empty probe page is unexpectedly truncated.");
  }
  if (endCursor !== null) {
    throw new Error("syson_project_list empty probe page returned an endCursor.");
  }
}

// ── Main smoke test ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
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
    probeHealth(
      sysonEntry.healthUrl,
      `SysON     ${new URL(sysonEntry.healthUrl).port}`,
    ),
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

  // Step 2 — prove the SysON MCP-to-GraphQL path without mutating SysON.
  console.log("\nProbing SysON project list (read-only) …");
  try {
    const readonlyProbeFilter = `gate-smoke-readonly-probe-${
      crypto.randomUUID().replaceAll("-", "")
    }`;
    const listed = await sysonClient.callTool({
      name: "syson_project_list",
      arguments: { filter: readonlyProbeFilter, first: 1 },
    });
    validateSysonProjectListProbe(listed.structuredContent);
    console.log("  SysON read path OK: empty, non-truncated probe page.");
  } catch (error) {
    failExit(
      `syson_project_list read-only probe failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Step 3 — generate the one bounded ephemeral STEP name. The basename is
  // derived entirely from crypto.randomUUID(); no external input controls it.
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const exportName = `${GATE_EXPORT_PREFIX}${suffix}-minimal`;
  const exportPath = `/exports/${exportName}.step`;
  let runFailure: unknown;
  const cleanupFailures: string[] = [];

  console.log(`\nEphemeral STEP path: "${exportPath}"`);

  try {
    // Step 3 — export a minimal geometry via build123d.
    // exportPath is declared before the try block so the finally block can clean it up.
    console.log("\nExporting minimal STEP geometry via build123d …");
    const buildScript = `
from build123d import *
with BuildPart() as bp:
    Box(${LIVE_SMOKE_BOX_DIMENSIONS_MM.join(", ")})
result = bp.part
`.trim();

    let exportResult;
    try {
      exportResult = await build123dClient.callTool({
        name: "build123d_export",
        arguments: {
          script: buildScript,
          name: exportName,
          formats: ["step"],
        },
      });
    } catch (error) {
      failExit(
        `build123d_export failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const exportContent = exportResult.structuredContent as Record<string, unknown>;
    const exported = Array.isArray(exportContent.files)
      ? exportContent.files[0] as Record<string, unknown>
      : undefined;
    if (
      exportContent.schemaVersion !== "1.0" || exportContent.kind !== "export" ||
      !exported || exported.format !== "step" || exported.path !== exportPath ||
      typeof exported.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(exported.sha256) ||
      !Number.isInteger(exported.bytes) || (exported.bytes as number) < 1
    ) failExit("build123d_export did not attest the expected STEP export.");
    console.log(`  Exported STEP to ${exportPath}`);

    // Step 4 — call CalculiX on the exported STEP.
    console.log(
      "\nCalling calculix_solve_static … (may take up to 2 minutes)",
    );
    const solverRequest = {
      step_path: exportPath,
      expected_step_sha256: exported.sha256,
      mesh_size_mm: LIVE_SMOKE_MESH_SIZE_MM,
      material: { e_mpa: 70000, nu: 0.33 },
      selections: liveSmokeSelections(),
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

    // Step 5 — parse the response through the real parser.
    console.log("\nValidating CalculiX response through parseFeaSolverResponse …");
    const rawResponse = solverResult.structuredContent as Record<string, unknown>;
    const constraints = rawResponse.constraints as Record<string, unknown> | undefined;
    if (!constraints) {
      failExit(
        `CalculiX response shape is invalid: ${
          JSON.stringify(rawResponse).slice(0, 200)
        }`,
      );
    }

    let parsed;
    try {
      parsed = parseFeaSolverResponse(rawResponse, {
        stagedPath: exportPath,
        stepDigest: exported.sha256,
        stepBytes: exported.bytes as number,
        fixedSelections: solverRequest.fixed,
        loads: solverRequest.loads.map(({ selection, force_n }) => ({
          selection,
          forceN: force_n,
        })),
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
      `\nOK fea-live-smoke: SysON read probe passed, solve completed, ` +
        `parser accepted the response.`,
    );
  } catch (error) {
    runFailure = error;
  } finally {
    // Step 6 — delete the exported STEP from the shared /exports Docker volume.
    //
    // WHY HERE — build123d and CalculiX share /exports as a Docker volume. There
    // is no host-to-volume path without Docker CLI; the only supported file removal
    // is through build123d_execute. The gate created the file, so the gate cleans
    // it up, regardless of whether the solve succeeded or failed.
    //
    // The path is under the fixed GATE_EXPORT_PREFIX so a naming collision with
    // a real engineering export is structurally excluded.
    console.log(`\nCleaning up: removing ${exportPath} from shared volume …`);
    try {
      const cleanupResult = await build123dClient.callTool({
        name: "build123d_execute",
        arguments: {
          script: ephemeralFeaExportCleanupScript(exportPath),
        },
      });
      validateEphemeralFeaExportCleanup(cleanupResult.structuredContent);
      console.log(`  Export file cleaned up.`);
    } catch (error) {
      cleanupFailures.push(
        `export cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      console.error(
        `  Warning: could not remove export file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      console.error(
        `  Manual cleanup: docker compose exec mcp-build123d rm -f ${exportPath}`,
      );
    }
  }
  if (cleanupFailures.length > 0) throw new FeaSmokeGateExit(1);
  if (runFailure !== undefined) throw runFailure;
}

if (import.meta.main) {
  // Exit status is assigned only after every nested finally has completed; no
  // direct exit may bypass provider cleanup.
  await settleFeaSmokeGate(main);
}
