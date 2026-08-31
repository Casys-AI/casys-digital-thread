/**
 * One local, durable, read-only composition shared by the MCP server and
 * native Workbench. It owns neither a Docker mutation port nor a project
 * command. The server separately composes its mutation/supervisor path.
 */

import { ProjectCapabilityRuntimeContextCompiler } from "../../application/control-plane/project-capability-runtime-context-compiler.ts";
import { ProjectCapabilityWorkbenchProjector } from "../../application/control-plane/project-capability-workbench.ts";
import type { CapabilityRuntimeSecretSlotObserver } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { listRegisteredEngineeringOperations } from "../../orchestration/operations/registry.ts";
import {
  BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  BUILD123D_ISOLATED_WORKER_UNIT_ID,
  BUILD123D_MICROSANDBOX_WORKER_CONTRACT,
} from "../cad/isolated/worker-contract.ts";
import {
  NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT,
} from "../electrical/spice/admitted/worker-contract.ts";
import {
  LocalNgspiceDockerSourceImageCache,
} from "../electrical/spice/admitted/ngspice-docker-source-image-cache.ts";
import { CALCULIX_MICROSANDBOX_WORKER_CONTRACT } from "../fea/isolated-v3/calculix-static-proof-v1/worker-contract.ts";
import { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "../fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import {
  MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT,
} from "../modelica/admitted/closed-subset-v2/worker-contract.ts";
import { LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE } from "./first-party-capability-runtime-identities.ts";
import {
  createLocalMicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { CompositeCapabilityRuntimeStateObserver } from "./composite-capability-runtime-state-observer.ts";
import { createCapabilityRuntimeHostObserver } from "./compose-capability-runtime-host.ts";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeAdminPolicyStore,
  FileCapabilityRuntimeJournal,
} from "./file-capability-runtime-host-stores.ts";
import { FileCapabilityRuntimeQualificationAttemptStore } from "./file-capability-runtime-qualification-attempt-store.ts";
import { FileCapabilityRuntimeQualificationAttestationStore } from "./file-capability-runtime-qualification-attestation-store.ts";
import { FileProjectCapabilityLedgerStore } from "./file-project-capability-ledger-store.ts";
import {
  createFirstPartyCapabilityRuntimeCatalog,
  createFirstPartyChronoRolloverPredecessorUnit,
  createFirstPartySysonRolloverPredecessorUnit,
  firstPartyAdmittedModelicaHistoryPredecessor,
  firstPartyBuild123dObservationHistoryPredecessor,
  firstPartyBuild123dSandboxHistoryPredecessor,
  firstPartyGeometryModuleAssemblerHistoryPredecessor,
} from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "./first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "./first-party-capability-runtime-qualification-specifications.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroupRegistry } from "./first-party-capability-runtime-launch-groups.ts";
import { GroupCapabilityRuntimeHostObservationReader } from "./group-capability-runtime-host-observation-reader.ts";
import { FileCapabilityRuntimeHostIdentityStore } from "./file-capability-runtime-host-identity-store.ts";
import {
  exactMicrosandboxMaterialArchitecture,
  LocalMicrosandboxCapabilityRuntimeCache,
  type MicrosandboxCapabilityRuntimeImageExpectation,
} from "./microsandbox-capability-runtime-cache.ts";

