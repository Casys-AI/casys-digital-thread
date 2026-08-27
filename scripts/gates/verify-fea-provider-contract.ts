/**
 * Couche 2 gate: validates the CalculiX provider contract from a committed
 * golden fixture without requiring a live provider.
 *
 * WHY THIS EXISTS — the pre-existing test suite validated the parser against
 * itself: stubs returned exactly what the code expected, masking the gap between
 * the test-time format and what CalculiX actually publishes. This gate reads a
 * fixture captured from a real provider run and verifies that `parseFeaSolverResponse`
 * accepts the real CalculiX output shape.
 *
 * The gate also verifies that the fixture's `meta.capturedFromImageDigest` matches
 * the calculix server's image digest in `config/mcp-fleet.json`. A mismatch means
 * the fixture was captured from an older image and must be refreshed with
 * `deno task capture:fea:contract-golden`.
 *
 * Failure modes this gate defends against:
 *  - Parser expects a field name that CalculiX does not publish (e.g. `supports`
 *    vs `fixedSelections`).
 *  - Provider updates its schema version and the parser does not follow.
 *  - Fixture captured from a stale image and never updated.
 *  - Metric values missing, zero, or negative (degraded provider state at capture).
 *
 * Exit 0 = contract valid.
 * Exit 1 = contract invalid.
 * Exit 2 = INCONCLUSIVE (the committed fixture is explicitly synthetic).
 *
 * Usage: deno run --allow-read=state/fixtures,config scripts/gates/verify-fea-provider-contract.ts
 */

import {
  loadFleetManifest,
  ManifestError,
} from "../../src/adapters/control-plane/manifest.ts";
import { parseFeaSolverResponse } from "../../src/adapters/sensitivity/live-fea/fea-solver-capture.ts";

const FIXTURE_PATH =
  "state/fixtures/fea-provider-contract/calculix-response-golden.json";
const FLEET_PATH = "config/mcp-fleet.json";

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * A fixture note that contains this sentinel means it was hand-constructed from
 * the parser contract rather than captured from a live provider. Such a fixture
 * validates the parser against itself — exactly the failure mode this gate was
 * built to prevent.
 */
const SYNTHETIC_FIXTURE_SENTINEL = "Synthetic fixture";

interface GoldenFixture {
  readonly meta: {
    readonly capturedFromImageDigest: string;
    readonly note: string;
  };
  readonly request?: {
    readonly exportAttestation: {
      readonly path: string;
      readonly sha256: string;
      readonly bytes: number;
    };
    readonly solver: {
      readonly fixedSelections: readonly unknown[];
      readonly loads: readonly unknown[];
    };
  };
  readonly response: unknown;
}

const repoRoot = new URL("../../", import.meta.url);

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  Deno.exit(1);
}

function inconclusive(message: string): never {
  console.error(`INCONCLUSIVE ${message}`);
  Deno.exit(2);
}

// ── Read golden fixture ───────────────────────────────────────────────────────

let fixture: GoldenFixture;
try {
  const raw = await Deno.readTextFile(new URL(FIXTURE_PATH, repoRoot));
  fixture = JSON.parse(raw) as GoldenFixture;
} catch (error) {
  fail(
    `Cannot read golden fixture at ${FIXTURE_PATH}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (
  !fixture.meta || typeof fixture.meta.capturedFromImageDigest !== "string" ||
  !fixture.meta.capturedFromImageDigest.trim()
) {
  fail(
    `Golden fixture ${FIXTURE_PATH} is missing meta.capturedFromImageDigest.`,
  );
}

/**
 * A synthetic fixture validates the parser against itself: stubs return exactly
 * what the code expects, masking the gap between the test-time format and what
 * CalculiX actually publishes. Accepting such a fixture would defeat the entire
 * purpose of this gate. Run `deno task capture:fea:contract-golden` with live
 * CalculiX to replace it with a real provider capture.
 */
if (
  typeof fixture.meta.note === "string" &&
  fixture.meta.note.includes(SYNTHETIC_FIXTURE_SENTINEL)
) {
  inconclusive(
    `Golden fixture ${FIXTURE_PATH} is synthetic (its note contains ` +
      `"${SYNTHETIC_FIXTURE_SENTINEL}"). This gate validates the parser against a ` +
      `real provider capture, not against itself. ` +
      `Run \`deno task capture:fea:contract-golden\` with live CalculiX to produce ` +
      `a real fixture, then commit it.`,
  );
}

if (!fixture.response || typeof fixture.response !== "object") {
  fail(`Golden fixture ${FIXTURE_PATH} has no parseable response block.`);
}

// ── Read fleet manifest and verify image digest ───────────────────────────────

