/**
 * Provider-free LED-driver source capture/review composition.
 *
 * Construction never receives a provider URL, tool client, or ngspice
 * handle. Capture writes draft CAS only; review reopens one opaque locator.
 * Neither grants a seal, run, D1, or Thread write.
 */

import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { LedDriverSourceCaptureService } from "./led-driver-source-capture.ts";
import { PrepareProjectLedDriverSourceCapture } from "../../../application/use-cases/electrical/led-driver/prepare-project-led-driver-source-capture.ts";
import { PrepareProjectLedDriverSourceReview } from "../../../application/use-cases/electrical/led-driver/prepare-project-led-driver-source-review.ts";
import type { ReopenAgentResource } from "../../../application/use-cases/resource/reopen-agent-resource.ts";

export interface LedDriverSourceCompositionPaths {
  readonly recordedAnalysisDirectory: string;
  readonly resources: ReopenAgentResource;
}

export interface LedDriverSourceComposition {
  readonly ledDriverSourceCapture: PrepareProjectLedDriverSourceCapture;
  readonly ledDriverSourceReview: PrepareProjectLedDriverSourceReview;
}

export function createLedDriverSourceComposition(
  paths: LedDriverSourceCompositionPaths,
): LedDriverSourceComposition {
  const captures = new LedDriverSourceCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "led-driver-source",
      directory: `${paths.recordedAnalysisDirectory}/electrical/led-driver-source`,
      uriNamespace: "led-driver-source",
      label: "Captured LED-driver human source",
    }),
  });
  return {
    ledDriverSourceCapture: new PrepareProjectLedDriverSourceCapture({
      captures,
      resources: paths.resources,
    }),
    ledDriverSourceReview: new PrepareProjectLedDriverSourceReview({
      captures,
    }),
  };
}
