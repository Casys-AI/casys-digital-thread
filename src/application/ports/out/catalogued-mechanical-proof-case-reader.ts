/**
 * Read one server-catalogued mechanical proof declaration.
 *
 * The application may name only a path already selected from the code-owned
 * catalogue. Filesystem access and missing-file semantics stay outside the
 * application layer.
 */
export interface CataloguedMechanicalProofCaseReader {
  read(path: string): Promise<string | undefined>;
}
