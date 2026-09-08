import { assertEquals } from "@std/assert";
import type { EngineeringCaseCatalog } from "./src/thread/types.ts";
import {
  ENGINEERING_CASE_FAMILIES,
  type EngineeringCase,
  projectCurrentEngineeringCases,
  unavailableEngineeringCaseCatalog,
  verificationCaseKey,
} from "../presentation/workbench/thread/evidence.ts";
import type { OverviewRecordedHeroNode } from "./src/project/overview-thread-hero-model.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "./src/project/overview/hulls/domain-groups.ts";
import { buildOverviewHullContents } from "./src/project/overview/hulls/content.ts";
import {
  buildOverviewCurrentEngineeringCasesContent,
  OVERVIEW_CURRENT_ENGINEERING_CASES_ADAPTER_ID,
  withOverviewCurrentEngineeringCases,
} from "./src/project/overview/hulls/adapters/from-current-engineering-cases.ts";
import { OVERVIEW_HULL_ADAPTERS } from "./src/project/overview/hulls/adapters/index.ts";
import { overviewHullRowGraphRefs } from "./src/project/overview/hulls/types.ts";
import { overviewHullRowPresentation } from "./src/project/overview/hulls/row.ts";
import { overviewThreadD3FlowGroupIdentity as groupId } from "./src/project/overview-thread-d3-flow-layout.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";

const CAMERA_ID = "id01-camera-bracket-bench";
const RADIAL_ID = "id01-radial-arm-bench";
const CAMERA_R1_DIGEST = "a".repeat(64);
const CAMERA_R3_DIGEST = "c".repeat(64);
const RADIAL_R2_DIGEST = "d".repeat(64);
const CAMERA_R1_KEY = verificationCaseKey("mechanical-proof", CAMERA_R1_DIGEST);
const CAMERA_R3_KEY = verificationCaseKey("mechanical-proof", CAMERA_R3_DIGEST);
const RADIAL_R2_KEY = verificationCaseKey("mechanical-proof", RADIAL_R2_DIGEST);
const CAMERA_REQUIREMENT_ID = "req-camera-bracket-stiffness";
const RADIAL_REQUIREMENT_ID = "req-radial-arm-stiffness";
const CAMERA_REQUIREMENT_NAME = "Camera bracket stiffness";
const RADIAL_REQUIREMENT_NAME = "Radial arm stiffness";
const R1_SOLVER = "artifact:calculix-isolated-result-json-r1";
const R3_SOLVER = "artifact:calculix-isolated-result-json-r3";
const R2_SOLVER = "artifact:calculix-isolated-result-json-r2";
const CAMERA_EVAL_R3 = "evaluation:camera-eval-r3";
const FORBIDDEN_VISIBLE = [
  "r1",
  "r2",
  "r3",
  "current",
  "prior",
  "Local CalculiX",
  "result.json",
  "History",
];
const FEA_PHYSICS = groupId("physics", OVERVIEW_DOMAIN_GROUP_KEYS.fea);
const FEA_VERDICTS = groupId("verdicts", OVERVIEW_DOMAIN_GROUP_KEYS.fea);

Deno.test("current-engineering-cases remains a registered producer of the same hull content", () => {
  assertEquals(
    OVERVIEW_HULL_ADAPTERS.map((adapter) => adapter.id),
    ["current-brief", "current-engineering-cases"],
  );
  assertEquals(
    OVERVIEW_HULL_ADAPTERS.some((adapter) =>
      adapter.id === OVERVIEW_CURRENT_ENGINEERING_CASES_ADAPTER_ID
    ),
    true,
  );
});

