import { assertEquals } from "@std/assert";
import {
  mergeOverviewViewerAliases,
  overviewDfmCaptureViewerAliases,
  type OverviewDfmViewerAliasRecord,
} from "./src/project/overview-thread-dfm-viewer-discovery.ts";
import { overviewRequirementSourceViewerAliases } from "./src/project/overview-thread-viewer-discovery.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "./src/project/overview/hulls/domain-groups.ts";
import { verificationCaseKey } from "../presentation/workbench/thread/evidence.ts";
import type { ThreadArtifact } from "./src/thread/types.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";
import type { OverviewViewerAliasEdge } from "./src/project/overview-thread-viewer-discovery.ts";

const DIGEST = "a".repeat(64);
const CASE_KEY = verificationCaseKey("dfm-check", DIGEST);
const CAPTURE_ID = "dfm-check-camera-board";
const CASE_ID = "dfm-case-camera-board";
const STEP_ID = "geometry-step-camera-board";
const OBS_ID = "dfm-obs-min-thickness";
const EVAL_ID = "dfm-eval-thickness";
const REQ_ID = "dfm-req-thickness";

function record(
  kind: OverviewDfmViewerAliasRecord["ref"]["kind"],
  id: string,
  extras: Partial<OverviewDfmViewerAliasRecord> = {},
): OverviewDfmViewerAliasRecord {
  return {
    key: `${kind}:${id}`,
    ref: { kind, id },
    entityKind: extras.entityKind ?? kind,
    artifactKind: extras.artifactKind,
    engineeringCaseRefs: extras.engineeringCaseRefs ?? [CASE_KEY],
  };
}

function session(id = "dfm-app", artifactId = CAPTURE_ID): ThreadViewerSession {
  return {
    id,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: artifactId },
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

function artifact(
  id: string,
  operation: string,
  kind = "evidence",
): ThreadArtifact {
  return {
    id,
    label: id,
    kind,
    system: "digital-thread",
    revision: "1",
    freshness: "fresh",
    producedBy: operation,
    producer: {
      serverId: "digital-thread",
      tool: operation,
      runId: `run:${id}`,
    },
    dependsOn: [],
  };
}

const CAPTURE = record("artifact", CAPTURE_ID, { artifactKind: "evidence" });
const CASE = record("artifact", CASE_ID, { artifactKind: "document" });
const STEP = record("artifact", STEP_ID, { artifactKind: "step" });
const OBS = record("observation", OBS_ID);
const EVALUATION = record("evaluation", EVAL_ID, { entityKind: "evaluation" });
const REQUIREMENT = record("requirement", REQ_ID);
const ARTIFACTS = [
  artifact(CAPTURE_ID, "industrialize.run-dfm-checks@1"),
  artifact(CASE_ID, "industrialize.seal-dfm-case@1", "document"),
  artifact(STEP_ID, "design.write-geometry@1", "step"),
];
const EDGES: OverviewViewerAliasEdge[] = [
  {
    from: { kind: "artifact", id: CASE_ID },
    to: { kind: "artifact", id: CAPTURE_ID },
    relation: "input_to",
  },
  {
    from: { kind: "artifact", id: CASE_ID },
    to: { kind: "artifact", id: CAPTURE_ID },
    relation: "derived_from",
  },
  {
    from: { kind: "artifact", id: STEP_ID },
    to: { kind: "artifact", id: CAPTURE_ID },
    relation: "input_to",
  },
  {
    from: { kind: "artifact", id: CAPTURE_ID },
    to: { kind: "observation", id: OBS_ID },
    relation: "source_of",
  },
  {
    from: { kind: "artifact", id: CAPTURE_ID },
    to: { kind: "evaluation", id: EVAL_ID },
    relation: "evidences",
  },
  {
    from: { kind: "requirement", id: REQ_ID },
    to: { kind: "evaluation", id: EVAL_ID },
    relation: "evaluates",
  },
];
const TARGET = [{ sessionId: "dfm-app", nodeKey: CAPTURE.key }];

Deno.test("exact DFM observation evaluation requirement and case alias the capture session", () => {
  const aliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, CASE, STEP, OBS, EVALUATION, REQUIREMENT],
    artifacts: ARTIFACTS,
    edges: EDGES,
    sessions: [session()],
  });
  assertEquals(aliases.get(OBS.key), TARGET);
  assertEquals(aliases.get(EVALUATION.key), TARGET);
  assertEquals(aliases.get(REQUIREMENT.key), TARGET);
  assertEquals(aliases.get(CASE.key), TARGET);
  assertEquals(aliases.has(CAPTURE.key), false);
  assertEquals(aliases.has(STEP.key), false);
});

