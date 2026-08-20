export type CataloguedProofCaseSelection =
  | { readonly status: "ok"; readonly caseId: string }
  | {
    readonly status: "unresolved";
    readonly code: "catalog-absent" | "catalog-ambiguous";
    readonly caseIds: readonly string[];
    readonly message: string;
  };

/**
 * Pick the unique catalogued case for a project. Ambiguity stays unresolved;
 * the review never picks a sibling case.
 */
export function selectUniqueCataloguedProofCase(
  projectId: string,
  cases: readonly { readonly caseId: string; readonly projectId: string }[],
): CataloguedProofCaseSelection {
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
        `No catalogued proof case binds project.id "${projectId}". Name an exact caseId or add the case to the catalog.`,
    };
  }
  const caseIds = matches.map((item) => item.caseId);
  return {
    status: "unresolved",
    code: "catalog-ambiguous",
    caseIds,
    message: `Several catalogued proof cases bind project.id "${projectId}": ` +
      `${caseIds.join(", ")}. Name the exact caseId.`,
  };
}
