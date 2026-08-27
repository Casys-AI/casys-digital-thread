import { assertEquals, assertStringIncludes } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import {
  activityReviewStatus,
  activityReviewStatusLabel,
  buildActivityReviewRecords,
  buildProjectProofSummary,
  buildProjectReviewRecords,
  currentProjectReview,
  projectReviewOwner,
  publishedRequirementEvaluationDetail,
  publishedRequirementTargetCount,
} from "./src/project/review-decision-model.ts";
import type { ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const HEX_D = "d".repeat(64);
const HEX_E = "e".repeat(64);
const HEX_F = "f".repeat(64);

Deno.test("the pending brief is reviewed without replacing the approved brief record", () => {
  const project = projectSnapshot();
  const records = buildProjectReviewRecords(project);
  const brief = records[0]!;
  assertEquals(brief.id, "brief");
  assertEquals(brief.state, "needs-review");
  assertEquals(brief.representation, "proposal");
  assertEquals(currentProjectReview(records)?.id, "brief");
  assertEquals(project.framing?.currentBrief?.revision, 1);
  if (brief.preview.kind === "brief") {
    assertEquals(brief.preview.brief.revision, 2);
  }
});

Deno.test("a rejected revision surfaces while the approved brief stays in force", () => {
  const project = projectSnapshot();
  const records = buildProjectReviewRecords({
    ...project,
    framing: {
      ...project.framing!,
      proposalReview: {
        ...project.framing!.proposalReview!,
        status: "rejected",
        decidedAt: "2026-08-02T01:00:00.000Z",
        decidedBy: { id: "reviewer", origin: "human" },
        rationale: "Correct the scope.",
      },
    },
  });
  const brief = records[0]!;

  assertEquals(brief.state, "revision-requested");
  assertEquals(brief.representation, "record");
  assertEquals(
    brief.title,
    "Approved engineering brief · revision requested",
  );
  assertEquals(
    brief.question,
    "A proposed revision was rejected; the approved brief remains in force.",
  );
  assertEquals(
    brief.summary,
    "A correction was requested. This record does not prove that an agent run is active.",
  );
  assertEquals(brief.outcome, {
    rationale: "Correct the scope.",
    decidedBy: "reviewer",
    decidedAt: "2026-08-02T01:00:00.000Z",
  });
  if (brief.preview.kind === "brief") {
    assertEquals(brief.preview.brief.revision, 1);
  }
});

Deno.test("a canonical decision outcome exposes its recorded rationale, actor and time", () => {
  const project = projectSnapshot();
  const architecture = project.decisions.find((decision) =>
    decision.id === "decision-architecture"
  )!;
  const record = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((decision) =>
      decision.id === architecture.id
        ? {
          ...decision,
          status: "approved" as const,
          approvalIds: ["approval-architecture"],
        }
        : decision
    ),
    approvals: [{
      id: "approval-architecture",
      decisionId: architecture.id,
      status: "approved",
      requestedAt: "2026-08-03T00:00:00.000Z",
      decidedAt: "2026-08-03T01:00:00.000Z",
      decidedBy: "reviewer-1",
      rationale: "The exact architecture matches the intended product.",
      inputEvidenceRefs: [],
    }],
  }).find((candidate) => candidate.id === "architecture")!;

  assertEquals(record.outcome, {
    rationale: "The exact architecture matches the intended product.",
    decidedBy: "reviewer-1",
    decidedAt: "2026-08-03T01:00:00.000Z",
  });
});

Deno.test("a rejected initial brief keeps the exact proposal without inventing an approval", () => {
  const project = projectSnapshot();
  const {
    currentBrief: _currentBrief,
    currentBriefApproval: _currentBriefApproval,
    ...framing
  } = project.framing!;
  const brief = buildProjectReviewRecords({
    ...project,
    framing: {
      ...framing,
      proposalReview: {
        ...framing.proposalReview!,
        status: "rejected",
        decidedAt: "2026-08-02T01:00:00.000Z",
        decidedBy: { id: "reviewer", origin: "human" },
        rationale: "Correct the initial scope.",
      },
    },
  })[0]!;

  assertEquals(brief.state, "revision-requested");
  assertEquals(brief.title, "Engineering brief proposal · revision requested");
  assertEquals(
    brief.question,
    "The initial proposal was rejected; no approved brief is in force.",
  );
  assertEquals(
    brief.summary,
    "A correction was requested. No approved brief or active agent work is implied.",
  );
  if (brief.preview.kind === "brief") {
    assertEquals(brief.preview.brief.revision, 2);
  }
});

