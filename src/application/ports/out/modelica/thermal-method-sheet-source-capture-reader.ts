/**
 * Reopen one technical source-analysis capture named by a thermal method sheet.
 *
 * Callers receive role/language identities and bounded `{id,kind,name}`
 * symbols from the validated analysis bundle. Source bytes stay behind this
 * port. A CAD or non-Modelica capture is not a thermal method identity.
 */

import type { ThermalMethodSheetSourceIdentity } from "../../../../domain/modelica/thermal-method-sheet-recross.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface ThermalMethodSheetSourceCaptureReader {
  read(
    fingerprint: ContentFingerprint,
  ): Promise<ThermalMethodSheetSourceIdentity | undefined>;
}
