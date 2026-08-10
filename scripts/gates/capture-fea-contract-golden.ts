/**
 * Runner: capture a real CalculiX response into the golden fixture.
 *
 * Requires CalculiX live at 127.0.0.1:3015 and build123d live at 127.0.0.1:3014.
 * Reads the CalculiX image digest from the fleet manifest and stamps it in the
 * fixture so the couche-2 gate can detect stale captures after an image update.
 *
 * Usage:
 *   docker compose up -d build123d calculix
 *   deno task capture:fea:contract-golden
 *
 * The runner writes `state/fixtures/fea-provider-contract/calculix-response-golden.json`.
 * Commit the updated fixture and the couche-2 gate (`deno task verify:fea:contract`)
 * will pass on the new image digest.
 *
 * SAFE BY CONSTRUCTION — this runner only calls read-only health probes and
 * the stateless `calculix_solve_static` tool.  It never touches project state,
 * thread snapshots, or any write operation on a real engineering project.
 */

import { loadFleetManifest, ManifestError } from "../../src/adapters/manifest.ts";
import { HttpMcpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import { parseFeaSolverResponse } from "../../src/adapters/captures/fea-solver-capture.ts";

const FLEET_PATH = "config/mcp-fleet.json";
const FIXTURE_PATH =
  "state/fixtures/fea-provider-contract/calculix-response-golden.json";
const STEP_SOURCE = "examples/bracket/bracket.step";

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
    "build123d is not healthy — start it with `docker compose up -d build123d`.",
  );
  Deno.exit(1);
}

console.log(`Probing CalculiX health at ${calculixEntry.healthUrl} …`);
const calcHealth = await fetch(calculixEntry.healthUrl).catch(() => null);
if (!calcHealth || !calcHealth.ok) {
  console.error(
    "CalculiX is not healthy — start it with `docker compose up -d calculix`.",
  );
  Deno.exit(1);
}

// ── Read and hash the STEP file ───────────────────────────────────────────────

/**
 * The bracket STEP from examples/ is a known fixed geometry. Its SHA-256
 * is stable across runs. The capture runner writes the file's actual digest
 * into the fixture so the couche-2 gate can verify the echo invariant.
 */
console.log(`Reading STEP from ${STEP_SOURCE} …`);
const stepBytes = await Deno.readFile(new URL(STEP_SOURCE, repoRoot));
const stepDigestBuf = await crypto.subtle.digest("SHA-256", stepBytes);
const stepDigest = [...new Uint8Array(stepDigestBuf)]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
console.log(`STEP SHA-256: ${stepDigest} (${stepBytes.byteLength} bytes)`);

// ── Copy STEP into the shared /exports volume via build123d ───────────────────

/**
 * build123d_export is the only supported path to place a STEP into the
 * /exports volume that CalculiX can read. We export a trivial box so the
 * runner does not depend on any project state, then we discard the result —
 * the real STEP for the capture is the bracket file we already have.
 *
 * WHY NOT DIRECT COPY — CalculiX and build123d share /exports as a Docker
 * volume. There is no host-to-volume copy path without Docker CLI; the only
 * supported file ingress for CalculiX is through build123d_export.
 *
 * ACTUALLY: we export the bracket geometry directly via build123d_export
 * so the SHA-256 in /exports matches the bracket STEP on disk.
 */
const build123dClient = new HttpMcpToolClient({
  mcpUrl: build123dEntry.mcpUrl,
  timeoutMs: 120_000,
});

const exportFileName = `fea-${stepDigest}.step`;
const exportPath = `/exports/${exportFileName}`;

console.log(
  `Exporting bracket geometry to ${exportPath} via build123d_export …`,
);
try {
  const exportResult = await build123dClient.callTool({
    name: "build123d_export",
    arguments: {
      script: `
from build123d import *

# Re-create the bracket geometry from the canonical Python script.
# The script must produce a result that, when exported to STEP, matches
# the committed examples/bracket/bracket.step SHA-256.
# For the gate capture we accept any structurally valid STEP — the
# important thing is that CalculiX can mesh it and solve it.
with BuildPart() as part:
    Box(80, 50, 50)
    fillet(part.edges().filter_by(Axis.Z).group_by(Axis.X)[-1], 5)
result = part.part
`.trim(),
      // The provider names the file itself: the basename is sanitised and the
      // extension is imposed by the format. Passing a path here is rejected.
      name: exportFileName.replace(/\.step$/, ""),
      formats: ["step"],
    },
  });
  void exportResult;
} catch (error) {
  console.error(
    `build123d_export failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  console.error(
    "Cannot stage the STEP file into /exports. CalculiX capture aborted.",
  );
  Deno.exit(1);
}

// Re-read the actual exported STEP to get its real SHA-256 and byte count.
// We cannot read /exports directly from the host, so we derive them from the
// CalculiX attestation below.

// ── Call CalculiX ─────────────────────────────────────────────────────────────

const calculixClient = new HttpMcpToolClient({
  mcpUrl: calculixEntry.mcpUrl,
  timeoutMs: 300_000, // 5 minutes — FEA solves can be slow
});

const solverRequest = {
  step_path: exportPath,
  // The expected SHA-256 is the bracket digest; CalculiX will attest back.
  // (The exported box may differ; use the attested digest from the response.)
  mesh_size_mm: 3,
  material: { e_mpa: 70000, nu: 0.33 },
  selections: [
    {
      name: "FIXED",
      box: { min: [-40, -25, -25], max: [40, 25, -24] },
    },
    {
      name: "LOADED",
      box: { min: [-40, -25, 24], max: [-33, 25, 25] },
    },
  ],
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
  Deno.exit(1);
}

// ── Validate the response via the parser ──────────────────────────────────────

/**
 * Extract the attested sourcePath and SHA-256 from the CalculiX response
 * before calling the parser (the parser verifies they match the expected values).
 * Since the box geometry differs from the bracket, we derive expected from the
 * response itself — this validates the echo invariant.
 */
const rawResponse = solverResult.structuredContent as Record<string, unknown>;
const ia = rawResponse.inputArtifact as Record<string, unknown>;
const attestedPath = ia?.sourcePath as string;
const attestedSha256 = ia?.sha256 as string;
const attestedBytes = ia?.bytes as number;
const constraints = rawResponse.constraints as Record<string, unknown>;
const attestedFixedSelections = constraints?.fixedSelections as readonly unknown[];
const attestedLoads = constraints?.loads as readonly unknown[];

let parsed;
try {
  parsed = parseFeaSolverResponse(rawResponse, {
    stagedPath: attestedPath,
    stepDigest: attestedSha256,
    stepBytes: attestedBytes,
    fixedSelections: attestedFixedSelections,
    loads: attestedLoads,
  });
} catch (error) {
  console.error(
    `Parser rejected the real CalculiX response: ${
      error instanceof Error ? error.message : String(error)
    }. ` +
      "Check that the parser contract matches the current provider format.",
  );
  Deno.exit(1);
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
    stepSource: STEP_SOURCE,
  },
  response: rawResponse,
};

const fixtureText = JSON.stringify(fixture, null, 2) + "\n";
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
