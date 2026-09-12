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
  OVERVIEW_CURRENT_DFM_CASES_ADAPTER_ID,
  OVERVIEW_HULL_ADAPTERS,
  withOverviewCurrentDfmCases,
} from "./src/project/overview/hulls/adapters/index.ts";
import { overviewHullRowGraphRefs } from "./src/project/overview/hulls/types.ts";
import { overviewHullRowPresentation } from "./src/project/overview/hulls/row.ts";
import { overviewThreadD3FlowGroupIdentity as groupId } from "./src/project/overview-thread-d3-flow-layout.ts";
import { overviewDfmCaptureViewerAliases } from "./src/project/overview-thread-dfm-viewer-discovery.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";
import type { ThreadArtifact, ThreadGraphEdge } from "./src/thread/types.ts";

const CAMERA_ID = "id01-camera-board-dfm";
const RADIAL_ID = "id01-radial-arm-dfm";
const CAMERA_DIGEST = "a".repeat(64);
const RADIAL_DIGEST = "b".repeat(64);
const CAMERA_KEY = verificationCaseKey("dfm-check", CAMERA_DIGEST);
const RADIAL_KEY = verificationCaseKey("dfm-check", RADIAL_DIGEST);
const CAMERA_CASE = "dfm-case-camera-board";
const CAMERA_CAPTURE = "dfm-check-camera-board";
const CAMERA_CAPTURE_B = "dfm-check-camera-board-b";
const RADIAL_CASE = "dfm-case-radial-arm";
const REQ_ENVELOPE = "dfm-req-envelope";
const REQ_THICKNESS = "dfm-req-thickness";
const REQ_OVERHANGS = "dfm-req-overhangs";
const EVAL_ENVELOPE = "dfm-eval-envelope";
const EVAL_THICKNESS = "dfm-eval-thickness";
const EVAL_OVERHANGS = "dfm-eval-overhangs";
const OBSERVATIONS = [
  "dfm-obs-min-thickness",
  "dfm-obs-envelope-x",
  "dfm-obs-envelope-count",
  "dfm-obs-overhang-remaining",
  "dfm-obs-zmin-filtered",
] as const;
const DFM_PHYSICS = groupId("physics", OVERVIEW_DOMAIN_GROUP_KEYS.dfm);
const DFM_VERDICTS = groupId("verdicts", OVERVIEW_DOMAIN_GROUP_KEYS.dfm);
const FEA_PHYSICS = groupId("physics", OVERVIEW_DOMAIN_GROUP_KEYS.fea);

Deno.test("current-dfm-cases remains a registered producer of the same hull content", () => {
  assertEquals(
    OVERVIEW_HULL_ADAPTERS.map((adapter) => adapter.id),
    ["current-brief", "current-engineering-cases", "current-dfm-cases"],
  );
  assertEquals(
    OVERVIEW_HULL_ADAPTERS.some((adapter) =>
      adapter.id === OVERVIEW_CURRENT_DFM_CASES_ADAPTER_ID
    ),
    true,
  );
});

