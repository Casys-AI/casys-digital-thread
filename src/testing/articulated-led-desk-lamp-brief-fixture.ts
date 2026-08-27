/**
 * Fresh articulated LED desk-lamp brief framing.
 *
 * This is a test identity and a reviewable proposal, not a live project, not a
 * relabel of desk-lamp-dl05, and not permission to invent thresholds, units,
 * materials, circuits or SysML. Physical inputs stay open-questions.
 */

import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../domain/project/project-brief.ts";
import type { EngineeringProjectCommandOrigin } from "../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../application/ports/out/engineering-project-revision-store.ts";
import { ProjectBriefCommandService } from "../application/use-cases/project/project-brief-command-service.ts";

export const ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID = "articulated-led-desk-lamp";

export const ARTICULATED_LED_DESK_LAMP_FIXTURE_CLOCK = "2026-08-21T12:00:00.000Z";

export const ARTICULATED_LED_DESK_LAMP_STRUCTURE_CLOCK = "2026-08-21T12:01:00.000Z";

export const ARTICULATED_LED_DESK_LAMP_FIXTURE_AGENT: EngineeringProjectCommandOrigin =
  {
    kind: "agent",
    actorId: "agent:articulated-led-desk-lamp",
  };

export const ARTICULATED_LED_DESK_LAMP_FIXTURE_HUMAN: EngineeringProjectCommandOrigin =
  {
    kind: "human",
    actorId: "human:fixture-reviewer",
  };

export const ARTICULATED_LED_DESK_LAMP_INTENT =
  "Build a reviewable articulated LED desk lamp with separate mechanical, thermal and electrical questions.";

const INTERNAL_PRODUCT_CONTRACT = {
  kind: "document" as const,
  reference: "private-history:articulated-led-desk-lamp-demo/product-contract",
};

const INTERNAL_HUMAN_GATES = {
  kind: "document" as const,
  reference: "private-history:articulated-led-desk-lamp-demo/human-input-gates",
};

const INTENT_SOURCE = {
  kind: "intent" as const,
  reference: "conversation:articulated-led-desk-lamp-demo",
};

const G0_ANSWER_SOURCE = {
  kind: "answer" as const,
  reference: "answer-g0-indoor-desk-use",
};

const FRAMING_SOURCES = [
  INTENT_SOURCE,
  INTERNAL_PRODUCT_CONTRACT,
  INTERNAL_HUMAN_GATES,
  G0_ANSWER_SOURCE,
];

export const ARTICULATED_LED_DESK_LAMP_G0_QUESTION = {
  id: "g0-mission",
  prompt:
    "What exact desk-use scenario should the demonstration represent, and which uses are explicitly excluded?",
  whyItMatters:
    "Every later requirement, model boundary and consequence depends on the scenario; a lamp is not a load case, thermal condition or circuit test.",
  recommendation: {
    value: "indoor-desk-use",
    rationale:
      "The internal planning record proposes one narrow indoor desk-use story and keeps certification, mains safety, EMC, optics, fatigue, stability, Make and Buy excluded.",
    confidence: "high" as const,
  },
  options: [
    {
      value: "indoor-desk-use",
      label: "Indoor desk use",
      consequences:
        "The first questions stay isolated-arm static, isolated-head thermal and LED-driver electrical. Make, Buy and certification stay out of scope.",
    },
    {
      value: "unknown",
      label: "Leave unknown",
      consequences:
        "The project stays at L1. Only reusable infrastructure may proceed; live evidence lots remain parked.",
    },
  ],
  allowUnknown: true,
  risk: "material" as const,
  evidenceNeeded: [
    "approved brief revision",
    "named product owner for the live walk",
  ],
};

export const ARTICULATED_LED_DESK_LAMP_G0_ANSWER = {
  id: "answer-g0-indoor-desk-use",
  questionId: "g0-mission",
  kind: "provided" as const,
  value: "indoor-desk-use",
  explanation:
    "Adopt the internal G0 planning recommendation: indoor desk illumination under reviewed isolated-branch questions. No physical value, unit, material, load, circuit or thermal model is implied.",
  source: {
    kind: "document" as const,
    reference: "private-history:articulated-led-desk-lamp-demo/human-input-gates",
  },
};

