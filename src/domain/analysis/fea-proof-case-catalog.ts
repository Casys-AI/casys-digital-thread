/**
 * Server-owned join from a mechanical proof-case id to its reviewed JSON file.
 *
 * WHY DOMAIN — the seal executor, the read-only seal review, and operator
 * tooling must share one map. Keeping it in the adapter forced reviews to
 * import adapters. The executor never derives a path from the id; an unknown
 * id is refused before any file is opened.
 *
 * EXTENSION RULE — a new proof case adds exactly one entry here and one JSON
 * file at the declared path. Tests that stub file contents still resolve a
 * catalogued id; they do not invent a new one.
 */

export const FEA_PROOF_CASE_SOURCES: ReadonlyMap<string, string> = new Map([
  [
    "desk-lamp-dl01-articulated-arm-cantilever-v1",
    "config/mechanical-proof-cases/desk-lamp-dl01-articulated-arm-cantilever.json",
  ],
  [
    "desk-lamp-dl03-arm-cantilever",
    "config/mechanical-proof-cases/desk-lamp-dl03-arm-cantilever.json",
  ],
  [
    "desk-lamp-dl04-arm-cantilever",
    "config/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json",
  ],
  [
    "desk-lamp-dl05-arm-cantilever",
    "config/mechanical-proof-cases/desk-lamp-dl05-arm-cantilever.json",
  ],
  [
    "desk-lamp-dl06-arm-cantilever",
    "config/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
  ],
]);

export function feaProofCaseSourcePath(caseId: string): string | undefined {
  return FEA_PROOF_CASE_SOURCES.get(caseId);
}

export function isKnownFeaProofCaseId(caseId: string): boolean {
  return FEA_PROOF_CASE_SOURCES.has(caseId);
}

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
