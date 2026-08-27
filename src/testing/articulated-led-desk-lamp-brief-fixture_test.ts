import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { collectEngineeringProjectIssues } from "../domain/project/engineering-project-validation.ts";
import {
  engineeringProjectFramingStatus,
  projectBriefIndependentQuestionBranches,
  projectBriefItems,
} from "../domain/project/project-brief.ts";
import {
  ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES,
  ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
  ARTICULATED_LED_DESK_LAMP_INTENT,
  articulatedLedDeskLampBriefItems,
  seedApprovedArticulatedLedDeskLampBrief,
  seedArticulatedLedDeskLampBriefProposal,
} from "./articulated-led-desk-lamp-brief-fixture.ts";

const HISTORICAL_VEHICLE = /desk-lamp-dl\d+|cantilever-arm-ca02|\bca02\b|\bdl0[0-9]\b/i;
const SOLVER_PAYLOAD =
  /\b(?:calculix|\.inp\b|ngspice|netlist|openmodelica|\.mo\b|sysml text|aql)\b/i;
const PHYSICAL_QUANTITY = /\b\d+(?:\.\d+)?\s*(?:mm|MPa|Pa|kN|N|W|V|A|K|degC|°C|s)\b/i;

Deno.test(
  "fresh lamp brief proposes through the real command service without historical desk-lamp identities",
  async () => {
    const { project } = await seedArticulatedLedDeskLampBriefProposal();

    assertEquals(project.project.id, ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID);
    assertEquals(project.project.id === "desk-lamp-dl05", false);
    assertEquals(project.schemaVersion, "4.0");
    assertEquals(project.framing?.intent.statement, ARTICULATED_LED_DESK_LAMP_INTENT);
    assertEquals(engineeringProjectFramingStatus(project.framing!), "awaiting-review");
    assertEquals(project.framing?.currentBrief, undefined);
    assertEquals(project.framing?.proposalReview?.status, "pending");
    assertEquals(project.plan, undefined);
    assertEquals(project.threadSnapshots, []);
    assertEquals(collectEngineeringProjectIssues(project), []);

    const proposal = project.framing!.proposedBrief!;
    assertEquals(proposal.contractVersion, "2.0");
    assertMatch(proposal.briefId, /^articulated-led-desk-lamp:brief$/);
  },
);

Deno.test(
  "fresh lamp brief states three independent Behave questions without solver inputs or units",
  () => {
    const items = articulatedLedDeskLampBriefItems();
    const byId = new Map(items.map((item) => [item.id, item]));

    const mechanical = byId.get(
      ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.mechanicalSuccess,
    );
    const thermal = byId.get(ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.thermalSuccess);
    const electrical = byId.get(
      ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.electricalSuccess,
    );
    assertExists(mechanical);
    assertExists(thermal);
    assertExists(electrical);
    assertEquals(mechanical.kind, "success-criterion");
    assertEquals(thermal.kind, "success-criterion");
    assertEquals(electrical.kind, "success-criterion");
    assertEquals(mechanical.dependsOnItemIds, []);
    assertEquals(thermal.dependsOnItemIds, []);
    assertEquals(electrical.dependsOnItemIds, []);

    assertEquals(
      byId.get(ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.mechanicalVerification)
        ?.dependsOnItemIds,
      [ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.mechanicalSuccess],
    );
    assertEquals(
      byId.get(ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.thermalVerification)
        ?.dependsOnItemIds,
      [ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.thermalSuccess],
    );
    assertEquals(
      byId.get(ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.electricalVerification)
        ?.dependsOnItemIds,
      [ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES.electricalSuccess],
    );

    for (const item of items) {
      assertEquals(HISTORICAL_VEHICLE.test(item.statement), false, item.id);
      assertEquals(PHYSICAL_QUANTITY.test(item.statement), false, item.id);
      // Exclusions may name a forbidden surface. Committing items must not.
      if (item.kind !== "exclusion") {
        assertEquals(SOLVER_PAYLOAD.test(item.statement), false, item.id);
      }
    }
  },
);