/** Independent Behave gates. None may imply a combined lamp verdict. */
export const ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES = {
  mechanicalSuccess: "success-mechanical-arm",
  thermalSuccess: "success-thermal-head",
  electricalSuccess: "success-electrical-driver",
  mechanicalVerification: "verify-mechanical-static",
  thermalVerification: "verify-thermal-admitted-modelica",
  electricalVerification: "verify-electrical-circuit",
} as const;

export function articulatedLedDeskLampBriefItems(): readonly ProjectBriefItem[] {
  return [
    {
      id: "objective",
      kind: "objective",
      statement:
        "Produce a reviewable articulated LED desk lamp record from a human-confirmed brief through three separate Behave questions and one later reviewed cross-domain change.",
      sourceRefs: FRAMING_SOURCES,
    },
    {
      id: "primary-user",
      kind: "primary-user",
      statement:
        "A person working at an indoor desk who needs inspected engineering evidence, not a manufactured product.",
      sourceRefs: FRAMING_SOURCES,
    },
    {
      id: "mission-indoor-desk-use",
      kind: "mission-scenario",
      statement:
        "Represent indoor desk illumination under reviewed isolated-branch questions. Outdoor, vehicle, industrial and emergency uses are outside this demonstration.",
      sourceRefs: FRAMING_SOURCES,
    },
    {
      id: "operating-indoor-desk",
      kind: "operating-environment",
      statement:
        "The operating environment is an indoor desk. No outdoor weather, vehicle vibration or industrial enclosure is in scope.",
      sourceRefs: FRAMING_SOURCES,
    },
    {
      id: "intended-market-concept",
      kind: "intended-market",
      statement:
        "This is a concept demonstration for a reviewer, not a manufactured-product release or a certification claim.",
      sourceRefs: FRAMING_SOURCES,
    },
    {
      id: ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.mechanicalSuccess,
      kind: "success-criterion",
      statement:
        "Under reviewed isolated-arm assumptions, the exact canonical isolated arm of this revision satisfies the declared static criteria. No threshold, unit, material, load or geometry is declared here.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
      dependsOnItemIds: [],
    },
    {
      id: ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.thermalSuccess,
      kind: "success-criterion",
      statement:
        "Under a separately reviewed isolated lamp-head thermal scenario, the named thermal criterion holds at its stated boundary. No equation, power, temperature, material or unit is declared here.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
      dependsOnItemIds: [],
    },
    {
      id: ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.electricalSuccess,
      kind: "success-criterion",
      statement:
        "Under a separately reviewed LED-driver circuit scenario, the named electrical criteria hold. No topology, component, supply, observation or unit is declared here.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
      dependsOnItemIds: [],
    },
    {
      id: ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.mechanicalVerification,
      kind: "verification-activity",
      statement:
        "Verify the isolated-arm static question through the registered mechanical proof path on exact canonical geometry of that revision.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
      dependsOnItemIds: [
        ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.mechanicalSuccess,
      ],
    },
    {
      id: ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.thermalVerification,
      kind: "verification-activity",
      statement:
        "Verify the isolated lamp-head thermal question through admitted Modelica observation and a separate qualified evaluation. Solver success is not a verdict.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
      dependsOnItemIds: [ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.thermalSuccess],
    },
    {
      id: ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.electricalVerification,
      kind: "verification-activity",
      statement:
        "Verify the LED-driver electrical question through a closed circuit method and a separate qualified evaluation. The circuit engine is not an oracle.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
      dependsOnItemIds: [
        ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.electricalSuccess,
      ],
    },
    {
      id: "exclusion-make",
      kind: "exclusion",
      statement:
        "Make is out of scope: DFM, printability, manufacturing route, tolerances and fabrication claims.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
    },
    {
      id: "exclusion-buy",
      kind: "exclusion",
      statement:
        "Buy is out of scope: BOM, price, sourcing and make-or-buy recommendation.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
    },
    {
      id: "exclusion-certification-safety",
      kind: "exclusion",
      statement:
        "Certification, safety compliance, mains safety, EMC, reliability and notified-body claims are out of scope.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
    },
    {
      id: "exclusion-optics-fatigue-stability",
      kind: "exclusion",
      statement:
        "Optical performance, fatigue, stability, buckling, dynamics and full-assembly physics are out of scope.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
    },
    {
      id: "exclusion-modal",
      kind: "exclusion",
      statement:
        "Modal analysis is out of scope. This demonstration makes no modal promise.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
    },
    {
      id: "exclusion-full-assembly-joints",
      kind: "exclusion",
      statement:
        "Full CAD assembly, joints, contact, wiring, ports, value-flow semantics and circuit-netlist authoring are out of scope for this framing.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
    },
    {
      id: "exclusion-historical-relabel",
      kind: "exclusion",
      statement:
        "This is not a repair, replay, clone or relabel of a historical desk-lamp vehicle. Similar geometry or a reused filename is never identity evidence.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT],
    },
    {
      id: "open-question-structure",
      kind: "open-question",
      statement:
        "Which named components and parameter owners should the first architecture retain? Structure remains unresolved until that decision is sourced and approved.",
      sourceRefs: [INTERNAL_HUMAN_GATES],
    },
    {
      id: "open-question-mechanical-inputs",
      kind: "open-question",
      statement:
        "What sourced arm geometry, material, support, load and named static acceptance criteria should be reviewed? Physical mechanical inputs remain unresolved.",
      sourceRefs: [INTERNAL_HUMAN_GATES],
    },
    {
      id: "open-question-thermal-method",
      kind: "open-question",
      statement:
        "What isolated lamp-head thermal boundary, sourced scalar equations, parameters, initial state, power input, scenario and named criterion are intended? Thermal method inputs remain unresolved.",
      sourceRefs: [INTERNAL_HUMAN_GATES],
    },
    {
      id: "open-question-electrical-circuit",
      kind: "open-question",
      statement:
        "Which reviewed LED-driver circuit source, component models, supply and test condition, requested observations and criteria define the electrical question? Circuit inputs remain unresolved.",
      sourceRefs: [INTERNAL_HUMAN_GATES],
    },
    {
      id: "open-question-cross-domain-impact",
      kind: "open-question",
      statement:
        "What exact reviewed power or brightness change is proposed, which thermal and electrical inputs does it affect, and what sourced argument supports mechanical independence for that revision? Impact remains unresolved.",
      sourceRefs: [INTERNAL_HUMAN_GATES],
    },
  ];
}

