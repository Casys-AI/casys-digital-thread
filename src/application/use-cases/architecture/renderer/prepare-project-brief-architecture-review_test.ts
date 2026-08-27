import { assertEquals, assertExists } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../../../domain/project/project-brief.ts";
import { parseArchitectureProposalParameters } from "../../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../../ports/out/engineering-project-revision-store.ts";
import { ProjectBriefCommandService } from "../../project/project-brief-command-service.ts";
import { PrepareProjectBriefArchitectureReview } from "./prepare-project-brief-architecture-review.ts";

const PROJECT_ID = "project-brief-architecture";
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const HUMAN = { kind: "human" as const, actorId: "human:owner" };

const ARM = {
  slug: "arm",
  name: "Arm",
  usage: "arm",
  sourceItemId: "constraint-arm",
};

Deno.test(
  "brief architecture review compiles parameters the production grammar accepts and traces every one to the approved brief",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      packageName: "ArticulatedArm",
      packageSourceItemId: "objective",
      systemName: "ArticulatedArmSystem",
      systemSourceItemId: "mission-articulated-arm",
      components: [ARM],
    });

    assertEquals(result.status, "resolved");
    assertEquals(result.diagnostics, []);
    assertExists(result.decisionParameters);
    // The grammar is the authority on the envelope; re-parsing here proves the
    // compiled parameters are the ones a later MRTR would accept.
    const parsed = parseArchitectureProposalParameters(result.decisionParameters);
    assertEquals(parsed.packageName, "ArticulatedArm");
    assertEquals(parsed.system.name, "ArticulatedArmSystem");
    assertEquals(parsed.components.length, 1);

    // Every emitted parameter names the exact brief item it came from.
    const traced = new Set(result.provenance.map((entry) => entry.parameterKey));
    for (const parameter of result.decisionParameters) {
      assertEquals(traced.has(parameter.key), true, parameter.key);
    }
    const name = result.provenance.find((entry) =>
      entry.parameterKey === "component.arm.name"
    );
    assertEquals(name?.sourceItemId, "constraint-arm");
    assertEquals(name?.sourceItemKind, "constraint");
  },
);

Deno.test(
  "brief architecture review compiles a system-only part with a unique AttributeUsage",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      packageName: "Cantilever",
      packageSourceItemId: "objective",
      systemName: "CantileverArm",
      systemSourceItemId: "mission-articulated-arm",
      components: [],
      attributes: [{
        slug: "thickness",
        name: "thickness",
        parent: "CantileverArm",
        sourceItemId: "constraint-thickness",
      }],
    });

    assertEquals(result.status, "resolved");
    assertExists(result.decisionParameters);
    const parsed = parseArchitectureProposalParameters(result.decisionParameters);
    assertEquals(parsed.components, []);
    assertEquals(parsed.attributes, [{
      name: "thickness",
      parentName: "CantileverArm",
    }]);
  },
);

Deno.test(
  "brief architecture review refuses a component whose brief item the approved brief does not contain",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      packageName: "ArticulatedArm",
      packageSourceItemId: "objective",
      systemName: "ArticulatedArmSystem",
      systemSourceItemId: "mission-articulated-arm",
      components: [{ ...ARM, sourceItemId: "constraint-invented" }],
    });

    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(result.diagnostics.map((item) => item.code), [
      "brief-item-absent",
    ]);
  },
);

Deno.test(
  "brief architecture review refuses a component traced to a non-committing brief item",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      packageName: "ArticulatedArm",
      packageSourceItemId: "objective",
      systemName: "ArticulatedArmSystem",
      systemSourceItemId: "mission-articulated-arm",
      components: [{ ...ARM, sourceItemId: "exclusion-decorative-housing" }],
    });

    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(result.diagnostics.map((item) => item.code), [
      "brief-item-not-committing",
    ]);
  },
);