Deno.test("ID01 Camera r3 and Radial r2 current cases produce two Physics and two Verdicts rows", () => {
  const wrapped = wrapId01();
  const physics = wrapped.get(FEA_PHYSICS)!;
  const verdicts = wrapped.get(FEA_VERDICTS)!;
  assertEquals(physics.rows.map((row) => row.label), [
    "Camera bracket bench",
    "Radial arm bench",
  ]);
  assertEquals(verdicts.rows.map((row) => row.label), [
    "Camera bracket bench",
    "Radial arm bench",
  ]);
  assertEquals(physics.rows.map((row) => row.key), [
    CAMERA_R3_KEY,
    RADIAL_R2_KEY,
  ]);
  assertEquals(physics.rows.length, 2);
  assertEquals(verdicts.rows.length, 2);
  for (const row of [...physics.rows, ...verdicts.rows]) {
    assertEquals(row.depth, 0);
    assertEquals(row.parentKey, undefined);
    assertEquals(row.endpoint, true);
    assertEquals(row.selectable, true);
    assertEquals(row.focusable, true);
  }
  assertEquals(physics.counts, undefined);
  assertEquals(verdicts.counts, undefined);
  assertEquals("history" in physics, false);
  assertEquals("history" in verdicts, false);
  assertEquals("counts" in physics, false);
  assertEquals("counts" in verdicts, false);
  const visible = [...physics.rows, ...verdicts.rows]
    .flatMap((row) => [row.label, row.detail ?? ""])
    .join(" ");
  for (const word of FORBIDDEN_VISIBLE) {
    assertEquals(visible.includes(word), false, word);
  }
});

Deno.test("Physics Camera viewer binds the current r3 solver-result only", () => {
  const physics = wrapId01({
    sessions: [
      artifactSession("r1-app", "calculix-isolated-result-json-r1"),
      artifactSession("r3-app", "calculix-isolated-result-json-r3"),
    ],
  }).get(FEA_PHYSICS)!;
  const camera = physics.rows.find((row) => row.key === CAMERA_R3_KEY)!;
  const radial = physics.rows.find((row) => row.key === RADIAL_R2_KEY)!;
  assertEquals(camera.nodeKey, R3_SOLVER);
  assertEquals(camera.viewerNodeKey, R3_SOLVER);
  assertEquals(camera.sessionIds, ["r3-app"]);
  assertEquals(camera.detail, undefined);
  assertEquals(overviewHullRowPresentation(camera).hasViewer, true);
  assertEquals(camera.viewerNodeKey === R1_SOLVER, false);
  assertEquals(camera.sessionIds.includes("r1-app"), false);
  assertEquals(radial.nodeKey, R2_SOLVER);
  assertEquals(overviewHullRowGraphRefs(camera)[0], R3_SOLVER);
});

Deno.test("visible graphRefs exclude exclusively r1 records", () => {
  const wrapped = wrapId01();
  const physics = wrapped.get(FEA_PHYSICS)!;
  const verdicts = wrapped.get(FEA_VERDICTS)!;
  const visibleRefs = [...physics.rows, ...verdicts.rows].flatMap(
    overviewHullRowGraphRefs,
  );
  assertEquals(visibleRefs.includes(R1_SOLVER), false);
  assertEquals(visibleRefs.includes("evaluation:camera-eval-r1"), false);
  assertEquals(visibleRefs.includes("artifact:fea-proof-camera-r1"), false);
  assertEquals(visibleRefs.includes(R3_SOLVER), true);
  const cameraPhysics = physics.rows.find((row) => row.key === CAMERA_R3_KEY)!;
  assertEquals(overviewHullRowGraphRefs(cameraPhysics)[0], R3_SOLVER);
});

Deno.test("Verdict detail uses Pass and the exact requirement without parsing the evaluation label", () => {
  const verdicts = wrapId01().get(FEA_VERDICTS)!;
  const camera = verdicts.rows.find((row) => row.key === CAMERA_R3_KEY)!;
  const radial = verdicts.rows.find((row) => row.key === RADIAL_R2_KEY)!;
  assertEquals(camera.nodeKey, CAMERA_EVAL_R3);
  assertEquals(camera.label, "Camera bracket bench");
  assertEquals(
    camera.detail,
    `Pass · ${CAMERA_REQUIREMENT_NAME}`,
  );
  assertEquals(radial.detail, `Pass · ${RADIAL_REQUIREMENT_NAME}`);
  assertEquals(camera.detail?.includes("SysON"), false);
  assertEquals(camera.detail?.includes("camera-eval"), false);
  assertEquals(camera.viewerNodeKey, undefined);
  assertEquals(camera.sessionIds, []);
  assertEquals(overviewHullRowPresentation(camera).hasViewer, false);
  assertEquals(overviewHullRowGraphRefs(camera)[0], CAMERA_EVAL_R3);
});