Deno.test(
  "fresh lamp fixture keeps internal planning references opaque to the public source tree",
  () => {
    const references = articulatedLedDeskLampBriefItems().flatMap((item) =>
      item.sourceRefs.map((source) => source.reference)
    );

    assertEquals(references.some((reference) => reference.includes("/rfcs/")), false);
    assertEquals(
      references.some((reference) => reference.startsWith("private-history:")),
      true,
    );
  },
);

Deno.test(
  "fresh lamp brief keeps Make, Buy, certification, modal and assembly as exclusions",
  () => {
    const exclusions = projectBriefItems(
      {
        contractVersion: "2.0",
        briefId: "fixture",
        id: "fixture",
        revision: 1,
        items: articulatedLedDeskLampBriefItems(),
        proposedAt: "2026-08-21T12:00:00.000Z",
        proposedBy: { id: "agent:fixture", origin: "agent" },
      },
      "exclusion",
    );
    const ids = exclusions.map((item) => item.id);
    assertEquals(ids.includes("exclusion-make"), true);
    assertEquals(ids.includes("exclusion-buy"), true);
    assertEquals(ids.includes("exclusion-certification-safety"), true);
    assertEquals(ids.includes("exclusion-modal"), true);
    assertEquals(ids.includes("exclusion-full-assembly-joints"), true);
    assertEquals(ids.includes("exclusion-historical-relabel"), true);
  },
);

Deno.test(
  "fresh lamp brief keeps structure, mechanical inputs, thermal method, circuit and impact as open questions",
  () => {
    const questions = projectBriefItems(
      {
        contractVersion: "2.0",
        briefId: "fixture",
        id: "fixture",
        revision: 1,
        items: articulatedLedDeskLampBriefItems(),
        proposedAt: "2026-08-21T12:00:00.000Z",
        proposedBy: { id: "agent:fixture", origin: "agent" },
      },
      "open-question",
    );
    assertEquals(
      questions.map((item) => item.id),
      [
        "open-question-structure",
        "open-question-mechanical-inputs",
        "open-question-thermal-method",
        "open-question-electrical-circuit",
        "open-question-cross-domain-impact",
      ],
    );
  },
);

Deno.test(
  "fresh lamp brief projects three independent Behave questions without a combined verdict",
  () => {
    const brief = {
      contractVersion: "2.0" as const,
      briefId: "fixture",
      id: "fixture",
      revision: 1,
      items: articulatedLedDeskLampBriefItems(),
      proposedAt: "2026-08-21T12:00:00.000Z",
      proposedBy: { id: "agent:fixture", origin: "agent" as const },
    };
    const branches = projectBriefIndependentQuestionBranches(brief);
    const gates = ARTICULATED_LED_DESK_LAMP_BEHAVE_GATES;
    assertEquals(
      branches.map((branch) => ({
        id: branch.successCriterionId,
        verificationActivityIds: branch.verificationActivityIds,
        state: branch.state,
      })),
      [
        {
          id: gates.mechanicalSuccess,
          verificationActivityIds: [gates.mechanicalVerification],
          state: "declared",
        },
        {
          id: gates.thermalSuccess,
          verificationActivityIds: [gates.thermalVerification],
          state: "declared",
        },
        {
          id: gates.electricalSuccess,
          verificationActivityIds: [gates.electricalVerification],
          state: "declared",
        },
      ],
    );
    assertEquals(branches.some((branch) => (branch.state as string) === "pass"), false);
  },
);

Deno.test(
  "fixture approval canonicalises the brief without inventing a live product decision",
  async () => {
    const { project } = await seedApprovedArticulatedLedDeskLampBrief();
    assertEquals(engineeringProjectFramingStatus(project.framing!), "approved");
    assertEquals(project.framing?.currentBriefApproval?.status, "approved");
    assertEquals(project.framing?.currentBrief?.contractVersion, "2.0");
    assertEquals(
      project.framing?.currentBrief?.items.map((item) => item.id),
      articulatedLedDeskLampBriefItems().map((item) => item.id),
    );
    assertEquals(collectEngineeringProjectIssues(project), []);
  },
);