Deno.test("architecture and requirements proposals become typed business previews", () => {
  const records = buildProjectReviewRecords(projectSnapshot());
  const architecture = records.find((record) => record.id === "architecture")!;
  const requirements = records.find((record) => record.id === "requirements")!;
  assertEquals(architecture.preview.kind, "architecture");
  if (architecture.preview.kind === "architecture") {
    assertEquals(architecture.preview.value.system.name, "DeskLamp");
    assertEquals(architecture.preview.value.components[0]?.usageName, "base");
  }
  assertEquals(requirements.preview.kind, "requirements");
  if (requirements.preview.kind === "requirements") {
    assertEquals(requirements.preview.value.containerComponent, "DeskLamp");
    assertEquals(requirements.preview.value.requirements[0]?.metric, "height");
  }
});

Deno.test("a replayed proposal exposes only its exact current pending approval", () => {
  const project = projectSnapshot();
  const fingerprint = { algorithm: "sha256" as const, digest: HEX_A };
  const decision = project.decisions.find((candidate) =>
    candidate.id === "decision-architecture"
  )!;
  const record = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((candidate) =>
      candidate.id === decision.id
        ? {
          ...candidate,
          inputFingerprint: fingerprint,
          approvalIds: ["approval-old", "approval-current"],
        }
        : candidate
    ),
    approvals: [{
      id: "approval-old",
      decisionId: decision.id,
      status: "rejected",
      requestedAt: "2026-08-03T00:00:00.000Z",
      decidedAt: "2026-08-03T00:30:00.000Z",
      decidedBy: "reviewer-1",
      rationale: "Revise it.",
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
    }, {
      id: "approval-current",
      decisionId: decision.id,
      status: "pending",
      requestedAt: "2026-08-03T01:00:00.000Z",
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
    }],
  }).find((candidate) => candidate.id === "architecture")!;

  assertEquals(record.state, "needs-review");
  assertEquals(record.approvalId, "approval-current");
});

Deno.test("a duplicate decision parameter makes the preview unavailable", () => {
  const project = projectSnapshot();
  const architecture = project.decisions.find((decision) =>
    decision.id === "decision-architecture"
  )!;
  const duplicate = {
    ...architecture,
    proposal: {
      ...architecture.proposal!,
      parameters: [...architecture.proposal!.parameters, {
        key: "system.name",
        label: "Duplicate",
        value: "OtherSystem",
      }],
    },
  };
  const records = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((decision) =>
      decision.id === duplicate.id ? duplicate : decision
    ),
  });
  const preview = records.find((record) => record.id === "architecture")!.preview;
  assertEquals(preview.kind, "unavailable");
  if (preview.kind === "unavailable") {
    assertStringIncludes(preview.reason, "Duplicate proposal parameter");
  }
});

Deno.test("a published geometry review resolves its viewer to sealed thread bytes", () => {
  const project = projectSnapshot({ publishedGeometry: true });
  const records = buildProjectReviewRecords(
    project,
    threadWithEvidence("geometry-artifact"),
  );
  const geometry = records.find((record) => record.id === "geometry")!;
  assertEquals(geometry.state, "published");
  assertEquals(geometry.representation, "published-result");
  assertEquals(geometry.preview.kind, "geometry");
  if (geometry.preview.kind === "geometry") {
    assertEquals(geometry.preview.assetPath, `/api/thread/assets/${HEX_A}.glb`);
  }
});

Deno.test("a completed lot stays distinct from unresolved global proof", () => {
  const project = projectSnapshot({ publishedGeometry: true });
  const geometry = buildProjectReviewRecords(project, threadSnapshot()).find((
    record,
  ) => record.id === "geometry")!;
  const proof = buildProjectProofSummary(threadSnapshot());
  assertEquals(geometry.state, "published");
  assertEquals(proof.status, "unresolved");
  assertEquals(proof.unresolvedCount, 1);
});

Deno.test("global proof reports failed and unevaluated requirements together", () => {
  const thread = threadSnapshot();
  const proof = buildProjectProofSummary({
    ...thread,
    requirements: [
      thread.requirements[0]!,
      {
        ...thread.requirements[0]!,
        id: "width",
        label: "Width",
        status: "fail",
        rationale: "The measured width exceeds its target.",
      },
    ],
  });

  assertEquals(proof.unresolvedCount, 1);
  assertEquals(proof.failedCount, 1);
  assertEquals(
    proof.detail,
    "1 requirement currently fails. 1 requirement still awaits measured evaluation.",
  );
});

Deno.test("published requirement count comes from its signed typed preview", () => {
  const record = buildProjectReviewRecords(
    projectSnapshot({ publishedRequirements: true }),
    threadSnapshot(),
  ).find((candidate) => candidate.id === "requirements")!;
  const thread = threadSnapshot();
  const currentProof = buildProjectProofSummary({
    ...thread,
    requirements: [
      thread.requirements[0]!,
      { ...thread.requirements[0]!, id: "width", label: "Width" },
    ],
  });

  assertEquals(record.representation, "published-result");
  assertEquals(publishedRequirementTargetCount(record), 1);
  assertEquals(currentProof.requirementCount, 2);
});

