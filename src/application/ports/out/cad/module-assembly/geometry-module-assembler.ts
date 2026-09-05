/** Provider-neutral driven port for one closed geometry-module assembly. */

import type { GeometryModuleAssemblyReceipt } from "../../../../../domain/cad/module-assembly/geometry-module-assembly-receipt.ts";
import type { GeometryModuleInputBundle } from "../../../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import type { ImmutableBytes } from "../../../../../domain/compile/source/provider-resource-reader.ts";

export interface GeometryModuleAssemblyCommand {
  readonly runId: string;
  readonly bundle: GeometryModuleInputBundle;
}

export interface GeometryModuleAssemblyResult {
  readonly receipt: GeometryModuleAssemblyReceipt;
  readonly assemblyStep: ImmutableBytes;
  readonly assemblyGlb: ImmutableBytes;
}

export interface GeometryModuleAssembler {
  assemble(
    command: GeometryModuleAssemblyCommand,
  ): Promise<GeometryModuleAssemblyResult>;
}

export class GeometryModuleAssemblyError extends Error {
  readonly code = "assembly_failure" as const;

  constructor(message: string) {
    super(message);
    this.name = "GeometryModuleAssemblyError";
  }
}
