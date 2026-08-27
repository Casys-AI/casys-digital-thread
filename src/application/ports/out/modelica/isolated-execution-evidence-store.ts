import type {
  ModelicaIsolatedExecutionCapture,
} from "../../../../domain/modelica/qualified-kit/isolated-execution-evidence.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface PersistedModelicaIsolatedExecutionCapture {
  readonly capture: ModelicaIsolatedExecutionCapture;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface ModelicaIsolatedExecutionCaptureStore {
  save(
    capture: ModelicaIsolatedExecutionCapture,
  ): Promise<PersistedModelicaIsolatedExecutionCapture>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<ModelicaIsolatedExecutionCapture | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}