Deno.test("current DFM case folds one physics capture row and three verdict rows", () => {
  const wrapped = wrapId01();
  const physics = wrapped.get(DFM_PHYSICS)!;
  const verdicts = wrapped.get(DFM_VERDICTS)!;
  assertEquals(physics.rows.map((row) => row.key), [CAMERA_KEY]);
  assertEquals(physics.rows[0]?.nodeKey, `artifact:${CAMERA_CAPTURE}`);
  assertEquals(physics.rows[0]?.viewerNodeKey, `artifact:${CAMERA_CAPTURE}`);
  assertEquals(physics.rows[0]?.sessionIds, ["dfm-app"]);
  assertEquals(overviewHullRowGraphRefs(physics.rows[0]!), [
    `artifact:${CAMERA_CAPTURE}`,
    `artifact:${CAMERA_CASE}`,
    "observation:dfm-obs-envelope-count",
    "observation:dfm-obs-envelope-x",
    "observation:dfm-obs-min-thickness",
    "observation:dfm-obs-overhang-remaining",
    "observation:dfm-obs-zmin-filtered",
  ]);
  assertEquals(
    verdicts.rows.map((row) => row.key),
    [
      `evaluation:${EVAL_ENVELOPE}`,
      `evaluation:${EVAL_OVERHANGS}`,
      `evaluation:${EVAL_THICKNESS}`,
    ],
  );
  assertEquals(verdicts.rows.map((row) => row.detail), [
    "Pass",
    "Fail",
    "Pass",
  ]);
  assertEquals(verdicts.rows.map((row) => row.sessionIds), [
    ["dfm-app"],
    ["dfm-app"],
    ["dfm-app"],
  ]);
  assertEquals(
    verdicts.rows.map((row) => row.viewerNodeKey),
    [
      `artifact:${CAMERA_CAPTURE}`,
      `artifact:${CAMERA_CAPTURE}`,
      `artifact:${CAMERA_CAPTURE}`,
    ],
  );
  assertEquals(physics.counts, undefined);
  assertEquals("history" in physics, false);
  assertEquals(
    physics.records.some((row) => row.nodeKey === `artifact:${CAMERA_CAPTURE}`),
    true,
  );
});

Deno.test("a sealed DFM case without capture stays a case-only physics row", () => {
  const members = [
    recorded({
      id: CAMERA_CASE,
      label: "Sealed DFM case",
      artifactKind: "document",
      refs: [CAMERA_KEY],
    }),
    ...requirementNodes(),
  ];
  const wrapped = withOverviewCurrentDfmCases(
    buildOverviewHullContents(members, []),
    members,
    { catalog: cameraCatalog() },
  );
  const physics = wrapped.get(DFM_PHYSICS)!;
  assertEquals(physics.rows.map((row) => row.key), [CAMERA_KEY]);
  assertEquals(physics.rows[0]?.nodeKey, `artifact:${CAMERA_CASE}`);
  assertEquals(physics.rows[0]?.sessionIds, []);
  assertEquals(physics.rows[0]?.viewerNodeKey, undefined);
  assertEquals(overviewHullRowPresentation(physics.rows[0]!).hasViewer, false);
});

Deno.test("missing unavailable and invalid current DFM catalogs keep original records", () => {
  const members = id01Members();
  const contents = buildOverviewHullContents(members, []);
  const originalPhysics = contents.get(DFM_PHYSICS)!;
  const originalVerdicts = contents.get(DFM_VERDICTS)!;
  assertEquals(
    withOverviewCurrentDfmCases(contents, members, {}).get(DFM_PHYSICS),
    originalPhysics,
  );
  assertEquals(
    withOverviewCurrentDfmCases(contents, members, {
      catalog: unavailableEngineeringCaseCatalog(),
    }).get(DFM_PHYSICS),
    originalPhysics,
  );
  assertEquals(
    withOverviewCurrentDfmCases(contents, members, {
      catalog: {
        ...cameraCatalog(),
        current: [{
          family: "dfm-check",
          id: CAMERA_ID,
          currentCaseKey: CAMERA_KEY,
          revision: 9,
        }],
      },
    }).get(DFM_PHYSICS),
    originalPhysics,
  );
  assertEquals(
    withOverviewCurrentDfmCases(contents, members, {
      catalog: cameraCatalog(),
    }).get(DFM_VERDICTS)?.records,
    originalVerdicts.records,
  );
});

