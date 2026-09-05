/**
 * Server-owned mapping from first-party catalogue materials to the sibling
 * non-persistent removal backends. Callers never supply a backend, image, or
 * runtime kind.
 */

import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  BUILD123D_ISOLATED_WORKER_UNIT_ID,
  BUILD123D_MICROSANDBOX_WORKER_CONTRACT,
} from "../cad/isolated/worker-contract.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "../cad/module-assembly/worker-contract.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "../electrical/spice/admitted/worker-contract.ts";
import { CALCULIX_MICROSANDBOX_WORKER_CONTRACT } from "../fea/isolated-v3/calculix-static-proof-v1/worker-contract.ts";
import { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "../fea/isolated-v3/local-calculix-image-reference.ts";
import { MODELICA_MICROSANDBOX_WORKER_CONTRACT } from "../modelica/qualified-kit/kit-v1/worker-contract.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "../electrical/spice/admitted/local-image-references.ts";
import type { ExactMicrosandboxImageExpectation } from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import {
  exactMicrosandboxMaterialArchitecture,
} from "./microsandbox-capability-runtime-cache.ts";
import {
  LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";

export function createFirstPartyNonpersistentMicrosandboxExpectations(
  catalog: CapabilityRuntimeCatalog,
): readonly {
  readonly material: { readonly unitId: string; readonly materialId: string };
  readonly image: ExactMicrosandboxImageExpectation;
}[] {
  const contracts = firstPartyMicrosandboxContracts();
  const result = [];
  for (const unit of catalog.units) {
    for (const material of unit.materials) {
      if (material.launchGroup !== null) continue;
      if (material.kind !== "microvm-image" || material.lifecycle !== "ephemeral") {
        continue;
      }
      const contract = contracts.get(`${unit.id}\u0000${material.id}`);
      if (!contract) {
        throw new Error(
          `First-party non-persistent removal lacks a Microsandbox contract for ${unit.id}/${material.id}.`,
        );
      }
      if (contract.reference !== material.imageReference) {
        throw new Error(
          `First-party Microsandbox contract drifted from catalogue ${unit.id}/${material.id}.`,
        );
      }
      result.push({
        material: { unitId: unit.id, materialId: material.id },
        image: {
          reference: material.imageReference,
          manifestDigest: material.imageReference.slice(
            material.imageReference.lastIndexOf("@") + 1,
          ),
          os: "linux" as const,
          architecture: exactMicrosandboxMaterialArchitecture(material.platforms),
          user: contract.user,
          entrypoint: contract.entrypoint,
        },
      });
    }
  }
  if (result.length !== contracts.size) {
    throw new Error(
      "First-party Microsandbox cache-removal contracts do not cover the catalogue.",
    );
  }
  return result;
}

function firstPartyMicrosandboxContracts(): ReadonlyMap<string, {
  readonly reference: string;
  readonly user: string;
  readonly entrypoint: readonly string[];
}> {
  return new Map([
    contract(
      BUILD123D_ISOLATED_WORKER_UNIT_ID,
      BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
      LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
      BUILD123D_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      [
        BUILD123D_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...BUILD123D_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    ),
    contract(
      "casys.geometry-module-assembler-worker",
      "geometry-module-assembler-worker-image",
      LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
      GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      [
        GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    ),
    contract(
      "casys.calculix-worker",
      "calculix-worker-image",
      LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
      CALCULIX_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      [
        CALCULIX_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...CALCULIX_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    ),
    contract(
      "casys.modelica-worker",
      "modelica-worker-image",
      LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
      MODELICA_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      [
        MODELICA_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...MODELICA_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    ),
    contract(
      "casys.spice-worker",
      "ngspice-runtime-image",
      LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
      NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      [
        NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    ),
  ]);
}

function contract(
  unitId: string,
  materialId: string,
  reference: string,
  user: string,
  entrypoint: readonly string[],
): [
  string,
  {
    readonly reference: string;
    readonly user: string;
    readonly entrypoint: readonly string[];
  },
] {
  return [`${unitId}\u0000${materialId}`, {
    reference: pinnedOciImageReference(
      reference,
      `$firstPartyMicrosandboxContract.${unitId}.${materialId}`,
    ),
    user,
    entrypoint,
  }];
}
