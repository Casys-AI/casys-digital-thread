export {
  canonicalCorrectedSourceCaptureText,
  CORRECTED_SOURCE_CAPTURE_SCHEMA,
  type CorrectedSourceCapture,
  validateCorrectedSourceCapture,
} from "../../../domain/sensitivity/correction-source/corrected-source-capture.ts";

export const CORRECTED_SOURCE_CAPTURE_URI_PREFIX =
  "casys://corrected-source-capture/sha256/" as const;
