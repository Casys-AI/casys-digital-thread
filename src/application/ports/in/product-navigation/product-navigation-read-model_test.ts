import { assertEquals } from "@std/assert";
import { attachmentsForDefinition } from "./product-navigation-read-model.ts";

Deno.test(
  "attachmentsForDefinition joins scoped requirements without a constrained_by graph edge",
  () => {
    const attachments = attachmentsForDefinition(
      { nodes: [], edges: [] },
      "20e71742-390d-4c6d-a91c-120debab5aa8",
      undefined,
      [{
        requirementId: "requirement-44c478-maxDisplacement",
        name: "Maximum displacement",
        sourceElementId: "122501cd-54d6-4aa9-b6a6-50b361ee2168",
        artifactId: "requirements-StandBackrest-44c478",
        targetElementId: "20e71742-390d-4c6d-a91c-120debab5aa8",
        status: "unresolved",
      }, {
        requirementId: "requirement-other",
        name: "Other",
        sourceElementId: "usage-other",
        artifactId: "requirements-other",
        targetElementId: "part-definition:other",
        status: "unresolved",
      }],
    );
    assertEquals(attachments.requirements, [{
      group: "requirements",
      kind: "requirement",
      id: "requirement-44c478-maxDisplacement",
      label: "Maximum displacement",
    }]);
  },
);

Deno.test(
  "attachmentsForDefinition keeps an existing constrained_by edge and does not duplicate it",
  () => {
    const attachments = attachmentsForDefinition(
      {
        nodes: [{
          ref: { kind: "requirement", id: "requirement-graph" },
          label: "Graph",
        }],
        edges: [{
          relation: "constrained_by",
          from: { kind: "part-definition", id: "def-rail" },
          to: { kind: "requirement", id: "requirement-graph" },
        }],
      },
      "def-rail",
      undefined,
      [{
        requirementId: "requirement-graph",
        name: "Scoped same id",
        sourceElementId: "usage",
        artifactId: "requirements",
        targetElementId: "def-rail",
        status: "unresolved",
      }],
    );
    assertEquals(attachments.requirements, [{
      group: "requirements",
      kind: "requirement",
      id: "requirement-graph",
      label: "Graph",
    }]);
  },
);