Deno.test("a published target reports unavailable evaluation evidence instead of zero unresolved", () => {
  const record = buildProjectReviewRecords(
    projectSnapshot({ publishedRequirements: true }),
  ).find((candidate) => candidate.id === "requirements")!;
  const proof = buildProjectProofSummary(undefined);

  assertEquals(proof.status, "not-declared");
  assertEquals(proof.unresolvedCount, 0);
  assertEquals(
    publishedRequirementEvaluationDetail(record, proof),
    "1 signed target · evaluation unavailable in current thread · target count does not imply measurement",
  );
});

Deno.test("published target status reports every available current evaluation bucket", () => {
  const record = buildProjectReviewRecords(
    projectSnapshot({ publishedRequirements: true }),
  ).find((candidate) => candidate.id === "requirements")!;
  const thread = threadSnapshot();
  const proof = buildProjectProofSummary({
    ...thread,
    requirements: [
      { ...thread.requirements[0]!, status: "pass" },
      { ...thread.requirements[0]!, id: "width", status: "fail" },
      { ...thread.requirements[0]!, id: "mass", status: "unresolved" },
    ],
  });

  assertEquals(
    publishedRequirementEvaluationDetail(record, proof),
    "1 signed target · current-thread evaluations: 1 passing, 1 failing, 1 awaiting measurement · target count does not imply coverage",
  );
});

Deno.test("Activity exposes one waiting state and two human review outcomes", () => {
  const proposed = buildProjectReviewRecords(projectSnapshot()).find((record) =>
    record.id === "architecture"
  )!;
  const project = projectSnapshot();
  const rejected = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((decision) =>
      decision.id === "decision-architecture"
        ? { ...decision, status: "rejected" as const }
        : decision
    ),
  }).find((record) => record.id === "architecture")!;
  const published = buildProjectReviewRecords(
    projectSnapshot({ publishedRequirements: true }),
  ).find((record) => record.id === "requirements")!;

  assertEquals(activityReviewStatus(proposed), "to-review");
  assertEquals(activityReviewStatus(rejected), "revision-requested");
  assertEquals(activityReviewStatus(published), "validated");
  assertEquals(activityReviewStatusLabel("to-review"), "To review");
  assertEquals(activityReviewStatusLabel("validated"), "Validated");
  assertEquals(
    activityReviewStatusLabel("revision-requested"),
    "Revision requested",
  );
});

Deno.test("Activity preserves successive geometry reviews with unique stable anchors", () => {
  const project = projectSnapshot({ publishedGeometry: true });
  const geometryWork = project.workItems.find((item) => item.id === "geometry")!;
  const geometryDecision = project.decisions.find((decision) =>
    decision.id === "decision-geometry"
  )!;
  const activity = buildActivityReviewRecords({
    ...project,
    workItems: [...project.workItems, {
      ...geometryWork,
      id: "geometry-v2",
      title: "geometry-v2",
      decisionIds: ["decision-geometry-v2"],
      evidenceRefs: [{
        snapshotId: "thread:r6",
        snapshotRevision: 6,
        kind: "artifact",
        id: "geometry-v2-artifact",
      }],
    }],
    decisions: [...project.decisions, {
      ...geometryDecision,
      id: "decision-geometry-v2",
      title: "geometry-v2",
      requestedAt: "2026-08-04T00:00:00.000Z",
      proposal: {
        ...geometryDecision.proposal!,
        proposedAt: "2026-08-04T00:00:00.000Z",
      },
    }],
  }).filter((record) => record.id === "geometry");

  assertEquals(activity.length, 2);
  assertEquals(new Set(activity.map((record) => record.anchorId)).size, 2);
  assertEquals(
    activity.find((record) => record.decision?.id === "decision-geometry-v2")
      ?.anchorId,
    "review-geometry",
  );
  assertEquals(
    activity.find((record) => record.decision?.id === "decision-geometry")
      ?.anchorId,
    "review-geometry-history-decision-geometry",
  );
});

Deno.test("Activity keeps the approved brief when a separate revision waits for review", () => {
  const briefs = buildActivityReviewRecords(projectSnapshot()).filter((
    record,
  ) => record.id === "brief");

  assertEquals(briefs.length, 2);
  assertEquals(briefs.map((record) => record.state), [
    "published",
    "needs-review",
  ]);
  assertEquals(new Set(briefs.map((record) => record.anchorId)).size, 2);
  assertEquals(
    briefs.find((record) => record.state === "needs-review")?.anchorId,
    "review-brief",
  );
});