export interface LocalCapabilityRuntimeReadCompositionOptions {
  readonly ledgerDirectory?: string;
  /**
   * Optional process-local secret availability observer. The MCP server passes
   * its sealed resolver; read-only compositions default to unavailable and
   * never read host secrets merely to render the Workbench.
   */
  readonly secrets?: CapabilityRuntimeSecretSlotObserver;
  /**
   * The server's code-owned CalculiX execution profile. Omit in a read-only
   * BFF process: it may observe the exact cache but cannot use it to execute.
   */
  readonly calculixExecutionProfile?: {
    readonly imageReference: string;
    readonly imageDigest: ContentFingerprint;
    readonly profileFingerprint: ContentFingerprint;
  };
  /**
   * The server's code-owned Build123d execution profile. Omit in a read-only
   * BFF process: it may observe the exact cache but cannot use it to execute.
   */
  readonly build123dExecutionProfile?: {
    readonly imageReference: string;
    readonly imageDigest: ContentFingerprint;
    readonly profileFingerprint: ContentFingerprint;
  };
  /**
   * The server's code-owned admitted Modelica profile. It is supplied only
   * when the actual worker composition exists; a profile-only construction is
   * not an executable host composition.
   */
  readonly admittedModelicaExecutionProfile?: {
    readonly imageReference: string;
    readonly imageDigest: ContentFingerprint;
    readonly profileFingerprint: ContentFingerprint;
  };
  /**
   * The server's code-owned admitted SPICE profile. It binds the executable
   * Microsandbox runtime, never its separate Docker source-cache material.
   */
  readonly admittedSpiceExecutionProfile?: {
    readonly imageReference: string;
    readonly imageDigest: ContentFingerprint;
    readonly profileFingerprint: ContentFingerprint;
  };
}

export interface LocalCapabilityRuntimeReadComposition {
  readonly catalog: Awaited<
    ReturnType<typeof createFirstPartyCapabilityRuntimeCatalog>
  >;
  readonly launchGroups: Awaited<
    ReturnType<typeof createFirstPartyCapabilityRuntimeLaunchGroupRegistry>
  >;
  readonly journal: FileCapabilityRuntimeJournal;
  readonly secrets: CapabilityRuntimeSecretSlotObserver;
  readonly composeObserver: ReturnType<typeof createCapabilityRuntimeHostObserver>;
  readonly microsandbox: LocalMicrosandboxCapabilityRuntimeCache;
  readonly cache: LocalNgspiceDockerSourceImageCache;
  readonly states: CompositeCapabilityRuntimeStateObserver;
  readonly host: GroupCapabilityRuntimeHostObservationReader;
  readonly policy: FileCapabilityRuntimeAdminPolicyStore;
  readonly lock: FileCapabilityRuntimeAdminLockStore;
  readonly hostIdentity: FileCapabilityRuntimeHostIdentityStore;
  readonly qualifications: FileCapabilityRuntimeQualificationAttestationStore;
  readonly qualificationAttempts: FileCapabilityRuntimeQualificationAttemptStore;
  readonly ledgers: FileProjectCapabilityLedgerStore;
  readonly contexts: ProjectCapabilityRuntimeContextCompiler;
  readonly workbench: ProjectCapabilityWorkbenchProjector;
}

/**
 * Reads exact current host state only. The only Docker interactions are
 * `compose ps`, container/image inspect, and Microsandbox image inspection;
 * none can start, stop, pull, remove, or create a runtime.
 */
