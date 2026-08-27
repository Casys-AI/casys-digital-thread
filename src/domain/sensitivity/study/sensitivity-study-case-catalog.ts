export type CataloguedSensitivityCaseSelection =
  | { readonly status: "ok"; readonly caseId: string }
  | {
    readonly status: "unresolved";
    readonly code: "catalog-absent" | "catalog-ambiguous";
    readonly caseIds: readonly string[];
    readonly message: string;
  };

/**
 * Pick the unique catalogued study template for a project. Ambiguity stays
 * unresolved; the review never picks a sibling project's case.
 */
export function selectUniqueCataloguedSensitivityCase(
  projectId: string,
  cases: readonly { readonly caseId: string; readonly projectId: string }[],
): CataloguedSensitivityCaseSelection {
  const matches = cases.filter((item) => item.projectId === projectId);
  if (matches.length === 1) {
    return { status: "ok", caseId: matches[0]!.caseId };
  }
  if (matches.length === 0) {
    return {
      status: "unresolved",
      code: "catalog-absent",
      caseIds: [],
      message:
        `No catalogued sensitivity-study template binds project.id "${projectId}". ` +
        "Name an exact caseId, add a reviewed template to the catalog, or seal a unique " +
        "sensitivity catalog offer with the FEA proof.",
    };
  }
  const caseIds = matches.map((item) => item.caseId);
  return {
    status: "unresolved",
    code: "catalog-ambiguous",
    caseIds,
    message:
      `Several catalogued sensitivity-study templates bind project.id "${projectId}": ` +
      `${caseIds.join(", ")}. Name the exact caseId.`,
  };
}

/** Server-owned append identities compiled from the case id. */
export function sensitivityStudySealIdentities(caseId: string): {
  readonly workItemId: string;
  readonly decisionId: string;
} {
  return {
    workItemId: `wi-sensitivity-seal-${caseId}`,
    decisionId: `dec-sensitivity-seal-${caseId}`,
  };
}