Deno.test("multiple DFM captures stay separately addressable and never pick latest", () => {
  const members = [
    recorded({
      id: CAMERA_CASE,
      label: "Sealed DFM case",
      artifactKind: "document",
      refs: [CAMERA_KEY],
    }),
    recorded({
      id: CAMERA_CAPTURE,
      label: "Measured DFM checks",
      artifactKind: "evidence",
      refs: [CAMERA_KEY],
    }),
    recorded({
      id: CAMERA_CAPTURE_B,
      label: "Measured DFM checks",
      artifactKind: "evidence",
      refs: [CAMERA_KEY],
    }),
  ];
  const wrapped = withOverviewCurrentDfmCases(
    buildOverviewHullContents(members, []),
    members,
    {
      catalog: cameraCatalog(),
      sessions: [
        artifactSession("dfm-app-a", CAMERA_CAPTURE),
        artifactSession("dfm-app-b", CAMERA_CAPTURE_B),
      ],
    },
  ).get(DFM_PHYSICS)!;
  assertEquals(wrapped.rows.map((row) => row.nodeKey), [
    `artifact:${CAMERA_CAPTURE}`,
    `artifact:${CAMERA_CAPTURE_B}`,
  ]);
  assertEquals(wrapped.rows.map((row) => row.key), [
    `artifact:${CAMERA_CAPTURE}`,
    `artifact:${CAMERA_CAPTURE_B}`,
  ]);
  assertEquals(wrapped.rows[0]?.sessionIds, ["dfm-app-a"]);
  assertEquals(wrapped.rows[1]?.sessionIds, ["dfm-app-b"]);
  assertEquals(wrapped.rows.some((row) => row.key === CAMERA_KEY), false);
});

Deno.test("two DFM cases with identical labels stay separately keyed", () => {
  const members = [
    recorded({
      id: CAMERA_CASE,
      label: "Identical copy",
      artifactKind: "document",
      refs: [CAMERA_KEY],
    }),
    recorded({
      id: CAMERA_CAPTURE,
      label: "Identical copy",
      artifactKind: "evidence",
      refs: [CAMERA_KEY],
    }),
    recorded({
      id: RADIAL_CASE,
      label: "Identical copy",
      artifactKind: "document",
      refs: [RADIAL_KEY],
    }),
    recorded({
      id: "dfm-check-radial-arm",
      label: "Identical copy",
      artifactKind: "evidence",
      refs: [RADIAL_KEY],
    }),
  ];
  const catalog = catalogFrom([
    dfmCase(CAMERA_KEY, CAMERA_ID, 1, CAMERA_DIGEST, [CAMERA_CASE]),
    dfmCase(RADIAL_KEY, "xx99-camera-board-dfm", 1, RADIAL_DIGEST, [
      RADIAL_CASE,
    ]),
  ]);
  const physics = withOverviewCurrentDfmCases(
    buildOverviewHullContents(members, []),
    members,
    { catalog },
  ).get(DFM_PHYSICS)!;
  assertEquals(physics.rows.map((row) => row.key), [CAMERA_KEY, RADIAL_KEY]);
  assertEquals(physics.rows.map((row) => row.label), [
    "Camera board dfm",
    "Camera board dfm",
  ]);
  assertEquals(physics.rows.map((row) => row.nodeKey), [
    `artifact:${CAMERA_CAPTURE}`,
    "artifact:dfm-check-radial-arm",
  ]);
});

Deno.test("unrelated FEA records stay outside the DFM current-case wrap", () => {
  const dfm = recorded({
    id: CAMERA_CAPTURE,
    label: "Measured DFM checks",
    artifactKind: "evidence",
    refs: [CAMERA_KEY],
  });
  const fea: OverviewRecordedHeroNode = {
    ...recorded({
      id: "calculix-isolated-result-json-r3",
      label: "Local CalculiX result.json",
      artifactKind: "solver-result",
    }),
    groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.fea,
    lane: "physics",
  };
  const contents = buildOverviewHullContents([dfm, fea], []);
  const wrapped = withOverviewCurrentDfmCases(contents, [dfm, fea], {
    catalog: cameraCatalog(),
  });
  assertEquals(wrapped.get(FEA_PHYSICS), contents.get(FEA_PHYSICS));
  assertEquals(
    wrapped.get(DFM_PHYSICS)?.rows.some((row) => row.nodeKey === fea.key),
    false,
  );
});

Deno.test("a missing installed DFM viewer leaves the capture row inspectable", () => {
  const physics = wrapId01({ sessions: [] }).get(DFM_PHYSICS)!;
  assertEquals(physics.rows[0]?.sessionIds, []);
  assertEquals(physics.rows[0]?.viewerNodeKey, undefined);
  assertEquals(
    physics.records.some((row) => row.nodeKey === `artifact:${CAMERA_CAPTURE}`),
    true,
  );
});

