import { assertEquals, assertExists } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../../../domain/project/project-brief.ts";
import { parseRequirementsProposalParameters } from "../../../../domain/architecture/requirements/requirements-proposal.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../../ports/out/engineering-project-revision-store.ts";
import { ProjectBriefCommandService } from "../../project/project-brief-command-service.ts";
import { PrepareProjectBriefRequirementsReview } from "./prepare-project-brief-requirements-review.ts";

const PROJECT_ID = "project-brief-requirements";
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const HUMAN = { kind: "human" as const, actorId: "human:owner" };

const DISPLACEMENT = {
  slug: "arm-displacement",
  name: "Maximum arm displacement",
  metric: "arm_max_displacement",
  operator: "<=",
  threshold: 2,
  unit: "mm",
  sourceItemId: "success-max-displacement",
};

Deno.test(
  "brief requirements review compiles parameters the production grammar accepts and traces every one to the approved brief",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      containerComponent: "ArticulatedArm",
      containerSourceItemId: "mission-articulated-arm",
      requirements: [DISPLACEMENT],
    });

    assertEquals(result.status, "resolved");
    assertEquals(result.diagnostics, []);
    assertExists(result.decisionParameters);
    // The grammar is the authority on the envelope; re-parsing here proves the
    // compiled parameters are the ones a later MRTR would accept.
    const parsed = parseRequirementsProposalParameters(result.decisionParameters);
    assertEquals(parsed.containerComponent, "ArticulatedArm");
    assertEquals(parsed.requirements.length, 1);

    // Every emitted parameter names the exact brief item it came from.
    const traced = new Set(result.provenance.map((entry) => entry.parameterKey));
    for (const parameter of result.decisionParameters) {
      assertEquals(traced.has(parameter.key), true, parameter.key);
    }
    const threshold = result.provenance.find((entry) =>
      entry.parameterKey === "requirement.arm-displacement.threshold"
    );
    assertEquals(threshold?.sourceItemId, "success-max-displacement");
    assertEquals(threshold?.sourceItemKind, "success-criterion");
  },
);

Deno.test(
  "brief requirements review refuses a requirement whose brief item the approved brief does not contain",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      containerComponent: "ArticulatedArm",
      containerSourceItemId: "mission-articulated-arm",
      requirements: [{ ...DISPLACEMENT, sourceItemId: "success-invented" }],
    });

    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(result.diagnostics.map((item) => item.code), [
      "brief-item-absent",
    ]);
  },
);

Deno.test(
  "brief requirements review refuses a requirement traced to a non-normative brief item",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      containerComponent: "ArticulatedArm",
      containerSourceItemId: "mission-articulated-arm",
      requirements: [{ ...DISPLACEMENT, sourceItemId: "constraint-budget" }],
    });

    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(result.diagnostics.map((item) => item.code), [
      "brief-item-not-normative",
    ]);
  },
);

Deno.test(
  "brief requirements review rescales a megapascal threshold to the oracle unit and names the transformation",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      containerComponent: "ArticulatedArm",
      containerSourceItemId: "mission-articulated-arm",
      requirements: [{
        ...DISPLACEMENT,
        slug: "arm-stress",
        name: "Maximum arm stress",
        metric: "arm_max_stress",
        threshold: 90,
        unit: "MPa",
      }],
    });

    assertEquals(result.status, "resolved");
    assertExists(result.decisionParameters);
    const threshold = result.decisionParameters.find((parameter) =>
      parameter.key === "requirement.arm-stress.threshold"
    );
    // SysON cannot round-trip MPa (probe 2026-08-14, type_mismatch), so the
    // server rescales rather than letting the agent do it unrecorded.
    assertEquals(threshold?.value, 90_000_000);
    assertEquals(threshold?.unit, "Pa");
    const traced = result.provenance.find((entry) =>
      entry.parameterKey === "requirement.arm-stress.threshold"
    );
    assertEquals(traced?.transformation, "MPa-to-Pa");
    const name = result.provenance.find((entry) =>
      entry.parameterKey === "requirement.arm-stress.name"
    );
    assertEquals(name?.transformation, "identity");
  },
);

Deno.test(
  "brief requirements review leaves unit admissibility to the production grammar",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      containerComponent: "ArticulatedArm",
      containerSourceItemId: "mission-articulated-arm",
      requirements: [{ ...DISPLACEMENT, unit: "furlong" }],
    });

    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(result.diagnostics.map((item) => item.code), [
      "proposal-grammar-rejected",
    ]);
  },
);

// ── Fixture ───────────────────────────────────────────────────────────────────

function reviewFor(
  store: EngineeringProjectRevisionStore,
): Promise<PrepareProjectBriefRequirementsReview> {
  return Promise.resolve(
    new PrepareProjectBriefRequirementsReview({ projects: store }),
  );
}

/** Real services build the snapshot so the approval receipt is authentic. */
async function approvedProjectStore(): Promise<MemoryProjectStore> {
  const store = new MemoryProjectStore();
  const service = new ProjectBriefCommandService(
    store,
    () => "2026-08-14T09:00:00.000Z",
  );
  let project = await service.startProject(AGENT, {
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Brief requirements review",
    issuedAt: "2026-08-14T08:59:00.000Z",
    intent: "Qualify an articulated arm against reviewed mechanical criteria.",
    intentSource: { kind: "human", reference: "conversation:turn-1" },
  });
  project = await service.proposeBrief(AGENT, {
    commandId: "propose-brief",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-14T08:59:30.000Z",
    items: briefItems(),
  });
  const proposal = project.framing!.proposedBrief!;
  const proposalReview = project.framing!.proposalReview!;
  project = await service.approveBrief(HUMAN, {
    commandId: "approve-brief",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-14T08:59:45.000Z",
    briefSnapshotId: proposal.id,
    briefRevision: proposal.revision,
    rationale: "Reviewed in the paired conversation.",
    inputFingerprint: proposalReview.inputFingerprint,
  });
  assertEquals(project.framing?.currentBriefApproval?.status, "approved");
  return store;
}

function briefItems(): readonly ProjectBriefItem[] {
  const source = [{ kind: "intent" as const, reference: "conversation:turn-1" }];
  return [
    {
      id: "objective",
      kind: "objective",
      statement: "Qualify an articulated arm against reviewed mechanical criteria.",
      sourceRefs: source,
    },
    {
      id: "mission-articulated-arm",
      kind: "mission-scenario",
      statement: "The articulated arm carries the lamp head at full extension.",
      sourceRefs: source,
    },
    {
      id: "constraint-budget",
      kind: "constraint",
      statement: "The arm keeps the reviewed material budget.",
      sourceRefs: source,
    },
    {
      id: "success-max-displacement",
      kind: "success-criterion",
      statement: "Maximum arm displacement stays at or below 2 mm under load.",
      sourceRefs: source,
      dependsOnItemIds: [],
    },
    {
      id: "verify-static-proof",
      kind: "verification-activity",
      statement: "Verify the arm with a reviewed static mechanical proof.",
      sourceRefs: source,
      dependsOnItemIds: ["success-max-displacement"],
    },
  ];
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const current = [...this.#revisions.values()]
      .filter((snapshot) => snapshot.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const snapshot = this.#revisions.get(revision);
    return Promise.resolve(
      snapshot?.project.id === projectId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size > 0) {
      throw new EngineeringProjectStoreConflictError("Already exists.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(snapshot.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Stale revision.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}
