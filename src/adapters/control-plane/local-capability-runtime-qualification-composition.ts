/**
 * Local composition for the private Chrono and CalculiX runtime qualification CLI.
 * It is not registered on MCP, Workbench or project command surfaces.
 */

import { ChronoPrescribedKinematicsCaseLowerer } from "../mechanics/chrono/chrono-prescribed-kinematics-case-lowerer.ts";
import { ChronoPrescribedKinematicsClient } from "../mechanics/chrono/chrono-prescribed-kinematics-client.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "../../application/control-plane/capability-runtime-launch-group-supervisor.ts";
import { CapabilityRuntimeQualificationService } from "../../application/control-plane/capability-runtime-qualification-service.ts";
import { fingerprintsEqual } from "../../domain/kernel/deterministic-json.ts";
import { createCapabilityRuntimeHostAdapter } from "./compose-capability-runtime-host.ts";
import {
  CalculixHttpRuntimeQualificationService,
} from "./calculix-http-runtime-qualification-service.ts";
import {
  FileCapabilityRuntimeHostMutationLock,
  FileCapabilityRuntimeLeaseStore,
} from "./file-capability-runtime-host-stores.ts";
import { FileCapabilityRuntimeQualificationAttemptStore } from "./file-capability-runtime-qualification-attempt-store.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "./first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "./first-party-capability-runtime-qualification-specifications.ts";
import {
  CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID,
  createFirstPartyCalculixHttpRuntimeQualificationCandidates,
} from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import {
  createFirstPartyCalculixHttpRuntimeQualificationSpecifications,
} from "./first-party-calculix-http-runtime-qualification-specifications.ts";
import { createLocalCapabilityRuntimeReadComposition } from "./local-capability-runtime-read-composition.ts";
import {
  ErpnextBuyRuntimeQualificationService,
} from "./erpnext-buy-runtime-qualification-service.ts";
import { LocalChronoRuntimeSecretResolver } from "./local-chrono-runtime-secret-resolver.ts";
import { overlaySecretInjector } from "./local-erpnext-buy-runtime-secret-resolver.ts";
import {
  CapabilityRuntimeCalculixInputStagerFactory,
} from "../sensitivity/live-fea/capability-runtime-calculix-input-stager.ts";
import {
  createFixedCalculixSensitivityResourceReader,
  createFixedRecordedCalculixSensitivityProvider,
} from "../sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";

const DOCKER_ENV_KEYS = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  "DOCKER_CONFIG",
] as const;

export interface LocalCapabilityRuntimeQualificationComposition {
  readonly service: LocalCapabilityRuntimeQualificationService;
  readonly secrets: LocalChronoRuntimeSecretResolver;
}

/**
 * Closed router for the code-owned local qualification probes. The CLI
 * cannot select a provider or alter a probe's fixed material.
 */
export interface LocalCapabilityRuntimeQualificationService {
  review(candidateId: string): Promise<unknown>;
  apply(
    candidateId: string,
    reviewFingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    confirm: boolean,
  ): Promise<unknown>;
  recover(candidateId: string): Promise<unknown>;
}