Deno.test("settled Activity records route to their owning surface", () => {
  assertEquals(projectReviewOwner("brief"), "project");
  assertEquals(projectReviewOwner("requirements"), "project");
  assertEquals(projectReviewOwner("architecture"), "product");
  assertEquals(projectReviewOwner("geometry"), "product");
});

Deno.test("a historical published geometry keeps its signed proposal preview without calling it sealed", () => {
  const project = projectSnapshot({ publishedGeometry: true });
  const withoutCapture = buildProjectReviewRecords(project, threadSnapshot())
    .find((record) => record.id === "geometry")!;
  assertEquals(withoutCapture.state, "published");
  assertEquals(withoutCapture.resultEvidence, undefined);
  if (withoutCapture.preview.kind === "geometry") {
    assertEquals(
      withoutCapture.preview.assetPath,
      `/api/draft-assets/${HEX_A}`,
    );
    assertEquals(withoutCapture.preview.assetAuthority, "proposal");
  }

  const baseThread = threadSnapshot();
  const withCapture = buildProjectReviewRecords(project, {
    ...baseThread,
    graph: {
      nodes: [{
        id: "graph:artifact:geometry-artifact",
        ref: { kind: "artifact", id: "geometry-artifact" },
        entityKind: "artifact",
        artifactKind: "step",
        label: "Published geometry",
        system: "build123d-sandbox",
        freshness: "fresh",
        summary: "Exact published capture",
      }],
      edges: [],
    },
  }).find((record) => record.id === "geometry")!;
  assertEquals(withCapture.resultEvidence?.id, "geometry-artifact");
});

Deno.test("Activity marks an exact published geometry predecessor as superseded by its signed successor", () => {
  const base = projectSnapshot({ publishedGeometry: true });
  const oldWork = base.workItems.find((item) => item.id === "geometry")!;
  const oldDecision = base.decisions.find((decision) =>
    decision.id === "decision-geometry"
  )!;
  const predecessorId = `geometry-${HEX_C}`;
  const project: EngineeringProjectSnapshot = {
    ...base,
    workItems: [
      ...base.workItems.filter((item) => item.id !== "geometry"),
      {
        ...oldWork,
        id: "geometry-v1",
        title: "Legacy geometry",
        evidenceRefs: [{
          snapshotId: "thread:r5",
          snapshotRevision: 5,
          kind: "artifact",
          id: predecessorId,
        }],
      },
      {
        ...oldWork,
        id: "geometry-v2",
        title: "Independent geometry bundle",
        decisionIds: ["decision-geometry-v2"],
        evidenceRefs: [{
          snapshotId: "thread:r6",
          snapshotRevision: 6,
          kind: "artifact",
          id: `geometry-${HEX_D}`,
        }],
      },
    ],
    decisions: [...base.decisions, {
      ...oldDecision,
      id: "decision-geometry-v2",
      title: "Independent geometry bundle",
      requestedAt: "2026-08-04T00:00:00.000Z",
      proposal: {
        ...oldDecision.proposal!,
        parameters: geometryV2Parameters({
          artifactId: predecessorId,
          digest: HEX_C,
        }),
        proposedAt: "2026-08-04T00:00:00.000Z",
      },
    }],
  };

  const geometry = buildActivityReviewRecords(project).filter((record) =>
    record.id === "geometry"
  );
  const legacy = geometry.find((record) =>
    record.decision?.id === "decision-geometry"
  )!;
  const current = geometry.find((record) =>
    record.decision?.id === "decision-geometry-v2"
  )!;

  assertEquals(legacy.supersededBy, {
    decisionId: "decision-geometry-v2",
    title: "Independent geometry bundle",
    href: "#work/review/geometry",
  });
  assertEquals(current.supersededBy, undefined);
});

Deno.test("an unapproved geometry successor cannot supersede a validated predecessor", () => {
  const base = projectSnapshot({ publishedGeometry: true });
  const oldWork = base.workItems.find((item) => item.id === "geometry")!;
  const oldDecision = base.decisions.find((decision) =>
    decision.id === "decision-geometry"
  )!;
  const predecessorId = `geometry-${HEX_C}`;
  const activity = buildActivityReviewRecords({
    ...base,
    workItems: [
      ...base.workItems.filter((item) => item.id !== "geometry"),
      {
        ...oldWork,
        id: "geometry-v1",
        evidenceRefs: [{
          snapshotId: "thread:r5",
          snapshotRevision: 5,
          kind: "artifact",
          id: predecessorId,
        }],
      },
      {
        ...oldWork,
        id: "geometry-v2",
        status: "waiting-for-decision",
        decisionIds: ["decision-geometry-v2"],
        evidenceRefs: [],
      },
    ],
    decisions: [...base.decisions, {
      ...oldDecision,
      id: "decision-geometry-v2",
      status: "proposed",
      proposal: {
        ...oldDecision.proposal!,
        parameters: geometryV2Parameters({
          artifactId: predecessorId,
          digest: HEX_C,
        }),
      },
    }],
  }).find((record) => record.decision?.id === "decision-geometry")!;

  assertEquals(activity.supersededBy, undefined);
});

