/**
 * Code-owned identities for the Build123d module-assembler isolated run.
 *
 * This is not the untrusted Build123d closed-subset profile. The caller
 * supplies one closed input bundle; the image-owned worker supplies the
 * assembly algorithm. Success is not collision freedom or canonical geometry.
 */

import type {
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
} from "../../compile/isolation/isolated-code-execution.ts";
import { validateIsolatedCodeOutputManifest } from "../../compile/isolation/isolated-code-execution.ts";

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