export async function createLocalCapabilityRuntimeReadComposition(
  options: LocalCapabilityRuntimeReadCompositionOptions = {},
): Promise<LocalCapabilityRuntimeReadComposition> {
  const [
    catalog,
    predecessorSysonUnit,
    predecessorChronoUnit,
    launchGroups,
    qualificationCandidates,
    qualificationSpecs,
  ] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createFirstPartySysonRolloverPredecessorUnit(),
    createFirstPartyChronoRolloverPredecessorUnit(),
    createFirstPartyCapabilityRuntimeLaunchGroupRegistry(),
    createFirstPartyCapabilityRuntimeQualificationCandidates(),
    createFirstPartyCapabilityRuntimeQualificationSpecifications(),
  ]);
  const journal = new FileCapabilityRuntimeJournal();
  const secrets: CapabilityRuntimeSecretSlotObserver = options.secrets ?? {
    observe: (slots) =>
      Promise.resolve(
        new Map(slots.map((slot) => [slot, "unavailable" as const])),
      ),
  };
  const composeObserver = createCapabilityRuntimeHostObserver({
    registry: launchGroups,
    journal,
    secrets,
  });
  const calculixWorker = catalog.units.find((unit) =>
    unit.id === "casys.calculix-worker"
  )?.materials.find((material) => material.id === "calculix-worker-image");
  if (!calculixWorker) {
    throw new Error(
      "The code-owned catalog is missing casys.calculix-worker/calculix-worker-image.",
    );
  }
  const build123dWorker = catalog.units.find((unit) =>
    unit.id === BUILD123D_ISOLATED_WORKER_UNIT_ID
  )?.materials.find((material) =>
    material.id === BUILD123D_ISOLATED_WORKER_MATERIAL_ID
  );
  if (!build123dWorker) {
    throw new Error(
      `The code-owned catalog is missing ${BUILD123D_ISOLATED_WORKER_UNIT_ID}/${BUILD123D_ISOLATED_WORKER_MATERIAL_ID}.`,
    );
  }
  const microsandboxExpectations: MicrosandboxCapabilityRuntimeImageExpectation[] = [{
    material: {
      unitId: "casys.calculix-worker",
      materialId: "calculix-worker-image",
    },
    image: {
      reference: options.calculixExecutionProfile?.imageReference ??
        LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
      manifestDigest: options.calculixExecutionProfile
        ? `sha256:${options.calculixExecutionProfile.imageDigest.digest}`
        : LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE.slice(
          LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE.lastIndexOf("@") + 1,
        ),
      os: "linux",
      architecture: exactMicrosandboxMaterialArchitecture(
        calculixWorker.platforms,
      ),
      user: CALCULIX_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      entrypoint: [
        CALCULIX_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...CALCULIX_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    },
    executionProfileFingerprint: options.calculixExecutionProfile?.profileFingerprint,
  }, {
    material: {
      unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
      materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
    },
    image: {
      reference: options.build123dExecutionProfile?.imageReference ??
        LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
      manifestDigest: options.build123dExecutionProfile
        ? `sha256:${options.build123dExecutionProfile.imageDigest.digest}`
        : LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE.slice(
          LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE.lastIndexOf("@") + 1,
        ),
      os: "linux",
      architecture: exactMicrosandboxMaterialArchitecture(
        build123dWorker.platforms,
      ),
      user: BUILD123D_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
      entrypoint: [
        BUILD123D_MICROSANDBOX_WORKER_CONTRACT.executable,
        ...BUILD123D_MICROSANDBOX_WORKER_CONTRACT.args,
      ],
    },
    executionProfileFingerprint: options.build123dExecutionProfile
      ?.profileFingerprint,
  }];
  if (options.admittedModelicaExecutionProfile) {
    const admittedModelicaWorker = catalog.units.find((unit) =>
      unit.id === "casys.modelica-worker"
    )?.materials.find((material) => material.id === "modelica-admitted-worker-image");
    if (!admittedModelicaWorker) {
      throw new Error(
        "The code-owned catalog is missing casys.modelica-worker/modelica-admitted-worker-image.",
      );
    }
    microsandboxExpectations.push({
      material: {
        unitId: "casys.modelica-worker",
        materialId: "modelica-admitted-worker-image",
      },
      image: {
        reference: options.admittedModelicaExecutionProfile.imageReference,
        manifestDigest:
          `sha256:${options.admittedModelicaExecutionProfile.imageDigest.digest}`,
        os: "linux",
        architecture: exactMicrosandboxMaterialArchitecture(
          admittedModelicaWorker.platforms,
        ),
        user: MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
        entrypoint: [
          MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.executable,
          ...MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.args,
        ],
      },
      executionProfileFingerprint: options.admittedModelicaExecutionProfile
        .profileFingerprint,
    });
  }
  if (options.admittedSpiceExecutionProfile) {
    const admittedSpiceWorker = catalog.units.find((unit) =>
      unit.id === "casys.spice-worker"
    )?.materials.find((material) => material.id === "ngspice-runtime-image");
    if (!admittedSpiceWorker) {
      throw new Error(
        "The code-owned catalog is missing casys.spice-worker/ngspice-runtime-image.",
      );
    }
    microsandboxExpectations.push({
      material: {
        unitId: "casys.spice-worker",
        materialId: "ngspice-runtime-image",
      },
      image: {
        reference: options.admittedSpiceExecutionProfile.imageReference,
        manifestDigest:
          `sha256:${options.admittedSpiceExecutionProfile.imageDigest.digest}`,
        os: "linux",
        architecture: exactMicrosandboxMaterialArchitecture(
          admittedSpiceWorker.platforms,
        ),
        user: NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
        entrypoint: [
          NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.executable,
          ...NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.args,
        ],
      },
      executionProfileFingerprint: options.admittedSpiceExecutionProfile
        .profileFingerprint,
    });
  }
  const microsandbox = new LocalMicrosandboxCapabilityRuntimeCache(
    createLocalMicrosandboxSdk,
    microsandboxExpectations,
  );
  const cache = new LocalNgspiceDockerSourceImageCache();
  const groupMaterialKeys = (await launchGroups.list()).flatMap((group) =>
    group.materials.map((member) => capabilityRuntimeMaterialKey(member.material))
  );
  const microsandboxMaterialKeys = [
    "casys.calculix-worker\u0000calculix-worker-image",
    capabilityRuntimeMaterialKey({
      unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
      materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
    }),
    ...(options.admittedModelicaExecutionProfile
      ? ["casys.modelica-worker\u0000modelica-admitted-worker-image"]
      : []),
    ...(options.admittedSpiceExecutionProfile
      ? ["casys.spice-worker\u0000ngspice-runtime-image"]
      : []),
  ];
  const states = new CompositeCapabilityRuntimeStateObserver([
    { observer: composeObserver, materialKeys: groupMaterialKeys },
    {
      observer: microsandbox,
      materialKeys: microsandboxMaterialKeys,
    },
    ...(options.admittedSpiceExecutionProfile
      ? [{
        observer: cache,
        materialKeys: ["casys.spice-worker\u0000ngspice-docker-source-image"],
      }]
      : []),
  ]);
  const policy = new FileCapabilityRuntimeAdminPolicyStore(undefined, catalog);
  const lock = new FileCapabilityRuntimeAdminLockStore(undefined, catalog, {
    transitionPredecessors: currentCatalogTransitionPredecessors(
      catalog,
      [
        predecessorSysonUnit,
        predecessorChronoUnit,
        firstPartyBuild123dSandboxHistoryPredecessor(),
        firstPartyBuild123dObservationHistoryPredecessor(),
        firstPartyGeometryModuleAssemblerHistoryPredecessor(),
        firstPartyAdmittedModelicaHistoryPredecessor(),
      ],
    ),
  });
  const hostIdentity = new FileCapabilityRuntimeHostIdentityStore();
  const qualifications = new FileCapabilityRuntimeQualificationAttestationStore();
  const qualificationAttempts = new FileCapabilityRuntimeQualificationAttemptStore();
  const ledgers = new FileProjectCapabilityLedgerStore(options.ledgerDirectory);
  const host = new GroupCapabilityRuntimeHostObservationReader(
    catalog,
    states,
    hostIdentity,
    composeObserver,
  );
  const contexts = new ProjectCapabilityRuntimeContextCompiler({
    registry: { list: listRegisteredEngineeringOperations },
    catalog,
    qualificationSpecs,
    qualificationCandidates,
    policy,
    host,
    lock,
    qualifications,
    qualificationAttempts,
    ledgers,
  });
  return {
    catalog,
    launchGroups,
    journal,
    secrets,
    composeObserver,
    microsandbox,
    cache,
    states,
    host,
    policy,
    lock,
    hostIdentity,
    qualifications,
    qualificationAttempts,
    ledgers,
    contexts,
    workbench: new ProjectCapabilityWorkbenchProjector({ contexts, states }),
  };
}

function currentCatalogTransitionPredecessors(
  catalog: LocalCapabilityRuntimeReadComposition["catalog"],
  predecessors: readonly {
    readonly id: string;
    readonly version: string;
    readonly manifestFingerprint: ContentFingerprint;
  }[],
) {
  return predecessors.map((predecessor) => {
    const successor = catalog.units.find((unit) => unit.id === predecessor.id);
    if (!successor) {
      throw new Error(
        `The code-owned local-lock transition predecessor ${predecessor.id} has no current catalogue successor.`,
      );
    }
    return {
      predecessor: {
        id: predecessor.id,
        version: predecessor.version,
        manifestFingerprint: structuredClone(predecessor.manifestFingerprint),
      },
      successor: {
        id: successor.id,
        version: successor.version,
        manifestFingerprint: structuredClone(successor.manifestFingerprint),
      },
    };
  });
}
