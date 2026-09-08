/**
 * Closed provenance for a reviewed brief-to-requirements binding.
 *
 * Fixtures are synthetic. These tests do not claim automatic impact
 * verdict/invalidation or live SysON proof.
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type { EngineeringApprovedBriefBasis } from "../../project/engineering-project.ts";
import type {
  ProjectBriefItem,
  ProjectBriefRevision,
} from "../../project/project-brief.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import type { TracedRequirementsProposal } from "./requirements-traced-proposal.ts";
import {
  buildRequirementsBriefProvenance,
  parseRequirementsBriefProvenance,
  REQUIREMENTS_BRIEF_PROVENANCE_SCHEMA,
} from "./requirements-brief-provenance.ts";

const SOURCE = [{ kind: "intent" as const, reference: "conversation:turn-1" }];

Deno.test("provenance builder refuses the capture source-reference limit before dispatch", async () => {
  const original = syntheticBrief();
  const brief: ProjectBriefRevision = {
    ...original,
    items: original.items.map((item) =>
      item.id === "success-max-displacement"
        ? {
          ...item,
          sourceRefs: Array.from({ length: 33 }, (_, index) => ({
            kind: "intent" as const,
            reference: `conversation:synthetic-${index}`,
          })),
        }
        : item
    ),
  };
  const basis = syntheticBasis();
  const proposal = await tracedProposal(brief, basis);
  await assertRejects(
    () => buildRequirementsBriefProvenance({ brief, basis, proposal }),
    TypeError,
    "between 1 and 32",
  );
});

Deno.test(
  "buildRequirementsBriefProvenance preserves identity, exact clause bytes and MPa-to-Pa",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const provenance = await buildRequirementsBriefProvenance({
      brief,
      basis,
      proposal,
    });

    assertEquals(provenance.schemaVersion, REQUIREMENTS_BRIEF_PROVENANCE_SCHEMA);
    assertEquals(provenance.briefBasis, basis);
    assertEquals(
      provenance.briefContentFingerprint,
      proposal.briefSource.briefContentFingerprint,
    );
    assertEquals(provenance.container.sourceItem, brief.items[1]);
    assertEquals(provenance.requirements.length, 2);
    assertEquals(provenance.requirements[0]?.requirementId, "arm_max_displacement");
    assertEquals(provenance.requirements[0]?.sourceItem, brief.items[3]);
    assertEquals(provenance.requirements[0]?.declaredThreshold, {
      value: 2,
      unit: "mm",
    });
    assertEquals(provenance.requirements[0]?.transformation, "identity");
    assertEquals(provenance.requirements[1]?.requirementId, "arm_max_stress");
    assertEquals(provenance.requirements[1]?.sourceItem, brief.items[4]);
    assertEquals(provenance.requirements[1]?.declaredThreshold, {
      value: 90,
      unit: "MPa",
    });
    assertEquals(provenance.requirements[1]?.transformation, "MPa-to-Pa");
    assertEquals(Object.isFrozen(provenance), true);
    assertEquals(Object.isFrozen(provenance.requirements[0]?.sourceItem), true);
  },
);

Deno.test(
  "buildRequirementsBriefProvenance records fractional-mm-to-nm for declared 0.2 mm",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const first = proposal.requirements[0]!;
    const second = proposal.requirements[1]!;
    const firstOrigin = proposal.briefSource.requirements[0]!;
    const secondOrigin = proposal.briefSource.requirements[1]!;
    const nmProposal: TracedRequirementsProposal = {
      ...proposal,
      requirements: [
        { ...first, threshold: { value: 200_000, unit: "nm" } },
        second,
      ],
      briefSource: {
        ...proposal.briefSource,
        requirements: [
          {
            ...firstOrigin,
            declaredThreshold: { value: 0.2, unit: "mm" },
            transformation: "fractional-mm-to-nm",
          },
          secondOrigin,
        ],
      },
    };
    const provenance = await buildRequirementsBriefProvenance({
      brief,
      basis,
      proposal: nmProposal,
    });
    assertEquals(provenance.requirements[0]?.declaredThreshold, {
      value: 0.2,
      unit: "mm",
    });
    assertEquals(provenance.requirements[0]?.transformation, "fractional-mm-to-nm");
    const parsed = parseRequirementsBriefProvenance(
      JSON.parse(JSON.stringify(provenance)),
    );
    assertEquals(parsed.requirements[0]?.transformation, "fractional-mm-to-nm");
  },
);

Deno.test(
  "buildRequirementsBriefProvenance rejects a tampered source item id",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const tampered = withSourceItemId(proposal, "success-invented");
    await assertRejects(
      () => buildRequirementsBriefProvenance({ brief, basis, proposal: tampered }),
      TypeError,
      "success-invented",
    );
  },
);

Deno.test(
  "buildRequirementsBriefProvenance rejects tampered source item bytes against the signed digest",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const tamperedBrief: ProjectBriefRevision = {
      ...brief,
      items: brief.items.map((item) =>
        item.id === "success-max-displacement"
          ? { ...item, statement: "Tampered displacement clause." }
          : item
      ),
    };
    await assertRejects(
      () =>
        buildRequirementsBriefProvenance({
          brief: tamperedBrief,
          basis,
          proposal,
        }),
      TypeError,
      "brief content fingerprint",
    );
  },
);

Deno.test(
  "buildRequirementsBriefProvenance rejects a tampered brief content digest",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const tampered = {
      ...proposal,
      briefSource: {
        ...proposal.briefSource,
        briefContentFingerprint: otherFingerprint(),
      },
    };
    await assertRejects(
      () => buildRequirementsBriefProvenance({ brief, basis, proposal: tampered }),
      TypeError,
      "brief content fingerprint",
    );
  },
);

Deno.test(
  "buildRequirementsBriefProvenance rejects a basis that does not equal the signed proposal basis",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    await assertRejects(
      () =>
        buildRequirementsBriefProvenance({
          brief,
          basis: { ...basis, approvedBriefFingerprint: otherFingerprint() },
          proposal,
        }),
      TypeError,
      "approved brief basis",
    );
  },
);

Deno.test(
  "buildRequirementsBriefProvenance rejects a non-normative requirement source",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const tampered = withSourceItemId(proposal, "constraint-budget");
    await assertRejects(
      () => buildRequirementsBriefProvenance({ brief, basis, proposal: tampered }),
      TypeError,
      "normative",
    );
  },
);

Deno.test(
  "buildRequirementsBriefProvenance rejects an exclusion or open-question container",
  async () => {
    const brief = syntheticBrief({
      container: {
        id: "exclusion-housing",
        kind: "exclusion",
        statement: "Decorative housing is out of scope.",
        sourceRefs: SOURCE,
      },
    });
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis, {
      containerSourceItemId: "exclusion-housing",
    });
    await assertRejects(
      () => buildRequirementsBriefProvenance({ brief, basis, proposal }),
      TypeError,
      "exclusion",
    );
  },
);

Deno.test(
  "buildRequirementsBriefProvenance rejects a normalisation mismatch",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const requirements = proposal.briefSource.requirements.map((item, index) =>
      index === 1
        ? {
          ...item,
          declaredThreshold: { value: 80, unit: "MPa" },
        }
        : item
    );
    const tampered = {
      ...proposal,
      briefSource: { ...proposal.briefSource, requirements },
    };
    await assertRejects(
      () => buildRequirementsBriefProvenance({ brief, basis, proposal: tampered }),
      TypeError,
      "normalis",
    );
  },
);

Deno.test(
  "parseRequirementsBriefProvenance accepts a closed document and rejects extra keys",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const provenance = await buildRequirementsBriefProvenance({
      brief,
      basis,
      proposal,
    });
    const parsed = parseRequirementsBriefProvenance(
      JSON.parse(JSON.stringify(provenance)),
    );
    assertEquals(parsed, provenance);
    assertThrows(
      () => parseRequirementsBriefProvenance({ ...provenance, extra: true }),
      TypeError,
      "unsupported field extra",
    );
  },
);

Deno.test(
  "parseRequirementsBriefProvenance rejects missing and duplicate metric origins",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const provenance = await buildRequirementsBriefProvenance({
      brief,
      basis,
      proposal,
    });
    const raw = JSON.parse(JSON.stringify(provenance)) as {
      requirements: unknown[];
    };
    assertThrows(
      () => parseRequirementsBriefProvenance({ ...raw, requirements: [] }),
      TypeError,
      "must not be empty",
    );
    const first = raw.requirements[0] as Record<string, unknown>;
    const second = raw.requirements[1] as Record<string, unknown>;
    const { requirementId: _omitted, ...missingId } = first;
    assertThrows(
      () =>
        parseRequirementsBriefProvenance({
          ...raw,
          requirements: [missingId, second],
        }),
      TypeError,
      "requirementId",
    );
    assertThrows(
      () =>
        parseRequirementsBriefProvenance({
          ...raw,
          requirements: [first, {
            ...second,
            requirementId: first.requirementId,
          }],
        }),
      TypeError,
      "duplicates",
    );
  },
);

Deno.test(
  "parseRequirementsBriefProvenance rejects missing sourceRefs, invalid kinds and non-committing containers",
  async () => {
    const brief = syntheticBrief();
    const basis = syntheticBasis();
    const proposal = await tracedProposal(brief, basis);
    const provenance = await buildRequirementsBriefProvenance({
      brief,
      basis,
      proposal,
    });
    const raw = JSON.parse(JSON.stringify(provenance));

    assertThrows(
      () =>
        parseRequirementsBriefProvenance({
          ...raw,
          requirements: [{
            ...raw.requirements[0],
            sourceItem: { ...raw.requirements[0].sourceItem, sourceRefs: [] },
          }, raw.requirements[1]],
        }),
      TypeError,
      "sourceRefs",
    );
    assertThrows(
      () =>
        parseRequirementsBriefProvenance({
          ...raw,
          requirements: [{
            ...raw.requirements[0],
            sourceItem: {
              ...raw.requirements[0].sourceItem,
              sourceRefs: [{ kind: "invented", reference: "x" }],
            },
          }, raw.requirements[1]],
        }),
      TypeError,
      "kind",
    );
    assertThrows(
      () =>
        parseRequirementsBriefProvenance({
          ...raw,
          requirements: [{
            ...raw.requirements[0],
            sourceItem: {
              ...raw.requirements[0].sourceItem,
              kind: "constraint",
            },
          }, raw.requirements[1]],
        }),
      TypeError,
      "normative",
    );
    assertThrows(
      () =>
        parseRequirementsBriefProvenance({
          ...raw,
          container: {
            sourceItem: { ...raw.container.sourceItem, kind: "exclusion" },
          },
        }),
      TypeError,
      "exclusion",
    );
    assertThrows(
      () =>
        parseRequirementsBriefProvenance({
          ...raw,
          container: {
            sourceItem: { ...raw.container.sourceItem, kind: "open-question" },
          },
        }),
      TypeError,
      "open-question",
    );
  },
);

function syntheticBrief(
  options: { readonly container?: ProjectBriefItem } = {},
): ProjectBriefRevision {
  const container = options.container ?? {
    id: "mission-articulated-arm",
    kind: "mission-scenario" as const,
    statement: "The articulated arm carries the lamp head at full extension.",
    sourceRefs: SOURCE,
  };
  return {
    contractVersion: "2.0",
    briefId: "project-brief-provenance:brief",
    id: "project-brief-provenance:brief:r1:abcdef12",
    revision: 1,
    items: [
      {
        id: "objective",
        kind: "objective",
        statement: "Qualify an articulated arm against reviewed mechanical criteria.",
        sourceRefs: SOURCE,
      },
      container,
      {
        id: "constraint-budget",
        kind: "constraint",
        statement: "The arm keeps the reviewed material budget.",
        sourceRefs: SOURCE,
      },
      {
        id: "success-max-displacement",
        kind: "success-criterion",
        statement: "Maximum arm displacement stays at or below 2 mm under load.",
        sourceRefs: SOURCE,
        dependsOnItemIds: [],
      },
      {
        id: "success-max-stress",
        kind: "success-criterion",
        statement: "Maximum arm stress stays at or below 90 MPa under load.",
        sourceRefs: SOURCE,
        dependsOnItemIds: [],
      },
    ],
    proposedAt: "2026-08-14T09:00:00.000Z",
    proposedBy: { id: "agent:guide", origin: "agent" },
  };
}

function syntheticBasis(): EngineeringApprovedBriefBasis {
  return {
    kind: "approved-brief",
    projectId: "project-brief-provenance",
    projectSnapshotId: "project-brief-provenance:r3",
    projectRevision: 3,
    briefId: "project-brief-provenance:brief",
    briefSnapshotId: "project-brief-provenance:brief:r1:abcdef12",
    briefRevision: 1,
    approvedBriefFingerprint: {
      algorithm: "sha256",
      digest: "c".repeat(64),
    },
  };
}

async function tracedProposal(
  brief: ProjectBriefRevision,
  basis: EngineeringApprovedBriefBasis,
  options: { readonly containerSourceItemId?: string } = {},
): Promise<TracedRequirementsProposal> {
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
      basis,
      briefContentFingerprint: await sha256Fingerprint(brief),
      containerSourceItemId: options.containerSourceItemId ??
        "mission-articulated-arm",
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

function otherFingerprint(): ContentFingerprint {
  return { algorithm: "sha256", digest: "d".repeat(64) };
}
