/**
 * Runner: capture a real CalculiX response into the golden fixture.
 *
 * Requires CalculiX live at 127.0.0.1:3015 and build123d live at 127.0.0.1:3014.
 * Reads the CalculiX image digest from the fleet manifest and stamps it in the
 * fixture so the couche-2 gate can detect stale captures after an image update.
 *
 * Usage:
 *   docker compose up -d mcp-build123d mcp-calculix
 *   deno task capture:fea:contract-golden
 *
 * The runner writes `state/fixtures/fea-provider-contract/calculix-response-golden.json`.
 * Commit the updated fixture and the couche-2 gate (`deno task verify:fea:contract`)
 * will pass on the new image digest.
 *
 * BOUNDED MUTATION — this runner writes one locally named ephemeral STEP via
 * `build123d_export`, passes that exact export attestation to the stateless
 * CalculiX solve, writes only the committed golden-fixture path, and removes
 * the STEP in a guaranteed `finally`. It never touches project state or thread
 * snapshots; a cleanup failure reports the exact manual removal command.
 */

import {
  loadFleetManifest,
  ManifestError,
} from "../../src/adapters/control-plane/manifest.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import { parseFeaSolverResponse } from "../../src/adapters/sensitivity/live-fea/fea-solver-capture.ts";
import {
  CONTRACT_CAPTURE_BOX_DIMENSIONS_MM,
  CONTRACT_CAPTURE_MESH_SIZE_MM,
  contractCaptureSelections,
} from "./fea-provider-smoke-inputs.ts";
import { requireCleanCaptureForPersistence } from "./fea-contract-capture-lifecycle.ts";
import {
  ephemeralFeaExportCleanupScript,
  validateEphemeralFeaExportCleanup,
} from "./fea-build123d-cleanup.ts";

const FLEET_PATH = "config/mcp-fleet.json";
const FIXTURE_PATH =
  "state/fixtures/fea-provider-contract/calculix-response-golden.json";

const repoRoot = new URL("../../", import.meta.url);

// ── Read fleet manifest ───────────────────────────────────────────────────────

let fleet: Awaited<ReturnType<typeof loadFleetManifest>>;
try {
  fleet = await loadFleetManifest(new URL(FLEET_PATH, repoRoot).pathname);
} catch (error) {
  console.error(
    `Cannot read fleet manifest at ${FLEET_PATH}: ${
      error instanceof ManifestError ? error.message : String(error)
    }`,
  );
  Deno.exit(1);
}

function requiredServer(
  id: string,
): (typeof fleet)["servers"][number] {
  const entry = fleet.servers.find((s) => s.id === id);
  if (!entry) throw new Error(`Fleet manifest has no "${id}" server.`);
  return entry;
}

const build123dEntry = requiredServer("build123d");
const calculixEntry = requiredServer("calculix");

// Extract digest from image reference.
function extractDigest(image: string): string {
  const match = image.match(/sha256:([0-9a-f]{64})/);
  if (match) return match[1];
  throw new Error(
    `Cannot extract sha256 digest from image reference: ${image}. ` +
      "Ensure the fleet manifest uses digest-pinned image references.",
  );
}
const calculixDigest = extractDigest(calculixEntry.image);

// ── Health check ──────────────────────────────────────────────────────────────

console.log(`Probing build123d health at ${build123dEntry.healthUrl} …`);
const b123dHealth = await fetch(build123dEntry.healthUrl).catch(() => null);
if (!b123dHealth || !b123dHealth.ok) {
  console.error(
    "build123d is not healthy — start it with `docker compose up -d mcp-build123d`.",
  );
  Deno.exit(1);
}

console.log(`Probing CalculiX health at ${calculixEntry.healthUrl} …`);
const calcHealth = await fetch(calculixEntry.healthUrl).catch(() => null);
if (!calcHealth || !calcHealth.ok) {
  console.error(
    "CalculiX is not healthy — start it with `docker compose up -d mcp-calculix`.",
  );
  Deno.exit(1);
}

// ── Export and attest the STEP in the shared volume ───────────────────────────

/**
 * build123d_export is the only supported path to place a STEP into the
 * /exports volume that CalculiX can read. The fixture is about this generated
 * box, not examples/bracket: claiming otherwise would forge provenance.
 *
 * WHY NOT DIRECT COPY — CalculiX and build123d share /exports as a Docker
 * volume. There is no host-to-volume copy path without Docker CLI; the only
 * supported file ingress for CalculiX is through build123d_export.
 */
const build123dClient = new HttpMcpToolClient({
  mcpUrl: build123dEntry.mcpUrl,
  timeoutMs: 120_000,
});

const exportName = `fea-contract-golden-${crypto.randomUUID().replaceAll("-", "")}`;
const exportFileName = `${exportName}.step`;
const exportPath = `/exports/${exportFileName}`;

