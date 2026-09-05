/** Routes one sealed non-persistent removal plan to its catalog-derived backend. */

import type {
  CapabilityRuntimeNonpersistentMaterialRemovalObservation,
  CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  CapabilityRuntimeNonpersistentMaterialRemovalPlan,
  CapabilityRuntimeNonpersistentRemovalBackend,
  CapabilityRuntimeNonpersistentRemovalMaterial,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import type {
  AuthorizedNonpersistentMaterialRemoval,
  CapabilityRuntimeNonpersistentMaterialRemovalHost,
} from "../../application/ports/out/capability/capability-runtime-nonpersistent-material-removal.ts";
import type { DockerCacheCapabilityRuntimeMaterialRemovalHost } from "./docker-cache-capability-runtime-material-removal.ts";
import type { MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost } from "./microsandbox-cache-capability-runtime-material-removal.ts";

export class LocalNonpersistentMaterialRemovalHost
  implements CapabilityRuntimeNonpersistentMaterialRemovalHost {
  constructor(
    private readonly docker: DockerCacheCapabilityRuntimeMaterialRemovalHost,
    private readonly microsandbox:
      MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost,
  ) {}

  inspect(input: {
    readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
    readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalObservation> {
    return input.backend === "docker-cache"
      ? this.docker.inspect({ material: input.material })
      : this.microsandbox.inspect({ material: input.material });
  }

  mutate(input: {
    readonly authorization: AuthorizedNonpersistentMaterialRemoval;
    readonly plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan;
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome> {
    return input.plan.backend === "docker-cache"
      ? this.docker.mutate(input)
      : this.microsandbox.mutate(input);
  }
}