/**
 * G1 structure as sourced constraints. Names follow the retained internal product brief.
 * No AttributeUsage, port, flow, value, unit or threshold is declared.
 */
export const ARTICULATED_LED_DESK_LAMP_STRUCTURE = {
  packageName: "ArticulatedLedDeskLamp",
  packageSourceItemId: "objective",
  systemName: "ArticulatedLedDeskLamp",
  systemSourceItemId: "constraint-system",
  components: [
    {
      slug: "base",
      name: "Base",
      usage: "base",
      parent: "ArticulatedLedDeskLamp",
      sourceItemId: "constraint-base",
    },
    {
      slug: "arm",
      name: "ArticulatedArm",
      usage: "arm",
      parent: "ArticulatedLedDeskLamp",
      sourceItemId: "constraint-arm",
    },
    {
      slug: "lampHead",
      name: "LampHead",
      usage: "lampHead",
      parent: "ArticulatedLedDeskLamp",
      sourceItemId: "constraint-lamp-head",
    },
    {
      slug: "ledDriver",
      name: "LedDriver",
      usage: "ledDriver",
      parent: "ArticulatedLedDeskLamp",
      sourceItemId: "constraint-led-driver",
    },
    {
      slug: "powerSupply",
      name: "PowerSupply",
      usage: "powerSupply",
      parent: "ArticulatedLedDeskLamp",
      sourceItemId: "constraint-power-supply",
    },
  ],
} as const;

