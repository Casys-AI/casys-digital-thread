/**
 * Read-only verification for the console manifest, fixtures and evidence.
 *
 * Usage:
 *   deno run --allow-read scripts/verify-console-evidence.ts
 */

interface Artifact {
  id: string;
  path: string;
  bytes: number;
  sha256: string;
}

interface EvidenceBundle {
  schemaVersion: string;
  bundleId: string;
  runId: string;
  artifacts: Artifact[];
  measurements: {
    density: { value: number; unit: string };
    volume: { value: number; unit: string };
    mass: { value: number; unit: string };
    boundingBox: { value: { x: number; y: number; z: number }; unit: string };
    maxVonMises: { value: number; unit: string; source: string };
  };
}

interface FixtureRun {
  id: string;
  source: string;
  stages: Array<{ id: string; outputs: Record<string, unknown> }>;
  evidence: Array<{ id: string; path?: string; sha256?: string }>;
}

interface ConsoleFixture {
  schemaVersion: string;
  mode: string;
  fleet: {
    counts: { total: number; drift: number };
    servers: Array<{
      id: string;
      desired: FleetManifest["servers"][number];
      drift: { status: string; fields: Array<{ field: string; status: string }> };
      demo: boolean;
    }>;
  };
  runs: { items: Array<{ id: string; source: string }> };
}

interface FleetManifest {
  schemaVersion: string;
  version: number;
  servers: Array<{
    id: string;
    mcpUrl: string;
    healthUrl: string;
    image: string;
    expectedTools: string[];
    expectedViews?: string[];
  }>;
}

const repoRoot = new URL("../../", import.meta.url);
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

