/**
 * Read one server-catalogued mechanical proof declaration.
 *
 * Case identifiers, not filesystem paths, cross the application boundary.
 * The adapter owns the versioned manifest, root directory, and file integrity
 * checks.
 */
export interface CataloguedMechanicalProofCaseReader {
  list(): Promise<readonly { readonly caseId: string }[]>;
  read(caseId: string): Promise<string | undefined>;
}