Deno.test("an unavailable DFM MRTR session stays bound without unlocking a payload", () => {
  const session = {
    ...artifactSession("dfm-unavailable", CAMERA_CAPTURE),
    session: {
      ...artifactSession("dfm-unavailable", CAMERA_CAPTURE).session,
      payload: {
        projection: {
          status: "unavailable",
          reason:
            "The signed DFM-check approval basis differs from this run basis.",
        },
      },
    },
  };
  const physics = wrapId01({ sessions: [session] }).get(DFM_PHYSICS)!;
  assertEquals(physics.rows[0]?.sessionIds, ["dfm-unavailable"]);
  assertEquals(session.session.payload.projection, {
    status: "unavailable",
    reason: "The signed DFM-check approval basis differs from this run basis.",
  });
});

function wrapId01(
  input: { sessions?: readonly ThreadViewerSession[] } = {},
) {
  const members = id01Members();
  const sessions = input.sessions ?? [
    artifactSession("dfm-app", CAMERA_CAPTURE),
  ];
  const aliases = overviewDfmCaptureViewerAliases({
    records: members.map((item) => ({
      key: item.key,
      ref: item.node.ref,
      entityKind: item.node.entityKind,
      artifactKind: item.node.artifactKind,
      engineeringCaseRefs: item.node.engineeringCaseRefs,
    })),
    artifacts: id01Artifacts(),
    edges: id01Edges(),
    sessions,
    catalog: cameraCatalog(),
  });
  return withOverviewCurrentDfmCases(
    buildOverviewHullContents(members, sessions, undefined, {}, aliases),
    members,
    { catalog: cameraCatalog(), sessions, viewerAliases: aliases },
  );
}

