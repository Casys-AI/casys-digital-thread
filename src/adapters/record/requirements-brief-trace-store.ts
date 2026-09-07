/** Immutable appendix bytes stay distinct from native requirements captures. */
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";

export function createRequirementsBriefTraceStore(
  requirementsCaptureDirectory: string,
) {
  return fileTextCaptureStore(
    new FileByteStore({
      kind: "requirements-brief-trace",
      directory: `${requirementsCaptureDirectory}/brief-traces`,
      uriNamespace: "requirements-brief-trace",
      label: "Retrospective documentary requirements brief trace",
    }),
  );
}