async function readJson<T>(relativePath: string): Promise<T> {
  try {
    return JSON.parse(
      await Deno.readTextFile(new URL(relativePath, repoRoot)),
    ) as T;
  } catch (error) {
    throw new Error(
      `Cannot parse ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyArtifact(artifact: Artifact): Promise<void> {
  const file = await Deno.readFile(new URL(artifact.path, repoRoot));
  const digest = toHex(await crypto.subtle.digest("SHA-256", file));

  if (file.byteLength !== artifact.bytes) {
    fail(
      `${artifact.id}: byte count is ${file.byteLength}, evidence records ${artifact.bytes}`,
    );
  }
  if (digest !== artifact.sha256) {
    fail(
      `${artifact.id}: SHA-256 is ${digest}, evidence records ${artifact.sha256}`,
    );
  }
}

const manifest = await readJson<FleetManifest>("config/mcp-fleet.json");
const snapshot = await readJson<ConsoleFixture>(
  "state/fixtures/console-snapshot.json",
);
const run = await readJson<FixtureRun>("state/fixtures/runs/bracket-demo.json");
const bundle = await readJson<EvidenceBundle>(
  "examples/console/bracket-evidence.json",
);

if (manifest.schemaVersion !== "1.0" || manifest.version !== 1) {
  fail("config/mcp-fleet.json must use schemaVersion 1.0 and version 1");
}

// Canonical fleet manifest server IDs in declared order.
// When a new provider server is reviewed and added to config/mcp-fleet.json,
// it must also be appended here to keep the gate green.
const expectedServerIds = [
  "syson",
  "build123d",
  "calculix",
  "modelica",
  "erpnext",
  "dfm",
  "tolerance",
  "prusaslicer",
  "spice",
];
const manifestServerIds = manifest.servers.map((server) => server.id);
if (JSON.stringify(manifestServerIds) !== JSON.stringify(expectedServerIds)) {
  fail(`manifest server order/IDs differ: ${manifestServerIds.join(", ")}`);
}

for (const server of manifest.servers) {
  if (!server.mcpUrl.endsWith("/mcp")) {
    fail(`${server.id}: MCP endpoint must end in /mcp`);
  }
  if (!server.healthUrl.endsWith("/health")) {
    fail(`${server.id}: health endpoint must end in /health`);
  }
  if (server.expectedTools.length === 0) {
    fail(`${server.id}: expectedTools must not be empty`);
  }
}

if (
  manifest.servers.find((server) => server.id === "syson")?.expectedViews
    ?.length !== 6
) {
  fail("syson: expectedViews must list all six published/discoverable viewers");
}

const expectedEngineeringViewers = (
  serverId: string,
  viewerUris: string[],
) => {
  const actual = manifest.servers.find((server) => server.id === serverId)
    ?.expectedViews;
  if (JSON.stringify(actual) !== JSON.stringify(viewerUris)) {
    fail(`${serverId}: expectedViews differ from the reviewed viewer set`);
  }
};

expectedEngineeringViewers(
  "build123d",
  [
    "ui://mcp-build123d/results-viewer",
    "ui://mcp-build123d/artifact-helper-viewer",
  ],
);
expectedEngineeringViewers(
  "calculix",
  ["ui://mcp-calculix/results-viewer"],
);
expectedEngineeringViewers(
  "modelica",
  [
    "ui://mcp-modelica/results-viewer",
    "ui://mcp-modelica/run-list-viewer",
  ],
);

const erpnextViews = manifest.servers.find((server) => server.id === "erpnext")
  ?.expectedViews;
if (
  JSON.stringify(erpnextViews) !==
    JSON.stringify(["ui://mcp-erpnext/doclist-viewer"])
) {
  fail("erpnext: expectedViews must list the provider-native document viewer");
}

if (snapshot.schemaVersion !== "2.0" || snapshot.mode !== "demo") {
  fail(
    "console snapshot must be explicitly labelled schemaVersion 2.0 and demo mode",
  );
}
// The checked-in console snapshot is a historical 5-server demo fixture. Its
// server count is intentionally not compared against the current manifest
// (which grows as new providers are added). The snapshot is a labelled demo;
// the manifest is the authoritative desired-state. Each is validated separately.
const DEMO_SNAPSHOT_SERVER_COUNT = 5;
if (snapshot.fleet.counts.total !== DEMO_SNAPSHOT_SERVER_COUNT) {
  fail(
    `console demo snapshot fleet count must remain ${DEMO_SNAPSHOT_SERVER_COUNT} (historical fixture)`,
  );
}
if (snapshot.fleet.servers.some((server) => !server.demo)) {
  fail("every server in the checked-in snapshot must be labelled as demo data");
}
// The checked-in snapshot is a labelled historical demo, not a second desired-state
// manifest. Current desired state is validated directly above and by adapter tests.
const localErpNextImage = "casys-digital-thread/mcp-erpnext:3.0.0-17ca098-1d99467";
if (
  manifest.servers.some((server) =>
    server.id === "erpnext"
      ? server.image !== localErpNextImage
      : !server.image.includes("@sha256:")
  )
) {
  fail(
    "published images must be digest-pinned and the local ERPNext image must be explicit",
  );
}
if (
  snapshot.fleet.counts.drift !== 0 ||
  snapshot.fleet.servers.some((server) =>
    server.drift.status !== "in_sync" ||
    server.drift.fields.find((field) => field.field === "image")?.status !==
      "in_sync"
  )
) {
  fail("source-pinned image fixture must be fully in sync");
}

if (bundle.schemaVersion !== "1.0" || bundle.bundleId !== bundle.runId) {
  fail("evidence bundle schema or run identity is inconsistent");
}
if (run.id !== bundle.runId || run.source !== "demo") {
  fail("run detail must match the evidence bundle and be labelled demo");
}
if (
  snapshot.runs.items.length !== 1 ||
  snapshot.runs.items[0]?.id !== run.id ||
  snapshot.runs.items[0]?.source !== "demo"
) {
  fail("console snapshot run summary must match the demo run detail");
}

const density = bundle.measurements.density.value;
const volume = bundle.measurements.volume.value;
const derivedMassG = density * volume * 1e-6;
const recordedMassG = bundle.measurements.mass.value;
if (Math.abs(derivedMassG - recordedMassG) > 0.000002) {
  fail(
    `mass ${recordedMassG} g does not agree with density × volume (${derivedMassG} g)`,
  );
}
if (
  recordedMassG !== 56.915761 ||
  bundle.measurements.boundingBox.value.z !== 52.5 ||
  bundle.measurements.maxVonMises.value !== 26.6 ||
  bundle.measurements.maxVonMises.source !== "documented-example"
) {
  fail("bracket mass, bbox z or documented FEA fixture truth has drifted");
}

const geometryStage = run.stages.find((stage) => stage.id === "geometry");
const physicsStage = run.stages.find((stage) => stage.id === "physics");
if (
  geometryStage?.outputs.massG !== recordedMassG ||
  physicsStage?.outputs.maxVonMisesMpa !==
    bundle.measurements.maxVonMises.value ||
  physicsStage?.outputs.provenance !== "documented-example"
) {
  fail("run stage outputs do not match the evidence bundle");
}

const runEvidence = new Map(
  run.evidence
    .filter((artifact) => artifact.path && artifact.sha256)
    .map((artifact) => [artifact.path, artifact.sha256]),
);
for (const artifact of bundle.artifacts) {
  if (runEvidence.get(artifact.path) !== artifact.sha256) {
    fail(`${artifact.id}: RunDetail and evidence-bundle hashes differ`);
  }
}

for (const artifact of bundle.artifacts) {
  try {
    await verifyArtifact(artifact);
  } catch (error) {
    fail(
      `${artifact.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  Deno.exit(1);
}

console.log(
  `OK ${bundle.bundleId}: ${bundle.artifacts.length} artifacts, ` +
    `${manifest.servers.length} desired MCP servers, fixture truth consistent`,
);
