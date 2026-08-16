export {
  CORRECTED_SOURCE_CAPTURE_SCHEMA,
  canonicalCorrectedSourceCaptureText,
  validateCorrectedSourceCapture,
  type CorrectedSourceCapture,
} from "../../domain/analysis/corrected-source-capture.ts";

export const CORRECTED_SOURCE_CAPTURE_URI_PREFIX =
  "casys://corrected-source-capture/sha256/" as const;