Deno.test(
  "brief architecture review compiles a hyphenated grouping slug the production grammar accepts",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      packageName: "HeatedStage",
      packageSourceItemId: "objective",
      systemName: "HeatedStageSystem",
      systemSourceItemId: "mission-articulated-arm",
      components: [{
        slug: "heated-stage-plate",
        name: "HeatedStagePlate",
        usage: "heatedStagePlate",
        sourceItemId: "constraint-arm",
      }],
      attributes: [{
        slug: "plate-thickness",
        name: "thickness",
        parent: "HeatedStagePlate",
        sourceItemId: "constraint-thickness",
      }],
    });

    assertEquals(result.status, "resolved");
    assertEquals(result.diagnostics, []);
    assertExists(result.decisionParameters);
    const parsed = parseArchitectureProposalParameters(result.decisionParameters);
    assertEquals(parsed.components, [{
      name: "HeatedStagePlate",
      usageName: "heatedStagePlate",
      parentName: "HeatedStageSystem",
    }]);
    assertEquals(parsed.attributes, [{
      name: "thickness",
      parentName: "HeatedStagePlate",
    }]);
    const traced = new Set(result.provenance.map((entry) => entry.parameterKey));
    assertEquals(traced.has("component.heated-stage-plate.name"), true);
    assertEquals(traced.has("attribute.plate-thickness.name"), true);
  },
);

Deno.test(
  "brief architecture review refuses a dotted slug at the declaration, not as an unknown compiled key",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const component = await review.execute({
      projectId: PROJECT_ID,
      packageName: "ArticulatedArm",
      packageSourceItemId: "objective",
      systemName: "ArticulatedArmSystem",
      systemSourceItemId: "mission-articulated-arm",
      components: [{ ...ARM, slug: "heated.stage" }],
    });

    assertEquals(component.status, "unresolved");
    assertEquals(component.decisionParameters, undefined);
    assertEquals(component.diagnostics.map((item) => item.code), [
      "invalid-component-slug",
    ]);
    assertEquals(component.diagnostics[0]?.slug, "heated.stage");

    const attribute = await review.execute({
      projectId: PROJECT_ID,
      packageName: "ArticulatedArm",
      packageSourceItemId: "objective",
      systemName: "ArticulatedArmSystem",
      systemSourceItemId: "mission-articulated-arm",
      components: [],
      attributes: [{
        slug: "plate:thickness",
        name: "thickness",
        parent: "ArticulatedArmSystem",
        sourceItemId: "constraint-thickness",
      }],
    });

    assertEquals(attribute.status, "unresolved");
    assertEquals(attribute.decisionParameters, undefined);
    assertEquals(attribute.diagnostics.map((item) => item.code), [
      "invalid-attribute-slug",
    ]);
    assertEquals(attribute.diagnostics[0]?.slug, "plate:thickness");
  },
);

Deno.test(
  "brief architecture review leaves identifier admissibility to the production grammar",
  async () => {
    const review = await reviewFor(await approvedProjectStore());

    const result = await review.execute({
      projectId: PROJECT_ID,
      packageName: "articulated-arm",
      packageSourceItemId: "objective",
      systemName: "ArticulatedArmSystem",
      systemSourceItemId: "mission-articulated-arm",
      components: [ARM],
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
): Promise<PrepareProjectBriefArchitectureReview> {
  return Promise.resolve(
    new PrepareProjectBriefArchitectureReview({ projects: store }),
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
    projectName: "Brief architecture review",
    issuedAt: "2026-08-14T08:59:00.000Z",
    intent: "Qualify an articulated arm against a reviewed product structure.",
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
      statement: "Qualify an articulated arm against a reviewed product structure.",
      sourceRefs: source,
    },
    {
      id: "mission-articulated-arm",
      kind: "mission-scenario",
      statement: "The articulated arm carries the lamp head at full extension.",
      sourceRefs: source,
    },
    {
      id: "constraint-arm",
      kind: "constraint",
      statement: "The arm is a retained structural component of the system.",
      sourceRefs: source,
    },
    {
      id: "constraint-thickness",
      kind: "constraint",
      statement: "The arm thickness is a named numeric handle of the part.",
      sourceRefs: source,
    },
    {
      id: "exclusion-decorative-housing",
      kind: "exclusion",
      statement: "A decorative housing is out of scope for this architecture.",
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
