/**
 * Read-only exact cache observer for the admitted ngspice distribution image.
 *
 * This is deliberately separate from Microsandbox: the Docker source image is
 * only a cache-only prerequisite for the sealed conversion performed by an
 * operator.  It never pulls, saves, imports, tags, or runs an image.
 */

import type { CapabilityRuntimeMaterialCache } from "../../../../application/control-plane/capability-runtime-execution-session.ts";
import type { CapabilityRuntimeStateObserver } from "../../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  type CapabilityRuntimeMaterialIdentity,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
} from "../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { samePinnedRepositoryDigest } from "../../../shared/docker-pinned-repository-digest.ts";
import {
  assertExactDockerNgspiceSourceImage,
  parseDockerNgspiceSourceInspection,
} from "./microsandbox-cache-preparation.ts";
import {
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
} from "./local-image-references.ts";

const NGSPICE_DOCKER_SOURCE_MATERIAL = Object.freeze({
  unitId: "casys.spice-worker",
  materialId: "ngspice-docker-source-image",
});
const NGSPICE_DOCKER_SOURCE_IMAGE_DIGEST = imageDigest(
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
);

/** A deliberately tiny read-only boundary so tests never invoke Docker. */
export interface NgspiceDockerSourceImageInspector {
  inspect(reference: string): Promise<unknown>;
}

/**
 * Attests only the exact locally-present source image.  An absent image or a
 * malformed inspection remains unavailable; this adapter cannot acquire it.
 */
export class LocalNgspiceDockerSourceImageCache
  implements CapabilityRuntimeMaterialCache, CapabilityRuntimeStateObserver {
  constructor(
    private readonly inspector: NgspiceDockerSourceImageInspector =
      localDockerSourceImageInspector(),
  ) {}

  async ensureExactCached(input: {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly imageReference: string;
  }): Promise<void> {
    assertExactInput(input);
    try {
      assertExactDockerNgspiceSourceImage(
        parseDockerNgspiceSourceInspection(
          await this.inspector.inspect(
            LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
          ),
        ),
      );
    } catch {
      throw unavailableSourceImageError();
    }
  }

  async observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    const requested = materials.filter(isNgspiceDockerSourceMaterialKey);
    if (requested.length === 0) return new Map();
    const installed = await this.#isExactlyCached();
    return new Map(requested.map((material) => [
      capabilityRuntimeMaterialKey(material),
      installed && isNgspiceDockerSourceMaterial(material)
        ? { material: "installed" as const, runtime: "inactive" as const }
        : { material: "absent" as const, runtime: "inactive" as const },
    ]));
  }

  async #isExactlyCached(): Promise<boolean> {
    try {
      assertExactDockerNgspiceSourceImage(
        parseDockerNgspiceSourceInspection(
          await this.inspector.inspect(
            LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
          ),
        ),
      );
      return true;
    } catch {
      return false;
    }
  }
}

function assertExactInput(input: {
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly imageReference: string;
}): void {
  if (
    !isNgspiceDockerSourceMaterial(input.material) ||
    input.material.imageDigest !== NGSPICE_DOCKER_SOURCE_IMAGE_DIGEST ||
    !samePinnedRepositoryDigest(
      input.imageReference,
      LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
    )
  ) {
    throw unavailableSourceImageError();
  }
}

function isNgspiceDockerSourceMaterial(
  material: CapabilityRuntimeMaterialIdentity,
): boolean {
  return isNgspiceDockerSourceMaterialKey(material) &&
    material.imageDigest === NGSPICE_DOCKER_SOURCE_IMAGE_DIGEST;
}

function isNgspiceDockerSourceMaterialKey(
  material: CapabilityRuntimeMaterialIdentity,
): boolean {
  return material.unitId === NGSPICE_DOCKER_SOURCE_MATERIAL.unitId &&
    material.materialId === NGSPICE_DOCKER_SOURCE_MATERIAL.materialId;
}

function unavailableSourceImageError(): Error {
  return new Error(
    "The exact local Docker ngspice source image is unavailable or does not attest its sealed worker contract.",
  );
}

function imageDigest(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  if (index < 0) throw new TypeError("ngspice Docker source image is not pinned.");
  return reference.slice(index + marker.length);
}

function localDockerSourceImageInspector(): NgspiceDockerSourceImageInspector {
  return Object.freeze({
    async inspect(reference: string): Promise<unknown> {
      const output = await new Deno.Command("docker", {
        args: ["image", "inspect", "--format", "{{json .}}", reference],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!output.success) throw unavailableSourceImageError();
      return JSON.parse(new TextDecoder().decode(output.stdout)) as unknown;
    },
  });
}
