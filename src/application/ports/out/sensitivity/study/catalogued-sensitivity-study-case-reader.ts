/**
 * Read server-catalogued sensitivity-study templates by case identifier.
 *
 * Manifest and filesystem policy remain an adapter concern; callers cannot
 * select files or paths.
 */
export interface CataloguedSensitivityStudyCaseReader {
  list(): Promise<readonly { readonly caseId: string }[]>;
  read(caseId: string): Promise<string | undefined>;
}
