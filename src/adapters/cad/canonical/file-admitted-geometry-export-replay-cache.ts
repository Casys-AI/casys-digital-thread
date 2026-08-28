/** Durable monotone replay/WAL records for canonical Build123d export. */

import {
  type AdmittedGeometryExportReplayCache,
  AdmittedGeometryExportReplayUnavailableError,
} from "../../../application/use-cases/cad/canonical/export-admitted-project-geometry.ts";
import type { ProjectAdmittedGeometryExportResult } from "../../../application/ports/in/cad/canonical/project-admitted-geometry-export.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { exactRecord, literalValue } from "../../../domain/kernel/case-validation.ts";
import { writeNewAttemptFileDurably } from "../../shared/wal/durable-attempt-file-writes.ts";

const SCHEMA = "admitted-geometry-export-replay/1.0" as const;
type State = "prepared" | "dispatching" | "recorded";

/**
 * Separate synced create-new records make a `dispatching` transition survive
 * restart. Build123d export has no idempotency key; a dispatching record with
 * no recorded result is therefore quarantined, never dispatched a second time.
 */
export class FileAdmittedGeometryExportReplayCache
  implements AdmittedGeometryExportReplayCache {
  constructor(private readonly directory: string) {}

  async prepare(key: ContentFingerprint): Promise<void> {
    const state = await this.#state(key);
    if (state === "dispatching") this.#ambiguous();
    if (state === "prepared" || state === "recorded") return;
    await this.#write(key, "prepared");
  }

  async dispatch(key: ContentFingerprint): Promise<void> {
    const state = await this.#state(key);
    if (state === "dispatching") this.#ambiguous();
    if (state === "recorded") return;
    if (state !== "prepared") {
      throw new AdmittedGeometryExportReplayUnavailableError(
        "The export dispatch has no durable preparation record.",
      );
    }
    await this.#write(key, "dispatching");
  }

  async read(
    key: ContentFingerprint,
  ): Promise<ProjectAdmittedGeometryExportResult | undefined> {
    const recorded = await this.#read(key, "recorded");
    if (recorded) return recorded.result!;
    if (await this.#read(key, "dispatching")) this.#ambiguous();
    await this.#read(key, "prepared");
    return undefined;
  }

  async save(
    key: ContentFingerprint,
    value: ProjectAdmittedGeometryExportResult,
  ): Promise<void> {
    const existing = await this.#read(key, "recorded");
    if (existing) {
      if (deterministicJson(existing.result) !== deterministicJson(value)) {
        throw new AdmittedGeometryExportReplayUnavailableError(
          "The durable replay key already names a different result.",
        );
      }
      return;
    }
    if (!await this.#read(key, "dispatching")) {
      throw new AdmittedGeometryExportReplayUnavailableError(
        "The captured draft has no durable dispatch boundary.",
      );
    }
    await this.#write(key, "recorded", value);
  }

  async #state(key: ContentFingerprint): Promise<State | undefined> {
    if (await this.#read(key, "recorded")) return "recorded";
    if (await this.#read(key, "dispatching")) return "dispatching";
    if (await this.#read(key, "prepared")) return "prepared";
    return undefined;
  }

  async #write(
    key: ContentFingerprint,
    state: State,
    result?: ProjectAdmittedGeometryExportResult,
  ): Promise<void> {
    await Deno.mkdir(this.directory, { recursive: true });
    const text = await serializeRecord(key, state, result);
    try {
      await writeNewAttemptFileDurably(
        this.#path(key, state),
        text,
        this.directory,
        "Admitted geometry export WAL made no durable write progress.",
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      // `dispatching` is the one non-idempotent provider claim. A matching
      // file proves another process won it; accepting equal bytes here would
      // authorize both callers to run build123d_export.
      if (state === "dispatching") {
        throw new AdmittedGeometryExportReplayUnavailableError(
          "The durable export dispatch claim belongs to another recovery owner.",
        );
      }
      const existing = await this.#read(key, state);
      if (
        !existing || deterministicJson(existing.result) !== deterministicJson(result)
      ) {
        throw new AdmittedGeometryExportReplayUnavailableError(
          "The durable replay transition collides with different facts.",
        );
      }
    }
  }

  async #read(
    key: ContentFingerprint,
    state: State,
  ): Promise<
    { readonly result: ProjectAdmittedGeometryExportResult | undefined } | undefined
  > {
    let text: string;
    try {
      text = await Deno.readTextFile(this.#path(key, state));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw new AdmittedGeometryExportReplayUnavailableError(
        "The durable replay record could not be read.",
      );
    }
    return await parseRecord(text, key, state);
  }

  #path(key: ContentFingerprint, state: State): string {
    return `${this.directory}/${key.digest}.${state}.json`;
  }

  #ambiguous(): never {
    throw new AdmittedGeometryExportReplayUnavailableError(
      "A prior Build123d export may have dispatched and requires recovery.",
    );
  }
}

async function serializeRecord(
  key: ContentFingerprint,
  state: State,
  result?: ProjectAdmittedGeometryExportResult,
): Promise<string> {
  const body = result === undefined
    ? { schemaVersion: SCHEMA, key, state }
    : { schemaVersion: SCHEMA, key, state, result };
  return deterministicJson({ ...body, fingerprint: await sha256Fingerprint(body) });
}

async function parseRecord(
  text: string,
  expectedKey: ContentFingerprint,
  expectedState: State,
): Promise<{ readonly result: ProjectAdmittedGeometryExportResult | undefined }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AdmittedGeometryExportReplayUnavailableError(
      "The durable replay record is malformed.",
    );
  }
  try {
    const object = exactRecord(
      parsed,
      expectedState === "recorded"
        ? ["schemaVersion", "key", "state", "result", "fingerprint"]
        : ["schemaVersion", "key", "state", "fingerprint"],
      "$replay",
    );
    literalValue(object.schemaVersion, SCHEMA, "$replay.schemaVersion");
    literalValue(object.state, expectedState, "$replay.state");
    const key = object.key as ContentFingerprint;
    const result = object.result as ProjectAdmittedGeometryExportResult | undefined;
    const body = result === undefined
      ? { schemaVersion: SCHEMA, key, state: expectedState }
      : { schemaVersion: SCHEMA, key, state: expectedState, result };
    if (
      !fingerprintsEqual(key, expectedKey) || !fingerprintsEqual(
        await sha256Fingerprint(body),
        object.fingerprint as ContentFingerprint,
      )
    ) throw new TypeError("Replay identity differs.");
    return { result: result === undefined ? undefined : structuredClone(result) };
  } catch {
    throw new AdmittedGeometryExportReplayUnavailableError(
      "The durable replay record does not match its exact identity.",
    );
  }
}
