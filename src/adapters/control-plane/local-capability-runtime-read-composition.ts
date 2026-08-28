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
import { CALCULIX_MICROSANDBOX_WORKER_CONTRACT } from "../fea/isolated-v3/calculix-static-proof-v1/worker-contract.ts";
import { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "../fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import {
  createLocalMicrosandboxSdk,
  microsandboxHostArchitecture,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { CompositeCapabilityRuntimeStateObserver } from "./composite-capability-runtime-state-observer.ts";
import { createCapabilityRuntimeHostObserver } from "./compose-capability-runtime-host.ts";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeAdminPolicyStore,
  FileCapabilityRuntimeJournal,
} from "./file-capability-runtime-host-stores.ts";
import { FileCapabilityRuntimeQualificationAttestationStore } from "./file-capability-runtime-qualification-attestation-store.ts";
import { FileProjectCapabilityLedgerStore } from "./file-project-capability-ledger-store.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroupRegistry } from "./first-party-capability-runtime-launch-groups.ts";
import { GroupCapabilityRuntimeHostObservationReader } from "./group-capability-runtime-host-observation-reader.ts";
import { FileCapabilityRuntimeHostIdentityStore } from "./file-capability-runtime-host-identity-store.ts";
import { LocalMicrosandboxCapabilityRuntimeCache } from "./microsandbox-capability-runtime-cache.ts";

export interface LocalCapabilityRuntimeReadCompositionOptions {
  readonly ledgerDirectory?: string;
  /**
   * The server's code-owned CalculiX execution profile. Omit in a read-only
   * BFF process: it may observe the exact cache but cannot use it to execute.
   */
  readonly calculixExecutionProfile?: {
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
  readonly states: CompositeCapabilityRuntimeStateObserver;
  readonly host: GroupCapabilityRuntimeHostObservationReader;
  readonly policy: FileCapabilityRuntimeAdminPolicyStore;
  readonly lock: FileCapabilityRuntimeAdminLockStore;
  readonly hostIdentity: FileCapabilityRuntimeHostIdentityStore;
  readonly qualifications: FileCapabilityRuntimeQualificationAttestationStore;
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
  const [catalog, launchGroups] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createFirstPartyCapabilityRuntimeLaunchGroupRegistry(),
  ]);
  const journal = new FileCapabilityRuntimeJournal();
  const secrets: CapabilityRuntimeSecretSlotObserver = {
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
  const microsandbox = new LocalMicrosandboxCapabilityRuntimeCache(
    createLocalMicrosandboxSdk,
    [{
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
        architecture: microsandboxHostArchitecture(),
        user: CALCULIX_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
        entrypoint: [
          CALCULIX_MICROSANDBOX_WORKER_CONTRACT.executable,
          ...CALCULIX_MICROSANDBOX_WORKER_CONTRACT.args,
        ],
      },
      executionProfileFingerprint: options.calculixExecutionProfile?.profileFingerprint,
      qualification: "qualified",
    }],
  );
  const groupMaterialKeys = (await launchGroups.list()).flatMap((group) =>
    group.materials.map((member) => capabilityRuntimeMaterialKey(member.material))
  );
  const states = new CompositeCapabilityRuntimeStateObserver([
    { observer: composeObserver, materialKeys: groupMaterialKeys },
    {
      observer: microsandbox,
      materialKeys: ["casys.calculix-worker\u0000calculix-worker-image"],
    },
  ]);
  const policy = new FileCapabilityRuntimeAdminPolicyStore(undefined, catalog);
  const lock = new FileCapabilityRuntimeAdminLockStore(undefined, catalog);
  const hostIdentity = new FileCapabilityRuntimeHostIdentityStore();
  const qualifications = new FileCapabilityRuntimeQualificationAttestationStore();
  const ledgers = new FileProjectCapabilityLedgerStore(options.ledgerDirectory);
  const host = new GroupCapabilityRuntimeHostObservationReader(
    catalog,
    states,
    hostIdentity,
  );
  const contexts = new ProjectCapabilityRuntimeContextCompiler({
    registry: { list: listRegisteredEngineeringOperations },
    catalog,
    policy,
    host,
    lock,
    qualifications,
    ledgers,
  });
  return {
    catalog,
    launchGroups,
    journal,
    secrets,
    composeObserver,
    microsandbox,
    states,
    host,
    policy,
    lock,
    hostIdentity,
    qualifications,
    ledgers,
    contexts,
    workbench: new ProjectCapabilityWorkbenchProjector({ contexts, states }),
  };
}