let fleet: Awaited<ReturnType<typeof loadFleetManifest>>;
try {
  fleet = await loadFleetManifest(new URL(FLEET_PATH, repoRoot).pathname);
} catch (error) {
  fail(
    `Cannot read fleet manifest at ${FLEET_PATH}: ${
      error instanceof ManifestError ? error.message : String(error)
    }`,
  );
}

const calculixEntry = fleet.servers.find((s) => s.id === "calculix");
if (!calculixEntry) {
  fail(`Fleet manifest has no "calculix" server entry.`);
}

// Extract the digest from the image reference (expects "image@sha256:<hex>" or bare sha).
const fleetImageRef: string = calculixEntry.image ?? "";
const fleetDigestMatch = fleetImageRef.match(/sha256:([0-9a-f]{64})/);
const fleetDigest = fleetDigestMatch ? fleetDigestMatch[1] : fleetImageRef;

if (fixture.meta.capturedFromImageDigest !== fleetDigest) {
  fail(
    `Golden fixture was captured from image digest ` +
      `${fixture.meta.capturedFromImageDigest.slice(0, 16)}… but the fleet ` +
      `manifest now declares ${fleetDigest.slice(0, 16)}…. ` +
      `Run \`deno task capture:fea:contract-golden\` with live CalculiX to refresh the fixture.`,
  );
}

// ── Read sealed request evidence, separately from the response under test ────

/**
 * The response is the object being tested. Expected values are persisted from
 * build123d's export attestation and the solver request before CalculiX replies;
 * deriving them from response fields would make the gate self-referential.
 */
const attestation = fixture.request?.exportAttestation;
const solver = fixture.request?.solver;
const stagedPath = attestation?.path;
const stepDigest = attestation?.sha256;
const stepBytes = attestation?.bytes;
const fixedSelections = solver?.fixedSelections;
const loads = solver?.loads;

if (typeof stagedPath !== "string" || !stagedPath.trim()) {
  fail("Golden fixture request.exportAttestation.path is missing or empty.");
}
if (typeof stepDigest !== "string" || !/^[0-9a-f]{64}$/.test(stepDigest)) {
  fail(
    "Golden fixture request.exportAttestation.sha256 is not a 64-char hex SHA-256.",
  );
}
if (!Number.isInteger(stepBytes) || (stepBytes as number) < 1) {
  fail(
    "Golden fixture request.exportAttestation.bytes is not a positive integer.",
  );
}
if (!Array.isArray(fixedSelections)) {
  fail("Golden fixture request.solver.fixedSelections is not an array.");
}
if (!Array.isArray(loads)) {
  fail("Golden fixture request.solver.loads is not an array.");
}

// ── Call the parser ───────────────────────────────────────────────────────────

let parsed;
try {
  parsed = parseFeaSolverResponse(fixture.response, {
    stagedPath: stagedPath as string,
    stepDigest: stepDigest as string,
    stepBytes: stepBytes as number,
    fixedSelections: fixedSelections as readonly unknown[],
    loads: loads as readonly unknown[],
  });
} catch (error) {
  fail(
    `parseFeaSolverResponse rejected the golden fixture: ${
      error instanceof Error ? error.message : String(error)
    }. ` +
      `This means the parser contract no longer matches the captured provider format. ` +
      `Review the parser and re-capture with \`deno task capture:fea:contract-golden\`.`,
  );
}

// ── Validate metric values ────────────────────────────────────────────────────

/**
 * A fixture captured during a degraded provider run might parse structurally
 * but contain zero or negative metric values. Guard against promoting such a
 * fixture as the canonical reference.
 */
if (
  !Number.isFinite(parsed.metrics.maxDisplacement.value) ||
  parsed.metrics.maxDisplacement.value <= 0
) {
  fail(
    `Golden fixture maxDisplacement.value is ${parsed.metrics.maxDisplacement.value}; ` +
      "must be a positive finite number. Re-capture from a valid provider run.",
  );
}
if (
  !Number.isFinite(parsed.metrics.maxVonMises.value) ||
  parsed.metrics.maxVonMises.value <= 0
) {
  fail(
    `Golden fixture maxVonMises.value is ${parsed.metrics.maxVonMises.value}; ` +
      "must be a positive finite number. Re-capture from a valid provider run.",
  );
}

// ── Report success ────────────────────────────────────────────────────────────

console.log(
  `OK fea-provider-contract: parser accepted the golden fixture. ` +
    `maxDisplacement=${parsed.metrics.maxDisplacement.value} ${parsed.metrics.maxDisplacement.unit}, ` +
    `maxVonMises=${parsed.metrics.maxVonMises.value} ${parsed.metrics.maxVonMises.unit}. ` +
    `Image digest ${
      fixture.meta.capturedFromImageDigest.slice(0, 16)
    }… matches fleet manifest.`,
);
