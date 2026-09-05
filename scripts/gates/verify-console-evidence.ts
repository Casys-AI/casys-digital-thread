/**
 * Read-only verification for the console manifest, fixtures, and evidence.
 *
 * Usage:
 *   deno run --allow-read scripts/gates/verify-console-evidence.ts
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
  provenance: {
    freshCadExecution: boolean;
    freshFeaExecution: boolean;
    statement: string;
  };
  artifacts: Artifact[];
  measurements: {
    density: { value: number; unit: string };
    volume: { value: number; unit: string };
    mass: { value: number; unit: string };
    boundingBox: { value: { x: number; y: number; z: number }; unit: string };
    maxVonMises: { value: number; unit: string; source: string };
  };
  comparisons: Array<{
    id: string;
    outcome: string;
    source: string;
    recordedValue: { value: number; unit: string };
    recordedLimit: { value: number; unit: string };
  }>;
}

interface FixtureStage {
  id: string;
  serverId: string;
  tool: string;
  basis: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  outputs: Record<string, unknown>;
}

interface FixtureRun {
  id: string;
  status: string;
  verdictStatus: string;
  source: string;
  startedAt?: string;
  completedAt?: string;
  passedRequirements: number;
  failedRequirements: number;
  unresolvedRequirements: number;
  stages: FixtureStage[];
  provenance: Array<{ label: string; value: string }>;
  warnings: string[];
  requirements: Array<{ id: string; status: string; message?: string }>;
  evidence: Array<{ id: string; path?: string; sha256?: string; producedBy?: string }>;
}

interface ConsoleRunSummary {
  id: string;
  name: string;
  subject: string;
  status: string;
  verdictStatus: string;
  source: string;
  passedRequirements: number;
  failedRequirements: number;
  unresolvedRequirements: number;
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
  runs: { items: ConsoleRunSummary[] };
}

interface FleetManifest {
  schemaVersion: string;
  version: number;
  servers: Array<{
    id: string;
    mcpUrl: string;
    healthUrl?: string;
    image: string;
    expectedTools: string[];
    expectedViews?: string[];
  }>;
}

const repoRoot = new URL("../../", import.meta.url);
const failures: string[] = [];
const NO_DISPATCH_ATTESTED =
  "No CAD, FEA, or SysON dispatch is attested by this checked-in demo.";
const EXPECTED_DOCUMENTARY_STAGES = [
  {
    id: "requirements",
    serverId: "fixture",
    tool: "documentary-record",
    basis: "documentary",
    status: "documentary",
  },
  {
    id: "geometry",
    serverId: "fixture",
    tool: "documentary-record",
    basis: "documentary",
    status: "documentary",
  },
  {
    id: "step",
    serverId: "fixture",
    tool: "documentary-record",
    basis: "documentary",
    status: "documentary",
  },
  {
    id: "fea",
    serverId: "fixture",
    tool: "documentary-record",
    basis: "documentary",
    status: "documentary",
  },
  {
    id: "comparison",
    serverId: "fixture",
    tool: "recorded-comparison",
    basis: "comparison",
    status: "not_evaluated",
  },
] as const;

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

function normalizedWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  "build123d-sandbox",
  "calculix",
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
  if (server.healthUrl !== undefined && !server.healthUrl.endsWith("/health")) {
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
  ],
);
expectedEngineeringViewers(
  "calculix",
  ["ui://mcp-calculix/results-viewer"],
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
// The checked-in console snapshot is a historical 4-server demo fixture. Its
// server count is intentionally not compared against the current manifest
// (which grows as new providers are added). The snapshot is a labelled demo;
// the manifest is the authoritative desired-state. Each is validated separately.
const DEMO_SNAPSHOT_SERVER_COUNT = 4;
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

const bundleRecord = bundle as unknown as Record<string, unknown>;
if (bundle.schemaVersion !== "2.0" || bundle.bundleId !== bundle.runId) {
  fail("evidence bundle schema or run identity is inconsistent");
}
if ("verdicts" in bundleRecord) {
  fail("documentary evidence bundle must not publish authoritative verdicts");
}
if (
  bundle.provenance.freshCadExecution !== false ||
  bundle.provenance.freshFeaExecution !== false
) {
  fail("documentary evidence bundle must declare both fresh execution flags false");
}
if (!bundle.provenance.statement.includes(NO_DISPATCH_ATTESTED)) {
  fail(
    "evidence provenance must state that no CAD, FEA, or SysON dispatch is attested",
  );
}
const expectedComparisonIdentity = [
  { id: "massBudget", outcome: "within-recorded-limit", source: "recorded-comparison" },
  { id: "holdLoad", outcome: "within-recorded-limit", source: "recorded-comparison" },
];
if (
  JSON.stringify(
      bundle.comparisons.map(({ id, outcome, source }) => ({ id, outcome, source })),
    ) !== JSON.stringify(expectedComparisonIdentity) ||
  bundle.comparisons.some((comparison) =>
    "status" in (comparison as unknown as Record<string, unknown>)
  )
) {
  fail(
    "evidence bundle must contain only recorded-comparison outcomes, not verdict statuses",
  );
}

if (
  run.id !== bundle.runId || run.source !== "demo" ||
  run.status !== "documentary" || run.verdictStatus !== "not_evaluated"
) {
  fail("run detail must match documentary evidence-bundle identity and state");
}
if (run.startedAt !== undefined || run.completedAt !== undefined) {
  fail("documentary demo run must not claim execution timestamps");
}
if (
  run.passedRequirements !== 0 || run.failedRequirements !== 0 ||
  run.unresolvedRequirements !== 2
) {
  fail(
    "documentary demo requirement summary must remain 0 passed, 0 failed, 2 unresolved",
  );
}
if (
  JSON.stringify(
      run.stages.map(({ id, serverId, tool, basis, status }) => ({
        id,
        serverId,
        tool,
        basis,
        status,
      })),
    ) !== JSON.stringify(EXPECTED_DOCUMENTARY_STAGES) ||
  run.stages.some((stage) =>
    stage.startedAt !== undefined || stage.completedAt !== undefined ||
    stage.basis === "execution"
  )
) {
  fail(
    "documentary run stages must use exact neutral identities, bases, and no timestamps",
  );
}
if (
  run.requirements.length !== 2 ||
  run.requirements.some((requirement) =>
    requirement.status !== "unresolved" ||
    typeof requirement.message !== "string" || requirement.message === ""
  )
) {
  fail("documentary requirements must remain unresolved with an explicit message");
}
if (
  !run.provenance.some((item) => item.value === NO_DISPATCH_ATTESTED) ||
  !run.warnings.includes(NO_DISPATCH_ATTESTED)
) {
  fail("run provenance and warnings must state that no provider dispatch is attested");
}

const expectedRunSummary: ConsoleRunSummary = {
  id: "bracket-demo-2026-07-30",
  name: "Bracket verification",
  subject: "Al 6061 mounting bracket",
  status: "documentary",
  verdictStatus: "not_evaluated",
  source: "demo",
  passedRequirements: 0,
  failedRequirements: 0,
  unresolvedRequirements: 2,
};
if (
  snapshot.runs.items.length !== 1 ||
  JSON.stringify(snapshot.runs.items[0]) !== JSON.stringify(expectedRunSummary)
) {
  fail("console snapshot run summary must match the documentary demo run detail");
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
  bundle.measurements.maxVonMises.source !== "recorded-comparison"
) {
  fail("bracket mass, bbox z, or recorded FEA comparison truth has drifted");
}

const geometryStage = run.stages.find((stage) => stage.id === "geometry");
const feaStage = run.stages.find((stage) => stage.id === "fea");
if (
  geometryStage?.outputs.massG !== recordedMassG ||
  feaStage?.outputs.maxVonMisesMpa !== bundle.measurements.maxVonMises.value ||
  feaStage?.outputs.provenance !== "recorded-comparison"
) {
  fail("documentary stage values do not match the evidence bundle");
}

const allowedDocumentaryProducers = new Set(["checkout", "recorded-comparison"]);
if (
  run.evidence.some((artifact) =>
    artifact.producedBy === undefined ||
    !allowedDocumentaryProducers.has(artifact.producedBy)
  )
) {
  fail("documentary evidence must not claim provider-produced artifacts");
}
if (
  run.evidence.find((artifact) => artifact.id === "step")?.producedBy !==
    "checkout" ||
  run.evidence.find((artifact) => artifact.id === "recorded-comparison")
      ?.producedBy !== "recorded-comparison"
) {
  fail("STEP and recorded comparison evidence must retain their documentary producers");
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

const readme = normalizedWhitespace(
  await Deno.readTextFile(new URL("examples/bracket/README.md", repoRoot)),
);
const readmeIdentity = normalizedWhitespace(
  'The [run fixture](../../state/fixtures/runs/bracket-demo.json) is labelled `source: "demo"`. The [evidence bundle](../console/bracket-evidence.json) records `freshCadExecution: false` and `freshFeaExecution: false`.',
);
const readmeRoute = normalizedWhitespace(
  "The exact fresh-evidence sequence is: admission (`compile.seal-admission@3`) → `design.execute-build123d@1` → isolated noncanonical draft; versus `project_admitted_geometry_export` → human MRTR → `design.write-geometry@1` → canonical STEP; then sealed proof case → `verify.run-fea-static-proof@3`.",
);
if (
  !readme.includes("# The bracket — illustrative documented demo, not a SysON record")
) {
  fail(
    "bracket README heading must label the material as an illustrative documented demo",
  );
}
if (!readme.includes(readmeIdentity)) {
  fail("bracket README must keep demo source separate from provenance execution flags");
}
if (!readme.includes("60 × 40 × 52.5 mm")) {
  fail("bracket README must record the 52.5 mm bounding-box extent");
}
if (/\bC3D10\b|wing top/i.test(readme)) {
  fail("bracket README must not claim unsupported C3D10 or wing-top details");
}
if (
  (readme.match(/within documented limit/g) ?? []).length !== 2 ||
  readme.includes("**pass**")
) {
  fail(
    "bracket README comparisons must state documented limits without a pass verdict",
  );
}
if (!readme.includes(readmeRoute)) {
  fail(
    "bracket README must state the exact isolated, canonical, and FEA route sequence",
  );
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
    `${manifest.servers.length} desired MCP servers, documentary fixture truth consistent`,
);