Deno.test("a sealed v2 review resolves four exact PartDefinition STEP assets", () => {
  const base = projectSnapshot({ publishedGeometry: true });
  const geometryDecision = base.decisions.find((decision) =>
    decision.id === "decision-geometry"
  )!;
  const partDigests = [HEX_C, HEX_D, HEX_E, HEX_F];
  const thread = threadWithEvidence("geometry-artifact");
  const v2Thread = {
    ...thread,
    artifacts: [
      ...thread.artifacts,
      ...partDigests.map((digest, index) => ({
        id: `part-${index}`,
        label: `Part ${index}`,
        kind: "step" as const,
        system: "build123d-sandbox",
        revision: digest,
        freshness: "fresh" as const,
        fingerprint: `sha256:${digest}`,
        uri: `/api/thread/assets/${digest}.step`,
        dependsOn: [],
      })),
    ],
  } as ThreadWorkbenchSnapshot;
  const record = buildProjectReviewRecords({
    ...base,
    decisions: base.decisions.map((decision) =>
      decision.id === geometryDecision.id
        ? {
          ...geometryDecision,
          proposal: {
            ...geometryDecision.proposal!,
            parameters: geometryV2Parameters(),
          },
        }
        : decision
    ),
  }, v2Thread).find((candidate) => candidate.id === "geometry")!;

  if (record.preview.kind !== "geometry") {
    throw new Error("expected geometry preview");
  }
  assertEquals(record.preview.partAssets.length, 4);
  assertEquals(
    record.preview.partAssets.map((asset) => asset.path),
    partDigests.map((digest) => `/api/thread/assets/${digest}.step`),
  );
  assertEquals(
    record.preview.partAssets.every((asset) => asset.authority === "sealed"),
    true,
  );
});

Deno.test("a sealed target PartDefinition review resolves its exact STEP and primary GLB", () => {
  const base = projectSnapshot({ publishedGeometry: true });
  const geometryDecision = base.decisions.find((decision) =>
    decision.id === "decision-geometry"
  )!;
  const stepDigest = HEX_C;
  const glbDigest = HEX_D;
  const thread = threadWithEvidence("geometry-artifact");
  const targetThread = {
    ...thread,
    artifacts: [
      ...thread.artifacts,
      {
        id: "target-step",
        label: "Target STEP",
        kind: "step" as const,
        system: "build123d-sandbox",
        revision: stepDigest,
        freshness: "fresh" as const,
        fingerprint: `sha256:${stepDigest}`,
        uri: `/api/thread/assets/${stepDigest}.step`,
        dependsOn: [],
      },
      {
        id: "target-glb",
        label: "Target GLB",
        kind: "cad-model" as const,
        system: "build123d-sandbox",
        revision: glbDigest,
        freshness: "fresh" as const,
        fingerprint: `sha256:${glbDigest}`,
        uri: `/api/thread/assets/${glbDigest}.glb`,
        dependsOn: [],
      },
    ],
  } as ThreadWorkbenchSnapshot;
  const record = buildProjectReviewRecords({
    ...base,
    decisions: base.decisions.map((decision) =>
      decision.id === geometryDecision.id
        ? {
          ...geometryDecision,
          proposal: {
            ...geometryDecision.proposal!,
            parameters: targetPartGeometryParameters(stepDigest, glbDigest),
          },
        }
        : decision
    ),
  }, targetThread).find((candidate) => candidate.id === "geometry")!;

  if (record.preview.kind !== "geometry") {
    throw new Error("expected geometry preview");
  }
  assertEquals(record.preview.assetAuthority, "sealed");
  assertEquals(
    record.preview.assetPath,
    `/api/thread/assets/${glbDigest}.glb`,
  );
  assertEquals(
    record.preview.partAssets.map((asset) => asset.path),
    [
      `/api/thread/assets/${stepDigest}.step`,
      `/api/thread/assets/${glbDigest}.glb`,
    ],
  );
  assertEquals(
    record.preview.partAssets.every((asset) => asset.authority === "sealed"),
    true,
  );
});

