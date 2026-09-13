import { assertEquals } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import {
  emptyProjectResponseEvidenceFacts,
  type ProjectResponseEvidenceFacts,
  type ProjectResponseEvidenceReader,
} from "../../ports/out/project-response/project-response-evidence-reader.ts";
import type { ProjectResponseBasis } from "../../../domain/project/project-response.ts";
import { ProjectBriefCommandService } from "../project/project-brief-command-service.ts";
import { ReadProjectResponse } from "./read-project-response.ts";

const AT = "2026-09-13T12:00:00.000Z";
const FRESH = {
  status: "fresh" as const,
  changedAt: AT,
  invalidatedByChangeIds: [],
};

Deno.test("a source-backed documentary clause-response does not add a requirement or pass", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([], {
    clauseResponses: [{
      artifactId: "documentary-clause-response-exclusion",
      revision: 1,
      sourceItemId: "exclusion",
      sourceBrief: {
        briefId: brief.briefId,
        snapshotId: brief.id,
        revision: brief.revision,
      },
      sourceItem: brief.items.find((item) => item.id === "exclusion")!,
      recordingStatus: "proposal",
      authorKind: "agent",
      scope: "context",
      answer: "Outdoor use remains excluded.",
      sourceRefs: [{
        kind: "agent-resource",
        uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
      }],
    }],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const exclusion = result.items.find((row) => row.item.id === "exclusion")!;
  assertEquals(exclusion.requirements, []);
  assertEquals(exclusion.clauseResponses.length, 1);
  assertEquals(exclusion.clauseResponses[0]!.recordingStatus, "proposal");
  assertEquals(exclusion.clauseResponses[0]!.authorKind, "agent");
  assertEquals(exclusion.clauseResponses[0]!.applicability, "current");
  assertEquals("pass" in exclusion, false);
  assertEquals(exclusion.correspondence, "unresolved");
});

Deno.test("a documentary answer on a verification clause leaves the proof gap", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([], {
    clauseResponses: [{
      artifactId: "documentary-clause-response-success",
      revision: 1,
      sourceItemId: "success",
      sourceBrief: {
        briefId: brief.briefId,
        snapshotId: brief.id,
        revision: brief.revision,
      },
      sourceItem: brief.items.find((item) => item.id === "success")!,
      recordingStatus: "proposal",
      authorKind: "agent",
      scope: "criterion",
      answer: "A textual answer cannot replace the static proof.",
      sourceRefs: [{
        kind: "agent-resource",
        uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
      }],
    }],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const success = result.items.find((row) => row.item.id === "success")!;
  assertEquals(success.clauseResponses.length, 1);
  assertEquals(
    success.gaps.some((item) => item.code === "clause-response.not-proof"),
    true,
  );
  assertEquals(success.requirements, []);
});

Deno.test("historical clause-responses stay visible after the brief item changes", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const current = brief.items.find((item) => item.id === "exclusion")!;
  const facts = factsWithTraces([], {
    clauseResponses: [{
      artifactId: "documentary-clause-response-exclusion-old",
      revision: 1,
      sourceItemId: "exclusion",
      sourceBrief: {
        briefId: brief.briefId,
        snapshotId: "brief-old",
        revision: 1,
      },
      sourceItem: { ...current, statement: "Older exclusion text." },
      recordingStatus: "proposal",
      authorKind: "agent",
      scope: "context",
      answer: "Historical answer.",
      sourceRefs: [{
        kind: "agent-resource",
        uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
      }],
    }],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const exclusion = result.items.find((row) => row.item.id === "exclusion")!;
  assertEquals(exclusion.clauseResponses[0]!.applicability, "historical");
  assertEquals(exclusion.clauseResponses[0]!.sourceState, "changed");
  assertEquals(exclusion.item.statement, current.statement);
});

Deno.test("removed-item clause-response stays inspectable as non-current history", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([], {
    clauseResponses: [{
      artifactId: "documentary-clause-response-retired",
      revision: 1,
      sourceItemId: "retired-exclusion",
      sourceBrief: {
        briefId: brief.briefId,
        snapshotId: "brief-old",
        revision: 1,
      },
      sourceItem: {
        id: "retired-exclusion",
        kind: "exclusion",
        statement: "Retired exclusion text.",
        sourceRefs: [{ kind: "intent", reference: "conversation:old" }],
      },
      recordingStatus: "proposal",
      authorKind: "agent",
      scope: "context",
      answer: "Historical retired answer.",
      sourceRefs: [{
        kind: "agent-resource",
        uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
      }],
    }],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  assertEquals(
    result.items.some((row) => row.item.id === "retired-exclusion"),
    false,
  );
  assertEquals(
    result.items.some((row) =>
      row.clauseResponses.some((record) => record.sourceItemId === "retired-exclusion")
    ),
    false,
  );
  assertEquals(result.historicalClauseResponses.length, 1);
  const historical = result.historicalClauseResponses[0]!;
  assertEquals(historical.answer, "Historical retired answer.");
  assertEquals(historical.scope, "context");
  assertEquals(historical.applicability, "historical");
  assertEquals(historical.sourceState, "removed");
  assertEquals(historical.sourceItemId, "retired-exclusion");
  assertEquals(historical.sourceRefs, [{
    kind: "agent-resource",
    uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
  }]);
  assertEquals(
    result.diagnostics.some((item) => item.code === "clause-response.removed-item"),
    false,
  );
  assertEquals(result.items.every((row) => row.correspondence !== "documentary"), true);
});

Deno.test("an invalid declared clause-response stays unavailable without a fabricated answer", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([], {
    clauseResponseFailure: {
      status: "unavailable",
      code: "clause-response.unavailable",
      message: "A declared clause-response capture is unavailable.",
    },
    clauseResponses: [{
      artifactId: "documentary-clause-response-forged",
      revision: 1,
      sourceItemId: "exclusion",
      sourceBrief: {
        briefId: brief.briefId,
        snapshotId: brief.id,
        revision: brief.revision,
      },
      sourceItem: brief.items.find((item) => item.id === "exclusion")!,
      recordingStatus: "proposal",
      authorKind: "agent",
      scope: "context",
      answer: "This forged answer must not be projected.",
      sourceRefs: [{
        kind: "agent-resource",
        uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
      }],
    }],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const exclusion = result.items.find((row) => row.item.id === "exclusion")!;
  assertEquals(result.status, "unavailable");
  assertEquals(
    result.diagnostics.some((item) => item.code === "clause-response.unavailable"),
    true,
  );
  assertEquals(exclusion.clauseResponses, []);
  assertEquals(exclusion.requirements, []);
  assertEquals("pass" in result, false);
});

Deno.test("available index enumerates every approved item including untraced non-verification kinds", async () => {
  const { project } = await approvedProject();
  const result = await usecase().project({ project });
  assertEquals(result.status, "available");
  assertEquals(result.grants, "none");
  assertEquals(result.items.map((row) => row.item.id), [
    "objective",
    "mission",
    "assumption",
    "exclusion",
    "question",
    "success",
    "verify",
    "make",
  ]);
  assertEquals(result.items.map((row) => row.item.kind), [
    "objective",
    "mission-scenario",
    "assumption",
    "exclusion",
    "open-question",
    "success-criterion",
    "verification-activity",
    "manufacturing-evidence",
  ]);
  assertEquals(
    result.items.every((row) => row.correspondence === "unresolved"),
    true,
  );
  assertEquals(
    result.items.find((row) => row.item.id === "assumption")!.gaps.map((g) => g.code),
    ["evidence.missing"],
  );
  assertEquals(
    result.items.find((row) => row.item.id === "make")!.gaps.map((g) => g.code)
      .includes("mapping.missing"),
    true,
  );
  assertEquals("pass" in result, false);
  assertEquals("coverage" in result, false);
  assertEquals(result.items.some((row) => "pass" in row), false);
});

Deno.test("a single current native pass is native correspondence and not a row verdict", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([{
    status: "available",
    artifactId: "requirements-current",
    threadRequirementIds: ["requirement-current-success"],
    origin: "native",
    sourceBrief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    requirementsArtifactId: "requirements-current",
    requirements: [{
      threadRequirementId: "requirement-current-success",
      requirementId: "maxDisplacement",
      sourceItemId: "success",
      sourceState: "unchanged",
    }],
  }], {
    requirements: [req("requirement-current-success", "requirements-current")],
    artifacts: [artifact("requirements-current"), artifact("obs-src")],
    observations: [observation("obs-current", ["obs-src"])],
    evaluations: [
      evaluation("eval-current", "requirement-current-success", "pass", [
        "obs-current",
      ], ["obs-src"]),
    ],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const success = result.items.find((row) => row.item.id === "success")!;
  assertEquals(success.correspondence, "native");
  assertEquals(success.requirements[0]!.applicability, "current");
  assertEquals(success.requirements[0]!.evaluations[0]!.status, "pass");
  assertEquals(success.requirements[0]!.evaluations[0]!.applicability, "current");
  assertEquals("pass" in success, false);
});

Deno.test("a gate item retains a gap when only one of its requirements is evaluated", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([{
    status: "available",
    artifactId: "requirements-current",
    threadRequirementIds: ["requirement-a", "requirement-b"],
    origin: "native",
    sourceBrief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    requirementsArtifactId: "requirements-current",
    requirements: ["requirement-a", "requirement-b"].map((id) => ({
      threadRequirementId: id,
      requirementId: id,
      sourceItemId: "success",
      sourceState: "unchanged" as const,
    })),
  }], {
    requirements: [
      req("requirement-a", "requirements-current"),
      req("requirement-b", "requirements-current"),
    ],
    artifacts: [artifact("requirements-current"), artifact("obs-src")],
    observations: [observation("obs-current", ["obs-src"])],
    evaluations: [
      evaluation("eval-a", "requirement-a", "pass", ["obs-current"], ["obs-src"]),
    ],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const row = result.items.find((item) => item.item.id === "success")!;
  assertEquals(row.requirements.map((item) => item.evaluations.length), [1, 0]);
  assertEquals(row.gaps.some((item) => item.code === "evaluation.missing"), true);
  assertEquals(row.requirements[0]!.evaluations[0]!.status, "pass");
});

Deno.test("latest aliases are refused before consulting the project store", async () => {
  const service = new ReadProjectResponse({
    projects: {
      get() {
        throw new Error("An alias must not reach the store.");
      },
    },
    snapshots: {
      get() {
        throw new Error("An alias must not reach snapshots.");
      },
    },
    evidence: new StubEvidence(),
  });
  for (const projectId of ["latest", "LATEST", "Latest"]) {
    const result = await service.read({ projectId });
    assertEquals(result.status, "unavailable");
    assertEquals(result.diagnostics[0]!.code, "basis.unavailable");
  }
});

Deno.test("exact current native pass stays current and an older unchanged clause stays historical", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([{
    status: "available",
    artifactId: "requirements-current",
    threadRequirementIds: ["requirement-current-success"],
    origin: "native",
    sourceBrief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    requirementsArtifactId: "requirements-current",
    requirements: [{
      threadRequirementId: "requirement-current-success",
      requirementId: "maxDisplacement",
      sourceItemId: "success",
      sourceState: "unchanged",
    }],
  }, {
    status: "available",
    artifactId: "requirements-old",
    threadRequirementIds: ["requirement-old-success"],
    origin: "native",
    sourceBrief: {
      briefId: brief.briefId,
      snapshotId: "brief:historical",
      revision: 1,
    },
    requirementsArtifactId: "requirements-old",
    requirements: [{
      threadRequirementId: "requirement-old-success",
      requirementId: "maxDisplacement",
      sourceItemId: "success",
      sourceState: "unchanged",
    }],
  }], {
    requirements: [
      req("requirement-current-success", "requirements-current"),
      req("requirement-old-success", "requirements-old"),
    ],
    artifacts: [
      artifact("requirements-current"),
      artifact("requirements-old"),
      artifact("obs-src"),
    ],
    observations: [observation("obs-current", ["obs-src"])],
    evaluations: [
      evaluation("eval-current", "requirement-current-success", "pass", [
        "obs-current",
      ], ["obs-src"]),
      evaluation("eval-old", "requirement-old-success", "pass", [
        "obs-current",
      ], ["obs-src"]),
    ],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const success = result.items.find((row) => row.item.id === "success")!;
  assertEquals(success.correspondence, "unresolved");
  assertEquals(
    success.gaps.some((item) => item.code === "correspondence.ambiguous"),
    true,
  );
  const current = success.requirements.find((item) =>
    item.traceArtifactId === "requirements-current"
  )!;
  const historical = success.requirements.find((item) =>
    item.traceArtifactId === "requirements-old"
  )!;
  assertEquals(current.origin, "native");
  assertEquals(current.applicability, "current");
  assertEquals(current.sourceBrief.snapshotId, brief.id);
  assertEquals(current.evaluations[0]!.status, "pass");
  assertEquals(current.evaluations[0]!.applicability, "current");
  assertEquals(historical.origin, "native");
  assertEquals(historical.applicability, "historical");
  assertEquals(historical.sourceState, "unchanged");
  assertEquals(historical.sourceBrief.snapshotId, "brief:historical");
  assertEquals(historical.evaluations[0]!.status, "pass");
  assertEquals(historical.evaluations[0]!.applicability, "historical");
});

Deno.test("documentary current pass is never a clause verdict", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([{
    status: "available",
    artifactId: "claim-doc",
    threadRequirementIds: ["requirement-doc"],
    origin: "documentary",
    sourceBrief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    requirementsArtifactId: "requirements-doc",
    declaration: {
      kind: "retrospective-documentary",
      linkedAt: AT,
      artifactId: "claim-doc",
      requirementsArtifactId: "requirements-doc",
      claimId: "claim:success",
      revision: 1,
    },
    requirements: [{
      threadRequirementId: "requirement-doc",
      requirementId: "maxDisplacement",
      sourceItemId: "success",
      sourceState: "unchanged",
    }],
  }], {
    requirements: [req("requirement-doc", "requirements-doc")],
    artifacts: [artifact("requirements-doc"), artifact("obs-src")],
    observations: [observation("obs-1", ["obs-src"])],
    evaluations: [
      evaluation("eval-doc", "requirement-doc", "pass", ["obs-1"], ["obs-src"]),
    ],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const success = result.items.find((row) => row.item.id === "success")!;
  assertEquals(success.correspondence, "documentary");
  assertEquals(success.requirements[0]!.origin, "documentary");
  assertEquals(success.requirements[0]!.applicability, "current");
  assertEquals(success.requirements[0]!.evaluations[0]!.status, "pass");
  assertEquals(success.requirements[0]!.evaluations[0]!.applicability, "current");
  assertEquals("pass" in success, false);
  assertEquals("complete" in success, false);
  assertEquals("ready" in success, false);
  assertEquals(result.status, "available");
});

Deno.test("TRACE GAP traces stay diagnostics and do not become item correspondence by label", async () => {
  const { project } = await approvedProject();
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([{
    status: "TRACE GAP",
    artifactId: "requirements-gap",
    threadRequirementIds: ["requirement-gap"],
  }]);
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  assertEquals(
    result.diagnostics.some((item) => item.code === "correspondence.trace-gap"),
    true,
  );
  assertEquals(
    result.items.every((row) => row.correspondence === "unresolved"),
    true,
  );
  assertEquals(
    result.items.every((row) => row.requirements.length === 0),
    true,
  );
});

Deno.test("same labels across different ids stay unresolved and do not join", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = factsWithTraces([{
    status: "available",
    artifactId: "requirements-other",
    threadRequirementIds: ["requirement-other"],
    origin: "native",
    sourceBrief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    requirementsArtifactId: "requirements-other",
    requirements: [{
      threadRequirementId: "requirement-other",
      requirementId: "maxDisplacement",
      sourceItemId: "success-other",
      sourceState: "unchanged",
    }],
  }]);
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const success = result.items.find((row) => row.item.id === "success")!;
  assertEquals(success.correspondence, "unresolved");
  assertEquals(success.requirements, []);
  assertEquals(
    success.gaps.some((item) => item.code === "correspondence.missing"),
    true,
  );
});

Deno.test("archived evaluation and missing or stale observation or artifact are not current", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts: ProjectResponseEvidenceFacts = {
    ...factsWithTraces([{
      status: "available",
      artifactId: "requirements-current",
      threadRequirementIds: ["requirement-live"],
      origin: "native",
      sourceBrief: {
        briefId: brief.briefId,
        snapshotId: brief.id,
        revision: brief.revision,
      },
      requirementsArtifactId: "requirements-current",
      requirements: [{
        threadRequirementId: "requirement-live",
        requirementId: "maxDisplacement",
        sourceItemId: "success",
        sourceState: "unchanged",
      }],
    }], {
      requirements: [req("requirement-live", "requirements-current")],
      artifacts: [
        artifact("requirements-current"),
        artifact("obs-src"),
        { ...artifact("stale-src"), freshness: { ...FRESH, status: "stale" } },
      ],
      observations: [
        observation("obs-missing-ref", ["obs-src"]),
        {
          ...observation("obs-stale", ["stale-src"]),
          freshness: { ...FRESH, status: "stale" },
        },
      ],
      evaluations: [
        evaluation("eval-archived", "requirement-live", "pass", ["obs-missing-ref"], [
          "obs-src",
        ]),
        evaluation("eval-missing", "requirement-live", "pass", ["obs-absent"], [
          "obs-src",
        ]),
        evaluation("eval-stale", "requirement-live", "pass", ["obs-stale"], [
          "stale-src",
        ]),
      ],
    }),
    archivedRefKeys: ["evaluation:eval-archived"],
  };
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const evaluations = result.items.find((row) => row.item.id === "success")!
    .requirements[0]!.evaluations;
  assertEquals(evaluations.map((item) => item.evaluationId), [
    "eval-missing",
    "eval-stale",
  ]);
  assertEquals(
    evaluations.find((item) => item.evaluationId === "eval-missing")!
      .applicability,
    "unresolved",
  );
  assertEquals(
    evaluations.find((item) => item.evaluationId === "eval-stale")!
      .applicability,
    "historical",
  );
  assertEquals(
    evaluations.find((item) => item.evaluationId === "eval-stale")!.status,
    "pass",
  );
});

Deno.test("a stale or failed requirement is historical even on the current brief", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = currentNativePassFacts(brief, {
    requirements: [{
      ...req("requirement-current-success", "requirements-current"),
      freshness: { ...FRESH, status: "failed" },
    }],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const success = result.items.find((row) => row.item.id === "success")!;
  const evaluation = success.requirements[0]!.evaluations[0]!;
  assertEquals(success.requirements[0]!.applicability, "current");
  assertEquals(evaluation.status, "pass");
  assertEquals(evaluation.applicability, "historical");
  assertEquals(
    success.gaps.some((item) => item.code === "evaluation.requirement-stale"),
    true,
  );
});

Deno.test("a stale or mismatched requirements source artifact is historical even on the current brief", async () => {
  const { project } = await approvedProject();
  const brief = project.framing!.currentBrief!;
  const thread = listedThread(project, 1);
  const facts = currentNativePassFacts(brief, {
    artifacts: [
      { ...artifact("requirements-current"), consumptionMismatch: true },
      artifact("obs-src"),
    ],
  });
  const result = await usecase(facts).project({
    project: withThread(project, thread),
    thread,
  });
  const success = result.items.find((row) => row.item.id === "success")!;
  const evaluation = success.requirements[0]!.evaluations[0]!;
  assertEquals(success.requirements[0]!.applicability, "current");
  assertEquals(evaluation.status, "pass");
  assertEquals(evaluation.applicability, "historical");
  assertEquals(
    success.gaps.some((item) => item.code === "evaluation.artifact-stale"),
    true,
  );
});

Deno.test("pending replacement brief is never selected", async () => {
  const { project, store } = await approvedProject();
  const approvedId = project.framing!.currentBrief!.id;
  const pending = await store.get(project.project.id);
  const commands = new ProjectBriefCommandService(store, () => AT);
  const later = await commands.proposeBrief({
    kind: "agent",
    actorId: "agent:test",
  }, {
    commandId: "propose-2",
    projectId: pending!.project.id,
    expectedRevision: pending!.revision,
    issuedAt: AT,
    items: pending!.framing!.currentBrief!.items.map((item) =>
      item.id === "objective"
        ? { ...item, statement: "Pending replacement must not be selected." }
        : item
    ),
  });
  const result = await usecase().project({ project: later });
  assertEquals(result.status, "available");
  assertEquals(result.basis!.brief.snapshotId, approvedId);
  assertEquals(
    result.items.find((row) => row.item.id === "objective")!.item.statement,
    "Enumerate every approved brief item.",
  );
  assertEquals(later.framing!.proposedBrief!.id !== approvedId, true);
});

Deno.test("no approved brief and no project stay unavailable without a fabricated brief", async () => {
  const store = new MemoryProjectStore();
  const commands = new ProjectBriefCommandService(store, () => AT);
  const started = await commands.startProject({
    kind: "agent",
    actorId: "agent:test",
  }, {
    commandId: "start",
    projectId: "project-response-none",
    projectName: "None",
    issuedAt: AT,
    intent: "No approved brief.",
    intentSource: { kind: "human", reference: "conversation:none" },
  });
  const none = await usecase(undefined, store).project({ project: started });
  assertEquals(none.status, "unavailable");
  assertEquals(none.items, []);
  assertEquals(none.basis, undefined);
  assertEquals(none.diagnostics[0]!.code, "brief.unavailable");

  const missing = await usecase(undefined, store).read({
    projectId: "project-missing",
  });
  assertEquals(missing.status, "unavailable");
  assertEquals(missing.items, []);
});

Deno.test("approved brief without Thread enumerates items with missing-evidence gaps", async () => {
  const { project } = await approvedProject();
  const result = await usecase().project({ project });
  assertEquals(result.status, "available");
  assertEquals(result.basis!.thread, undefined);
  assertEquals(result.items.length, 8);
  assertEquals(
    result.items.every((row) =>
      row.gaps.some((item) => item.code === "evidence.missing")
    ),
    true,
  );
});

Deno.test("a declared but unreadable Thread stays unavailable in read and projection", async () => {
  const { project, store } = await approvedProject();
  const thread = listedThread(project, 2);
  const listed = withThread(project, thread);
  store.overlay = listed;
  const service = usecase(undefined, store);
  for (
    const result of [
      await service.read({ projectId: project.project.id }),
      await service.project({ project: listed }),
    ]
  ) {
    assertEquals(result.status, "unavailable");
    assertEquals(result.basis!.thread, undefined);
    assertEquals(result.items.length, project.framing!.currentBrief!.items.length);
    assertEquals(result.diagnostics.map((item) => item.code), ["thread.unavailable"]);
    assertEquals(result.grants, "none");
  }
});

Deno.test("read rejects a mismatched expected basis without mixing revisions", async () => {
  const { project, store } = await approvedProject();
  const thread = listedThread(project, 2);
  store.currentThread = thread;
  store.overlay = withThread(project, thread);
  const current = await usecase(undefined, store).read({
    projectId: project.project.id,
  });
  assertEquals(current.status, "available");
  const stale = await usecase(undefined, store).read({
    projectId: project.project.id,
    expectedBasis: {
      ...current.basis!,
      projectRevision: current.basis!.projectRevision + 1,
    } satisfies ProjectResponseBasis,
  });
  assertEquals(stale.status, "unavailable");
  assertEquals(stale.items, []);
  assertEquals(stale.basis, current.basis);
  assertEquals(stale.diagnostics[0]!.code, "basis.stale");
});

Deno.test("project uses the supplied Thread and never refetches a newer tip", async () => {
  const { project, store } = await approvedProject();
  const older = listedThread(project, 1);
  const newer = listedThread(project, 2);
  store.currentThread = newer;
  const listed = {
    ...project,
    threadSnapshots: [
      {
        snapshotId: older.id,
        revision: older.revision,
        subjectId: older.subject.id,
      },
      {
        snapshotId: newer.id,
        revision: newer.revision,
        subjectId: newer.subject.id,
      },
    ],
  };
  const snapshots: { get(id: string): Promise<ThreadSnapshot> } = {
    get() {
      throw new Error("project() must not refetch a Thread tip.");
    },
  };
  const result = await new ReadProjectResponse({
    projects: store,
    snapshots,
    evidence: new StubEvidence(),
  }).project({ project: listed, thread: older });
  assertEquals(result.status, "available");
  assertEquals(result.basis!.thread, {
    snapshotId: older.id,
    revision: 1,
    subjectId: older.subject.id,
  });
});

function usecase(
  facts?: ProjectResponseEvidenceFacts,
  store: MemoryProjectStore = new MemoryProjectStore(),
) {
  return new ReadProjectResponse({
    projects: store,
    snapshots: store.asSnapshots(),
    evidence: new StubEvidence(facts),
  });
}

class StubEvidence implements ProjectResponseEvidenceReader {
  readonly #facts: ProjectResponseEvidenceFacts;
  constructor(facts?: ProjectResponseEvidenceFacts) {
    this.#facts = facts ?? emptyProjectResponseEvidenceFacts();
  }
  read(): Promise<ProjectResponseEvidenceFacts> {
    return Promise.resolve(this.#facts);
  }
}

async function approvedProject(): Promise<{
  readonly project: EngineeringProjectSnapshot;
  readonly store: MemoryProjectStore;
}> {
  const store = new MemoryProjectStore();
  const commands = new ProjectBriefCommandService(store, () => AT);
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await commands.startProject(agent, {
    commandId: "start",
    projectId: "project-response",
    projectName: "Response fixture",
    issuedAt: AT,
    intent: "Enumerate every approved brief item.",
    intentSource: { kind: "human", reference: "conversation:response" },
  });
  project = await commands.proposeBrief(agent, {
    commandId: "propose",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Enumerate every approved brief item.",
      sourceRefs: [{ kind: "intent", reference: "conversation:response" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Inspect the recorded response index.",
      sourceRefs: [{ kind: "document", reference: "brief:mission" }],
    }, {
      id: "assumption",
      kind: "assumption",
      statement: "The operator can inspect the index.",
      sourceRefs: [{ kind: "document", reference: "brief:assumption" }],
      owner: "human:test",
      reviewTrigger: "Before manufacturing.",
    }, {
      id: "exclusion",
      kind: "exclusion",
      statement: "No outdoor use.",
      sourceRefs: [{ kind: "document", reference: "brief:exclusion" }],
    }, {
      id: "question",
      kind: "open-question",
      statement: "Which finish is required?",
      sourceRefs: [{ kind: "document", reference: "brief:question" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Displacement stays at or below 2 mm.",
      sourceRefs: [{ kind: "document", reference: "brief:limit" }],
      dependsOnItemIds: [],
    }, {
      id: "verify",
      kind: "verification-activity",
      statement: "Run the static proof.",
      sourceRefs: [{ kind: "document", reference: "brief:verify" }],
      dependsOnItemIds: ["success"],
    }, {
      id: "make",
      kind: "manufacturing-evidence",
      statement: "Printable on the reviewed printer.",
      sourceRefs: [{ kind: "document", reference: "brief:make" }],
    }],
  });
  project = await commands.approveBrief(human, {
    commandId: "approve",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Fixture approval.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  return { project, store };
}

function withThread(
  project: EngineeringProjectSnapshot,
  thread: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const listed = project.threadSnapshots.some((item) => item.snapshotId === thread.id)
    ? project.threadSnapshots
    : [...project.threadSnapshots, {
      snapshotId: thread.id,
      revision: thread.revision,
      subjectId: thread.subject.id,
    }];
  return { ...project, threadSnapshots: listed };
}

function listedThread(
  project: EngineeringProjectSnapshot,
  revision: number,
): ThreadSnapshot {
  return {
    id: `thread:response:r${revision}`,
    revision,
    subject: { id: project.project.subjectId },
  } as ThreadSnapshot;
}

function factsWithTraces(
  traces: ProjectResponseEvidenceFacts["traces"],
  extra: Partial<ProjectResponseEvidenceFacts> = {},
): ProjectResponseEvidenceFacts {
  return {
    traces,
    clauseResponses: extra.clauseResponses ?? [],
    requirements: extra.requirements ?? [],
    evaluations: extra.evaluations ?? [],
    observations: extra.observations ?? [],
    artifacts: extra.artifacts ?? [],
    archivedRefKeys: extra.archivedRefKeys ?? [],
    ...(extra.clauseResponseFailure
      ? { clauseResponseFailure: extra.clauseResponseFailure }
      : {}),
  };
}

function currentNativePassFacts(
  brief: { readonly briefId: string; readonly id: string; readonly revision: number },
  extra: Partial<ProjectResponseEvidenceFacts> = {},
): ProjectResponseEvidenceFacts {
  return factsWithTraces([{
    status: "available",
    artifactId: "requirements-current",
    threadRequirementIds: ["requirement-current-success"],
    origin: "native",
    sourceBrief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    requirementsArtifactId: "requirements-current",
    requirements: [{
      threadRequirementId: "requirement-current-success",
      requirementId: "maxDisplacement",
      sourceItemId: "success",
      sourceState: "unchanged",
    }],
  }], {
    requirements: extra.requirements ??
      [req("requirement-current-success", "requirements-current")],
    artifacts: extra.artifacts ??
      [artifact("requirements-current"), artifact("obs-src")],
    observations: extra.observations ??
      [observation("obs-current", ["obs-src"])],
    evaluations: extra.evaluations ?? [
      evaluation("eval-current", "requirement-current-success", "pass", [
        "obs-current",
      ], ["obs-src"]),
    ],
    archivedRefKeys: extra.archivedRefKeys,
  });
}

function req(id: string, sourceArtifactId: string) {
  return { id, sourceArtifactId, freshness: FRESH };
}

function artifact(id: string) {
  return { id, freshness: FRESH, consumptionMismatch: false };
}

function observation(id: string, sourceArtifactIds: readonly string[]) {
  return { id, sourceArtifactIds, freshness: FRESH };
}

function evaluation(
  id: string,
  requirementId: string,
  status: "pass" | "fail" | "unresolved" | "error",
  observationIds: readonly string[],
  evidenceArtifactIds: readonly string[],
) {
  return {
    id,
    requirementId,
    status,
    observationIds,
    evidenceArtifactIds,
    evaluatedAt: AT,
    freshness: FRESH,
  };
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  #current: EngineeringProjectSnapshot | undefined;
  #revisions = new Map<number, EngineeringProjectSnapshot>();
  overlay: EngineeringProjectSnapshot | undefined;
  currentThread: ThreadSnapshot | undefined;

  get(
    _projectId?: string,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const value = this.overlay ?? this.#current;
    return Promise.resolve(value && structuredClone(value));
  }

  getRevision(
    _projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const value = this.#revisions.get(revision);
    return Promise.resolve(value && structuredClone(value));
  }

  asSnapshots(): { get(snapshotId: string): Promise<ThreadSnapshot | undefined> } {
    return {
      get: (snapshotId) => this.getSnapshot(snapshotId),
    };
  }

  getSnapshot(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    if (this.currentThread?.id === snapshotId) {
      return Promise.resolve(this.currentThread);
    }
    return Promise.resolve(undefined);
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    this.#current = structuredClone(snapshot);
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#current?.revision !== expectedRevision) {
      return Promise.reject(new Error("CAS failed."));
    }
    this.#current = structuredClone(snapshot);
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}