Deno.test("sealed-case evidence closeout and raw slots stay inspectable records", () => {
  const extraSlots = [
    { id: "pub-input-step", kind: "step", label: "input.step" },
    { id: "pub-request", kind: "canonical-json", label: "request.json" },
  ];
  const members = [
    ...id01Members(),
    ...extraSlots.map((slot) =>
      recorded({
        id: slot.id,
        label: slot.label,
        artifactKind: slot.kind,
        refs: [CAMERA_R3_KEY],
      })
    ),
  ];
  const wrapped = withOverviewCurrentEngineeringCases(
    buildOverviewHullContents(members, []),
    members,
    { catalog: id01Catalog() },
  );
  const physics = wrapped.get(FEA_PHYSICS)!;
  const verdicts = wrapped.get(FEA_VERDICTS)!;
  assertEquals(physics.rows.map((row) => row.label), [
    "Camera bracket bench",
    "Radial arm bench",
  ]);
  assertEquals(verdicts.rows.map((row) => row.label), [
    "Camera bracket bench",
    "Radial arm bench",
  ]);
  const inspectable = [
    "artifact:pub-input-step",
    "artifact:pub-request",
    "artifact:fea-proof-camera-r3",
    "artifact:camera-closeout-r3",
    "artifact:pub-evaluation",
    "artifact:calculix-isolated-result-json-r1",
  ];
  for (const key of inspectable) {
    assertEquals(
      [...physics.rows, ...verdicts.rows].some((row) => row.key === key),
      false,
      key,
    );
    assertEquals(
      physics.records.some((row) => row.nodeKey === key) ||
        verdicts.records.some((row) => row.nodeKey === key),
      true,
      key,
    );
  }
});

Deno.test("unavailable malformed and ambiguous principals fail closed", () => {
  const members = id01Members();
  const contents = buildOverviewHullContents(members, []);
  const originalPhysics = contents.get(FEA_PHYSICS)!;
  const originalVerdicts = contents.get(FEA_VERDICTS)!;
  assertEquals(originalPhysics.mode, "records");
  const missing = withOverviewCurrentEngineeringCases(contents, members, {});
  assertEquals(missing.get(FEA_PHYSICS), originalPhysics);
  assertEquals(missing.get(FEA_VERDICTS), originalVerdicts);
  const unavailable = withOverviewCurrentEngineeringCases(contents, members, {
    catalog: unavailableEngineeringCaseCatalog(),
  });
  assertEquals(unavailable.get(FEA_PHYSICS), originalPhysics);
  const malformed = withOverviewCurrentEngineeringCases(contents, members, {
    catalog: {
      ...id01Catalog(),
      current: [{
        family: "mechanical-proof",
        id: CAMERA_ID,
        currentCaseKey: CAMERA_R3_KEY,
        revision: 1,
      }],
    },
  });
  assertEquals(malformed.get(FEA_PHYSICS), originalPhysics);
  const ambiguousMembers = [
    recorded({
      id: "calculix-isolated-result-json-r3a",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [CAMERA_R3_KEY],
    }),
    recorded({
      id: "calculix-isolated-result-json-r3b",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [CAMERA_R3_KEY],
    }),
    recorded({
      id: "calculix-isolated-result-json-r2",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [RADIAL_R2_KEY],
    }),
  ];
  const ambiguous = buildOverviewCurrentEngineeringCasesContent(
    hullFrom(ambiguousMembers),
    ambiguousMembers,
    id01Catalog(),
  )!;
  assertEquals(ambiguous.rows.map((row) => row.label), [
    "Radial arm bench",
  ]);
  assertEquals(
    ambiguous.rows.some((row) =>
      row.nodeKey === "artifact:calculix-isolated-result-json-r3a"
    ),
    false,
  );
  assertEquals(
    ambiguous.rows.some((row) =>
      row.nodeKey === "artifact:calculix-isolated-result-json-r3b"
    ),
    false,
  );
  assertEquals(ambiguous.rows[0]?.nodeKey, R2_SOLVER);
});

