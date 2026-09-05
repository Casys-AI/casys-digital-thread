/**
 * Read-only host view for sealed persistent Compose groups.
 *
 * It observes only exact catalogue materials through their own read-only
 * runtime authority (enrolled Compose group or exact Microsandbox cache).
 * A scoped `read({ materials })` inspects only that closed set. An unscoped
 * `read()` is the explicit full-catalogue path for administration and
 * qualification. Other local images are neither claimed nor inspected. This
 * keeps project planning honest while avoiding a startup pull, service start,
 * or speculative host claim.
 */

import type {
  CapabilityRuntimeHostPlatformObserver,
  CapabilityRuntimeStateObserver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeHostObservationReader,
  CapabilityRuntimeHostObservationScope,
} from "../../application/control-plane/project-capability-runtime-context-compiler.ts";
import {
  CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
  type CapabilityRuntimeCatalog,
  type CapabilityRuntimeHostObservation,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeHostIdentityReader } from "./file-capability-runtime-host-identity-store.ts";

export class GroupCapabilityRuntimeHostObservationReader
  implements CapabilityRuntimeHostObservationReader {
  constructor(
    private readonly catalog: CapabilityRuntimeCatalog,
    private readonly states: CapabilityRuntimeStateObserver,
    private readonly identity: CapabilityRuntimeHostIdentityReader,
    private readonly platform: CapabilityRuntimeHostPlatformObserver,
  ) {}

  async read(
    scope?: CapabilityRuntimeHostObservationScope,
  ): Promise<CapabilityRuntimeHostObservation> {
    const catalogMaterials = this.catalog.units.flatMap((unit) =>
      unit.materials.map((material) => ({
        identity: {
          unitId: unit.id,
          materialId: material.id,
          imageDigest: digestFromReference(material.imageReference),
        },
        imageReference: material.imageReference,
      }))
    );
    const materials = selectCatalogMaterials(catalogMaterials, scope?.materials);
    const observed = await this.states.observe(
      materials.map((material) => material.identity),
    );
    return {
      schemaVersion: CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
      identityFingerprint: await this.identity.read(),
      platform: await this.platform.observePlatform(),
      images: materials.filter((material) =>
        observed.get(capabilityRuntimeMaterialKey(material.identity))?.material ===
          "installed"
      ).map((material) => ({ reference: material.imageReference, sizeBytes: null })),
    };
  }
}

function selectCatalogMaterials<
  T extends {
    readonly identity: {
      readonly unitId: string;
      readonly materialId: string;
      readonly imageDigest: string;
    };
  },
>(
  catalogMaterials: readonly T[],
  requested: CapabilityRuntimeHostObservationScope["materials"] | undefined,
): readonly T[] {
  if (requested === undefined) return catalogMaterials;
  const catalogByKey = new Map(
    catalogMaterials.map((material) => [
      capabilityRuntimeMaterialKey(material.identity),
      material,
    ]),
  );
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const identity of requested) {
    const key = capabilityRuntimeMaterialKey(identity);
    const catalogued = catalogByKey.get(key);
    if (!catalogued || catalogued.identity.imageDigest !== identity.imageDigest) {
      throw new TypeError(
        `Host observation requested ${identity.unitId}/${identity.materialId} absent from the current catalogue.`,
      );
    }
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(catalogued);
  }
  return selected;
}

function digestFromReference(reference: string): string {
  const digest = reference.slice(reference.lastIndexOf("@sha256:") + "@sha256:".length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(
      "Grouped capability runtime material must use an exact SHA-256 image reference.",
    );
  }
  return digest;
}
