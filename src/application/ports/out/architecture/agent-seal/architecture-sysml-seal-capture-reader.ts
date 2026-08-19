/**
 * Outward reader for a sealed architecture SysML Thread document.
 *
 * Application and presentation code reopen exact CAS identities. They never
 * parse SysML or choose a frontend here.
 */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface ArchitectureSysmlSealCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}
