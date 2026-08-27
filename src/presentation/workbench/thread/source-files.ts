/**
 * Disposable Workbench read model for exact project source files.
 *
 * Identities are fileId + fileRevision recrossed against one named workspace
 * revision. This catalog is not product authority and is never a second
 * hierarchy beside SysML.
 */

export const THREAD_SOURCE_FILE_CATALOG_SCHEMA = "thread-source-files/1.0" as const;

export type ThreadSourceFileCatalogStatus =
  | "observed"
  | "unattached"
  | "unavailable";

export type ThreadSourceFileBindingRelation = "represents" | "parameterizes";

export interface ThreadSourceFileBinding {
  relation: ThreadSourceFileBindingRelation;
  sourceSymbolId: string;
  sysmlElementId: string;
  sysmlElementKind: string;
}

export interface ThreadSourceFileRecord {
  fileId: string;
  fileRevision: number;
  workspaceRevision: number;
  workspaceEventFingerprint: string;
  fileFingerprint: string;
  resourceFingerprint: string;
  resourceUri: string;
  resourceName: string;
  mimeType: string;
  moduleId: string;
  role: string;
  admissionArtifactId: string;
  bindings: ThreadSourceFileBinding[];
  derivedPath?: string;
}

export interface ThreadSourceFileCatalog {
  schemaVersion: typeof THREAD_SOURCE_FILE_CATALOG_SCHEMA;
  status: ThreadSourceFileCatalogStatus;
  files: ThreadSourceFileRecord[];
}

export function unavailableThreadSourceFileCatalog(): ThreadSourceFileCatalog {
  return {
    schemaVersion: THREAD_SOURCE_FILE_CATALOG_SCHEMA,
    status: "unavailable",
    files: [],
  };
}

export function unattachedThreadSourceFileCatalog(): ThreadSourceFileCatalog {
  return {
    schemaVersion: THREAD_SOURCE_FILE_CATALOG_SCHEMA,
    status: "unattached",
    files: [],
  };
}

export function sourceFileGraphRefId(
  fileId: string,
  fileRevision: number,
): string {
  return `${fileId}@${fileRevision}`;
}
