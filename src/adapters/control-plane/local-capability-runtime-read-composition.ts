/**
 * One local, durable, read-only composition shared by the MCP server and
 * native Workbench. It owns neither a Docker mutation port nor a project
 * command. The server separately composes its mutation/supervisor path.
 */

import { ProjectCapabilityRuntimeContextCompiler } from "../../application/control-plane/project-capability-runtime-context-compiler.ts";
import { ProjectCapabilityWorkbenchProjector } from "../../application/control-plane/project-capability-workbench.ts";
import type { CapabilityRuntimeSecretSlotObserver } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { listRegisteredEngineeringOperations } from "../../orchestration/operations/registry.ts";
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
} from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyNonpersistentMicrosandboxExpectations } from "./first-party-capability-runtime-nonpersistent-materials.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "./first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "./first-party-capability-runtime-qualification-specifications.ts";
import { createFirstPartyCalculixHttpRuntimeQualificationCandidates } from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import { createFirstPartyCalculixHttpRuntimeQualificationSpecifications } from "./first-party-calculix-http-runtime-qualification-specifications.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroups } from "./first-party-capability-runtime-launch-groups.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../application/control-plane/capability-runtime-launch-group-registry.ts";
import {
  loadLocalErpnextBuyInstallationProfile,
} from "./local-erpnext-buy-installation-profile.ts";
import {
  loadLocalErpnextBuyQualificationFixture,
} from "./local-erpnext-buy-qualification-fixture.ts";
import {
  catalogWithErpnextBuyRuntime,
  createErpnextBuyRuntimeContribution,
  type ErpnextBuyRuntimeContribution,
  launchGroupRegistryWithErpnextBuyRuntime,
} from "./local-erpnext-buy-runtime-contribution.ts";
import {
  createErpnextBuyRuntimeQualificationCandidates,
  type ErpnextBuyRuntimeQualificationCandidate,
} from "./first-party-erpnext-buy-runtime-qualification-candidates.ts";
import { createErpnextBuyRuntimeQualificationSpecifications } from "./first-party-erpnext-buy-runtime-qualification-specifications.ts";
import {
  LocalErpnextBuyRuntimeSecretResolver,
  overlaySecretObserver,
} from "./local-erpnext-buy-runtime-secret-resolver.ts";
import { capabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { LocalErpnextBuyQualificationFixture } from "./local-erpnext-buy-qualification-fixture.ts";
import { GroupCapabilityRuntimeHostObservationReader } from "./group-capability-runtime-host-observation-reader.ts";
import { FileCapabilityRuntimeHostIdentityStore } from "./file-capability-runtime-host-identity-store.ts";
import {
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
   * The server's code-owned qualified Modelica kit profile. It is supplied
   * only when the actual worker composition exists; a profile-only
   * construction is not an executable host composition.
   */
  readonly qualifiedModelicaExecutionProfile?: {
    readonly imageReference: string;
    readonly imageDigest: ContentFingerprint;
    readonly profileFingerprint: ContentFingerprint;
  };
  /**
   * The server's code-owned admitted Modelica profile. It is supplied only
   * when the actual worker composition exists; a profile-only construction is
   * not an executable host composition. Sharing the Modelica worker image
   * does not qualify this method.
   */
  readonly admittedModelicaExecutionProfile?: {
    readonly imageReference: string;
    readonly imageDigest: ContentFingerprint;
    readonly profileFingerprint: ContentFingerprint;
  };
  /**
   * The server's code-owned admitted SPICE profile. It binds its one
   * executable Microsandbox runtime material.
   */
  readonly admittedSpiceExecutionProfile?: {
    readonly imageReference: string;
    readonly imageDigest: ContentFingerprint;
    readonly profileFingerprint: ContentFingerprint;
  };
  /**
   * Trusted local ERP Buy installation profile. Missing is a non-qualified
   * absence. A malformed supplied file is rejected closed.
   */
  readonly erpnextBuyInstallationProfilePath?: string;
  /**
   * Trusted local ERP Buy qualification fixture. Missing leaves the installed
   * material unqualified. Probe tools/args are never read from this file.
   */
  readonly erpnextBuyQualificationFixturePath?: string;
}

export interface LocalCapabilityRuntimeReadComposition {
  readonly catalog: Awaited<
    ReturnType<typeof createFirstPartyCapabilityRuntimeCatalog>
  >;
  readonly launchGroups: FixedCapabilityRuntimeLaunchGroupRegistry;
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
  readonly qualificationAttempts: FileCapabilityRuntimeQualificationAttemptStore;
  /** Deterministic Chrono then CalculiX then optional ERP attestation inputs. */
  readonly qualificationCandidates:
    readonly import("../../domain/capability/runtime/capability-runtime-qualification-candidate.ts").CapabilityRuntimeAttestableQualificationCandidate[];
  readonly qualificationSpecs:
    readonly import("../../domain/capability/runtime/capability-runtime-qualification-specification.ts").CapabilityRuntimeQualificationSpecification[];
  readonly ledgers: FileProjectCapabilityLedgerStore;
  readonly contexts: ProjectCapabilityRuntimeContextCompiler;
  readonly workbench: ProjectCapabilityWorkbenchProjector;
  readonly erpnextBuy: {
    readonly contribution: ErpnextBuyRuntimeContribution;
    readonly fixture: LocalErpnextBuyQualificationFixture | undefined;
    readonly secrets: LocalErpnextBuyRuntimeSecretResolver | undefined;
    readonly qualificationCandidates:
      readonly ErpnextBuyRuntimeQualificationCandidate[];
  } | undefined;
}

/**
 * Reads exact current host state only. The only Docker interactions are
 * `compose ps`, container/image inspect, and Microsandbox image inspection;
 * none can start, stop, pull, remove, or create a runtime.
 */
export async function createLocalCapabilityRuntimeReadComposition(
  options: LocalCapabilityRuntimeReadCompositionOptions = {},
): Promise<LocalCapabilityRuntimeReadComposition> {
  const erpInstallation = await loadLocalErpnextBuyInstallationProfile({
    path: options.erpnextBuyInstallationProfilePath,
  });
  const erpFixtureLoad = await loadLocalErpnextBuyQualificationFixture({
    path: options.erpnextBuyQualificationFixturePath,
  });
  const erpContribution = erpInstallation.status === "present"
    ? await createErpnextBuyRuntimeContribution(erpInstallation.profile)
    : undefined;
  const erpFixture = erpFixtureLoad.status === "present"
    ? erpFixtureLoad.fixture
    : undefined;
  const [
    baseCatalog,
    firstPartyGroups,
    chronoQualificationCandidates,
    chronoQualificationSpecs,
    calculixQualificationCandidates,
    calculixQualificationSpecs,
  ] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createFirstPartyCapabilityRuntimeLaunchGroups(),
    createFirstPartyCapabilityRuntimeQualificationCandidates(),
    createFirstPartyCapabilityRuntimeQualificationSpecifications(),
    createFirstPartyCalculixHttpRuntimeQualificationCandidates(),
    createFirstPartyCalculixHttpRuntimeQualificationSpecifications(),
  ]);
  const catalog = erpContribution
    ? await catalogWithErpnextBuyRuntime(baseCatalog, erpContribution)
    : baseCatalog;
  const launchGroups = erpContribution
    ? launchGroupRegistryWithErpnextBuyRuntime(firstPartyGroups, erpContribution)
    : new FixedCapabilityRuntimeLaunchGroupRegistry(firstPartyGroups);
  const erpQualificationCandidates = erpContribution && erpFixture
    ? await createErpnextBuyRuntimeQualificationCandidates({
      catalog,
      launchGroup: erpContribution.launchGroup,
      profile: erpContribution.profile,
      fixture: erpFixture,
    })
    : [];
  const erpQualificationSpecs = erpQualificationCandidates.length === 0
    ? []
    : await createErpnextBuyRuntimeQualificationSpecifications(
      erpQualificationCandidates,
    );
  const qualificationCandidates = Object.freeze([
    ...chronoQualificationCandidates,
    ...calculixQualificationCandidates,
    ...erpQualificationCandidates,
  ]);
  const qualificationSpecs = Object.freeze([
    ...chronoQualificationSpecs,
    ...calculixQualificationSpecs,
    ...erpQualificationSpecs,
  ]);
  const erpSecrets = erpContribution &&
      erpContribution.profile.launchGroup.secretSlots.length > 0
    ? new LocalErpnextBuyRuntimeSecretResolver({
      profile: erpContribution.profile,
      group: capabilityRuntimeLaunchGroupReference(erpContribution.launchGroup),
    })
    : undefined;
  const journal = new FileCapabilityRuntimeJournal();
  const secrets: CapabilityRuntimeSecretSlotObserver = overlaySecretObserver(
    options.secrets ?? {
      observe: (slots) =>
        Promise.resolve(
          new Map(slots.map((slot) => [slot, "unavailable" as const])),
        ),
    },
    erpSecrets,
  );
  const composeObserver = createCapabilityRuntimeHostObserver({
    registry: launchGroups,
    journal,
    secrets,
  });
  /**
   * Read coverage derives from the complete first-party microVM catalogue,
   * rather than from the set of executors enabled in this process. A worker
   * stays observable as `absent` or `installed` even when its operation is
   * not registered here. Optional execution profiles only attest invocation
   * semantics and must recross the catalogued target image exactly.
   */
  const microsandboxExpectations = overlayExecutionProfiles(
    createFirstPartyNonpersistentMicrosandboxExpectations(catalog),
    options,
  );
  const microsandbox = new LocalMicrosandboxCapabilityRuntimeCache(
    createLocalMicrosandboxSdk,
    microsandboxExpectations,
  );
  const groupMaterialKeys = (await launchGroups.list()).flatMap((group) =>
    group.materials.map((member) => capabilityRuntimeMaterialKey(member.material))
  );
  const microsandboxMaterialKeys = microsandboxExpectations.map((expectation) =>
    capabilityRuntimeMaterialKey(expectation.material)
  );
  const states = new CompositeCapabilityRuntimeStateObserver([
    { observer: composeObserver, materialKeys: groupMaterialKeys },
    {
      observer: microsandbox,
      materialKeys: microsandboxMaterialKeys,
    },
  ]);
  const policy = new FileCapabilityRuntimeAdminPolicyStore(undefined, catalog);
  const lock = new FileCapabilityRuntimeAdminLockStore(undefined, catalog);
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
    states,
    host,
    policy,
    lock,
    hostIdentity,
    qualifications,
    qualificationAttempts,
    qualificationCandidates,
    qualificationSpecs,
    ledgers,
    contexts,
    workbench: new ProjectCapabilityWorkbenchProjector({ contexts, states }),
    erpnextBuy: erpContribution
      ? {
        contribution: erpContribution,
        fixture: erpFixture,
        secrets: erpSecrets,
        qualificationCandidates: erpQualificationCandidates,
      }
      : undefined,
  };
}