/** Bare AttributeUsage handles. No magnitude, unit, type or equation. */
export const ARTICULATED_LED_DESK_LAMP_HANDLES = [
  {
    slug: "armLever",
    name: "armLever",
    parent: "ArticulatedArm",
    sourceItemId: "constraint-handle-arm-lever",
  },
  {
    slug: "armMaterial",
    name: "armMaterial",
    parent: "ArticulatedArm",
    sourceItemId: "constraint-handle-arm-material",
  },
  {
    slug: "lampHeadThermalState",
    name: "lampHeadThermalState",
    parent: "LampHead",
    sourceItemId: "constraint-handle-lamp-head-thermal",
  },
  {
    slug: "ledDriverElectrical",
    name: "ledDriverElectrical",
    parent: "LedDriver",
    sourceItemId: "constraint-handle-led-driver-electrical",
  },
  {
    slug: "electricalPower",
    name: "electricalPower",
    parent: "LedDriver",
    sourceItemId: "constraint-handle-electrical-power",
  },
] as const;

export function articulatedLedDeskLampStructureBriefItems(): readonly ProjectBriefItem[] {
  const framing = articulatedLedDeskLampBriefItems().filter((item) =>
    item.id !== "open-question-structure"
  );
  const structure: readonly ProjectBriefItem[] = [
    {
      id: "constraint-system",
      kind: "constraint",
      statement:
        "The product system is ArticulatedLedDeskLamp. It is a renderer-backed package and root only.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-base",
      kind: "constraint",
      statement:
        "Base is a retained structural component that grounds the product story. No stability, ballast or mounting proof is implied.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-arm",
      kind: "constraint",
      statement:
        "ArticulatedArm is the sole canonical CAD and mechanical-proof subject. It is a single isolated part, never an assembly mapping.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-lamp-head",
      kind: "constraint",
      statement:
        "LampHead carries the LED and light story. No mechanical, optical or thermal CAD authority is implied.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-led-driver",
      kind: "constraint",
      statement:
        "LedDriver is the electrical behaviour boundary. No circuit topology or component model is implied.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-power-supply",
      kind: "constraint",
      statement:
        "PowerSupply is the reviewed electrical source boundary. It is structural only: no connector or electrical-source semantics are implied.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-handle-arm-lever",
      kind: "constraint",
      statement:
        "ArticulatedArm owns a named geometric lever handle. No magnitude, unit or source value is declared.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-handle-arm-material",
      kind: "constraint",
      statement:
        "ArticulatedArm owns a named material and density handle. No material identity, density or unit is declared.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-handle-lamp-head-thermal",
      kind: "constraint",
      statement:
        "LampHead owns a named thermal initial-state handle. No temperature, coefficient, equation or unit is declared.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-handle-led-driver-electrical",
      kind: "constraint",
      statement:
        "LedDriver owns a named electrical source-parameter handle. No topology, component or unit is declared.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
    {
      id: "constraint-handle-electrical-power",
      kind: "constraint",
      statement:
        "LedDriver owns the unique reviewed electrical-power handle consumed by electrical and thermal branches. No wattage or unit is declared.",
      sourceRefs: [INTERNAL_PRODUCT_CONTRACT, INTERNAL_HUMAN_GATES],
    },
  ];
  return [...framing, ...structure];
}

export interface ArticulatedLedDeskLampBriefSeed {
  readonly store: EngineeringProjectRevisionStore;
  readonly service: ProjectBriefCommandService;
  readonly project: EngineeringProjectSnapshot;
}

export async function seedArticulatedLedDeskLampBriefProposal(): Promise<
  ArticulatedLedDeskLampBriefSeed
> {
  const store = new MemoryProjectStore();
  const service = new ProjectBriefCommandService(
    store,
    () => ARTICULATED_LED_DESK_LAMP_FIXTURE_CLOCK,
  );
  let project = await service.startProject(
    ARTICULATED_LED_DESK_LAMP_FIXTURE_AGENT,
    {
      commandId: "fixture:start",
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      projectName: "Articulated LED desk lamp",
      issuedAt: "2026-08-21T11:00:00.000Z",
      intent: ARTICULATED_LED_DESK_LAMP_INTENT,
      intentSource: {
        kind: "human",
        reference: "conversation:articulated-led-desk-lamp-demo",
      },
    },
  );
  project = await service.proposeQuestion(
    ARTICULATED_LED_DESK_LAMP_FIXTURE_AGENT,
    {
      commandId: "fixture:question-g0",
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: ARTICULATED_LED_DESK_LAMP_FIXTURE_CLOCK,
      question: ARTICULATED_LED_DESK_LAMP_G0_QUESTION,
    },
  );
  project = await service.recordAnswer(
    ARTICULATED_LED_DESK_LAMP_FIXTURE_AGENT,
    {
      commandId: "fixture:answer-g0",
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: ARTICULATED_LED_DESK_LAMP_FIXTURE_CLOCK,
      answer: ARTICULATED_LED_DESK_LAMP_G0_ANSWER,
    },
  );
  project = await service.proposeBrief(
    ARTICULATED_LED_DESK_LAMP_FIXTURE_AGENT,
    {
      commandId: "fixture:propose-brief",
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: ARTICULATED_LED_DESK_LAMP_FIXTURE_CLOCK,
      items: articulatedLedDeskLampBriefItems(),
    },
  );
  return { store, service, project };
}

/**
 * Fixture-only canonicalisation. It is not a live L5 product decision and must
 * not be treated as one in documentation or Workbench copy.
 */
export async function seedApprovedArticulatedLedDeskLampBrief(): Promise<
  ArticulatedLedDeskLampBriefSeed
> {
  const seeded = await seedArticulatedLedDeskLampBriefProposal();
  const proposal = seeded.project.framing!.proposedBrief!;
  const proposalReview = seeded.project.framing!.proposalReview!;
  const project = await seeded.service.approveBrief(
    ARTICULATED_LED_DESK_LAMP_FIXTURE_HUMAN,
    {
      commandId: "fixture:approve-brief",
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      expectedRevision: seeded.project.revision,
      issuedAt: ARTICULATED_LED_DESK_LAMP_FIXTURE_CLOCK,
      briefSnapshotId: proposal.id,
      briefRevision: proposal.revision,
      rationale:
        "Fixture reviewer accepts indoor desk-use framing, exclusions and open physical questions. No threshold, unit or component identity is approved.",
      inputFingerprint: proposalReview.inputFingerprint,
    },
  );
  return { ...seeded, project };
}

/**
 * Successor brief that commits renderer-supported structure only. Scalar
 * criteria, ports, flows and value-bearing attributes stay unresolved.
 */
export async function seedApprovedArticulatedLedDeskLampStructureBrief(): Promise<
  ArticulatedLedDeskLampBriefSeed
> {
  const seeded = await seedApprovedArticulatedLedDeskLampBrief();
  const service = new ProjectBriefCommandService(
    seeded.store,
    () => ARTICULATED_LED_DESK_LAMP_STRUCTURE_CLOCK,
  );
  let project = await service.proposeBrief(
    ARTICULATED_LED_DESK_LAMP_FIXTURE_AGENT,
    {
      commandId: "fixture:propose-structure-brief",
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      expectedRevision: seeded.project.revision,
      issuedAt: ARTICULATED_LED_DESK_LAMP_STRUCTURE_CLOCK,
      items: articulatedLedDeskLampStructureBriefItems(),
    },
  );
  const proposal = project.framing!.proposedBrief!;
  const proposalReview = project.framing!.proposalReview!;
  project = await service.approveBrief(
    ARTICULATED_LED_DESK_LAMP_FIXTURE_HUMAN,
    {
      commandId: "fixture:approve-structure-brief",
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: ARTICULATED_LED_DESK_LAMP_STRUCTURE_CLOCK,
      briefSnapshotId: proposal.id,
      briefRevision: proposal.revision,
      rationale:
        "Fixture reviewer accepts the sourced structural names. No threshold, unit, port, flow or value-bearing attribute is approved.",
      inputFingerprint: proposalReview.inputFingerprint,
    },
  );
  return { store: seeded.store, service, project };
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
