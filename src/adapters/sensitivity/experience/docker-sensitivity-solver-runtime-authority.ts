/** Read-only recross of the exact local CalculiX container image. */

import type { ContainerObserver } from "../../../application/control-plane/ports.ts";
import type { DesiredServer } from "../../../application/control-plane/read-model/fleet-manifest.ts";
import type { SensitivityExperienceSolverRuntimeIdentity } from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import type { SensitivityExperienceSolverRuntimeAuthority } from "./sensitivity-experience-coordinator.ts";

export class DockerSensitivitySolverRuntimeAuthority
  implements SensitivityExperienceSolverRuntimeAuthority {
  constructor(
    private readonly observer: ContainerObserver,
    private readonly server: DesiredServer,
  ) {}

  async attest(
    expected: SensitivityExperienceSolverRuntimeIdentity,
  ): Promise<boolean> {
    if (
      this.server.id !== "calculix" || this.server.image !== expected.imageReference
    ) {
      return false;
    }
    const observed = (await this.observer.observe([this.server])).get(this.server.id);
    if (
      !observed?.runtimeAvailable || !observed.present ||
      observed.state?.toLowerCase() !== "running" ||
      observed.health?.toLowerCase() === "unhealthy"
    ) return false;
    return observed.image === expected.imageReference ||
      (observed.repoDigests ?? []).includes(expected.imageReference);
  }
}