interface ConfiguredMicrosandboxExecutionProfile {
  readonly imageReference: string;
  readonly imageDigest: ContentFingerprint;
  readonly profileFingerprint: ContentFingerprint;
}

export function overlayExecutionProfiles(
  expectations: readonly {
    readonly material: { readonly unitId: string; readonly materialId: string };
    readonly image: MicrosandboxCapabilityRuntimeImageExpectation["image"];
    readonly allowedExecutionProfileFingerprints?: readonly ContentFingerprint[];
  }[],
  options: LocalCapabilityRuntimeReadCompositionOptions,
): readonly MicrosandboxCapabilityRuntimeImageExpectation[] {
  const configured = new Map<string, {
    readonly imageReference: string;
    readonly manifestDigest: string;
    readonly fingerprints: ContentFingerprint[];
  }>();
  const register = (
    material: { readonly unitId: string; readonly materialId: string },
    profile: ConfiguredMicrosandboxExecutionProfile | undefined,
    path: string,
  ): void => {
    if (!profile) return;
    const key = capabilityRuntimeMaterialKey(material);
    const imageReference = pinnedOciImageReference(profile.imageReference, path);
    const manifestDigest = `sha256:${profile.imageDigest.digest}`;
    const existing = configured.get(key);
    if (existing) {
      if (
        existing.imageReference !== imageReference ||
        existing.manifestDigest !== manifestDigest
      ) {
        throw new Error(`Execution profile overlay targets conflict for ${key}.`);
      }
      if (
        existing.fingerprints.some((fingerprint) =>
          sameFingerprint(fingerprint, profile.profileFingerprint)
        )
      ) {
        throw new Error(
          `Duplicate execution profile fingerprint overlay for ${key}.`,
        );
      }
      existing.fingerprints.push(profile.profileFingerprint);
      return;
    }
    configured.set(key, {
      imageReference,
      manifestDigest,
      fingerprints: [profile.profileFingerprint],
    });
  };
  register(
    { unitId: "casys.calculix-worker", materialId: "calculix-worker-image" },
    options.calculixExecutionProfile,
    "$localCapabilityRuntime.calculix.imageReference",
  );
  register(
    {
      unitId: "casys.build123d-isolated-worker",
      materialId: "build123d-isolated-worker-image",
    },
    options.build123dExecutionProfile,
    "$localCapabilityRuntime.build123d.imageReference",
  );
  register(
    {
      unitId: "casys.modelica-worker",
      materialId: "modelica-worker-image",
    },
    options.qualifiedModelicaExecutionProfile,
    "$localCapabilityRuntime.qualifiedModelica.imageReference",
  );
  register(
    {
      unitId: "casys.modelica-worker",
      materialId: "modelica-worker-image",
    },
    options.admittedModelicaExecutionProfile,
    "$localCapabilityRuntime.admittedModelica.imageReference",
  );
  register(
    { unitId: "casys.spice-worker", materialId: "ngspice-runtime-image" },
    options.admittedSpiceExecutionProfile,
    "$localCapabilityRuntime.admittedSpice.imageReference",
  );
  return expectations.map((expectation) => {
    const overlay = configured.get(
      capabilityRuntimeMaterialKey(expectation.material),
    );
    if (!overlay) {
      return {
        material: expectation.material,
        image: expectation.image,
        allowedExecutionProfileFingerprints: Object.freeze([
          ...(expectation.allowedExecutionProfileFingerprints ?? []),
        ]),
      };
    }
    if (
      overlay.imageReference !== expectation.image.reference ||
      overlay.manifestDigest !== expectation.image.manifestDigest
    ) {
      throw new Error(
        `Execution profile target drifted from catalogued microVM material ${expectation.material.unitId}/${expectation.material.materialId}.`,
      );
    }
    return {
      material: expectation.material,
      image: expectation.image,
      allowedExecutionProfileFingerprints: Object.freeze([
        ...overlay.fingerprints,
      ]),
    };
  });
}

function sameFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}
