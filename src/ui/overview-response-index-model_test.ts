import { assert, assertEquals } from "@std/assert";
import { GENERIC_ENGINEERING_WORKBENCH_FIXTURE } from "../testing/workbench/generic-engineering-workbench-fixture.ts";
import {
  applicabilityLabel,
  correspondenceLabel,
  DEFAULT_RESPONSE_FILTER,
  freshnessLabel,
  hasResponseGap,
  isResponseBasisMatch,
  parseProjectResponse,
  type ProjectResponseBasis,
  type ProjectResponseItem,
  requirementEvidenceRefs,
  selectWorkbenchProjectResponse,
  sourceStateLabel,
} from "./src/project/overview-response-index-model.ts";
import { isEngineeringWorkbenchSnapshot } from "./src/thread/types.ts";

function briefItem(id: string, kind = "success-criterion"): unknown {
  return {
    id,
    kind,
    statement: `Statement for ${id}.`,
    sourceRefs: [{ kind: "answer", reference: "answer-1" }],
  };
}

function freshEvaluationFreshness(): unknown {
  return {
    status: "fresh",
    changedAt: "2026-09-13T10:00:00Z",
    invalidatedByChangeIds: [],
  };
}

function currentPassEvaluation(): unknown {
  return {
    evaluationId: "eval-1",
    status: "pass",
    applicability: "current",
    observationIds: ["obs-1"],
    evidenceArtifactIds: ["art-evidence-1"],
    evaluatedAt: "2026-09-13T10:00:00Z",
    freshness: freshEvaluationFreshness(),
  };
}

function requirement(overrides: Record<string, unknown> = {}): unknown {
  return {
    threadRequirementId: "req-1",
    requirementsArtifactId: "art-requirements-1",
    traceArtifactId: "art-trace-1",
    origin: "native",
    sourceBrief: { briefId: "brief-1", snapshotId: "snap-7", revision: 7 },
    sourceItemId: "item-1",
    sourceState: "unchanged",
    applicability: "current",
    evaluations: [currentPassEvaluation()],
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): unknown {
  return {
    item: briefItem("item-1"),
    correspondence: "native",
    requirements: [requirement()],
    gaps: [],
    ...overrides,
  };
}

function basis(): ProjectResponseBasis {
  return {
    projectId: "project-1",
    projectRevision: 892,
    brief: { briefId: "brief-1", snapshotId: "snap-7", revision: 7 },
    thread: { snapshotId: "thread-9", revision: 119, subjectId: "subject-1" },
  };
}

function availablePayload(
  items: readonly unknown[] = [row()],
): Record<string, unknown> {
  return {
    schemaVersion: "project-response/1.0",
    status: "available",
    basis: basis(),
    items,
    diagnostics: [],
    grants: "none",
  };
}

Deno.test("available payload with native current pass parses and has no gap", () => {
  const parsed = parseProjectResponse(availablePayload());
  assert(parsed.ok, JSON.stringify(parsed));
  assertEquals(parsed.model.items.length, 1);
  assertEquals(hasResponseGap(parsed.model.items[0]!), false);
});

Deno.test("only explicit server gaps filter the focused view, never evaluations", () => {
  const explicit = {
    code: "response.no-correspondence",
    message: "No mapping recorded.",
  };
  const parsed = parseProjectResponse(
    availablePayload([
      // Current fail and error evaluations stay display facts, not gaps.
      row({
        item: briefItem("fail-1"),
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              status: "fail",
            }],
          }),
        ],
      }),
      row({
        item: briefItem("err-1"),
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              status: "error",
            }],
          }),
        ],
      }),
      // Documentary, historical-only and unresolved records are not gaps
      // without an explicit server gap fact.
      row({
        item: briefItem("doc-1", "assumption"),
        correspondence: "documentary",
        requirements: [requirement({ origin: "documentary" })],
      }),
      row({
        item: briefItem("hist-1"),
        requirements: [
          requirement({
            applicability: "historical",
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              applicability: "historical",
            }],
          }),
        ],
      }),
      row({
        item: briefItem("unresolved-eval-1"),
        requirements: [requirement({ evaluations: [] })],
      }),
      // TRACE GAP correspondence alone is not a gap either: the server says
      // so explicitly through gaps.
      row({
        item: briefItem("tracegap-1", "open-question"),
        correspondence: "TRACE GAP",
        requirements: [],
      }),
      // Only these two carry explicit server gap facts.
      row({
        item: briefItem("gap-1", "open-question"),
        correspondence: "TRACE GAP",
        requirements: [],
        gaps: [explicit],
      }),
      row({
        item: briefItem("gap-2", "exclusion"),
        correspondence: "unresolved",
        requirements: [],
        gaps: [explicit],
      }),
    ]),
  );
  assert(parsed.ok, JSON.stringify(parsed));
  const [fail, err, doc, hist, unresolvedEval, traceGap, gap1, gap2] =
    parsed.model.items;
  assertEquals(hasResponseGap(fail!), false);
  assertEquals(fail!.requirements[0]!.evaluations[0]!.status, "fail");
  assertEquals(hasResponseGap(err!), false);
  assertEquals(err!.requirements[0]!.evaluations[0]!.status, "error");
  assertEquals(hasResponseGap(doc!), false);
  assertEquals(hasResponseGap(hist!), false);
  assertEquals(hasResponseGap(unresolvedEval!), false);
  assertEquals(hasResponseGap(traceGap!), false);
  assertEquals(hasResponseGap(gap1!), true);
  assertEquals(hasResponseGap(gap2!), true);
});

