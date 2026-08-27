/**
 * File CAS adapters for geometry-module draft and capture records.
 *
 * They persist those records through the existing geometry-draft and
 * geometry-capture stores. They do not export, call a provider, or seal
 * Thread state.
 */

import {
  type GeometryModuleCapture,
  type GeometryModuleDraftCapture,
  parseGeometryModuleCapture,
  parseGeometryModuleDraftCapture,
} from "../../../domain/cad/canonical/geometry-module-evidence.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  GeometryModuleCaptureStore,
  GeometryModuleDraftStore,
  PersistedGeometryModuleCapture,
  PersistedGeometryModuleDraft,
} from "../../../application/ports/out/cad/canonical/geometry-module-evidence-store.ts";
import {
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";

export class GeometryModuleEvidenceStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeometryModuleEvidenceStoreIntegrityError";
  }
}

export class FileGeometryModuleDraftStore implements GeometryModuleDraftStore {
  readonly #store: FileCaptureStore<"geometry-draft">;

  constructor(
    store: FileCaptureStore<"geometry-draft"> = new FileCaptureStore(
      GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
    ),
  ) {
    this.#store = store;
  }

  async save(value: unknown): Promise<PersistedGeometryModuleDraft> {
    const unsigned = await parseGeometryModuleDraftCapture(value);
    const fingerprint = await sha256Fingerprint(unsigned);
    const canonical = deterministicJson(unsigned);
    await this.#store.save(fingerprint, canonical);
    const reread = await this.read(fingerprint);
    if (
      reread === undefined ||
      deterministicJson(omitFingerprint(reread)) !== canonical ||
      !fingerprintsEqual(reread.fingerprint, fingerprint)
    ) {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module draft failed its exact durable reread.",
      );
    }
    return Object.freeze({
      draft: reread,
      fingerprint,
      uri: this.#store.uriFor(fingerprint),
    });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<GeometryModuleDraftCapture | undefined> {
    const text = await this.#store.read(fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module draft is not JSON.",
      );
    }
    let unsigned: Omit<GeometryModuleDraftCapture, "fingerprint">;
    try {
      unsigned = await parseGeometryModuleDraftCapture(parsed);
    } catch {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module draft failed exact replay validation.",
      );
    }
    const observed = await sha256Fingerprint(unsigned);
    if (
      text !== deterministicJson(unsigned) ||
      !fingerprintsEqual(observed, fingerprint)
    ) {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module draft is non-canonical or divergent.",
      );
    }
    return Object.freeze({ ...unsigned, fingerprint });
  }
}

export class FileGeometryModuleCaptureStore implements GeometryModuleCaptureStore {
  readonly #store: FileCaptureStore<"geometry-capture">;

  constructor(
    store: FileCaptureStore<"geometry-capture"> = new FileCaptureStore(
      GEOMETRY_CAPTURE_DESCRIPTOR,
    ),
  ) {
    this.#store = store;
  }

  async save(value: unknown): Promise<PersistedGeometryModuleCapture> {
    const capture = await parseGeometryModuleCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    const canonical = deterministicJson(capture);
    await this.#store.save(fingerprint, canonical);
    const reread = await this.read(fingerprint);
    if (reread === undefined || deterministicJson(reread) !== canonical) {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module capture failed its exact durable reread.",
      );
    }
    return Object.freeze({
      capture: reread,
      fingerprint,
      uri: this.#store.uriFor(fingerprint),
    });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<GeometryModuleCapture | undefined> {
    const text = await this.#store.read(fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module capture is not JSON.",
      );
    }
    let capture: GeometryModuleCapture;
    try {
      capture = await parseGeometryModuleCapture(parsed);
    } catch {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module capture failed exact replay validation.",
      );
    }
    const observed = await sha256Fingerprint(capture);
    if (
      text !== deterministicJson(capture) ||
      !fingerprintsEqual(observed, fingerprint)
    ) {
      throw new GeometryModuleEvidenceStoreIntegrityError(
        "The geometry-module capture is non-canonical or divergent.",
      );
    }
    return capture;
  }

  uriFor(fingerprint: ContentFingerprint): string {
    return this.#store.uriFor(fingerprint);
  }
}

function omitFingerprint(
  draft: GeometryModuleDraftCapture,
): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  const { fingerprint: _fingerprint, ...unsigned } = draft;
  return unsigned;
}
