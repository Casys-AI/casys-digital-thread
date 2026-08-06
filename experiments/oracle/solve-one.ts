/**
 * One real solve at one height, as machine-readable JSON on stdout.
 *
 * Why this boundary exists: the LLM-subject experiment alternates between a
 * fresh agent proposing a height and the oracle judging it with a real solve.
 * The orchestrator that carries messages between the two must not be able to
 * influence either side — so the solve is a standalone command with no memory,
 * no policy, and no threshold knowledge. It reports measurements; judging
 * against a frozen threshold happens in the experiment script, deterministic
 * and logged. It writes nothing except its stdout line.
 */

import { validateSensitivityStudyCase } from "../../src/domain/analysis/sensitivity-study.ts";
import { HttpMcpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import { solveAtHeight } from "./harness.ts";

const SENSITIVITY_CASE_PATH =
  "config/sensitivity-cases/coffee-machine-cm01-v3-drip-tray-size-z.json";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = Deno.args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

const heightRaw = argument("height");
const label = argument("label") ?? "solve-one";
const heightMm = Number(heightRaw);
if (!Number.isFinite(heightMm) || heightMm <= 0) {
  console.log(JSON.stringify({
    error: "invalid_height",
    detail: `--height=<mm> must be a finite positive number, got ${heightRaw}`,
  }));
  Deno.exit(1);
}
// Safe-domain refusal mirrors the campaign guard: outside the reviewed box
// domain a solve would measure a boundary-condition artefact, not physics.
if (heightMm < 20 || heightMm > 31) {
  console.log(JSON.stringify({
    error: "domain_exceeded",
    detail: `height ${heightMm} outside the reviewed safe domain [20, 31] mm`,
  }));
  Deno.exit(0);
}

const sc = validateSensitivityStudyCase(
  JSON.parse(await Deno.readTextFile(SENSITIVITY_CASE_PATH)),
);
const build123d = new HttpMcpToolClient({
  mcpUrl: "http://127.0.0.1:3014/mcp",
  timeoutMs: 120_000,
});
const calculix = new HttpMcpToolClient({
  mcpUrl: "http://127.0.0.1:3015/mcp",
  timeoutMs: 300_000,
});

const result = await solveAtHeight(build123d, calculix, sc, heightMm, label);
console.log(JSON.stringify({
  heightMm,
  displacementMm: result.displacementMm,
  vonMisesMpa: result.vonMisesMpa,
  stepSha256: result.stepSha256,
}));
