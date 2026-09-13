/** Immutable documentary clause-response bytes stay distinct from requirement traces. */
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";

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
