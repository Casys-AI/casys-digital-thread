/**
 * Server-owned join from a sensitivity-study case id to its reviewed template.
 *
 * WHY DOMAIN — the seal executor, the read-only seal review, and operator
 * tooling must share one map. Keeping it in the adapter forced reviews to
 * import adapters. The executor never derives a path from the id; an unknown
 * id is refused before any file is opened.
 *
 * EXTENSION RULE — a new study case adds exactly one entry here and one JSON
 * template at the declared path. Tests that stub file contents still resolve a
 * catalogued id; they do not invent a new one. desk-lamp-dl06 / Heron has no
 * reviewed catalog JSON; a signed catalog-offer on the Thread tip is a
 * different authority.
 */

export const SENSITIVITY_STUDY_CASE_SOURCES: ReadonlyMap<string, string> = new Map([
  [
    "dl04-size-z-sensitivity",
    "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
  ],
  [
    "dl05-arm-thickness-sensitivity",
    "config/sensitivity-study-cases/dl05-arm-thickness-sensitivity.json",
  ],
  [
    "dl05-arm-thickness-isolated",
    "config/sensitivity-study-cases/dl05-arm-thickness-isolated.json",
  ],
]);

export function sensitivityStudyCaseSourcePath(
  caseId: string,
): string | undefined {
  return SENSITIVITY_STUDY_CASE_SOURCES.get(caseId);
}

export function isKnownSensitivityStudyCaseId(caseId: string): boolean {
  return SENSITIVITY_STUDY_CASE_SOURCES.has(caseId);
}

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
        "sensitivity catalog offer with the FEA proof. " +
        "desk-lamp-dl06 has no reviewed catalog JSON.",
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