function id01Members(): OverviewRecordedHeroNode[] {
  return [
    recorded({
      id: CAMERA_CASE,
      label: "Sealed DFM case",
      artifactKind: "document",
      refs: [CAMERA_KEY],
    }),
    recorded({
      id: CAMERA_CAPTURE,
      label: "Measured DFM checks",
      artifactKind: "evidence",
      refs: [CAMERA_KEY],
    }),
    ...OBSERVATIONS.map((id) =>
      recorded({
        kind: "observation",
        id,
        label: `Observation ${id}`,
        refs: [CAMERA_KEY],
      })
    ),
    recorded({
      kind: "evaluation",
      id: EVAL_ENVELOPE,
      label: "Envelope evaluation",
      summary: "pass",
      selection: { kind: "requirement", id: REQ_ENVELOPE },
      refs: [CAMERA_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "evaluation",
      id: EVAL_THICKNESS,
      label: "Thickness evaluation",
      summary: "pass",
      selection: { kind: "requirement", id: REQ_THICKNESS },
      refs: [CAMERA_KEY],
      lane: "verdicts",
    }),
    recorded({
      kind: "evaluation",
      id: EVAL_OVERHANGS,
      label: "Overhang evaluation",
      summary: "fail",
      selection: { kind: "requirement", id: REQ_OVERHANGS },
      refs: [CAMERA_KEY],
      lane: "verdicts",
    }),
    ...requirementNodes(),
  ];
}

function requirementNodes(): OverviewRecordedHeroNode[] {
  return [
    recorded({
      kind: "requirement",
      id: REQ_ENVELOPE,
      label: "Envelope must fit the declared build volume",
      refs: [CAMERA_KEY],
      lane: "system-model",
    }),
    recorded({
      kind: "requirement",
      id: REQ_THICKNESS,
      label: "Minimum thickness must meet the sealed limit",
      refs: [CAMERA_KEY],
      lane: "system-model",
    }),
    recorded({
      kind: "requirement",
      id: REQ_OVERHANGS,
      label: "No overhang zones remain after the declared Z-min filter",
      refs: [CAMERA_KEY],
      lane: "system-model",
    }),
  ];
}

function id01Artifacts(): ThreadArtifact[] {
  return [
    {
      id: CAMERA_CASE,
      label: "Sealed DFM case",
      kind: "document",
      system: "digital-thread",
      revision: "1",
      freshness: "fresh",
      producedBy: "industrialize.seal-dfm-case@1",
      producer: {
        serverId: "digital-thread",
        tool: "industrialize.seal-dfm-case@1",
        runId: "run:dfm-seal",
      },
      dependsOn: [],
    },
    {
      id: CAMERA_CAPTURE,
      label: "Measured DFM checks",
      kind: "evidence",
      system: "digital-thread",
      revision: CAMERA_DIGEST,
      freshness: "fresh",
      producedBy: "industrialize.run-dfm-checks@1",
      producer: {
        serverId: "digital-thread",
        tool: "industrialize.run-dfm-checks@1",
        runId: "run:dfm-checks",
      },
      dependsOn: [CAMERA_CASE],
    },
  ];
}

function id01Edges(): ThreadGraphEdge[] {
  return [
    {
      id: `derived:${CAMERA_CASE}:${CAMERA_CAPTURE}`,
      from: { kind: "artifact", id: CAMERA_CASE },
      to: { kind: "artifact", id: CAMERA_CAPTURE },
      relation: "derived_from",
      rationale: "case to capture",
      origin: "provenance",
    },
    {
      id: `input:${CAMERA_CASE}:${CAMERA_CAPTURE}`,
      from: { kind: "artifact", id: CAMERA_CASE },
      to: { kind: "artifact", id: CAMERA_CAPTURE },
      relation: "input_to",
      rationale: "case input",
      origin: "structure",
    },
    ...OBSERVATIONS.map((id) => ({
      id: `source:${CAMERA_CAPTURE}:${id}`,
      from: { kind: "artifact" as const, id: CAMERA_CAPTURE },
      to: { kind: "observation" as const, id },
      relation: "source_of" as const,
      rationale: "source",
      origin: "structure" as const,
    })),
    ...[EVAL_ENVELOPE, EVAL_THICKNESS, EVAL_OVERHANGS].map((id) => ({
      id: `evidences:${CAMERA_CAPTURE}:${id}`,
      from: { kind: "artifact" as const, id: CAMERA_CAPTURE },
      to: { kind: "evaluation" as const, id },
      relation: "evidences" as const,
      rationale: "evidence",
      origin: "provenance" as const,
    })),
    ...[
      [REQ_ENVELOPE, EVAL_ENVELOPE],
      [REQ_THICKNESS, EVAL_THICKNESS],
      [REQ_OVERHANGS, EVAL_OVERHANGS],
    ].map(([requirementId, evaluationId]) => ({
      id: `evaluates:${requirementId}:${evaluationId}`,
      from: { kind: "requirement" as const, id: requirementId! },
      to: { kind: "evaluation" as const, id: evaluationId! },
      relation: "evaluates" as const,
      rationale: "evaluates",
      origin: "provenance" as const,
    })),
  ];
}

function cameraCatalog(): EngineeringCaseCatalog {
  return catalogFrom([
    dfmCase(CAMERA_KEY, CAMERA_ID, 1, CAMERA_DIGEST, [CAMERA_CASE]),
  ]);
}

function catalogFrom(cases: EngineeringCase[]): EngineeringCaseCatalog {
  const projected = projectCurrentEngineeringCases(cases);
  return {
    schemaVersion: "engineering-cases/1.1",
    status: "observed",
    coverage: ENGINEERING_CASE_FAMILIES.map((family) => ({
      family,
      status: "observed" as const,
    })),
    cases,
    current: projected.current,
    issues: projected.issues,
  };
}

function dfmCase(
  key: string,
  id: string,
  revision: number,
  caseDigest: string,
  authorityArtifactIds: string[],
): EngineeringCase {
  return {
    key,
    family: "dfm-check",
    caseSchemaVersion: "dfm-check-case/1.0",
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
    groupKey: spec.groupKey ?? OVERVIEW_DOMAIN_GROUP_KEYS.dfm,
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
    app: { id: "io.casys.mcp-dfm.results", version: "1.0.0" },
    manifest: {
      uri: "ui://mcp-dfm/manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-dfm/results-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 1,
    },
    launchUri: "/api/viewer/app",
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.mcp-dfm.recorded-checks-session/1.0",
      payload: {},
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}