Deno.test("default visibility shows every item, including failing rows", () => {
  assertEquals(DEFAULT_RESPONSE_FILTER, "all");
});

Deno.test("basis binding refuses cross-project and stale bases without links", () => {
  assertEquals(isResponseBasisMatch(undefined, basis()), true);
  assertEquals(isResponseBasisMatch(basis(), undefined), false);
  assertEquals(isResponseBasisMatch(undefined, undefined), true);
  assertEquals(isResponseBasisMatch(basis(), basis()), true);
  assertEquals(
    isResponseBasisMatch(basis(), { ...basis(), projectRevision: 891 }),
    false,
  );
  assertEquals(
    isResponseBasisMatch(
      { ...basis(), brief: { ...basis().brief, revision: 6 } },
      basis(),
    ),
    false,
  );
  assertEquals(
    isResponseBasisMatch(
      basis(),
      { ...basis(), thread: { ...basis().thread!, revision: 118 } },
    ),
    false,
  );
});

Deno.test("unavailable payload parses with diagnostics and no synthesized items", () => {
  const parsed = parseProjectResponse({
    schemaVersion: "project-response/1.0",
    status: "unavailable",
    items: [],
    diagnostics: [{
      code: "response.no-approved-brief",
      message: "No approved brief.",
    }],
    grants: "none",
  });
  assert(parsed.ok, JSON.stringify(parsed));
  assertEquals(parsed.model.items, []);
  assertEquals(parsed.model.diagnostics.length, 1);
});

Deno.test("malformed payloads are rejected, never cast", () => {
  const malformed: readonly unknown[] = [
    null,
    "project-response/1.0",
    { ...availablePayload(), schemaVersion: "project-response/2.0" },
    { ...availablePayload(), status: "ready" },
    { ...availablePayload(), grants: "read" },
    { ...availablePayload(), items: "all" },
    { ...availablePayload(), diagnostics: [{ code: "x" }] },
    availablePayload([row({ correspondence: "partial" })]),
    availablePayload([row({ correspondence: "Documentary" })]),
    availablePayload([
      row({ requirements: [requirement({ origin: "derived" })] }),
    ]),
    availablePayload([
      row({
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              status: "passed",
            }],
          }),
        ],
      }),
    ]),
    availablePayload([
      row({ item: { kind: "constraint", statement: "No id." } }),
    ]),
    { ...availablePayload(), basis: { projectId: "p" } },
    { ...availablePayload(), basis: { ...basis(), projectId: "latest" } },
    // Canonical freshness is an object; a bare status string must refuse.
    availablePayload([
      row({
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              freshness: "fresh",
            }],
          }),
        ],
      }),
    ]),
    availablePayload([
      row({
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              freshness: {
                status: "mouldy",
                changedAt: "2026-09-13T10:00:00Z",
                invalidatedByChangeIds: [],
              },
            }],
          }),
        ],
      }),
    ]),
    availablePayload([
      row({
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              freshness: { status: "fresh", invalidatedByChangeIds: [] },
            }],
          }),
        ],
      }),
    ]),
    availablePayload([
      row({
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              freshness: {
                ...(freshEvaluationFreshness() as Record<string, unknown>),
                extra: true,
              },
            }],
          }),
        ],
      }),
    ]),
    availablePayload([
      row({
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              freshness: {
                ...(freshEvaluationFreshness() as Record<string, unknown>),
                invalidatedByChangeIds: "change-1",
              },
            }],
          }),
        ],
      }),
    ]),
  ];
  for (const payload of malformed) {
    const parsed = parseProjectResponse(payload);
    assertEquals(parsed.ok, false, JSON.stringify(payload).slice(0, 160));
    if (!parsed.ok) assert(parsed.issues.length > 0);
  }
});

Deno.test("older host without a response field selects undefined", () => {
  assertEquals(selectWorkbenchProjectResponse(undefined), undefined);
  assertEquals(selectWorkbenchProjectResponse(null), undefined);
  assertEquals(selectWorkbenchProjectResponse({}), undefined);
  const payload = availablePayload();
  assertEquals(selectWorkbenchProjectResponse({ response: payload }), payload);
});

Deno.test("evidence refs are exact, ordered and deduplicated", () => {
  const parsed = parseProjectResponse(availablePayload());
  assert(parsed.ok);
  const refs = requirementEvidenceRefs(
    parsed.model.items[0]!.requirements[0]!,
  );
  assertEquals(refs, [
    { kind: "requirement", id: "req-1" },
    { kind: "artifact", id: "art-trace-1" },
    { kind: "artifact", id: "art-requirements-1" },
    { kind: "evaluation", id: "eval-1" },
    { kind: "observation", id: "obs-1" },
    { kind: "artifact", id: "art-evidence-1" },
  ]);
});

