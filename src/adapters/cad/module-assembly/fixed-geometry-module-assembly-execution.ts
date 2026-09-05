/** Adapter-private identities for the current Build123d module-assembly worker. */

import type {
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { validateIsolatedCodeOutputManifest } from "../../../domain/compile/isolation/isolated-code-execution.ts";

export const GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE = Object.freeze(
  {
    id: "build123d-module-assembler-v1",
    version: "1.0.0",
  } as const satisfies IsolatedCodeProfileRef,
);

export const GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST:
  readonly IsolatedCodeOutputDeclaration[] = validateIsolatedCodeOutputManifest([
    {
      role: "assembly.glb",
      basename: "assembly.glb",
      mediaType: "model/gltf-binary",
      format: "glb",
    },
    {
      role: "assembly.step",
      basename: "assembly.step",
      mediaType: "model/step",
      format: "step-ap214",
    },
  ]);

export const GEOMETRY_MODULE_ASSEMBLY_OUTPUT_VALIDATOR = Object.freeze({
  id: "geometry-module-assembly-output-validator",
  version: "1.0.0",
});

export interface GeometryModuleAssemblyRequestProfile {
  readonly executionProfile: IsolatedCodeProfileRef;
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
}