Deno.test("a sealed v2 review exposes exact GLB paths without replacing authoritative STEP assets", () => {
  const base = projectSnapshot({ publishedGeometry: true });
  const geometryDecision = base.decisions.find((decision) =>
    decision.id === "decision-geometry"
  )!;
  const stepDigests = [HEX_C, HEX_D, HEX_E, HEX_F];
  const glbDigests = ["6", "7", "8", "9"].map((digit) => digit.repeat(64));
  const thread = threadWithEvidence("geometry-artifact");
  const v2Thread = {
    ...thread,
    artifacts: [
      ...thread.artifacts,
      ...stepDigests.map((digest, index) => ({
        id: `part-step-${index}`,
        label: `Part ${index} STEP`,
        kind: "step" as const,
        system: "build123d-sandbox",
        revision: digest,
        freshness: "fresh" as const,
        fingerprint: `sha256:${digest}`,
        uri: `/api/thread/assets/${digest}.step`,
        dependsOn: [],
      })),
      ...glbDigests.map((digest, index) => ({
        id: `part-glb-${index}`,
        label: `Part ${index} GLB`,
        kind: "cad-model" as const,
        system: "build123d-sandbox",
        revision: digest,
        freshness: "fresh" as const,
        fingerprint: `sha256:${digest}`,
        uri: `/api/thread/assets/${digest}.glb`,
        dependsOn: [],
      })),
    ],
  } as ThreadWorkbenchSnapshot;
  const record = buildProjectReviewRecords({
    ...base,
    decisions: base.decisions.map((decision) =>
      decision.id === geometryDecision.id
        ? {
          ...geometryDecision,
          proposal: {
            ...geometryDecision.proposal!,
            parameters: geometryV2Parameters(undefined, true),
          },
        }
        : decision
    ),
  }, v2Thread).find((candidate) => candidate.id === "geometry")!;

  if (record.preview.kind !== "geometry") {
    throw new Error("expected geometry preview");
  }
  const stepAssets = record.preview.partAssets.filter((asset) =>
    asset.format === "step"
  );
  const glbAssets = record.preview.partAssets.filter((asset) =>
    asset.format === "gltf"
  );
  assertEquals(stepAssets.length, 4);
  assertEquals(
    stepAssets.map((asset) => asset.path),
    stepDigests.map((digest) => `/api/thread/assets/${digest}.step`),
  );
  assertEquals(glbAssets.length, 4);
  assertEquals(
    glbAssets.map((asset) => asset.path),
    glbDigests.map((digest) => `/api/thread/assets/${digest}.glb`),
  );
  assertEquals(
    glbAssets.every((asset) => asset.authority === "sealed"),
    true,
  );
});

