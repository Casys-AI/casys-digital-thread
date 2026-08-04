/**
 * One real solve at one rib height, as machine-readable JSON on stdout.
 *
 * Why this boundary exists: the LLM-subject experiment for geometry without a
 * closed-form law needs a standalone oracle that reports measurements without
 * policy or threshold knowledge. The orchestrator feeds a rib height, the oracle
 * returns {ribMm, displacementMm, vonMisesMpa, stepSha256}. Judging against a
 * threshold happens in the experiment script, not here. This file writes nothing
 * except its stdout line.
 */

import { HttpMcpToolClient } from "../../src/adapters/http-mcp-tool-client.ts";
import {
  buildRibbedCalculixRequest,
  PLATE_THICKNESS_DEFAULT_MM,
  PLATE_THICKNESS_MAX_MM,
  PLATE_THICKNESS_MIN_MM,
  renderRibbedTrayScript,
  RIB_HEIGHT_MAX_MM,
  RIB_HEIGHT_MIN_MM,
  ribbedTrayVolumeMm3,
} from "./ribbed-geometry.ts";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = Deno.args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

const ribRaw = argument("rib");
const ribMm = Number(ribRaw);
if (!Number.isFinite(ribMm) || ribMm <= 0) {
  console.log(JSON.stringify({
    error: "invalid_rib",
    detail: `--rib=<mm> must be a finite positive number, got ${ribRaw}`,
  }));
  Deno.exit(1);
}
// Refuse requests outside the reviewed domain: outside [1, 14] the banding
// geometry may not fully capture the plate cross-section and the solve would
// measure a boundary-condition artefact rather than rib stiffening.
if (ribMm < RIB_HEIGHT_MIN_MM || ribMm > RIB_HEIGHT_MAX_MM) {
  console.log(JSON.stringify({
    error: "domain_exceeded",
    detail:
      `rib ${ribMm} mm is outside the reviewed safe domain [${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}] mm`,
  }));
  Deno.exit(0);
}

const plateRaw = argument("plate");
const plateMm = plateRaw === undefined ? PLATE_THICKNESS_DEFAULT_MM : Number(plateRaw);
if (
  !Number.isFinite(plateMm) || plateMm < PLATE_THICKNESS_MIN_MM ||
  plateMm > PLATE_THICKNESS_MAX_MM
) {
  console.log(JSON.stringify({
    error: "domain_exceeded",
    detail: `plate ${plateRaw} mm is outside the reviewed safe domain ` +
      `[${PLATE_THICKNESS_MIN_MM}, ${PLATE_THICKNESS_MAX_MM}] mm`,
  }));
  Deno.exit(0);
}

const label = argument("label") ??
  `oracle-ribbed-tray-rib-${ribMm}-plate-${plateMm}`;

const build123d = new HttpMcpToolClient({
  mcpUrl: "http://127.0.0.1:3014/mcp",
  timeoutMs: 120_000,
});
const calculix = new HttpMcpToolClient({
  mcpUrl: "http://127.0.0.1:3015/mcp",
  timeoutMs: 300_000,
});

// Step 1: export the ribbed tray geometry as STEP.
const script = renderRibbedTrayScript(ribMm, plateMm);
const buildResult = await build123d.callTool({
  name: "build123d_export",
  arguments: {
    script,
    formats: ["step"],
    name: label,
    timeout_ms: 120000,
  },
});

const buildSc = buildResult.structuredContent;
if (
  buildSc.schemaVersion !== "1.0" ||
  buildSc.kind !== "export" ||
  !Array.isArray(buildSc.files) ||
  (buildSc.files as unknown[]).length !== 1
) {
  console.log(JSON.stringify({
    error: "build123d_unexpected_response",
    detail: "build123d_export did not return a single STEP export at schema 1.0",
    response: buildSc,
  }));
  Deno.exit(1);
}

const file = (buildSc.files as Record<string, unknown>[])[0];
const stepPath = String(file.path);
const stepSha256 = String(file.sha256);
const stepBytes = Number(file.bytes);

if (!stepPath || !stepSha256 || !Number.isFinite(stepBytes) || stepBytes <= 0) {
  console.log(JSON.stringify({
    error: "build123d_missing_fields",
    detail: "build123d_export file entry missing path, sha256, or bytes",
  }));
  Deno.exit(1);
}

// Step 2: run the linear static FEA on the exported STEP.
const calcArgs = buildRibbedCalculixRequest(stepPath, stepSha256, plateMm);
const calcResult = await calculix.callTool({
  name: "calculix_solve_static",
  arguments: calcArgs,
});

const calcSc = calcResult.structuredContent;
if (calcSc.schemaVersion !== "2.0" || calcSc.kind !== "static-solve") {
  console.log(JSON.stringify({
    error: "calculix_unexpected_response",
    detail: "calculix_solve_static did not return schema 2.0 static-solve",
    response: calcSc,
  }));
  Deno.exit(1);
}

const inputArtifact = calcSc.inputArtifact as Record<string, unknown>;
if (
  inputArtifact.sourcePath !== stepPath ||
  Number(inputArtifact.bytes) !== stepBytes
) {
  console.log(JSON.stringify({
    error: "calculix_attestation_mismatch",
    detail: "CalculiX did not attest the exact STEP file exported by build123d",
    expected: { sourcePath: stepPath, bytes: stepBytes },
    got: { sourcePath: inputArtifact.sourcePath, bytes: inputArtifact.bytes },
  }));
  Deno.exit(1);
}

const handoffSha256 = String(inputArtifact.sha256);
const metrics = calcSc.metrics as Record<string, { value: number; unit: string }>;
const disp = metrics.maxDisplacement;
const vm = metrics.maxVonMises;

if (
  typeof disp?.value !== "number" || !Number.isFinite(disp.value) ||
  typeof vm?.value !== "number" || !Number.isFinite(vm.value)
) {
  console.log(JSON.stringify({
    error: "calculix_invalid_metrics",
    detail: "maxDisplacement or maxVonMises value is not a finite number",
    metrics,
  }));
  Deno.exit(1);
}

console.log(JSON.stringify({
  ribMm,
  plateMm,
  volumeMm3: ribbedTrayVolumeMm3(plateMm, ribMm),
  displacementMm: disp.value,
  vonMisesMpa: vm.value,
  stepSha256: handoffSha256,
}));
