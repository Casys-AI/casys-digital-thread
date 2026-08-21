/**
 * Outward CAS seam for one LED-driver human source.
 *
 * Application code captures exact UTF-8 then reopens the same identities.
 * It never hashes after a silent rewrite and never chooses a provider or
 * D1 representation.
 */

import type { LedDriverHumanSource } from "../../../../domain/electrical/led-driver/led-driver-human-source.ts";
import type { LedDriverSourceCaptureDocument } from "../../../../domain/electrical/led-driver/led-driver-source-capture.ts";

export interface ReopenedLedDriverSourceCapture {
  readonly reference: LedDriverSourceCaptureDocument;
  readonly sourceText: string;
  readonly source: LedDriverHumanSource;
}

export interface LedDriverSourceCaptureReader {
  capture(sourceText: string): Promise<LedDriverSourceCaptureDocument>;
  reopen(value: unknown): Promise<ReopenedLedDriverSourceCapture>;
}