Deno.test("shared solver-result across current cases omits every conflicting Physics row", () => {
  const sharedSolverId = "calculix-isolated-result-json-shared";
  const sharedSolver = `artifact:${sharedSolverId}`;
  const members = [
    recorded({
      id: sharedSolverId,
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [CAMERA_R3_KEY, RADIAL_R2_KEY],
    }),
    recorded({
      kind: "evaluation",
      id: "camera-eval-r3",
      label: "SysON evaluated camera displacement",
      summary: "pass",
      selection: { kind: "requirement", id: CAMERA_REQUIREMENT_ID },
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "evaluation",
      id: "radial-eval-r2",
      label: "SysON evaluated radial displacement",
      summary: "pass",
      selection: { kind: "requirement", id: RADIAL_REQUIREMENT_ID },
      refs: [RADIAL_R2_KEY],
      lane: "verdicts",
    }),
    ...requirementNodes(),
  ];
  const wrapped = withOverviewCurrentEngineeringCases(
    buildOverviewHullContents(members, []),
    members,
    {
      catalog: id01Catalog(),
      sessions: [artifactSession("shared-app", sharedSolverId)],
    },
  );
  const physics = wrapped.get(FEA_PHYSICS)!;
  const verdicts = wrapped.get(FEA_VERDICTS)!;
  assertEquals(physics.rows, []);
  assertEquals(
    physics.rows.some((row) => row.key === CAMERA_R3_KEY),
    false,
  );
  assertEquals(
    physics.rows.some((row) => row.key === RADIAL_R2_KEY),
    false,
  );
  assertEquals(
    physics.rows.some((row) => row.nodeKey === sharedSolver),
    false,
  );
  assertEquals(
    physics.rows.some((row) => row.viewerNodeKey === sharedSolver),
    false,
  );
  assertEquals(
    physics.rows.some((row) => row.sessionIds.includes("shared-app")),
    false,
  );
  assertEquals(
    physics.records.some((row) => row.nodeKey === sharedSolver),
    true,
  );
  assertEquals(verdicts.rows.map((row) => row.label), [
    "Camera bracket bench",
    "Radial arm bench",
  ]);
  assertEquals(verdicts.rows.map((row) => row.nodeKey), [
    CAMERA_EVAL_R3,
    "evaluation:radial-eval-r2",
  ]);
});

Deno.test("shared evaluation across current cases omits every conflicting Verdicts row", () => {
  const sharedEvalId = "shared-eval";
  const sharedEval = `evaluation:${sharedEvalId}`;
  const members = [
    recorded({
      id: "calculix-isolated-result-json-r3",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [CAMERA_R3_KEY],
    }),
    recorded({
      id: "calculix-isolated-result-json-r2",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [RADIAL_R2_KEY],
    }),
    recorded({
      kind: "evaluation",
      id: sharedEvalId,
      label: "SysON evaluated shared displacement",
      summary: "pass",
      selection: { kind: "requirement", id: CAMERA_REQUIREMENT_ID },
      refs: [CAMERA_R3_KEY, RADIAL_R2_KEY],
      lane: "verdicts",
    }),
    ...requirementNodes(),
  ];
  const wrapped = withOverviewCurrentEngineeringCases(
    buildOverviewHullContents(members, []),
    members,
    { catalog: id01Catalog() },
  );
  const physics = wrapped.get(FEA_PHYSICS)!;
  const verdicts = wrapped.get(FEA_VERDICTS)!;
  assertEquals(verdicts.rows, []);
  assertEquals(
    verdicts.rows.some((row) => row.key === CAMERA_R3_KEY),
    false,
  );
  assertEquals(
    verdicts.rows.some((row) => row.key === RADIAL_R2_KEY),
    false,
  );
  assertEquals(
    verdicts.rows.some((row) => row.nodeKey === sharedEval),
    false,
  );
  assertEquals(
    verdicts.records.some((row) => row.nodeKey === sharedEval),
    true,
  );
  assertEquals(physics.rows.map((row) => row.label), [
    "Camera bracket bench",
    "Radial arm bench",
  ]);
  assertEquals(physics.rows.map((row) => row.nodeKey), [
    R3_SOLVER,
    R2_SOLVER,
  ]);
});