function projectSnapshot(
  options: {
    publishedGeometry?: boolean;
    publishedRequirements?: boolean;
  } = {},
): EngineeringProjectSnapshot {
  const brief = (revision: number) => ({
    briefId: "brief",
    id: `brief:r${revision}`,
    revision,
    items: [{
      id: `objective-${revision}`,
      kind: "objective" as const,
      statement: `Objective ${revision}`,
      sourceRefs: [{ kind: "intent" as const, reference: "conversation" }],
    }],
    proposedAt: `2026-08-0${revision}T00:00:00.000Z`,
    proposedBy: { id: "agent", origin: "agent" as const },
  });
  const work = (
    id: string,
    operationId: string,
    decisionIds: string[],
    published = false,
  ) => ({
    id,
    activityId: `activity:${id}`,
    phaseId: id,
    title: id,
    description: id,
    kind: "architect" as const,
    operation: { id: operationId, version: "1", bindings: [] },
    status: published ? "completed" as const : "waiting-for-decision" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: published
      ? [{
        snapshotId: "thread:r5",
        snapshotRevision: 5,
        kind: "artifact" as const,
        id: `${id}-artifact`,
      }]
      : [],
    decisionIds,
    blockerIds: [],
  });
  const proposal = (
    id: string,
    parameters: Array<{
      key: string;
      label: string;
      value: string | number | boolean;
      unit?: string;
    }>,
  ) => ({
    id,
    phaseId: id,
    title: id,
    question: `${id}?`,
    status: (options.publishedGeometry && id === "decision-geometry") ||
        (options.publishedRequirements && id === "decision-requirements")
      ? "approved" as const
      : "proposed" as const,
    requestedAt: "2026-08-03T00:00:00.000Z",
    inputEvidenceRefs: [],
    approvalIds: [],
    proposal: {
      summary: id,
      parameters,
      proposedAt: "2026-08-03T00:00:00.000Z",
      proposedBy: { id: "agent", origin: "agent" as const },
    },
  });
  return {
    schemaVersion: "4.0",
    id: "project:r1",
    revision: 1,
    generatedAt: "2026-08-03T00:00:00.000Z",
    project: {
      id: "project",
      name: "Project",
      subjectId: "subject",
      objective: { title: "Project", statement: "Project" },
    },
    framing: {
      intent: {
        statement: "Intent",
        source: { kind: "human", reference: "conversation" },
        capturedAt: "2026-08-01T00:00:00.000Z",
        capturedBy: { id: "agent", origin: "agent" },
      },
      questions: [],
      answers: [],
      currentBrief: brief(1),
      currentBriefApproval: {
        briefSnapshotId: "brief:r1",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: { algorithm: "sha256", digest: HEX_C },
        requestedAt: "2026-08-01T00:00:00.000Z",
      },
      proposedBrief: brief(2),
      proposalReview: {
        briefSnapshotId: "brief:r2",
        briefRevision: 2,
        status: "pending",
        inputFingerprint: { algorithm: "sha256", digest: HEX_B },
        requestedAt: "2026-08-02T00:00:00.000Z",
      },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [
      work("baseline", "baseline.from-approved-brief", [], true),
      work("architecture", "model.write-architecture", [
        "decision-architecture",
      ]),
      work(
        "requirements",
        "model.write-requirements",
        ["decision-requirements"],
        options.publishedRequirements,
      ),
      work(
        "geometry",
        "design.write-geometry",
        ["decision-geometry"],
        options.publishedGeometry,
      ),
    ],
    agentRuns: [],
    decisions: [
      proposal("decision-architecture", [
        { key: "architecture.package", label: "Package", value: "LampPackage" },
        { key: "system.name", label: "System", value: "DeskLamp" },
        { key: "component.base.name", label: "Name", value: "WeightedBase" },
        { key: "component.base.usage", label: "Usage", value: "base" },
      ]),
      proposal("decision-requirements", [
        {
          key: "requirements.containerComponent",
          label: "Target",
          value: "DeskLamp",
        },
        { key: "requirement.height.name", label: "Name", value: "Height" },
        { key: "requirement.height.metric", label: "Metric", value: "height" },
        { key: "requirement.height.operator", label: "Operator", value: "<=" },
        {
          key: "requirement.height.threshold",
          label: "Threshold",
          value: 450,
          unit: "mm",
        },
      ]),
      proposal("decision-geometry", geometryParameters()),
    ],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as EngineeringProjectSnapshot;
}

function geometryParameters() {
  return Object.entries({
    "geometry.draft.digest": HEX_C,
    "geometry.manifest.schemaVersion": "geometry-manifest/1.0",
    "geometry.manifest.architectureBasis.snapshotId": "thread:r4",
    "geometry.manifest.architectureBasis.revision": 4,
    "geometry.manifest.architectureBasis.artifactFingerprint": HEX_B,
    "geometry.manifest.unitSystem": "mm",
    "geometry.manifest.exportFormats": "gltf,step",
    "geometry.manifest.scriptHash": HEX_C,
    "geometry.manifest.assemblyFiles.count": 1,
    "geometry.manifest.assemblyFiles.0.format": "gltf",
    "geometry.manifest.assemblyFiles.0.name": "assembly",
    "geometry.manifest.assemblyFiles.0.fingerprint": HEX_A,
    "geometry.manifest.components.count": 0,
    "geometry.manifest.partMeshes.count": 0,
  }).map(([key, value]) => ({ key, label: key, value }));
}

function targetPartGeometryParameters(stepDigest: string, glbDigest: string) {
  return Object.entries({
    "geometry.draft.digest": HEX_F,
    "geometry.manifest.schemaVersion": "geometry-part-manifest/1.0",
    "geometry.manifest.architectureBasis.snapshotId": "thread:r6",
    "geometry.manifest.architectureBasis.revision": 6,
    "geometry.manifest.architectureBasis.artifactFingerprint": HEX_B,
    "geometry.manifest.predecessor.present": false,
    "geometry.manifest.unitSystem": "mm",
    "geometry.manifest.exportFormats": "step,gltf",
    "geometry.manifest.target.partDefinitionElementId": "partdef:arm",
    "geometry.manifest.target.label": "Lamp arm",
    "geometry.manifest.target.scriptHash": HEX_A,
    "geometry.manifest.target.files.count": 2,
    "geometry.manifest.target.files.0.format": "step",
    "geometry.manifest.target.files.0.name": "lamp-arm",
    "geometry.manifest.target.files.0.fingerprint": stepDigest,
    "geometry.manifest.target.files.1.format": "gltf",
    "geometry.manifest.target.files.1.name": "lamp-arm",
    "geometry.manifest.target.files.1.fingerprint": glbDigest,
  }).map(([key, value]) => ({ key, label: key, value }));
}

function geometryV2Parameters(
  predecessor?: { artifactId: string; digest: string },
  includePartGlb = false,
) {
  const digests = [HEX_C, HEX_D, HEX_E, HEX_F];
  const glbDigests = ["6", "7", "8", "9"].map((digit) => digit.repeat(64));
  const entries: Array<[string, string | number | boolean]> = [
    ["geometry.draft.digest", HEX_F],
    ["geometry.manifest.schemaVersion", "geometry-manifest/2.0"],
    ["geometry.manifest.architectureBasis.snapshotId", "thread:r5"],
    ["geometry.manifest.architectureBasis.revision", 5],
    ["geometry.manifest.architectureBasis.artifactFingerprint", HEX_B],
    ["geometry.manifest.unitSystem", "mm"],
    ["geometry.manifest.exportFormats", "step,gltf"],
    ["geometry.manifest.scriptHash", HEX_A],
    ["geometry.manifest.assemblyFiles.count", 2],
    ["geometry.manifest.assemblyFiles.0.format", "step"],
    ["geometry.manifest.assemblyFiles.0.name", "assembly"],
    ["geometry.manifest.assemblyFiles.0.fingerprint", "0".repeat(64)],
    ["geometry.manifest.assemblyFiles.1.format", "gltf"],
    ["geometry.manifest.assemblyFiles.1.name", "assembly"],
    ["geometry.manifest.assemblyFiles.1.fingerprint", "1".repeat(64)],
    ["geometry.manifest.components.count", 4],
    ["geometry.manifest.predecessor.present", predecessor !== undefined],
    [
      "geometry.manifest.placementConvention",
      "right-handed-mm-extrinsic-xyz-degrees",
    ],
    [
      "geometry.manifest.partExportFormats",
      includePartGlb ? "step,gltf" : "step",
    ],
    ["geometry.manifest.partDefinitions.count", 4],
    ["geometry.manifest.occurrences.count", 4],
  ];
  if (predecessor) {
    entries.push(
      ["geometry.manifest.predecessor.artifactId", predecessor.artifactId],
      ["geometry.manifest.predecessor.fingerprint", predecessor.digest],
    );
  }
  for (let index = 0; index < 4; index++) {
    const component = `geometry.manifest.components.${index}`;
    const definition = `geometry.manifest.partDefinitions.${index}`;
    const occurrence = `geometry.manifest.occurrences.${index}`;
    entries.push(
      [`${component}.usageName`, `part${index}`],
      [`${component}.elementId`, `usage-${index}`],
      [`${component}.label`, `Part ${index}`],
      [`${definition}.elementId`, `definition-${index}`],
      [`${definition}.label`, `Part ${index}`],
      [`${definition}.scriptHash`, String(index + 2).repeat(64)],
      [`${definition}.files.count`, includePartGlb ? 2 : 1],
      [`${definition}.files.0.format`, "step"],
      [`${definition}.files.0.name`, `part-${index}`],
      [`${definition}.files.0.fingerprint`, digests[index]!],
      [`${occurrence}.usageElementId`, `usage-${index}`],
      [`${occurrence}.partDefinitionElementId`, `definition-${index}`],
    );
    if (includePartGlb) {
      entries.push(
        [`${definition}.files.1.format`, "gltf"],
        [`${definition}.files.1.name`, `part-${index}`],
        [`${definition}.files.1.fingerprint`, glbDigests[index]!],
      );
    }
    for (const vector of ["translationMm", "rotationDeg"]) {
      for (let axis = 0; axis < 3; axis++) {
        entries.push([`${occurrence}.${vector}.${axis}`, 0]);
      }
    }
  }
  return entries.map(([key, value]) => ({ key, label: key, value }));
}

function threadSnapshot(): ThreadWorkbenchSnapshot {
  return {
    artifacts: [{
      id: "sealed-glb",
      label: "Sealed assembly",
      kind: "cad-model",
      system: "build123d-sandbox",
      revision: HEX_A,
      freshness: "fresh",
      fingerprint: `sha256:${HEX_A}`,
      uri: `/api/thread/assets/${HEX_A}.glb`,
      dependsOn: [],
    }],
    requirements: [{
      id: "height",
      label: "Height",
      source: "SysON",
      sourceElementId: "fixture:height",
      expression: "height <= 450 mm",
      status: "unresolved",
      observationIds: [],
      violationIds: [],
      rationale: "No observation",
    }],
    observations: [],
  } as unknown as ThreadWorkbenchSnapshot;
}

function threadWithEvidence(id: string): ThreadWorkbenchSnapshot {
  const thread = threadSnapshot();
  return {
    ...thread,
    graph: {
      nodes: [{
        id: `graph:artifact:${id}`,
        ref: { kind: "artifact", id },
        entityKind: "artifact",
        artifactKind: "document",
        label: "Published geometry capture",
        system: "digital-thread",
        freshness: "fresh",
        summary: "Exact published geometry capture",
        recordedAt: "2026-08-05T00:00:00.000Z",
      }],
      edges: [],
    },
  } as ThreadWorkbenchSnapshot;
}