Deno.test("contract literals keep their display labels", () => {
  assertEquals(correspondenceLabel("documentary"), "documentaire");
  assertEquals(correspondenceLabel("TRACE GAP"), "TRACE GAP");
  assertEquals(applicabilityLabel("historical"), "historique");
  assertEquals(sourceStateLabel("brief-unavailable"), "brief indisponible");
});

Deno.test("stale freshness keeps its reason visible instead of collapsing", () => {
  const parsed = parseProjectResponse(
    availablePayload([
      row({
        requirements: [
          requirement({
            evaluations: [{
              ...(currentPassEvaluation() as Record<string, unknown>),
              status: "fail",
              freshness: {
                status: "stale",
                changedAt: "2026-09-13T10:00:00Z",
                reason: "superseded by change-9",
                invalidatedByChangeIds: ["change-9"],
              },
            }],
          }),
        ],
      }),
    ]),
  );
  assert(parsed.ok, JSON.stringify(parsed));
  const evaluation = parsed.model.items[0]!.requirements[0]!.evaluations[0]!;
  assertEquals(evaluation.freshness.status, "stale");
  assertEquals(
    freshnessLabel(evaluation.freshness),
    "stale · superseded by change-9",
  );
  assertEquals(
    freshnessLabel({
      status: "fresh",
      changedAt: "2026-09-13T10:00:00Z",
      invalidatedByChangeIds: [],
    }),
    "fresh",
  );
});

Deno.test("unsupported future states are rejected, not rendered", () => {
  const parsed = parseProjectResponse(
    availablePayload([row({ correspondence: "satisfied" })]),
  );
  assertEquals(parsed.ok, false);
});

Deno.test("gap view never invents a row verdict", () => {
  const parsed = parseProjectResponse(
    availablePayload([
      row({ item: briefItem("a") }),
      row({
        item: briefItem("b"),
        correspondence: "unresolved",
        requirements: [],
      }),
    ]),
  );
  assert(parsed.ok);
  const item = parsed.model.items[0]! as ProjectResponseItem;
  assert(!("verdict" in item) && !("ready" in item) && !("score" in item));
});

function oldHostWorkbench(): Record<string, unknown> {
  const workbench = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  delete workbench.response;
  return workbench;
}

Deno.test("full workbench without response stays accepted and preserves the old view", () => {
  const workbench = oldHostWorkbench();
  assertEquals(isEngineeringWorkbenchSnapshot(workbench), true);
  assertEquals(selectWorkbenchProjectResponse(workbench), undefined);
});

Deno.test("full workbench carrying the index admits it to its consumer", () => {
  const workbench = oldHostWorkbench();
  const payload = availablePayload([
    row({ item: briefItem("item-1") }),
    row({
      item: briefItem("item-2", "assumption"),
      correspondence: "unresolved",
      requirements: [],
      gaps: [{
        code: "response.no-correspondence",
        message: "No mapping recorded.",
      }],
    }),
  ]);
  workbench.response = payload;
  assertEquals(isEngineeringWorkbenchSnapshot(workbench), true);
  assertEquals(selectWorkbenchProjectResponse(workbench), payload);
  const parsed = parseProjectResponse(
    selectWorkbenchProjectResponse(workbench),
  );
  assert(parsed.ok, JSON.stringify(parsed));
  if (parsed.ok) {
    assertEquals(parsed.model.items.length, 2);
    assertEquals(hasResponseGap(parsed.model.items[0]!), false);
    assertEquals(hasResponseGap(parsed.model.items[1]!), true);
  }
});

Deno.test("malformed index record keeps the page alive with an explicit unreadable state", () => {
  const workbench = oldHostWorkbench();
  workbench.response = {
    schemaVersion: "project-response/1.0",
    status: "available",
    items: [{ item: briefItem("item-1"), correspondence: "satisfied" }],
    diagnostics: [],
    grants: "none",
  };
  // The projection guard stays admissible so the page survives; the panel
  // parser refuses explicitly instead of silently ignoring coverage.
  assertEquals(isEngineeringWorkbenchSnapshot(workbench), true);
  const parsed = parseProjectResponse(
    selectWorkbenchProjectResponse(workbench),
  );
  assertEquals(parsed.ok, false);
  if (!parsed.ok) assert(parsed.issues.length > 0);
});

Deno.test("non-record index value refuses the whole projection loudly", () => {
  const workbench = oldHostWorkbench();
  workbench.response = "must-stay-a-record";
  assertEquals(isEngineeringWorkbenchSnapshot(workbench), false);
});

Deno.test("malformed nested brief source refuses the index before rendering", () => {
  const malformed = availablePayload([
    row({
      item: {
        ...(briefItem("bad-source") as Record<string, unknown>),
        sourceRefs: [null],
      },
    }),
  ]);
  const parsed = parseProjectResponse(malformed);
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assert(
      parsed.issues.some((issue) => issue.code === "response.invalid-shape"),
    );
  }
});