let exportAttempted = false;
let runFailure: unknown;
let cleanupFailure: unknown;
let pendingFixtureText: string | undefined;
try {
  console.log(
    `Exporting ephemeral box geometry to ${exportPath} via build123d_export …`,
  );
  exportAttempted = true;
  let exported: { path: string; sha256: string; bytes: number };
  try {
    const exportResult = await build123dClient.callTool({
      name: "build123d_export",
      arguments: {
        script: `
from build123d import *

# Ephemeral provider-contract geometry. This is not the bracket fixture.
with BuildPart() as part:
    Box(${CONTRACT_CAPTURE_BOX_DIMENSIONS_MM.join(", ")})
    fillet(part.edges().filter_by(Axis.Z).group_by(Axis.X)[-1], 5)
result = part.part
`.trim(),
        // The provider names the file itself: the basename is sanitised and the
        // extension is imposed by the format. Passing a path here is rejected.
        name: exportName,
        formats: ["step"],
      },
    });
    const root = exportResult.structuredContent as Record<string, unknown>;
    const file = Array.isArray(root.files)
      ? root.files[0] as Record<string, unknown>
      : undefined;
    if (
      root.schemaVersion !== "1.0" || root.kind !== "export" || !file ||
      file.format !== "step" || file.path !== exportPath ||
      typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !Number.isInteger(file.bytes) || (file.bytes as number) < 1
    ) throw new Error("build123d_export did not attest the expected STEP export.");
    exported = { path: file.path, sha256: file.sha256, bytes: file.bytes as number };
  } catch (error) {
    console.error(
      `build123d_export failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    console.error(
      "Cannot attest the ephemeral STEP in /exports. CalculiX capture aborted.",
    );
    throw error;
  }

  // ── Call CalculiX ─────────────────────────────────────────────────────────────

  const calculixClient = new HttpMcpToolClient({
    mcpUrl: calculixEntry.mcpUrl,
    timeoutMs: 300_000, // 5 minutes — FEA solves can be slow
  });

  const solverRequest = {
    step_path: exported.path,
    expected_step_sha256: exported.sha256,
    // This is a provider-contract capture, not a convergence study. Ten
    // millimetres is the live-proven bounded mesh for this 80 x 50 x 50 mm
    // geometry; 3 mm reached the static solve but exceeded the provider timeout.
    mesh_size_mm: CONTRACT_CAPTURE_MESH_SIZE_MM,
    material: { e_mpa: 70000, nu: 0.33 },
    selections: contractCaptureSelections(),
    fixed: ["FIXED"],
    loads: [{ selection: "LOADED", force_n: [0, 0, -500] }],
  };

  console.log(
    `Calling calculix_solve_static … (this may take up to 5 minutes)`,
  );
  let solverResult;
  try {
    solverResult = await calculixClient.callTool({
      name: "calculix_solve_static",
      arguments: solverRequest,
    });
  } catch (error) {
    console.error(
      `calculix_solve_static failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }

  // ── Validate the response via the parser ──────────────────────────────────────

  /**
   * Expected identity comes from build123d's export attestation and the exact
   * solver request, never from the CalculiX response being checked.
   */
  const rawResponse = solverResult.structuredContent as Record<string, unknown>;
  let parsed;
  try {
    parsed = parseFeaSolverResponse(rawResponse, {
      stagedPath: exported.path,
      stepDigest: exported.sha256,
      stepBytes: exported.bytes,
      fixedSelections: solverRequest.fixed,
      loads: solverRequest.loads.map(({ selection, force_n }) => ({
        selection,
        forceN: force_n,
      })),
    });
  } catch (error) {
    console.error(
      `Parser rejected the real CalculiX response: ${
        error instanceof Error ? error.message : String(error)
      }. ` +
        "Check that the parser contract matches the current provider format.",
    );
    throw error;
  }

  console.log(
    `Parse OK: maxDisplacement=${parsed.metrics.maxDisplacement.value} mm, ` +
      `maxVonMises=${parsed.metrics.maxVonMises.value} MPa`,
  );

  // ── Write golden fixture ──────────────────────────────────────────────────────

  const fixture = {
    meta: {
      capturedFromImageDigest: calculixDigest,
      capturedAt: new Date().toISOString(),
      note:
        "Captured from live CalculiX provider. Refresh with `deno task capture:fea:contract-golden` after each image update.",
      stepSource: "build123d_export ephemeral box",
    },
    request: {
      exportAttestation: exported,
      solver: {
        fixedSelections: solverRequest.fixed,
        loads: solverRequest.loads.map(({ selection, force_n }) => ({
          selection,
          forceN: force_n,
        })),
      },
    },
    response: rawResponse,
  };

  // Hold the exact bytes in memory. Persistence is deliberately after the
  // required STEP cleanup, so a leaked export can never leave a passing golden.
  pendingFixtureText = JSON.stringify(fixture, null, 2) + "\n";
} catch (error) {
  runFailure = error;
} finally {
  // The file name is generated locally and scoped to this capture. Cleanup is
  // performed even when CalculiX or parser validation fails.
  if (exportAttempted) {
    try {
      const cleanupResult = await build123dClient.callTool({
        name: "build123d_execute",
        arguments: {
          script: ephemeralFeaExportCleanupScript(exportPath),
        },
      });
      validateEphemeralFeaExportCleanup(cleanupResult.structuredContent);
      console.log(`Cleaned up ephemeral STEP ${exportPath}.`);
    } catch (error) {
      console.error(
        `Warning: could not remove ${exportPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      console.error(
        `Manual cleanup: docker compose exec mcp-build123d rm -f ${exportPath}`,
      );
      cleanupFailure = error;
    }
  }
}

const fixtureText = requireCleanCaptureForPersistence({
  pendingFixtureText,
  runFailure,
  cleanupFailure,
});
await Deno.writeTextFile(
  new URL(FIXTURE_PATH, repoRoot),
  fixtureText,
);

console.log(
  `OK: golden fixture written to ${FIXTURE_PATH} ` +
    `(image digest ${calculixDigest.slice(0, 16)}…).`,
);
console.log(
  "Commit the updated fixture to keep the couche-2 gate green on this image.",
);
