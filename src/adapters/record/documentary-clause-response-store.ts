/** Immutable documentary clause-response bytes stay distinct from requirement traces. */
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";

/** Writer and native Workbench reader share this CAS root. */
export const DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY =
  "state/local/documentary-clause-responses";

export function createDocumentaryClauseResponseStore(directory: string) {
  return fileTextCaptureStore(
    new FileByteStore({
      kind: "documentary-clause-response",
      directory,
      uriNamespace: "documentary-clause-response",
      label: "Documentary clause-response",
    }),
  );
}
