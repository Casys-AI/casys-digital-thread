/**
 * Materialize isolated STEP bytes onto a private host cache, then stage them
 * into the CalculiX volume. The cache is not thread-assets and not a cad-model.
 */

import type { SolverInputStager } from "../../application/ports/out/solver-input-stager.ts";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { ContainerAssetStager } from "./container-asset-stager.ts";

export class IsolatedStepSolverStager implements SolverInputStager {
  constructor(
    private readonly hostCacheDirectory: string,
    private readonly container: ContainerAssetStager,
    private readonly writeFile: (
      path: string,
      bytes: Uint8Array,
    ) => Promise<void> = (path, bytes) => Deno.writeFile(path, bytes),
    private readonly readFile: (
      path: string,
    ) => Promise<Uint8Array> = (path) => Deno.readFile(path),
  ) {}

  async stage(input: {
    readonly bytes: Uint8Array;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }): Promise<{ readonly stagedAsset: { readonly location: string } }> {
    if (input.fingerprint.algorithm !== "sha256") {
      throw new TypeError("Staged STEP fingerprint must use sha256.");
    }
    if (input.bytes.byteLength !== input.byteCount) {
      throw new TypeError("Staged STEP byteCount does not match the supplied bytes.");
    }
    const fileName = `fea-${input.fingerprint.digest}.step`;
    const hostPath = `${this.hostCacheDirectory.replace(/\/$/, "")}/${fileName}`;
    await Deno.mkdir(this.hostCacheDirectory, { recursive: true });
    await this.writeFile(hostPath, input.bytes);
    const staged = await this.container.stage({
      sourcePath: hostPath,
      expectedDigest: input.fingerprint.digest,
      expectedBytes: input.byteCount,
      containerFileName: fileName,
    });
    return { stagedAsset: { location: staged.containerPath } };
  }

  async read(input: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }): Promise<Uint8Array | undefined> {
    if (input.fingerprint.algorithm !== "sha256") {
      throw new TypeError("Staged STEP fingerprint must use sha256.");
    }
    const fileName = `fea-${input.fingerprint.digest}.step`;
    const hostPath = `${this.hostCacheDirectory.replace(/\/$/, "")}/${fileName}`;
    let bytes: Uint8Array;
    try {
      bytes = await this.readFile(hostPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    if (bytes.byteLength !== input.byteCount) {
      throw new TypeError(
        "Cached isolated STEP byteCount does not match the WAL publication.",
      );
    }
    if (await fingerprintResourceBytes(bytes) !== input.fingerprint.digest) {
      throw new TypeError(
        "Cached isolated STEP digest does not match the WAL publication.",
      );
    }
    return bytes;
  }
}
