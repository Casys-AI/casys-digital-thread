/**
 * Unique Thread join of a sealed thermal method sheet for compilation recross.
 *
 * Zero seals is absence, not a gap. Two or more active seals fail closed.
 */

import type { ThermalMethodSheetCompilationJoin } from "../../../application/ports/out/compile/admission/thermal-method-sheet-compilation-join.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import type { ModelicaThermalMethodSheet } from "../../../domain/modelica/thermal-method-sheet.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../domain/project/engineering-project.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { ThermalMethodSheetSealCaptureStore } from "./verify-seal-modelica-thermal-method-sheet-run-executor.ts";
import { validateModelicaThermalMethodSheetSealCapture } from "./thermal-method-sheet-seal-capture.ts";

const OPERATION_REF =
  `${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version}`;

export class CaptureBackedThermalMethodSheetCompilationJoin
  implements ThermalMethodSheetCompilationJoin {
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly #captures: ThermalMethodSheetSealCaptureStore;
  readonly #sheets: ThermalMethodSheetStore;

  constructor(dependencies: {
    readonly snapshots: Pick<ThreadSnapshotStore, "get">;
    readonly captures: ThermalMethodSheetSealCaptureStore;
    readonly sheets: ThermalMethodSheetStore;
  }) {
    this.#snapshots = dependencies.snapshots;
    this.#captures = dependencies.captures;
    this.#sheets = dependencies.sheets;
  }

  async read(request: {
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
  }): Promise<ModelicaThermalMethodSheet | undefined> {
    const raw = await this.#snapshots.get(request.basis.snapshotId);
    if (!raw) return undefined;
    const snapshot = validateThreadSnapshot(raw);
    if (
      snapshot.id !== request.basis.snapshotId ||
      snapshot.revision !== request.basis.revision ||
      snapshot.subject.id !== request.basis.subjectId
    ) {
      throw new TypeError(
        "The thermal method-sheet compilation join reopened a foreign Thread snapshot.",
      );
    }
    const archived = archivedRefKeys(snapshot);
    const matches = snapshot.artifacts.filter((artifact) =>
      artifact.kind === "document" &&
      artifact.freshness.status === "fresh" &&
      artifact.producer.serverId === "digital-thread" &&
      artifact.producer.tool === OPERATION_REF &&
      !archived.has(`artifact:${artifact.id}`)
    );
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) {
      throw new TypeError(
        "The Thread basis has an ambiguous thermal method-sheet seal.",
      );
    }
    const artifact = matches[0]!;
    const captureText = await this.#captures.read(artifact.fingerprint);
    if (captureText === undefined) {
      throw new TypeError(
        "The thermal method-sheet seal capture is unavailable.",
      );
    }
    const capture = validateModelicaThermalMethodSheetSealCapture(
      JSON.parse(captureText),
    );
    if (capture.admission.projectId !== request.projectId) {
      throw new TypeError(
        "The thermal method-sheet seal belongs to another project.",
      );
    }
    const sheet = await this.#sheets.read(capture.sheet.fingerprint);
    if (!sheet) {
      throw new TypeError("The sealed thermal method sheet is unavailable.");
    }
    return sheet;
  }
}
