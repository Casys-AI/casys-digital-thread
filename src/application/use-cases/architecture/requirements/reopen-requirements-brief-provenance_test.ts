/**
 * Read-only reopen of exact reviewed brief provenance from a Project store.
 *
 * Fixtures are synthetic projects. These tests do not claim automatic impact
 * verdict/invalidation or live SysON proof.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../../../domain/project/project-brief.ts";
import type { TracedRequirementsProposal } from "../../../../domain/architecture/requirements/requirements-traced-proposal.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../../ports/out/engineering-project-revision-store.ts";
import { approvedBriefBasisForProject } from "../../project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../project/project-brief-command-service.ts";
import { reopenRequirementsBriefProvenance } from "./reopen-requirements-brief-provenance.ts";

const PROJECT_ID = "project-brief-provenance-reopen";
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const HUMAN = { kind: "human" as const, actorId: "human:owner" };
const NOW = "2026-08-14T12:00:00.000Z";

Deno.test(
  "reopenRequirementsBriefProvenance preserves identity and MPa-to-Pa on the current approved brief",
  async () => {
    const store = await approvedProjectStore();
    const current = await store.get(PROJECT_ID);
    const proposal = await tracedProposal(current!);
    const provenance = await reopenRequirementsBriefProvenance({
      projects: store,
      projectId: PROJECT_ID,
      proposal,
      mode: "current",
    });
    assertEquals(provenance.requirements[0]?.transformation, "identity");
    assertEquals(provenance.requirements[0]?.declaredThreshold, {
      value: 2,
      unit: "mm",
    });
    assertEquals(provenance.requirements[1]?.transformation, "MPa-to-Pa");
    assertEquals(provenance.requirements[1]?.declaredThreshold, {
      value: 90,
      unit: "MPa",
    });
    assertEquals(
      provenance.requirements[0]?.sourceItem.statement,
      "Maximum arm displacement stays at or below 2 mm under load.",
    );
    assertEquals(
      provenance.container.sourceItem.sourceRefs,
      current!.framing!.currentBrief!.items.find((item) =>
        item.id === "mission-articulated-arm"
      )!.sourceRefs,
    );
  },
);

Deno.test(
  "reopenRequirementsBriefProvenance rejects tampered source ids, item bytes, digests and identities",
  async () => {
    const store = await approvedProjectStore();
    const current = await store.get(PROJECT_ID);
    const proposal = await tracedProposal(current!);

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: withSourceItemId(proposal, "success-invented"),
          mode: "current",
        }),
      TypeError,
      "success-invented",
    );

    const mutated = structuredClone(current!);
    const item = mutated.framing!.currentBrief!.items.find((entry) =>
      entry.id === "success-max-displacement"
    )!;
    (item as { statement: string }).statement = "Tampered displacement clause.";
    store.replace(mutated);
    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal,
          mode: "current",
        }),
      TypeError,
      "brief content fingerprint",
    );
    store.replace(current!);

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: {
            ...proposal,
            briefSource: {
              ...proposal.briefSource,
              briefContentFingerprint: {
                algorithm: "sha256",
                digest: "d".repeat(64),
              },
            },
          },
          mode: "current",
        }),
      TypeError,
      "brief content fingerprint",
    );

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: withBasis(proposal, {
            approvedBriefFingerprint: {
              algorithm: "sha256",
              digest: "e".repeat(64),
            },
          }),
          mode: "current",
        }),
      TypeError,
      "approved brief basis",
    );

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: "foreign-project",
          proposal,
          mode: "current",
        }),
      TypeError,
      "project",
    );

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: withBasis(proposal, { projectId: "foreign-project" }),
          mode: "current",
        }),
      TypeError,
      "project",
    );

    const error = await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: withBasis(proposal, { projectRevision: 999 }),
          mode: "current",
        }),
      TypeError,
    );
    assertStringIncludes(error.message, "revision");
  },
);

Deno.test(
  "reopenRequirementsBriefProvenance rejects a non-normative source, wrong container and normalisation mismatch",
  async () => {
    const store = await approvedProjectStore();
    const current = await store.get(PROJECT_ID);
    const proposal = await tracedProposal(current!);

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: withSourceItemId(proposal, "constraint-budget"),
          mode: "current",
        }),
      TypeError,
      "normative",
    );

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: {
            ...proposal,
            briefSource: {
              ...proposal.briefSource,
              containerSourceItemId: "exclusion-housing",
            },
          },
          mode: "current",
        }),
      TypeError,
      "exclusion",
    );

    const requirements = proposal.briefSource.requirements.map((item, index) =>
      index === 1 ? { ...item, declaredThreshold: { value: 80, unit: "MPa" } } : item
    );
    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal: {
            ...proposal,
            briefSource: { ...proposal.briefSource, requirements },
          },
          mode: "current",
        }),
      TypeError,
      "normalis",
    );
  },
);

Deno.test(
  "current mode rejects a successor brief while historical mode reopens the original clause",
  async () => {
    const store = await approvedProjectStore();
    const original = await store.get(PROJECT_ID);
    const proposal = await tracedProposal(original!);
    const originalClause =
      "Maximum arm displacement stays at or below 2 mm under load.";

    const service = new ProjectBriefCommandService(
      store,
      () => "2026-08-14T12:01:00.000Z",
    );
    let project = await service.proposeBrief(AGENT, {
      commandId: "propose-successor",
      projectId: PROJECT_ID,
      expectedRevision: original!.revision,
      issuedAt: "2026-08-14T09:10:00.000Z",
      items: successorBriefItems(),
    });
    const proposalBrief = project.framing!.proposedBrief!;
    const proposalReview = project.framing!.proposalReview!;
    project = await service.approveBrief(HUMAN, {
      commandId: "approve-successor",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-14T09:10:15.000Z",
      briefSnapshotId: proposalBrief.id,
      briefRevision: proposalBrief.revision,
      rationale: "Reviewed successor brief.",
      inputFingerprint: proposalReview.inputFingerprint,
    });
    assertEquals(
      project.framing?.currentBrief?.items.find((item) =>
        item.id === "success-max-displacement"
      )?.statement,
      "Maximum arm displacement stays at or below 1 mm under load.",
    );

    await assertRejects(
      () =>
        reopenRequirementsBriefProvenance({
          projects: store,
          projectId: PROJECT_ID,
          proposal,
          mode: "current",
        }),
      TypeError,
      "approved brief",
    );

    const historical = await reopenRequirementsBriefProvenance({
      projects: store,
      projectId: PROJECT_ID,
      proposal,
      mode: "historical",
    });
    assertEquals(
      historical.requirements[0]?.sourceItem.statement,
      originalClause,
    );
    assertEquals(
      historical.briefBasis.briefSnapshotId,
      original!.framing!.currentBrief!.id,
    );
  },
);

Deno.test(
  "current mode accepts an unrelated later Project revision that keeps the same approved brief",
  async () => {
    const store = await approvedProjectStore();
    const original = await store.get(PROJECT_ID);
    const proposal = await tracedProposal(original!);
    const service = new ProjectBriefCommandService(store, () => NOW);
    const later = await service.proposeQuestion(AGENT, {
      commandId: "propose-question",
      projectId: PROJECT_ID,
      expectedRevision: original!.revision,
      issuedAt: "2026-08-14T09:05:00.000Z",
      question: {
        id: "mission",
        prompt: "Which initial operating scenario should the product prove?",
        whyItMatters: "It bounds the architecture and verification plan.",
        recommendation: {
          value: "bounded-demonstration",
          rationale: "It is observable and can be tested incrementally.",
          confidence: "medium",
        },
        options: [{
          value: "bounded-demonstration",
          label: "Bounded demonstration",
          consequences: "The first proof stays reviewable.",
        }],
        allowUnknown: true,
        risk: "reversible",
        evidenceNeeded: ["reviewed operating scenario"],
      },
    });
    assertEquals(later.revision > original!.revision, true);
    assertEquals(
      later.framing?.currentBrief?.id,
      original!.framing?.currentBrief?.id,
    );

    const provenance = await reopenRequirementsBriefProvenance({
      projects: store,
      projectId: PROJECT_ID,
      proposal,
      mode: "current",
    });
    assertEquals(
      provenance.briefBasis,
      approvedBriefBasisForProject(original!),
    );
    assertEquals(
      provenance.requirements[0]?.sourceItem.statement,
      "Maximum arm displacement stays at or below 2 mm under load.",
    );
  },
);

async function approvedProjectStore(): Promise<MemoryProjectStore> {
  const store = new MemoryProjectStore();
  const service = new ProjectBriefCommandService(store, () => NOW);
  let project = await service.startProject(AGENT, {
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Brief provenance reopen",
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

async function tracedProposal(
  project: EngineeringProjectSnapshot,
): Promise<TracedRequirementsProposal> {
  const brief = project.framing!.currentBrief!;
  return {
    containerComponent: "ArticulatedArm",
    partDefName: "ArticulatedArmRequirements",
    requirements: [
      {
        slug: "arm-displacement",
        name: "Maximum arm displacement",
        metric: "arm_max_displacement",
        operator: "<=",
        threshold: { value: 2, unit: "mm" },
      },
      {
        slug: "arm-stress",
        name: "Maximum arm stress",
        metric: "arm_max_stress",
        operator: "<=",
        threshold: { value: 90_000_000, unit: "Pa" },
      },
    ],
    briefSource: {
      basis: approvedBriefBasisForProject(project),
      briefContentFingerprint: await sha256Fingerprint(brief),
      containerSourceItemId: "mission-articulated-arm",
      requirements: [
        {
          requirementId: "arm_max_displacement",
          sourceItemId: "success-max-displacement",
          declaredThreshold: { value: 2, unit: "mm" },
          transformation: "identity",
        },
        {
          requirementId: "arm_max_stress",
          sourceItemId: "success-max-stress",
          declaredThreshold: { value: 90, unit: "MPa" },
          transformation: "MPa-to-Pa",
        },
      ],
    },
  };
}

function withSourceItemId(
  proposal: TracedRequirementsProposal,
  sourceItemId: string,
): TracedRequirementsProposal {
  const requirements = proposal.briefSource.requirements.map((item, index) =>
    index === 0 ? { ...item, sourceItemId } : item
  );
  return {
    ...proposal,
    briefSource: { ...proposal.briefSource, requirements },
  };
}

function withBasis(
  proposal: TracedRequirementsProposal,
  patch: Partial<TracedRequirementsProposal["briefSource"]["basis"]>,
): TracedRequirementsProposal {
  return {
    ...proposal,
    briefSource: {
      ...proposal.briefSource,
      basis: { ...proposal.briefSource.basis, ...patch },
    },
  };
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
      id: "exclusion-housing",
      kind: "exclusion",
      statement: "Decorative housing is out of scope.",
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
      id: "success-max-stress",
      kind: "success-criterion",
      statement: "Maximum arm stress stays at or below 90 MPa under load.",
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

function successorBriefItems(): readonly ProjectBriefItem[] {
  return briefItems().map((item) =>
    item.id === "success-max-displacement"
      ? {
        ...item,
        statement: "Maximum arm displacement stays at or below 1 mm under load.",
      }
      : item
  );
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

  replace(snapshot: EngineeringProjectSnapshot): void {
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
  }
}
