/**
 * Documentary Thread requirement bindings for one sealed electrical
 * observation method-sheet criterion.
 *
 * The sealed method defines the requirement. Identity is versioned by the
 * method-sheet ContentFingerprint, never by an L4 evaluation capture.
 * Bound role is explicit and is never parsed back from an id.
 */

import { deepFreeze, nonEmptyText } from "../../../kernel/case-validation.ts";
import { requireSha256Fingerprint } from "../../../kernel/content-fingerprint.ts";
import { deterministicJson } from "../../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import type { TracedRequirement } from "../../../thread/thread-snapshot.ts";
import type {
  ElectricalObservationMethodCriterion,
  ElectricalObservationQuantityLiteral,
} from "../../observation-method-sheet.ts";

export type SpiceDocumentaryBoundRole = "limit" | "min" | "max";

export interface SpiceDocumentaryRequirementBinding {
  readonly criterionId: string;
  readonly boundRole: SpiceDocumentaryBoundRole;
  readonly requirementId: string;
  readonly name: string;
  readonly operator: "<=" | ">=";
  readonly limit: ElectricalObservationQuantityLiteral;
}

export function spiceDocumentaryRequirementBindings(input: {
  readonly criterion: ElectricalObservationMethodCriterion;
  readonly methodSheetFingerprint: ContentFingerprint;
}): readonly SpiceDocumentaryRequirementBinding[] {
  if (input.criterion.comparator === "between-inclusive") {
    return deepFreeze([
      spiceDocumentaryRequirementBinding({ ...input, boundRole: "min" }),
      spiceDocumentaryRequirementBinding({ ...input, boundRole: "max" }),
    ]);
  }
  return deepFreeze([
    spiceDocumentaryRequirementBinding({ ...input, boundRole: "limit" }),
  ]);
}

export function spiceDocumentaryRequirementBinding(input: {
  readonly criterion: ElectricalObservationMethodCriterion;
  readonly boundRole: SpiceDocumentaryBoundRole;
  readonly methodSheetFingerprint: ContentFingerprint;
}): SpiceDocumentaryRequirementBinding {
  const methodSheetFingerprint = requireSha256Fingerprint(
    input.methodSheetFingerprint,
    "methodSheetFingerprint",
  );
  const criterionId = nonEmptyText(input.criterion.id, "criterion.id");
  const bound = boundFor(input.criterion, input.boundRole);
  return deepFreeze({
    criterionId,
    boundRole: input.boundRole,
    requirementId:
      `electrical-observation-${criterionId}-${input.boundRole}-${methodSheetFingerprint.digest}`,
    name: bound.name,
    operator: bound.operator,
    limit: bound.limit,
  });
}

export function resolveSpiceDocumentaryRequirement(input: {
  readonly basisRequirements: readonly TracedRequirement[];
  readonly archivedRequirementIds: ReadonlySet<string>;
  readonly proposed: TracedRequirement;
}): {
  readonly requirement: TracedRequirement;
  readonly reused: boolean;
} {
  if (input.archivedRequirementIds.has(input.proposed.id)) {
    throw new TypeError(
      `Documentary requirement ${input.proposed.id} is archived on the basis snapshot.`,
    );
  }
  const matches = input.basisRequirements.filter((item) =>
    item.id === input.proposed.id
  );
  if (matches.length > 1) {
    throw new TypeError(
      `Documentary requirement ${input.proposed.id} is ambiguous on the basis snapshot.`,
    );
  }
  const existing = matches[0];
  if (existing === undefined) {
    return { requirement: input.proposed, reused: false };
  }
  if (
    documentaryRequirementSemantics(existing) !==
      documentaryRequirementSemantics(input.proposed)
  ) {
    throw new TypeError(
      `Documentary requirement ${input.proposed.id} conflicts with the basis snapshot.`,
    );
  }
  return { requirement: existing, reused: true };
}

function boundFor(
  criterion: ElectricalObservationMethodCriterion,
  boundRole: SpiceDocumentaryBoundRole,
): {
  readonly name: string;
  readonly operator: "<=" | ">=";
  readonly limit: ElectricalObservationQuantityLiteral;
} {
  if (criterion.comparator === "between-inclusive") {
    if (boundRole === "min") {
      const min = criterion.bounds?.min;
      if (min === undefined) {
        throw new TypeError(
          `Criterion ${criterion.id} is missing between-inclusive bounds.min.`,
        );
      }
      return { name: `${criterion.id} minimum`, operator: ">=", limit: min };
    }
    if (boundRole === "max") {
      const max = criterion.bounds?.max;
      if (max === undefined) {
        throw new TypeError(
          `Criterion ${criterion.id} is missing between-inclusive bounds.max.`,
        );
      }
      return { name: `${criterion.id} maximum`, operator: "<=", limit: max };
    }
    throw new TypeError(
      `Criterion ${criterion.id} between-inclusive boundRole must be min or max.`,
    );
  }
  if (boundRole !== "limit") {
    throw new TypeError(
      `Criterion ${criterion.id} comparator ${criterion.comparator} boundRole must be limit.`,
    );
  }
  if (criterion.comparator !== "<=" && criterion.comparator !== ">=") {
    throw new TypeError(
      `Criterion ${criterion.id} comparator ${criterion.comparator} is not a documentary bound.`,
    );
  }
  const threshold = criterion.threshold;
  if (threshold === undefined) {
    throw new TypeError(`Criterion ${criterion.id} is missing a threshold.`);
  }
  return { name: criterion.id, operator: criterion.comparator, limit: threshold };
}

function documentaryRequirementSemantics(requirement: TracedRequirement): string {
  return deterministicJson({
    id: requirement.id,
    name: requirement.name,
    statement: requirement.statement,
    version: requirement.version,
    criterion: requirement.criterion,
    trace: requirement.trace,
  });
}
