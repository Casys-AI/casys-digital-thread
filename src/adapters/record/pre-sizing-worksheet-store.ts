/** Immutable pre-sizing worksheet bytes stay distinct from requirement traces. */
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";

/** Writer and native Workbench reader share this CAS root. */
export const DEFAULT_PRE_SIZING_WORKSHEET_DIRECTORY =
  "state/local/pre-sizing-worksheets";

export function createPreSizingWorksheetStore(directory: string) {
  return fileTextCaptureStore(
    new FileByteStore({
      kind: "pre-sizing-worksheet",
      directory,
      uriNamespace: "pre-sizing-worksheet",
      label: "Pre-sizing worksheet",
    }),
  );
}
