/** File-backed closed manifest CAS; no provider or workbench dependency. */

import type {
  CrossDomainImpactManifestReader,
  CrossDomainImpactManifestReference,
  ReopenedCrossDomainImpactManifest,
} from "../../application/ports/out/impact/cross-domain-impact-manifest-reader.ts";
import {
  crossDomainImpactManifestUri,
} from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import {
  validateCrossDomainImpactManifest,
  type CrossDomainImpactManifest,
} from "../../domain/impact/cross-domain-impact-manifest.ts";
import { deterministicJson, fingerprintsEqual, sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";

export interface CrossDomainImpactManifestStoreReceipt {
  readonly reference: CrossDomainImpactManifestReference;
  readonly uri: string;
}

/**
 * Stores full canonical manifest documents under their own content address.
 * The manifest's embedded fingerprint remains the body fingerprint; it must
 * not be repurposed as a file name because the embedded field is excluded from
 * that body digest.
 */
export class FileCrossDomainImpactManifestStore
  implements CrossDomainImpactManifestReader {
  readonly #captures: FileCaptureStore<"cross-domain-impact-manifest">;

  constructor(captures: FileCaptureStore<"cross-domain-impact-manifest">) {
    this.#captures = captures;
  }

  async save(
    value: CrossDomainImpactManifest,
  ): Promise<CrossDomainImpactManifestStoreReceipt> {
    const manifest = await validateCrossDomainImpactManifest(value);
    const reference = await sha256Fingerprint(manifest);
    const stored = await this.#captures.save(reference, deterministicJson(manifest));
    const reopened = await this.read({ fingerprint: reference });
    if (!reopened || deterministicJson(reopened.manifest) !== deterministicJson(manifest)) {
      throw new Error("Cross-domain impact manifest was not exactly readable after capture save.");
    }
    return { reference: { fingerprint: reference }, uri: stored.uri };
  }

  async read(
    reference: CrossDomainImpactManifestReference,
  ): Promise<ReopenedCrossDomainImpactManifest | undefined> {
    const text = await this.#captures.read(reference.fingerprint);
    if (text === undefined) return undefined;
    const manifest = await validateCrossDomainImpactManifest(JSON.parse(text));
    const actual = await sha256Fingerprint(manifest);
    if (!fingerprintsEqual(actual, reference.fingerprint)) {
      throw new TypeError("Reopened cross-domain impact manifest does not match its requested content address.");
    }
    const uri = this.#captures.uriFor(actual);
    if (uri !== crossDomainImpactManifestUri(actual)) {
      throw new TypeError("Cross-domain impact manifest store uses an unexpected CAS URI namespace.");
    }
    return {
      reference: { fingerprint: actual },
      uri,
      manifest,
    };
  }

  uriFor(fingerprint: ContentFingerprint): string {
    return this.#captures.uriFor(fingerprint);
  }
}
