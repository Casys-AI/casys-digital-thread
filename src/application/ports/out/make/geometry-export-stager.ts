/**
 * Stage exact reviewed geometry bytes onto the shared provider export volume.
 *
 * Callers supply bytes, the attested digest, and a caller-owned filename.
 * The returned sha256 is computed from the staged bytes and must match.
 * Host paths and Docker handles stay behind the adapter.
 *
 * Used by measured DFM, documentary printability, and print-estimate observe
 * paths. This is not `SolverInputStager` (CalculiX private volume) and not a
 * CAD-only exporter.
 */

export interface GeometryExportStager {
  stage(input: {
    readonly bytes: Uint8Array;
    readonly digest: string;
    readonly fileName: string;
  }): Promise<{
    readonly path: string;
    readonly sha256: string;
    readonly byteCount: number;
  }>;
}
