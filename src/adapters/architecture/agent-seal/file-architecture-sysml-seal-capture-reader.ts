/**
 * Filesystem adapter for `architecture-sysml-seal-capture/1.0` JSON.
 *
 * Paths stay inside FileByteStore. Callers receive canonical UTF-8 text only.
 */

import type { ArchitectureSysmlSealCaptureReader } from "../../../application/ports/out/architecture/agent-seal/architecture-sysml-seal-capture-reader.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";

export function fileArchitectureSysmlSealCaptureReader(
  store: FileByteStore<"architecture-sysml-seal-capture">,
): ArchitectureSysmlSealCaptureReader {
  return {
    async read(fingerprint) {
      const stored = await store.read(fingerprint);
      if (stored === undefined) return undefined;
      return new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
}
