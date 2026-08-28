/**
 * Read-only host view for sealed persistent Compose groups.
 *
 * It observes only exact catalogue materials through their own read-only
 * runtime authority (enrolled Compose group or exact Microsandbox cache).
 * Other local images are neither claimed nor inspected. This keeps project
 * planning honest while avoiding a startup pull, service start, or speculative
 * host claim.
 */

import type { CapabilityRuntimeStateObserver } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeHostObservationReader } from "../../application/control-plane/project-capability-runtime-context-compiler.ts";
import {
  CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
  type CapabilityRuntimeCatalog,
  type CapabilityRuntimeHostObservation,
} from "../../application/control-plane/read-model/capability-runtime-catalog.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeHostIdentityReader } from "./file-capability-runtime-host-identity-store.ts";

export class GroupCapabilityRuntimeHostObservationReader
  implements CapabilityRuntimeHostObservationReader {
  constructor(
    private readonly catalog: CapabilityRuntimeCatalog,
    private readonly states: CapabilityRuntimeStateObserver,
    private readonly identity: CapabilityRuntimeHostIdentityReader,
  ) {}

  async read(): Promise<CapabilityRuntimeHostObservation> {
    const materials = this.catalog.units.flatMap((unit) =>
      unit.materials.map((material) => ({
        identity: {
          unitId: unit.id,
          materialId: material.id,
          imageDigest: digestFromReference(material.imageReference),
        },
        imageReference: material.imageReference,
      }))
    );
    const observed = await this.states.observe(
      materials.map((material) => material.identity),
    );
    return {
      schemaVersion: CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
      identityFingerprint: await this.identity.read(),
      platform: Deno.build.arch === "aarch64" ? "linux/arm64" : "linux/amd64",
      images: materials.filter((material) =>
        observed.get(capabilityRuntimeMaterialKey(material.identity))?.material ===
          "installed"
      ).map((material) => ({ reference: material.imageReference, sizeBytes: null })),
    };
  }
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
