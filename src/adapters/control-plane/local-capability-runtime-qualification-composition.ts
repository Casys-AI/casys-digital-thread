/**
 * Local composition for the private Chrono runtime qualification CLI.
 * It is not registered on MCP, Workbench or project command surfaces.
 */

import { ChronoPrescribedKinematicsCaseLowerer } from "../mechanics/chrono/chrono-prescribed-kinematics-case-lowerer.ts";
import { ChronoPrescribedKinematicsClient } from "../mechanics/chrono/chrono-prescribed-kinematics-client.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "../../application/control-plane/capability-runtime-launch-group-supervisor.ts";
import { CapabilityRuntimeQualificationService } from "../../application/control-plane/capability-runtime-qualification-service.ts";
import { createCapabilityRuntimeHostAdapter } from "./compose-capability-runtime-host.ts";
import {
  FileCapabilityRuntimeHostMutationLock,
  FileCapabilityRuntimeLeaseStore,
} from "./file-capability-runtime-host-stores.ts";
import { FileCapabilityRuntimeQualificationAttemptStore } from "./file-capability-runtime-qualification-attempt-store.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "./first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "./first-party-capability-runtime-qualification-specifications.ts";
import { createLocalCapabilityRuntimeReadComposition } from "./local-capability-runtime-read-composition.ts";
import { LocalChronoRuntimeSecretResolver } from "./local-chrono-runtime-secret-resolver.ts";

const DOCKER_ENV_KEYS = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  "DOCKER_CONFIG",
] as const;

export interface LocalCapabilityRuntimeQualificationComposition {
  readonly service: CapabilityRuntimeQualificationService;
  readonly secrets: LocalChronoRuntimeSecretResolver;
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
    secrets,
    secretInjector: secrets,
    dockerEnvironment: dockerProcessEnvironment(),
  });
  const groups = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: capability.launchGroups,
    journal: capability.journal,
    leases,
    states: capability.composeObserver,
    host,
    secrets,
    lock: hostMutationLock,
  });
  const service = new CapabilityRuntimeQualificationService({
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
  return { service, secrets };
}

export async function createLocalCapabilityRuntimeQualificationComposition(
  options: { readonly now?: () => string } = {},
): Promise<CapabilityRuntimeQualificationService> {
  return (await composeLocalCapabilityRuntimeQualification(options)).service;
}

function dockerProcessEnvironment(): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of DOCKER_ENV_KEYS) {
    const value = Deno.env.get(key);
    if (value) result[key] = value;
  }
  return result;
}
