import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { parseArchitectureProposalParameters } from "../domain/architecture/renderer/architecture-proposal.ts";
import { collectEngineeringProjectIssues } from "../domain/project/engineering-project-validation.ts";
import { PrepareProjectBriefArchitectureReview } from "../application/use-cases/architecture/renderer/prepare-project-brief-architecture-review.ts";
import { ProjectBriefArchitectureReviewError } from "../application/use-cases/architecture/renderer/prepare-project-brief-architecture-review.ts";
import { PrepareProjectBriefRequirementsReview } from "../application/use-cases/architecture/requirements/prepare-project-brief-requirements-review.ts";
import {
  ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES,
  ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
  ARTICULATED_LED_DESK_LAMP_HANDLES,
  ARTICULATED_LED_DESK_LAMP_STRUCTURE,
  articulatedLedDeskLampStructureBriefItems,
  seedApprovedArticulatedLedDeskLampBrief,
  seedApprovedArticulatedLedDeskLampStructureBrief,
} from "./articulated-led-desk-lamp-brief-fixture.ts";

const PHYSICAL_QUANTITY = /\b\d+(?:\.\d+)?\s*(?:mm|MPa|Pa|kN|N|W|V|A|K|degC|°C|s)\b/i;

Deno.test(
  "fresh lamp architecture review compiles renderer-supported components from sourced structure constraints",
  async () => {
    const { store, project } = await seedApprovedArticulatedLedDeskLampStructureBrief();
    assertEquals(project.framing?.currentBrief?.revision, 2);
    assertEquals(collectEngineeringProjectIssues(project), []);
    for (const item of articulatedLedDeskLampStructureBriefItems()) {
      assertEquals(PHYSICAL_QUANTITY.test(item.statement), false, item.id);
    }

    const result = await new PrepareProjectBriefArchitectureReview({
      projects: store,
    }).execute({
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      ...ARTICULATED_LED_DESK_LAMP_STRUCTURE,
    });

    assertEquals(result.status, "resolved");
    assertEquals(result.diagnostics, []);
    assertExists(result.decisionParameters);
    const parsed = parseArchitectureProposalParameters(result.decisionParameters);
    assertEquals(parsed.packageName, "ArticulatedLedDeskLamp");
    assertEquals(parsed.system.name, "ArticulatedLedDeskLamp");
    assertEquals(
      parsed.components.map((component) => component.name),
      ["Base", "ArticulatedArm", "LampHead", "LedDriver", "PowerSupply"],
    );
    assertEquals(parsed.attributes ?? [], []);
  },
);

Deno.test(
  "fresh lamp architecture review compiles bare parameter handles without values, ports or flows",
  async () => {
    const { store } = await seedApprovedArticulatedLedDeskLampStructureBrief();
    const result = await new PrepareProjectBriefArchitectureReview({
      projects: store,
    }).execute({
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      ...ARTICULATED_LED_DESK_LAMP_STRUCTURE,
      attributes: [...ARTICULATED_LED_DESK_LAMP_HANDLES],
    });
    assertEquals(result.status, "resolved");
    assertExists(result.decisionParameters);
    const parsed = parseArchitectureProposalParameters(result.decisionParameters);
    assertEquals(
      parsed.attributes?.map((attribute) => attribute.name),
      [
        "armLever",
        "armMaterial",
        "lampHeadThermalState",
        "ledDriverElectrical",
        "electricalPower",
      ],
    );
    assertEquals(
      parsed.attributes?.every((attribute) =>
        Object.keys(attribute).every((key) => key === "name" || key === "parentName")
      ),
      true,
    );
    const traced = new Set(result.provenance.map((entry) => entry.parameterKey));
    for (const parameter of result.decisionParameters) {
      assertEquals(traced.has(parameter.key), true, parameter.key);
    }
  },
);

Deno.test(
  "fresh lamp architecture review refuses structure traced to the unresolved structure question",
  async () => {
    const { store } = await seedApprovedArticulatedLedDeskLampBrief();
    const result = await new PrepareProjectBriefArchitectureReview({
      projects: store,
    }).execute({
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      packageName: "ArticulatedLedDeskLamp",
      packageSourceItemId: "objective",
      systemName: "ArticulatedLedDeskLamp",
      systemSourceItemId: "open-question-structure",
      components: [],
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(result.diagnostics.map((item) => item.code), [
      "brief-item-not-committing",
    ]);
  },
);

Deno.test(
  "fresh lamp architecture review refuses ports, flows and value-bearing extras",
  async () => {
    const { store } = await seedApprovedArticulatedLedDeskLampStructureBrief();
    const review = new PrepareProjectBriefArchitectureReview({ projects: store });

    const ports = await assertRejects(
      () =>
        review.execute({
          projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
          ...ARTICULATED_LED_DESK_LAMP_STRUCTURE,
          ports: [],
        }),
      ProjectBriefArchitectureReviewError,
    );
    assertEquals(ports.code, "invalid_request");

    const valuedAttribute = await assertRejects(
      () =>
        review.execute({
          projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
          ...ARTICULATED_LED_DESK_LAMP_STRUCTURE,
          attributes: [{
            slug: "armLever",
            name: "armLever",
            parent: "ArticulatedArm",
            sourceItemId: "constraint-arm",
            value: "invented",
            unit: "mm",
          }],
        }),
      ProjectBriefArchitectureReviewError,
    );
    assertEquals(valuedAttribute.code, "invalid_request");
  },
);

Deno.test(
  "fresh lamp requirements review refuses thresholds traced to an open-question or exclusion",
  async () => {
    const { store } = await seedApprovedArticulatedLedDeskLampStructureBrief();
    const review = new PrepareProjectBriefRequirementsReview({ projects: store });

    const fromOpenQuestion = await review.execute({
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      containerComponent: "ArticulatedArm",
      containerSourceItemId: "constraint-arm",
      requirements: [{
        slug: "arm-displacement",
        name: "Maximum arm displacement",
        metric: "arm_max_displacement",
        operator: "<=",
        threshold: 2,
        unit: "mm",
        sourceItemId: "open-question-mechanical-inputs",
      }],
    });
    assertEquals(fromOpenQuestion.status, "unresolved");
    assertEquals(fromOpenQuestion.decisionParameters, undefined);
    assertEquals(fromOpenQuestion.diagnostics.map((item) => item.code), [
      "brief-item-not-normative",
    ]);

    const fromExclusion = await review.execute({
      projectId: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      containerComponent: "ArticulatedArm",
      containerSourceItemId: "constraint-arm",
      requirements: [{
        slug: "arm-displacement",
        name: "Maximum arm displacement",
        metric: "arm_max_displacement",
        operator: "<=",
        threshold: 2,
        unit: "mm",
        sourceItemId: "exclusion-make",
      }],
    });
    assertEquals(fromExclusion.status, "unresolved");
    assertEquals(fromExclusion.diagnostics.map((item) => item.code), [
      "brief-item-not-normative",
    ]);

    const gates = ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES;
    const criterion = articulatedLedDeskLampStructureBriefItems().find(
      (item) => item.id === gates.mechanicalSuccess,
    );
    assertExists(criterion);
    assertEquals(PHYSICAL_QUANTITY.test(criterion.statement), false);
  },
);
