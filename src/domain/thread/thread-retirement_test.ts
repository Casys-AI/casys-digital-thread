/**
 * Tests for the thread-retirement cascade module.
 *
 * All invariants are expressed as declarative phrases describing the contract,
 * not the implementation. Validation is done through validateThreadSnapshot
 * rather than inspecting in-memory objects wherever publishability matters.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  computeArchiveCascade,
  renderArchiveCascadeSummary,
  UnknownArchiveTargetError,
} from "./thread-retirement.ts";
import type { ThreadSnapshot } from "./thread-snapshot.ts";
import {
  applyThreadSnapshotExtension,
  type ThreadSnapshotExtension,
} from "./thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "./thread-snapshot-validation.ts";

// ---------------------------------------------------------------------------
// Minimal snapshot builder
// ---------------------------------------------------------------------------

function freshness() {
  return {
    status: "fresh" as const,
    changedAt: "2026-08-08T10:00:00.000Z",
    invalidatedByChangeIds: [] as string[],
  };
}

function op(runId = "run:test") {
  return { serverId: "test", tool: "test_tool", runId };
}

function fp(seed: string) {
  return { algorithm: "sha256" as const, digest: seed.repeat(64).slice(0, 64) };
}

function artifact(
  id: string,
  inputArtifactIds: string[] = [],
  digestSeed = "a",
) {
  return {
    id,
    name: `Artifact ${id}`,
    kind: "solver-result" as const,
    version: "v1",
    fingerprint: fp(digestSeed),
    producer: op(),
    inputArtifactIds,
    freshness: freshness(),
  };
}

function observation(id: string, sourceArtifactIds: string[]) {
  return {
    id,
    name: `Observation ${id}`,
    metric: "test.metric",
    quantity: { value: 1.0, unit: "mm" },
    source: {
      operation: op(),
      artifactIds: sourceArtifactIds,
      capturedAt: "2026-08-08T10:00:00.000Z",
    },
    freshness: freshness(),
  };
}

function evaluation(
  id: string,
  requirementId: string,
  observationIds: string[],
  evidenceArtifactIds: string[] = [],
) {
  return {
    id,
    name: `Evaluation ${id}`,
    requirementId,
    observationIds,
    status: "unresolved" as const,
    evaluatedAt: "2026-08-08T10:00:00.000Z",
    evaluator: op(),
    evidenceArtifactIds,
    message: "Provisional.",
    freshness: freshness(),
  };
}

function violation(
  id: string,
  requirementId: string,
  evaluationId: string,
  observationIds: string[] = [],
  evidenceArtifactIds: string[] = [],
) {
  return {
    id,
    name: `Violation ${id}`,
    requirementId,
    evaluationId,
    severity: "error" as const,
    status: "open" as const,
    detectedAt: "2026-08-08T10:00:00.000Z",
    observationIds,
    evidenceArtifactIds,
    summary: "Violation summary.",
    freshness: freshness(),
  };
}

function requirement(id: string, sourceArtifactId: string, targetArtifactId: string) {
  return {
    id,
    name: `Requirement ${id}`,
    statement: "Test requirement.",
    version: "v1",
    criterion: {
      metric: "test.metric",
      operator: "<=" as const,
      limit: { value: 10.0, unit: "mm" },
    },
    trace: {
      sourceArtifactId,
      elementId: `element-${id}`,
      targetArtifactIds: [targetArtifactId],
    },
    freshness: freshness(),
  };
}

function action(id: string, violationIds: string[]) {
  return {
    id,
    name: `Action ${id}`,
    kind: "review" as const,
    readiness: "ready" as const,
    rationale: "Action rationale.",
    targets: [] as never[],
    addressesViolationIds: violationIds,
    dependsOnActionIds: [] as string[],
  };
}

function minimalBase(
  modelArtifact: ReturnType<typeof artifact>,
  extra: Partial<ThreadSnapshot> = {},
): ThreadSnapshot {
  const changeSetId = "cs-base";
  return {
    schemaVersion: "1.0" as const,
    id: "snapshot-base",
    revision: 1,
    generatedAt: "2026-08-08T10:00:00.000Z",
    subject: {
      id: "project:test-subject",
      name: "Test Subject",
      kind: "system" as const,
      version: "v1",
      modelArtifactId: modelArtifact.id,
    },
    freshness: freshness(),
    changeSet: {
      id: changeSetId,
      name: "Base changes",
      status: "applied" as const,
      createdAt: "2026-08-08T10:00:00.000Z",
      appliedAt: "2026-08-08T10:00:00.000Z",
      changes: [],
    },
    artifacts: [modelArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// computeArchiveCascade — unknown target is rejected
// ---------------------------------------------------------------------------

Deno.test("computeArchiveCascade rejects a target absent from the snapshot", () => {
  const model = artifact("model-a", [], "a");
  const snap = minimalBase(model);
  assertThrows(
    () => computeArchiveCascade(snap, [{ kind: "artifact", id: "nonexistent" }]),
    UnknownArchiveTargetError,
    "nonexistent",
  );
});

// ---------------------------------------------------------------------------
// computeArchiveCascade — empty input yields empty output
// ---------------------------------------------------------------------------

Deno.test("computeArchiveCascade returns empty result for empty targets", () => {
  const model = artifact("model-a", [], "a");
  const snap = minimalBase(model);
  const result = computeArchiveCascade(snap, []);
  assertEquals(result.length, 0);
});

// ---------------------------------------------------------------------------
// computeArchiveCascade — follows inputArtifactIds chain
// ---------------------------------------------------------------------------

Deno.test(
  "computeArchiveCascade follows inputArtifactIds to cascade downstream artifacts",
  () => {
    const model = artifact("model", [], "0");
    const a1 = artifact("art-1", [], "1");
    const a2 = artifact("art-2", ["art-1"], "2");
    const a3 = artifact("art-3", ["art-2"], "3");
    const a4 = artifact("art-4", [], "4"); // independent — must NOT cascade

    // Consumptions required by the validator for derived artifacts.
    const cons1 = {
      id: "cons-1",
      artifactId: "art-1",
      consumer: op(),
      observedFingerprint: fp("1"),
      verifiedAt: "2026-08-08T10:00:00.000Z",
      status: "verified" as const,
    };
    const cons2 = {
      id: "cons-2",
      artifactId: "art-2",
      consumer: op(),
      observedFingerprint: fp("2"),
      verifiedAt: "2026-08-08T10:00:00.000Z",
      status: "verified" as const,
    };

    const snap: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, a1, a2, a3, a4],
      consumptions: [cons1, cons2],
      provenance: [
        {
          id: "link-a2-from-a1",
          relation: "derived_from",
          from: { kind: "artifact", id: "art-2" },
          to: { kind: "artifact", id: "art-1" },
          rationale: "Derived.",
        },
        {
          id: "link-a3-from-a2",
          relation: "derived_from",
          from: { kind: "artifact", id: "art-3" },
          to: { kind: "artifact", id: "art-2" },
          rationale: "Derived.",
        },
        {
          id: "uses-1",
          relation: "uses",
          from: { kind: "consumption", id: "cons-1" },
          to: { kind: "artifact", id: "art-1" },
          rationale: "Used.",
        },
        {
          id: "uses-2",
          relation: "uses",
          from: { kind: "consumption", id: "cons-2" },
          to: { kind: "artifact", id: "art-2" },
          rationale: "Used.",
        },
      ],
    };

    const result = computeArchiveCascade(snap, [{ kind: "artifact", id: "art-1" }]);
    const ids = result.map((e) => e.ref.id);
    assertEquals(ids.includes("art-1"), true, "Target itself must be in the cascade.");
    assertEquals(ids.includes("art-2"), true, "art-2 consumes art-1.");
    assertEquals(ids.includes("art-3"), true, "art-3 transitively consumes art-1.");
    assertEquals(ids.includes("art-4"), false, "art-4 is independent.");
  },
);

// ---------------------------------------------------------------------------
// computeArchiveCascade — follows derived_from provenance links
// ---------------------------------------------------------------------------

Deno.test(
  "computeArchiveCascade follows derived_from provenance links as an additional cascade path",
  () => {
    const model = artifact("model", [], "0");
    const a1 = artifact("a1", [], "1");
    const a2 = artifact("a2", ["a1"], "2"); // derives from a1

    const cons = {
      id: "cons-a1-by-a2",
      artifactId: "a1",
      consumer: op(),
      observedFingerprint: fp("1"),
      verifiedAt: "2026-08-08T10:00:00.000Z",
      status: "verified" as const,
    };

    const snap: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, a1, a2],
      consumptions: [cons],
      provenance: [
        {
          id: "link-a2-from-a1",
          relation: "derived_from",
          from: { kind: "artifact", id: "a2" },
          to: { kind: "artifact", id: "a1" },
          rationale: "Derived.",
        },
        {
          id: "uses-cons",
          relation: "uses",
          from: { kind: "consumption", id: "cons-a1-by-a2" },
          to: { kind: "artifact", id: "a1" },
          rationale: "Used.",
        },
      ],
    };

    const result = computeArchiveCascade(snap, [{ kind: "artifact", id: "a1" }]);
    const ids = result.map((e) => e.ref.id);
    assertEquals(ids.includes("a1"), true);
    assertEquals(ids.includes("a2"), true, "a2 derives from a1 via derived_from link.");
  },
);

// ---------------------------------------------------------------------------
// computeArchiveCascade — cascades to observations, evaluations, violations
// ---------------------------------------------------------------------------

Deno.test(
  "computeArchiveCascade cascades from artifact to observations then evaluations then violations",
  () => {
    const model = artifact("model", [], "0");
    const req = requirement("req-1", "model", "model");
    const a1 = artifact("a1", [], "1");
    const obs1 = observation("obs-1", ["a1"]);
    const eval1 = evaluation("eval-1", "req-1", ["obs-1"]);
    const action1 = action("act-1", ["viol-1"]);
    const viol1 = violation("viol-1", "req-1", "eval-1", ["obs-1"]);

    const snap: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, a1],
      requirements: [req],
      observations: [obs1],
      evaluations: [eval1],
      violations: [viol1],
      proposedActions: [action1],
      provenance: [
        {
          id: "link-obs1-from-a1",
          relation: "derived_from",
          from: { kind: "observation", id: "obs-1" },
          to: { kind: "artifact", id: "a1" },
          rationale: "Observed.",
        },
        {
          id: "link-eval1-evaluates-req1",
          relation: "evaluates",
          from: { kind: "evaluation", id: "eval-1" },
          to: { kind: "requirement", id: "req-1" },
          rationale: "Evaluates.",
        },
        {
          id: "link-eval1-uses-obs1",
          relation: "uses",
          from: { kind: "evaluation", id: "eval-1" },
          to: { kind: "observation", id: "obs-1" },
          rationale: "Uses.",
        },
        {
          id: "link-viol1-caused-by-eval1",
          relation: "caused_by",
          from: { kind: "violation", id: "viol-1" },
          to: { kind: "evaluation", id: "eval-1" },
          rationale: "Caused.",
        },
        {
          id: "link-act1-addresses-viol1",
          relation: "addresses",
          from: { kind: "action", id: "act-1" },
          to: { kind: "violation", id: "viol-1" },
          rationale: "Addresses.",
        },
        {
          id: "link-req1-traces-to-model",
          relation: "traces_to",
          from: { kind: "requirement", id: "req-1" },
          to: { kind: "artifact", id: "model" },
          rationale: "Traces.",
        },
      ],
    };

    const result = computeArchiveCascade(snap, [{ kind: "artifact", id: "a1" }]);
    const byKind = (kind: string) =>
      result.filter((e) => e.ref.kind === kind).map((e) => e.ref.id);

    assertEquals(byKind("artifact"), ["a1"]);
    assertEquals(byKind("observation"), ["obs-1"]);
    assertEquals(byKind("evaluation"), ["eval-1"]);
    assertEquals(byKind("violation"), ["viol-1"]);
    // requirement and action are NOT in the cascade — they are not production downstream
    assertEquals(byKind("requirement"), []);
  },
);

Deno.test(
  "computeArchiveCascade retires a requirement's evaluations and violations",
  () => {
    const model = artifact("model", [], "0");
    const req = requirement("req-retired", "model", "model");
    const eval1 = evaluation("eval-for-req", "req-retired", []);
    const viol1 = violation("viol-for-eval", "req-retired", "eval-for-req");
    const snapshot: ThreadSnapshot = {
      ...minimalBase(model),
      requirements: [req],
      evaluations: [eval1],
      violations: [viol1],
    };
    const result = computeArchiveCascade(snapshot, [{
      kind: "requirement",
      id: "req-retired",
    }]);
    assertEquals(result.map((entry) => entry.ref), [
      { kind: "evaluation", id: "eval-for-req" },
      { kind: "requirement", id: "req-retired" },
      { kind: "violation", id: "viol-for-eval" },
    ]);
  },
);

// ---------------------------------------------------------------------------
// computeArchiveCascade — does NOT follow traces_to
// ---------------------------------------------------------------------------

Deno.test("computeArchiveCascade never follows traces_to links", () => {
  const model = artifact("model", [], "0");
  const proofArt = artifact("proof-art", [], "1");

  // The model requirement traces to the model artifact; retiring proof-art
  // must NOT cascade to model or its requirement.
  const req = requirement("req-1", "model", "model");

  const snap: ThreadSnapshot = {
    ...minimalBase(model),
    artifacts: [model, proofArt],
    requirements: [req],
    provenance: [
      {
        id: "link-proof-traces-to-model",
        relation: "traces_to",
        from: { kind: "artifact", id: "proof-art" },
        to: { kind: "artifact", id: "model" },
        rationale: "Historical evidence anchored to model.",
      },
      {
        id: "link-req1-traces-to-model",
        relation: "traces_to",
        from: { kind: "requirement", id: "req-1" },
        to: { kind: "artifact", id: "model" },
        rationale: "Traces.",
      },
    ],
  };

  const result = computeArchiveCascade(snap, [{ kind: "artifact", id: "proof-art" }]);
  const kinds = result.map((e) => e.ref.kind);
  assertEquals(kinds.every((k) => k === "artifact"), true);
  assertEquals(result.every((e) => e.ref.id === "proof-art"), true);
});

// ---------------------------------------------------------------------------
// computeArchiveCascade — excludes already-archived entities
// ---------------------------------------------------------------------------

Deno.test(
  "computeArchiveCascade excludes entities already archived in the snapshot",
  () => {
    const model = artifact("model", [], "0");
    const a1 = artifact("a1", [], "1");
    const a2 = artifact("a2", ["a1"], "2");

    const cons = {
      id: "cons-a1-by-a2",
      artifactId: "a1",
      consumer: op(),
      observedFingerprint: fp("1"),
      verifiedAt: "2026-08-08T10:00:00.000Z",
      status: "verified" as const,
    };

    // Simulate a prior revision that already archived a2.
    const existingArchivedChange = {
      id: "prior-archived:a2",
      kind: "archived" as const,
      target: { kind: "artifact" as const, id: "a2" },
      summary: "Already archived.",
    };

    const snap: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, a1, a2],
      consumptions: [cons],
      changeSet: {
        id: "cs-with-prior-archive",
        name: "With prior archive",
        status: "applied" as const,
        createdAt: "2026-08-08T10:00:00.000Z",
        appliedAt: "2026-08-08T10:00:00.000Z",
        changes: [existingArchivedChange],
      },
      provenance: [
        {
          id: "link-a2-from-a1",
          relation: "derived_from",
          from: { kind: "artifact", id: "a2" },
          to: { kind: "artifact", id: "a1" },
          rationale: "Derived.",
        },
        {
          id: "uses-cons",
          relation: "uses",
          from: { kind: "consumption", id: "cons-a1-by-a2" },
          to: { kind: "artifact", id: "a1" },
          rationale: "Used.",
        },
        {
          id: "link-change-archives-a2",
          relation: "changes",
          from: { kind: "change", id: "prior-archived:a2" },
          to: { kind: "artifact", id: "a2" },
          rationale: "Archived.",
        },
      ],
    };

    const result = computeArchiveCascade(snap, [{ kind: "artifact", id: "a1" }]);
    const ids = result.map((e) => e.ref.id);
    assertEquals(ids.includes("a1"), true, "a1 is the target, must be included.");
    assertEquals(
      ids.includes("a2"),
      false,
      "a2 is already archived, must be excluded.",
    );
  },
);

Deno.test(
  "computeArchiveCascade traverses a retired ancestor to retire new descendants",
  () => {
    const model = artifact("model", [], "0");
    const retiredParent = artifact("retired-parent", [], "1");
    const newChild = artifact("new-child", ["retired-parent"], "2");
    const snap: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, retiredParent, newChild],
      changeSet: {
        ...minimalBase(model).changeSet,
        changes: [{
          id: "prior:archived:artifact:retired-parent",
          kind: "archived",
          target: { kind: "artifact", id: "retired-parent" },
          summary: "Previously retired.",
        }],
      },
      provenance: [{
        id: "prior:changes:artifact:retired-parent",
        relation: "changes",
        from: { kind: "change", id: "prior:archived:artifact:retired-parent" },
        to: { kind: "artifact", id: "retired-parent" },
        rationale: "Previously retired.",
      }],
    };
    const result = computeArchiveCascade(snap, [{
      kind: "artifact",
      id: "retired-parent",
    }]);
    assertEquals(result.map((entry) => entry.ref), [{
      kind: "artifact",
      id: "new-child",
    }]);
  },
);

Deno.test(
  "computeArchiveCascade propagates from an archived artifact to late active observation evidence",
  () => {
    const model = artifact("model", [], "0");
    const retiredArtifact = artifact("retired-artifact", [], "1");
    const req = requirement("req", "model", "model");
    const lateObservation = observation("late-observation", ["retired-artifact"]);
    const lateEvaluation = evaluation("late-evaluation", "req", ["late-observation"]);
    const lateViolation = violation("late-violation", "req", "late-evaluation", [
      "late-observation",
    ]);
    const snapshot: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, retiredArtifact],
      requirements: [req],
      observations: [lateObservation],
      evaluations: [lateEvaluation],
      violations: [lateViolation],
      changeSet: {
        ...minimalBase(model).changeSet,
        changes: [{
          id: "prior:archived:artifact:retired-artifact",
          kind: "archived",
          target: { kind: "artifact", id: "retired-artifact" },
          summary: "Previously retired.",
        }],
      },
    };
    const result = computeArchiveCascade(snapshot, [{
      kind: "artifact",
      id: "retired-artifact",
    }]);
    assertEquals(result.map((entry) => entry.ref), [
      { kind: "evaluation", id: "late-evaluation" },
      { kind: "observation", id: "late-observation" },
      { kind: "violation", id: "late-violation" },
    ]);
  },
);

Deno.test(
  "computeArchiveCascade propagates an archived requirement through an archived evaluation to a late violation",
  () => {
    const model = artifact("model", [], "0");
    const retiredRequirement = requirement("retired-requirement", "model", "model");
    const retiredEvaluation = evaluation(
      "retired-evaluation",
      "retired-requirement",
      [],
    );
    const lateViolation = violation(
      "late-violation",
      "retired-requirement",
      "retired-evaluation",
    );
    const snapshot: ThreadSnapshot = {
      ...minimalBase(model),
      requirements: [retiredRequirement],
      evaluations: [retiredEvaluation],
      violations: [lateViolation],
      changeSet: {
        ...minimalBase(model).changeSet,
        changes: [
          {
            id: "prior:archived:requirement:retired-requirement",
            kind: "archived",
            target: { kind: "requirement", id: "retired-requirement" },
            summary: "Previously retired.",
          },
          {
            id: "prior:archived:evaluation:retired-evaluation",
            kind: "archived",
            target: { kind: "evaluation", id: "retired-evaluation" },
            summary: "Previously retired.",
          },
        ],
      },
    };
    const result = computeArchiveCascade(snapshot, [{
      kind: "requirement",
      id: "retired-requirement",
    }]);
    assertEquals(result.map((entry) => entry.ref), [{
      kind: "violation",
      id: "late-violation",
    }]);
  },
);

// ---------------------------------------------------------------------------
// computeArchiveCascade — result order is stable
// ---------------------------------------------------------------------------

Deno.test("computeArchiveCascade produces a deterministic sorted order", () => {
  const model = artifact("model", [], "0");
  const a1 = artifact("z-last", [], "1");
  const a2 = artifact("a-first", [], "2");

  // Both are independent targets.
  const snap: ThreadSnapshot = {
    ...minimalBase(model),
    artifacts: [model, a1, a2],
  };

  const result = computeArchiveCascade(snap, [
    { kind: "artifact", id: "z-last" },
    { kind: "artifact", id: "a-first" },
  ]);

  assertEquals(result[0]?.ref.id, "a-first", "Sorted by id within artifact tier.");
  assertEquals(result[1]?.ref.id, "z-last");
});

// ---------------------------------------------------------------------------
// renderArchiveCascadeSummary
// ---------------------------------------------------------------------------

Deno.test("renderArchiveCascadeSummary renders one line per entry", () => {
  const cascade = [
    { ref: { kind: "artifact" as const, id: "art-1" }, because: "art-1" },
    { ref: { kind: "observation" as const, id: "obs-1" }, because: "art-1" },
  ];
  const text = renderArchiveCascadeSummary(cascade);
  const lines = text.split("\n");
  assertEquals(lines.length, 2);
  assertEquals(lines[0]?.includes("artifact:art-1"), true);
  assertEquals(lines[0]?.includes("because: art-1"), true);
  assertEquals(lines[1]?.includes("observation:obs-1"), true);
});

Deno.test("renderArchiveCascadeSummary returns a placeholder for empty cascade", () => {
  const text = renderArchiveCascadeSummary([]);
  assertEquals(text, "(no entities to retire)");
});

// ---------------------------------------------------------------------------
// Extension — archived entry produces change + provenance link; snapshot valid
// ---------------------------------------------------------------------------

Deno.test(
  "ThreadSnapshotExtension with archived entries produces validated successor snapshot",
  () => {
    const model = artifact("model-ext", [], "0");
    const target = artifact("art-to-archive", [], "1");
    const base: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, target],
    };

    const ext: ThreadSnapshotExtension = {
      id: "retire-art-to-archive",
      name: "Retire art-to-archive",
      subjectId: base.subject.id,
      capturedAt: "2026-08-08T11:00:00.000Z",
      artifacts: [],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
      archived: [{
        target: { kind: "artifact", id: "art-to-archive" },
        summary: "Retired: superseded by a corrected version.",
      }],
    };

    const successor = applyThreadSnapshotExtension(base, ext, {
      appliedAt: "2026-08-08T11:00:00.000Z",
    });

    // The snapshot must be publishable.
    validateThreadSnapshot(successor);

    // The changeSet must carry the archived change.
    const archivedChange = successor.changeSet.changes.find(
      (c) => c.kind === "archived" && c.target.id === "art-to-archive",
    );
    assertEquals(
      archivedChange !== undefined,
      true,
      "Archived change must be present.",
    );
    assertEquals(archivedChange?.beforeFingerprint, undefined);
    assertEquals(archivedChange?.afterFingerprint, undefined);

    // A 'changes' provenance link must connect the change to the target.
    const link = successor.provenance.find(
      (l) =>
        l.relation === "changes" &&
        l.from.kind === "change" &&
        l.from.id === archivedChange!.id &&
        l.to.id === "art-to-archive",
    );
    assertEquals(link !== undefined, true, "changes provenance link must be present.");

    // The artifact still exists (archiving is NOT a deletion).
    assertEquals(successor.artifacts.some((a) => a.id === "art-to-archive"), true);
  },
);

Deno.test(
  "archived change identities retain entity kind across a full observation cascade",
  () => {
    const model = artifact("model-full", [], "0");
    const proof = artifact("same-id", [], "1");
    const obs = observation("same-id", ["same-id"]);
    const base: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, proof],
      observations: [obs],
      provenance: [{
        id: "obs-from-proof",
        relation: "derived_from",
        from: { kind: "observation", id: "same-id" },
        to: { kind: "artifact", id: "same-id" },
        rationale: "Observed.",
      }],
    };
    const cascade = computeArchiveCascade(base, [
      { kind: "artifact", id: "same-id" },
    ]);
    const successor = applyThreadSnapshotExtension(base, {
      id: "retire-full",
      name: "Retire full",
      subjectId: base.subject.id,
      capturedAt: "2026-08-08T11:00:00.000Z",
      artifacts: [],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
      archived: cascade.map((entry) => ({ target: entry.ref, summary: "Retired." })),
    });
    validateThreadSnapshot(successor);
    assertEquals(
      successor.changeSet.changes.filter((change) => change.kind === "archived").map((
        change,
      ) => change.id),
      [
        "retire-full:archived:artifact:same-id",
        "retire-full:archived:observation:same-id",
      ],
    );
  },
);

// ---------------------------------------------------------------------------
// Extension — accumulated archived changes survive a subsequent revision
// ---------------------------------------------------------------------------

Deno.test(
  "Archived changes accumulate across successive snapshot revisions",
  () => {
    const model = artifact("model-acc", [], "0");
    const art1 = artifact("art-acc-1", [], "1");
    const art2 = artifact("art-acc-2", [], "2");

    const base: ThreadSnapshot = {
      ...minimalBase(model),
      artifacts: [model, art1, art2],
    };

    // First extension: retire art1.
    const ext1: ThreadSnapshotExtension = {
      id: "retire-art-acc-1",
      name: "Retire art-acc-1",
      subjectId: base.subject.id,
      capturedAt: "2026-08-08T11:00:00.000Z",
      artifacts: [],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
      archived: [{
        target: { kind: "artifact", id: "art-acc-1" },
        summary: "Retired.",
      }],
    };
    const rev2 = applyThreadSnapshotExtension(base, ext1, {
      appliedAt: "2026-08-08T11:00:00.000Z",
    });
    validateThreadSnapshot(rev2);

    // Second extension: retire art2.
    const ext2: ThreadSnapshotExtension = {
      id: "retire-art-acc-2",
      name: "Retire art-acc-2",
      subjectId: base.subject.id,
      capturedAt: "2026-08-08T12:00:00.000Z",
      artifacts: [],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
      archived: [{
        target: { kind: "artifact", id: "art-acc-2" },
        summary: "Retired.",
      }],
    };
    const rev3 = applyThreadSnapshotExtension(rev2, ext2, {
      appliedAt: "2026-08-08T12:00:00.000Z",
    });
    validateThreadSnapshot(rev3);

    // Both archived changes must persist in the final revision.
    const archivedIds = rev3.changeSet.changes
      .filter((c) => c.kind === "archived")
      .map((c) => c.target.id)
      .sort();
    assertEquals(archivedIds, ["art-acc-1", "art-acc-2"]);
  },
);

// ---------------------------------------------------------------------------
// Validation — archived change targeting a nonexistent entity is rejected
// ---------------------------------------------------------------------------

Deno.test(
  "validateThreadSnapshot rejects a change kind archived targeting a nonexistent entity",
  () => {
    const model = artifact("model-val", [], "0");
    const base: ThreadSnapshot = {
      ...minimalBase(model),
    };

    // Manually inject an invalid archived change (no such artifact in snapshot).
    const invalid = {
      ...base,
      changeSet: {
        ...base.changeSet,
        changes: [
          {
            id: "bad-archived-change",
            kind: "archived" as const,
            target: { kind: "artifact" as const, id: "nonexistent-id" },
            summary: "Retire something that does not exist.",
          },
        ],
      },
      provenance: [
        {
          id: "link-bad-change",
          relation: "changes" as const,
          from: { kind: "change" as const, id: "bad-archived-change" },
          to: { kind: "artifact" as const, id: "nonexistent-id" },
          rationale: "Bad link.",
        },
      ],
    };

    // The entity nonexistent-id does not exist → missing_reference error.
    let threw = false;
    try {
      validateThreadSnapshot(invalid);
    } catch {
      threw = true;
    }
    assertEquals(
      threw,
      true,
      "Validation must reject archived change on nonexistent entity.",
    );
  },
);