Deno.test("verdict summary keeps unresolved and error honest", () => {
  const members = [
    recorded({
      kind: "evaluation",
      id: "camera-eval-unresolved",
      label: "SysON evaluated camera displacement",
      summary: "unresolved",
      selection: { kind: "requirement", id: CAMERA_REQUIREMENT_ID },
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "evaluation",
      id: "radial-eval-error",
      label: "SysON evaluated radial displacement",
      summary: "error",
      selection: { kind: "requirement", id: RADIAL_REQUIREMENT_ID },
      refs: [RADIAL_R2_KEY],
      lane: "verdicts",
    }),
    ...requirementNodes(),
  ];
  const wrapped = withOverviewCurrentEngineeringCases(
    buildOverviewHullContents(members, []),
    members,
    { catalog: id01Catalog() },
  ).get(FEA_VERDICTS)!;
  const camera = wrapped.rows.find((row) => row.key === CAMERA_R3_KEY)!;
  const radial = wrapped.rows.find((row) => row.key === RADIAL_R2_KEY)!;
  assertEquals(
    camera.detail,
    `unresolved · ${CAMERA_REQUIREMENT_NAME}`,
  );
  assertEquals(radial.detail, `error · ${RADIAL_REQUIREMENT_NAME}`);
});

Deno.test("closeout evidence and observation are never the Verdict principal", () => {
  const members = [
    recorded({
      id: "camera-closeout-r3",
      label: "Closeout",
      artifactKind: "document",
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      id: "pub-evaluation",
      label: "evaluation evidence",
      artifactKind: "evidence",
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "observation",
      id: "camera-obs-r3",
      label: "Observed displacement",
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "evaluation",
      id: "radial-eval-r2",
      label: "SysON evaluated radial displacement",
      summary: "pass",
      selection: { kind: "requirement", id: RADIAL_REQUIREMENT_ID },
      refs: [RADIAL_R2_KEY],
      lane: "verdicts",
    }),
    ...requirementNodes(),
  ];
  const wrapped = withOverviewCurrentEngineeringCases(
    buildOverviewHullContents(members, []),
    members,
    { catalog: id01Catalog() },
  ).get(FEA_VERDICTS)!;
  assertEquals(wrapped.rows.map((row) => row.label), ["Radial arm bench"]);
  assertEquals(
    wrapped.rows.some((row) => row.key === CAMERA_R3_KEY),
    false,
  );
  assertEquals(wrapped.rows[0]?.nodeKey, "evaluation:radial-eval-r2");
});

Deno.test("assembly-integrity records stay outside FEA current-case wrapping", () => {
  const fea = recorded({
    id: "calculix-isolated-result-json-r3",
    label: "Local CalculiX result.json",
    artifactKind: "solver-result",
    refs: [CAMERA_R3_KEY],
  });
  const assembly: OverviewRecordedHeroNode = {
    ...recorded({
      id: "assembly-integrity-obs",
      label: "Assembly integrity observation",
    }),
    groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity,
    lane: "physics",
  };
  const contents = buildOverviewHullContents([fea, assembly], []);
  const wrapped = withOverviewCurrentEngineeringCases(
    contents,
    [fea, assembly],
    { catalog: cameraOnlyCatalog() },
  );
  const assemblyKey = groupId(
    "physics",
    OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity,
  );
  assertEquals(wrapped.get(assemblyKey), contents.get(assemblyKey));
  assertEquals(
    wrapped.get(FEA_PHYSICS)?.rows.some((row) => row.key === assembly.key),
    false,
  );
});

