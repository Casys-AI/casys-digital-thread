import { assertEquals, assertThrows } from "@std/assert";
import { validElectricalObservationMethodSheet } from "../../../../testing/electrical-observation-method-sheet-fixtures.ts";
import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import type { TracedRequirement } from "../../../thread/thread-snapshot.ts";
import {
  validateElectricalObservationMethodSheet,
} from "../../observation-method-sheet.ts";
import {
  resolveSpiceDocumentaryRequirement,
  spiceDocumentaryRequirementBinding,
  spiceDocumentaryRequirementBindings,
} from "./spice-documentary-requirement-binding.ts";

const FIRST: ContentFingerprint = { algorithm: "sha256", digest: "c".repeat(64) };
const SECOND: ContentFingerprint = { algorithm: "sha256", digest: "d".repeat(64) };

function sheet() {
  return validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
}

function proposedFromBinding(
  binding: ReturnType<typeof spiceDocumentaryRequirementBinding>,
): TracedRequirement {
  return {
    id: binding.requirementId,
    name: `Electrical observation ${binding.name}`,
    statement: "Reviewed brief gate evaluated by the sealed method sheet.",
    version: FIRST.digest,
    criterion: {
      metric: binding.criterionId,
      operator: binding.operator,
      limit: binding.limit,
    },
    trace: {
      sourceArtifactId: "electrical-observation-method-sheet-seal",
      elementId: "success-criterion-node-voltage",
      targetArtifactIds: ["electrical-observation-method-sheet-seal"],
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-21T12:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

Deno.test(
  "documentary requirement id is versioned by the method-sheet fingerprint",
  () => {
    const criterion = sheet().criteria[0]!;
    const first = spiceDocumentaryRequirementBinding({
      criterion,
      boundRole: "limit",
      methodSheetFingerprint: FIRST,
    });
    const again = spiceDocumentaryRequirementBinding({
      criterion,
      boundRole: "limit",
      methodSheetFingerprint: FIRST,
    });
    const second = spiceDocumentaryRequirementBinding({
      criterion,
      boundRole: "limit",
      methodSheetFingerprint: SECOND,
    });
    assertEquals(first, again);
    assertEquals(first.criterionId, criterion.id);
    assertEquals(first.boundRole, "limit");
    assertEquals(first.operator, "<=");
    assertEquals(first.limit, { value: 3, unit: "V" });
    assertEquals(
      first.requirementId,
      `electrical-observation-${criterion.id}-limit-${FIRST.digest}`,
    );
    assertEquals(first.requirementId === second.requirementId, false);
    assertEquals(second.requirementId.endsWith(SECOND.digest), true);
  },
);

Deno.test(
  "between-inclusive maps explicit min and max bounds without regex",
  () => {
    const criterion = sheet().criteria[1]!;
    const bindings = spiceDocumentaryRequirementBindings({
      criterion,
      methodSheetFingerprint: FIRST,
    });
    assertEquals(bindings.map((item) => item.boundRole), ["min", "max"]);
    assertEquals(bindings.map((item) => item.operator), [">=", "<="]);
    assertEquals(bindings.map((item) => item.limit), [
      { value: 1, unit: "A" },
      { value: 4, unit: "A" },
    ]);
    assertEquals(bindings[0]?.name, `${criterion.id} minimum`);
    assertEquals(bindings[1]?.name, `${criterion.id} maximum`);
    assertEquals(
      bindings[0]?.requirementId.includes("-min-"),
      true,
    );
    assertEquals(
      bindings[1]?.requirementId.includes("-max-"),
      true,
    );
    assertEquals(criterion.id.includes("min"), false);
    assertThrows(
      () =>
        spiceDocumentaryRequirementBinding({
          criterion,
          boundRole: "limit",
          methodSheetFingerprint: FIRST,
        }),
      TypeError,
      "boundRole must be min or max",
    );
  },
);

Deno.test(
  "same documentary requirement identity is reused; divergent content fails closed",
  () => {
    const criterion = sheet().criteria[0]!;
    const binding = spiceDocumentaryRequirementBinding({
      criterion,
      boundRole: "limit",
      methodSheetFingerprint: FIRST,
    });
    const proposed = proposedFromBinding(binding);
    const published = resolveSpiceDocumentaryRequirement({
      basisRequirements: [],
      archivedRequirementIds: new Set(),
      proposed,
    });
    assertEquals(published.reused, false);
    const reused = resolveSpiceDocumentaryRequirement({
      basisRequirements: [{
        ...proposed,
        freshness: {
          status: "fresh",
          changedAt: "2026-01-01T00:00:00.000Z",
          invalidatedByChangeIds: [],
        },
      }],
      archivedRequirementIds: new Set(),
      proposed,
    });
    assertEquals(reused.reused, true);
    assertEquals(reused.requirement.id, proposed.id);
    assertEquals(
      reused.requirement.freshness.changedAt,
      "2026-01-01T00:00:00.000Z",
    );
    assertThrows(
      () =>
        resolveSpiceDocumentaryRequirement({
          basisRequirements: [{
            ...proposed,
            statement: "Divergent sealed-method statement.",
          }],
          archivedRequirementIds: new Set(),
          proposed,
        }),
      TypeError,
      "conflicts with the basis snapshot",
    );
  },
);

Deno.test(
  "explicit archived documentary requirement identity is refused",
  () => {
    const criterion = sheet().criteria[0]!;
    const binding = spiceDocumentaryRequirementBinding({
      criterion,
      boundRole: "limit",
      methodSheetFingerprint: FIRST,
    });
    const proposed = proposedFromBinding(binding);
    assertThrows(
      () =>
        resolveSpiceDocumentaryRequirement({
          basisRequirements: [proposed],
          archivedRequirementIds: new Set([proposed.id]),
          proposed,
        }),
      TypeError,
      "archived on the basis snapshot",
    );
    assertThrows(
      () =>
        resolveSpiceDocumentaryRequirement({
          basisRequirements: [],
          archivedRequirementIds: new Set([proposed.id]),
          proposed,
        }),
      TypeError,
      "archived on the basis snapshot",
    );
  },
);

Deno.test("documentary requirement binding refuses an invalid method-sheet fingerprint", () => {
  const criterion = sheet().criteria[0]!;
  assertThrows(
    () =>
      spiceDocumentaryRequirementBinding({
        criterion,
        boundRole: "limit",
        methodSheetFingerprint: { algorithm: "sha256", digest: "C".repeat(64) },
      }),
    TypeError,
    "sha256 64-lowercase-hex",
  );
});
