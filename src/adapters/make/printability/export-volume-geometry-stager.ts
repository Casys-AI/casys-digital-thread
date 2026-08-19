/**
 * Stages exact reviewed bytes onto the shared provider export volume.
 *
 * The filename is caller-owned. The returned sha256 is computed from the
 * staged bytes and must match the declared digest.
 */

import type { GeometryExportStager } from "../../../application/ports/out/make/geometry-export-stager.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";

export class ExportVolumeGeometryStager implements GeometryExportStager {
  constructor(
    private readonly directory: string,
    private readonly containerDirectory = "/exports",
  ) {}

  async stage(input: {
    readonly bytes: Uint8Array;
    readonly digest: string;
    readonly fileName: string;
  }): Promise<{
    readonly path: string;
    readonly sha256: string;
    readonly byteCount: number;
  }> {
    if (!/^[A-Za-z0-9._-]+$/.test(input.fileName)) {
      throw new TypeError("Staged export file name must be a safe basename.");
    }
    await Deno.mkdir(this.directory, { recursive: true });
    const hostPath = `${this.directory.replace(/\/$/, "")}/${input.fileName}`;
    await Deno.writeFile(hostPath, input.bytes);
    const sha256 = await fingerprintResourceBytes(await Deno.readFile(hostPath));
    if (sha256 !== input.digest) {
      throw new Error(
        `Staged export ${input.fileName} sha256 diverges from the declared digest.`,
      );
    }
    return {
      path: `${this.containerDirectory.replace(/\/$/, "")}/${input.fileName}`,
      sha256,
      byteCount: input.bytes.byteLength,
    };
  }
}