Deno.test("a dangling DFM source_of edge yields no observation alias", () => {
  const aliases = overviewDfmCaptureViewerAliases({
    records: [OBS],
    artifacts: ARTIFACTS,
    edges: EDGES,
    sessions: [session()],
  });
  assertEquals(aliases.size, 0);
});

Deno.test("mixed source_of edges to two DFM captures refuse the observation alias", () => {
  const other = record("artifact", "dfm-check-other", {
    artifactKind: "evidence",
  });
  const aliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, other, OBS],
    artifacts: [
      ...ARTIFACTS,
      artifact("dfm-check-other", "industrialize.run-dfm-checks@1"),
    ],
    edges: [
      ...EDGES,
      {
        from: { kind: "artifact", id: "dfm-check-other" },
        to: { kind: "observation", id: OBS_ID },
        relation: "source_of",
      },
    ],
    sessions: [session(), session("other-app", "dfm-check-other")],
  });
  assertEquals(aliases.has(OBS.key), false);
});

Deno.test("conflicting DFM case refs refuse the alias", () => {
  const otherKey = verificationCaseKey("dfm-check", "b".repeat(64));
  const conflicted = record("observation", OBS_ID, {
    engineeringCaseRefs: [CASE_KEY, otherKey],
  });
  const aliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, conflicted],
    artifacts: ARTIFACTS,
    edges: EDGES,
    sessions: [session()],
  });
  assertEquals(aliases.has(conflicted.key), false);
});

Deno.test("mechanical-proof case refs never authorize a DFM alias", () => {
  const feaKey = verificationCaseKey("mechanical-proof", DIGEST);
  const mixed = record("observation", OBS_ID, {
    engineeringCaseRefs: [feaKey],
  });
  const aliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, mixed],
    artifacts: ARTIFACTS,
    edges: EDGES,
    sessions: [session()],
  });
  assertEquals(aliases.has(mixed.key), false);
});

Deno.test("missing registered DFM session yields no alias", () => {
  const aliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, OBS, EVALUATION, REQUIREMENT, CASE],
    artifacts: ARTIFACTS,
    edges: EDGES,
    sessions: [],
  });
  assertEquals(aliases.size, 0);
});

Deno.test("two registered sessions on the same DFM capture refuse the alias", () => {
  const aliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, OBS],
    artifacts: ARTIFACTS,
    edges: EDGES,
    sessions: [session("dfm-a"), session("dfm-b")],
  });
  assertEquals(aliases.has(OBS.key), false);
});

Deno.test("a requirement with two result captures yields no DFM alias", () => {
  const secondEval = record("evaluation", "dfm-eval-other", {
    entityKind: "evaluation",
  });
  const otherCapture = record("artifact", "dfm-check-other", {
    artifactKind: "evidence",
  });
  const aliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, otherCapture, EVALUATION, secondEval, REQUIREMENT],
    artifacts: [
      ...ARTIFACTS,
      artifact("dfm-check-other", "industrialize.run-dfm-checks@1"),
    ],
    edges: [
      ...EDGES,
      {
        from: { kind: "artifact", id: "dfm-check-other" },
        to: { kind: "evaluation", id: "dfm-eval-other" },
        relation: "evidences",
      },
      {
        from: { kind: "requirement", id: REQ_ID },
        to: { kind: "evaluation", id: "dfm-eval-other" },
        relation: "evaluates",
      },
    ],
    sessions: [session(), session("other-app", "dfm-check-other")],
  });
  assertEquals(aliases.has(REQUIREMENT.key), false);
});

Deno.test("DFM aliases compose beside requirement aliases without overlap", () => {
  const requirementAliases = overviewRequirementSourceViewerAliases(
    [{
      key: "requirement:REQ-MASS",
      groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
      ref: { kind: "requirement", id: "REQ-MASS" },
    }, {
      key: "artifact:requirements-current",
      groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
      ref: { kind: "artifact", id: "requirements-current" },
      isRequirementsCapture: true,
    }],
    [{
      from: { kind: "artifact", id: "requirements-current" },
      to: { kind: "requirement", id: "REQ-MASS" },
      relation: "traces_to",
    }],
    [{
      ...session("requirements-app", "requirements-current"),
      app: { id: "io.casys.mcp-syson", version: "1.0.0" },
    }],
  );
  const dfmAliases = overviewDfmCaptureViewerAliases({
    records: [CAPTURE, OBS],
    artifacts: ARTIFACTS,
    edges: EDGES,
    sessions: [session()],
  });
  const merged = mergeOverviewViewerAliases(requirementAliases, dfmAliases);
  assertEquals(
    merged.get("requirement:REQ-MASS")?.[0]?.sessionId,
    "requirements-app",
  );
  assertEquals(merged.get(OBS.key), TARGET);
});