Deno.test("current-engineering-cases adapter source has no series logic or supersedes relation", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "./src/project/overview/hulls/adapters/from-current-engineering-cases.ts",
      import.meta.url,
    ),
  );
  assertEquals(source.includes("supersedes"), false);
  assertEquals(/\bseries\b/i.test(source), false);
  assertEquals(source.includes("EngineeringCaseSeries"), false);
  assertEquals(source.includes("projectEngineeringCaseSeries"), false);
  assertEquals(source.includes("current-by-revision"), false);
  assertEquals(source.includes("caseLifecycle"), false);
  try {
    await Deno.stat(
      new URL(
        "./src/project/overview/hulls/adapters/from-engineering-case-series.ts",
        import.meta.url,
      ),
    );
    throw new Error("from-engineering-case-series.ts must be absent");
  } catch (error) {
    assertEquals(error instanceof Deno.errors.NotFound, true);
  }
});

function wrapId01(input: { sessions?: readonly ThreadViewerSession[] } = {}) {
  const members = id01Members();
  return withOverviewCurrentEngineeringCases(
    buildOverviewHullContents(members, []),
    members,
    { catalog: id01Catalog(), ...input },
  );
}

function id01Members(): OverviewRecordedHeroNode[] {
  return [
    recorded({
      id: "calculix-isolated-result-json-r1",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [CAMERA_R1_KEY],
    }),
    recorded({
      id: "calculix-isolated-result-json-r3",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [CAMERA_R3_KEY],
    }),
    recorded({
      id: "calculix-isolated-result-json-r2",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
      refs: [RADIAL_R2_KEY],
    }),
    recorded({
      id: "fea-proof-camera-r1",
      label: "Sealed camera proof r1",
      refs: [CAMERA_R1_KEY],
    }),
    recorded({
      id: "fea-proof-camera-r3",
      label: "Sealed camera proof",
      refs: [CAMERA_R3_KEY],
    }),
    recorded({
      id: "fea-proof-radial-r2",
      label: "Sealed radial proof",
      refs: [RADIAL_R2_KEY],
    }),
    recorded({
      id: "shared-mesh",
      label: "Shared mesh input",
      refs: [CAMERA_R3_KEY, RADIAL_R2_KEY],
    }),
    recorded({
      kind: "evaluation",
      id: "camera-eval-r1",
      label: "SysON evaluated camera displacement r1",
      summary: "pass",
      selection: { kind: "requirement", id: CAMERA_REQUIREMENT_ID },
      refs: [CAMERA_R1_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "evaluation",
      id: "camera-eval-r3",
      label: "SysON evaluated camera displacement",
      summary: "pass",
      selection: { kind: "requirement", id: CAMERA_REQUIREMENT_ID },
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "evaluation",
      id: "radial-eval-r2",
      label: "SysON evaluated radial displacement",
      summary: "pass",
      selection: { kind: "requirement", id: RADIAL_REQUIREMENT_ID },
      refs: [RADIAL_R2_KEY],
      lane: "verdicts",
    }),
    recorded({
      id: "camera-closeout-r3",
      label: "Closeout",
      artifactKind: "document",
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      id: "pub-evaluation",
      label: "evaluation evidence",
      artifactKind: "evidence",
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "observation",
      id: "camera-obs-r3",
      label: "Observed displacement",
      refs: [CAMERA_R3_KEY],
      lane: "verdicts",
    }),
    ...requirementNodes(),
  ];
}

function requirementNodes(): OverviewRecordedHeroNode[] {
  return [
    recorded({
      kind: "requirement",
      id: CAMERA_REQUIREMENT_ID,
      label: CAMERA_REQUIREMENT_NAME,
      lane: "system-model",
      groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
    }),
    recorded({
      kind: "requirement",
      id: RADIAL_REQUIREMENT_ID,
      label: RADIAL_REQUIREMENT_NAME,
      lane: "system-model",
      groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
    }),
  ];
}

function hullFrom(members: readonly OverviewRecordedHeroNode[]) {
  return buildOverviewHullContents(members, []).get(FEA_PHYSICS)!;
}

function id01Catalog(): EngineeringCaseCatalog {
  return catalogFrom([
    mechanicalCase(
      CAMERA_R1_KEY,
      CAMERA_ID,
      1,
      CAMERA_R1_DIGEST,
      ["fea-proof-camera-r1"],
    ),
    mechanicalCase(
      CAMERA_R3_KEY,
      CAMERA_ID,
      3,
      CAMERA_R3_DIGEST,
      ["fea-proof-camera-r3"],
    ),
    mechanicalCase(
      RADIAL_R2_KEY,
      RADIAL_ID,
      2,
      RADIAL_R2_DIGEST,
      ["fea-proof-radial-r2"],
    ),
  ]);
}

function cameraOnlyCatalog(): EngineeringCaseCatalog {
  return catalogFrom([
    mechanicalCase(
      CAMERA_R3_KEY,
      CAMERA_ID,
      3,
      CAMERA_R3_DIGEST,
      ["fea-proof-camera-r3"],
    ),
  ]);
}

function catalogFrom(cases: EngineeringCase[]): EngineeringCaseCatalog {
  const projected = projectCurrentEngineeringCases(cases);
  return {
    schemaVersion: "engineering-cases/1.1",
    status: "observed",
    coverage: observedCoverage(),
    cases,
    current: projected.current,
    issues: projected.issues,
  };
}

function observedCoverage() {
  return ENGINEERING_CASE_FAMILIES.map((family) => ({
    family,
    status: "observed" as const,
  }));
}

function mechanicalCase(
  key: string,
  id: string,
  revision: number,
  caseDigest: string,
  authorityArtifactIds: string[],
): EngineeringCase {
  return {
    key,
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
    id,
    revision,
    scope: `${id} r${revision}`,
    caseDigest,
    authorityArtifactIds,
  };
}

function recorded(spec: {
  readonly kind?: "artifact" | "evaluation" | "requirement" | "observation";
  readonly id: string;
  readonly label: string;
  readonly refs?: readonly string[];
  readonly lane?: OverviewRecordedHeroNode["lane"];
  readonly groupKey?: string;
  readonly artifactKind?: string;
  readonly summary?: string;
  readonly selection?: NonNullable<
    OverviewRecordedHeroNode["node"]["selection"]
  >;
}): OverviewRecordedHeroNode {
  const entityKind = spec.kind ?? "artifact";
  const key = `${entityKind}:${spec.id}`;
  return {
    key,
    lane: spec.lane ?? "physics",
    groupKey: spec.groupKey ?? OVERVIEW_DOMAIN_GROUP_KEYS.fea,
    label: spec.label,
    kind: "recorded",
    color: "black",
    emphasis: false,
    node: {
      id: key,
      ref: { kind: entityKind, id: spec.id },
      entityKind,
      ...(spec.artifactKind ? { artifactKind: spec.artifactKind } : {}),
      label: spec.label,
      freshness: "fresh",
      system: "digital-thread",
      summary: spec.summary ?? spec.label,
      recordedAt: "2026-09-07T00:00:00Z",
      ...(spec.refs ? { engineeringCaseRefs: [...spec.refs] } : {}),
      ...(spec.selection ? { selection: spec.selection } : {}),
    },
  };
}

function artifactSession(id: string, record: string): ThreadViewerSession {
  return {
    id,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: record },
    app: { id: "io.casys.mcp-calculix", version: "1.0.0" },
    manifest: {
      uri: "ui://mcp-calculix/manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-calculix/result-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 1,
    },
    launchUri: "/api/viewer/app",
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.mcp-calculix.recorded-result-session/1.0",
      payload: {},
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}