export async function composeLocalCapabilityRuntimeQualification(
  options: { readonly now?: () => string } = {},
): Promise<LocalCapabilityRuntimeQualificationComposition> {
  const secrets = new LocalChronoRuntimeSecretResolver();
  const capability = await createLocalCapabilityRuntimeReadComposition({ secrets });
  const hostMutationLock = new FileCapabilityRuntimeHostMutationLock();
  const leases = new FileCapabilityRuntimeLeaseStore();
  const host = createCapabilityRuntimeHostAdapter({
    registry: capability.launchGroups,
    journal: capability.journal,
    secrets: capability.secrets,
    secretInjector: overlaySecretInjector(
      secrets,
      capability.erpnextBuy?.secrets,
    ),
    dockerEnvironment: dockerProcessEnvironment(),
  });
  const groups = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: capability.launchGroups,
    journal: capability.journal,
    leases,
    states: capability.composeObserver,
    host,
    secrets: capability.secrets,
    lock: hostMutationLock,
  });
  const chrono = new CapabilityRuntimeQualificationService({
    catalog: capability.catalog,
    candidates: await createFirstPartyCapabilityRuntimeQualificationCandidates(),
    specs: await createFirstPartyCapabilityRuntimeQualificationSpecifications(),
    policy: capability.policy,
    lock: capability.lock,
    hostObservation: capability.host,
    attestations: capability.qualifications,
    attempts: new FileCapabilityRuntimeQualificationAttemptStore(),
    launchGroups: capability.launchGroups,
    groups,
    states: capability.composeObserver,
    secrets,
    createObserver: (snapshot) =>
      ChronoPrescribedKinematicsClient.fromTrustedRuntime({
        secretResolver: secrets,
        secretSnapshot: snapshot,
      }),
    lowerer: new ChronoPrescribedKinematicsCaseLowerer(),
    now: options.now,
  });
  const [calculixCandidates, calculixSpecs] = await Promise.all([
    createFirstPartyCalculixHttpRuntimeQualificationCandidates(),
    createFirstPartyCalculixHttpRuntimeQualificationSpecifications(),
  ]);
  const resourceReader = createFixedCalculixSensitivityResourceReader();
  const calculix = new CalculixHttpRuntimeQualificationService({
    candidates: calculixCandidates,
    specs: calculixSpecs,
    catalog: capability.catalog,
    policy: capability.policy,
    lock: capability.lock,
    launchGroups: capability.launchGroups,
    attempts: new FileCapabilityRuntimeQualificationAttemptStore(),
    groups,
    states: capability.composeObserver,
    host: capability.host,
    stagers: new CapabilityRuntimeCalculixInputStagerFactory({
      groups: capability.launchGroups,
      hostCacheDirectory: "state/local/sensitivity-step-cache",
    }),
    provider: createFixedRecordedCalculixSensitivityProvider(),
    readResource: async (resource) =>
      (await resourceReader.read(resource)).bytes.copy(),
    attestations: capability.qualifications,
    now: options.now,
  });
  const erpCandidates = capability.erpnextBuy?.qualificationCandidates ?? [];
  const erpSpecs = capability.qualificationSpecs.filter((spec) =>
    erpCandidates.some((candidate) =>
      candidate.id === spec.candidate.id &&
      candidate.fingerprint.digest === spec.candidate.fingerprint.digest
    )
  );
  const erp = capability.erpnextBuy && erpCandidates.length === 1
    ? new ErpnextBuyRuntimeQualificationService({
      candidates: erpCandidates,
      specs: erpSpecs,
      catalog: capability.catalog,
      profile: capability.erpnextBuy.contribution.profile,
      fixture: capability.erpnextBuy.fixture,
      policy: capability.policy,
      lock: capability.lock,
      launchGroups: capability.launchGroups,
      attempts: new FileCapabilityRuntimeQualificationAttemptStore(),
      attestations: capability.qualifications,
      groups,
      leases,
      host: capability.host,
      now: options.now,
      secrets: capability.erpnextBuy.secrets,
    })
    : undefined;
  return {
    service: new LocalQualificationServiceRouter({ chrono, calculix, erp }),
    secrets,
  };
}

export async function createLocalCapabilityRuntimeQualificationComposition(
  options: { readonly now?: () => string } = {},
): Promise<LocalCapabilityRuntimeQualificationService> {
  return (await composeLocalCapabilityRuntimeQualification(options)).service;
}

class LocalQualificationServiceRouter
  implements LocalCapabilityRuntimeQualificationService {
  constructor(
    private readonly services: {
      readonly chrono: CapabilityRuntimeQualificationService;
      readonly calculix: CalculixHttpRuntimeQualificationService;
      readonly erp: ErpnextBuyRuntimeQualificationService | undefined;
    },
  ) {}

  async review(candidateId: string): Promise<unknown> {
    if (this.services.erp?.owns(candidateId)) {
      return await this.services.erp.review(candidateId);
    }
    return candidateId === CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID
      ? await this.services.calculix.review(candidateId)
      : await this.services.chrono.review(candidateId);
  }

  async apply(
    candidateId: string,
    reviewFingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    confirm: boolean,
  ): Promise<unknown> {
    if (this.services.erp?.owns(candidateId)) {
      return await this.services.erp.apply(
        candidateId,
        reviewFingerprint,
        confirm,
      );
    }
    if (candidateId !== CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID) {
      return await this.services.chrono.apply(
        candidateId,
        reviewFingerprint,
        confirm,
      );
    }
    if (!confirm) {
      throw new Error("Capability runtime qualification apply requires --confirm.");
    }
    const review = await this.services.calculix.review(candidateId);
    if (!fingerprintsEqual(review.reviewFingerprint, reviewFingerprint)) {
      throw new Error("CalculiX qualification review fingerprint is stale.");
    }
    return await this.services.calculix.apply(review);
  }

  async recover(candidateId: string): Promise<unknown> {
    if (this.services.erp?.owns(candidateId)) {
      return await this.services.erp.recover(candidateId);
    }
    return candidateId === CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID
      ? await this.services.calculix.recover(candidateId)
      : await this.services.chrono.recover(candidateId);
  }
}

function dockerProcessEnvironment(): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of DOCKER_ENV_KEYS) {
    const value = Deno.env.get(key);
    if (value) result[key] = value;
  }
  return result;
}
