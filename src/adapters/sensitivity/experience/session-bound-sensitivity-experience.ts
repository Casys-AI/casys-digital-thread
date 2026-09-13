/**
 * Session-bound CalculiX runtime identity for private sensitivity reuse.
 *
 * The coordinator is constructed only after the exact JIT lease is active.
 * Identity is derived from the sealed casys-mcp-calculix group member, never
 * from a fleet manifest, alias, endpoint, or ambient container.
 */

import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  CapabilityRuntimeLaunchGroupRegistry,
  CapabilityRuntimeStateObserver,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeLease } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { capabilityRuntimeMaterialKey } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../../domain/capability/runtime/capability-runtime-material.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  type CapabilityRuntimeLaunchGroupMaterial,
  type CapabilityRuntimeLaunchGroupReference,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  type SensitivityExperienceSolverRuntimeIdentity,
  solverRuntimeIdentityFromImageReference,
} from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { FileFeaSensitivityAttemptStore } from "../live-fea/file-fea-sensitivity-attempt-store.ts";
import { FileSensitivityExperienceRepository } from "./file-sensitivity-experience-repository.ts";
import { FileSensitivityExperienceReuseAttemptStore } from "./file-sensitivity-experience-reuse-attempt-store.ts";
import {
  SensitivityExperienceCoordinator,
  type SensitivityExperienceSolverRuntimeAuthority,
} from "./sensitivity-experience-coordinator.ts";

export const SENSITIVITY_EXPERIENCE_CALCULIX_GROUP_ID = "casys-mcp-calculix" as const;
export const SENSITIVITY_EXPERIENCE_CALCULIX_SERVICE_NAME = "mcp-calculix" as const;

export interface SensitivityExperienceSessionBindingInput {
  readonly lease: CapabilityRuntimeLease;
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly material: CapabilityRuntimeMaterialIdentity;
}

export interface SensitivityExperienceExecutorBinding {
  readonly attempts: FileSensitivityExperienceReuseAttemptStore;
  readonly bindActiveSession: (
    input: SensitivityExperienceSessionBindingInput,
  ) => Promise<
    {
      readonly coordinator: SensitivityExperienceCoordinator;
    } | undefined
  >;
}

export interface SensitivityExperienceSessionFactoryDependencies {
  readonly repository: FileSensitivityExperienceRepository;
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly caseCaptures: Pick<FileCaptureStore<"sensitivity-study-case">, "read">;
  readonly studyCaptures: Pick<FileCaptureStore<"sensitivity-study">, "read">;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly executionAttempts: Pick<FileFeaSensitivityAttemptStore, "read">;
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly observer: CapabilityRuntimeStateObserver;
  readonly reuseAttempts: FileSensitivityExperienceReuseAttemptStore;
}

export function createSensitivityExperienceExecutorBinding(
  dependencies: SensitivityExperienceSessionFactoryDependencies,
): SensitivityExperienceExecutorBinding {
  const factory = createSensitivityExperienceSessionFactory(dependencies);
  return {
    attempts: dependencies.reuseAttempts,
    bindActiveSession: async (input) => {
      const bound = await factory.forActiveCapabilitySession(input);
      return bound === undefined ? undefined : { coordinator: bound.coordinator };
    },
  };
}

export function createSensitivityExperienceSessionFactory(
  dependencies: SensitivityExperienceSessionFactoryDependencies,
) {
  return {
    async forActiveCapabilitySession(
      input: SensitivityExperienceSessionBindingInput,
    ): Promise<
      {
        readonly solverRuntime: SensitivityExperienceSolverRuntimeIdentity;
        readonly coordinator: SensitivityExperienceCoordinator;
      } | undefined
    > {
      const derived = await deriveSessionSolverRuntime(
        input,
        dependencies.groups,
        dependencies.observer,
      );
      if (!derived) return undefined;
      const authority = new SessionBoundSensitivitySolverRuntimeAuthority({
        expected: derived.solverRuntime,
        session: input,
        groups: dependencies.groups,
        observer: dependencies.observer,
      });
      if (!await authority.attest(derived.solverRuntime)) return undefined;
      return {
        solverRuntime: derived.solverRuntime,
        coordinator: new SensitivityExperienceCoordinator({
          repository: dependencies.repository,
          projects: dependencies.projects,
          snapshots: dependencies.snapshots,
          caseCaptures: dependencies.caseCaptures,
          studyCaptures: dependencies.studyCaptures,
          admissions: dependencies.admissions,
          executionAttempts: dependencies.executionAttempts,
          solverRuntime: derived.solverRuntime,
          solverRuntimeAuthority: authority,
        }),
      };
    },
  };
}

interface SessionBoundSensitivitySolverRuntimeAuthorityOptions {
  readonly expected: SensitivityExperienceSolverRuntimeIdentity;
  readonly session: SensitivityExperienceSessionBindingInput;
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly observer: CapabilityRuntimeStateObserver;
}

export class SessionBoundSensitivitySolverRuntimeAuthority
  implements SensitivityExperienceSolverRuntimeAuthority {
  constructor(
    private readonly options: SessionBoundSensitivitySolverRuntimeAuthorityOptions,
  ) {}

  async attest(
    expected: SensitivityExperienceSolverRuntimeIdentity,
  ): Promise<boolean> {
    if (!sameSolverRuntime(expected, this.options.expected)) return false;
    const derived = await deriveSessionSolverRuntime(
      this.options.session,
      this.options.groups,
      this.options.observer,
    );
    return derived !== undefined &&
      sameSolverRuntime(derived.solverRuntime, expected);
  }
}

async function deriveSessionSolverRuntime(
  input: SensitivityExperienceSessionBindingInput,
  groups: CapabilityRuntimeLaunchGroupRegistry,
  observer: CapabilityRuntimeStateObserver,
): Promise<
  {
    readonly solverRuntime: SensitivityExperienceSolverRuntimeIdentity;
    readonly member: CapabilityRuntimeLaunchGroupMaterial;
  } | undefined
> {
  try {
    if (!leaseCoversSession(input.lease, input.launchGroup, input.material)) {
      return undefined;
    }
    const group = await groups.require(input.launchGroup);
    if (!groupMatchesSession(group, input.launchGroup)) return undefined;
    const member = uniqueCalculixMember(group, input.material);
    if (!member) return undefined;
    const solverRuntime = solverRuntimeIdentityFromImageReference(
      member.imageReference,
    );
    if (solverRuntime.imageDigest.digest !== input.material.imageDigest) {
      return undefined;
    }
    if (!await observationIsHealthy(observer, input.material)) return undefined;
    return { solverRuntime, member };
  } catch {
    return undefined;
  }
}

function leaseCoversSession(
  lease: CapabilityRuntimeLease,
  launchGroup: CapabilityRuntimeLaunchGroupReference,
  material: CapabilityRuntimeMaterialIdentity,
): boolean {
  return lease.launchGroups.some((candidate) =>
    sameCapabilityRuntimeLaunchGroupReference(candidate, launchGroup)
  ) &&
    lease.materialKeys.includes(capabilityRuntimeMaterialKey(material));
}

function groupMatchesSession(
  group: CapabilityRuntimeLaunchGroup,
  launchGroup: CapabilityRuntimeLaunchGroupReference,
): boolean {
  return group.id === SENSITIVITY_EXPERIENCE_CALCULIX_GROUP_ID &&
    sameCapabilityRuntimeLaunchGroupReference(
      capabilityRuntimeLaunchGroupReference(group),
      launchGroup,
    );
}

function uniqueCalculixMember(
  group: CapabilityRuntimeLaunchGroup,
  material: CapabilityRuntimeMaterialIdentity,
): CapabilityRuntimeLaunchGroupMaterial | undefined {
  const matches = group.materials.filter((member) =>
    member.serviceName === SENSITIVITY_EXPERIENCE_CALCULIX_SERVICE_NAME &&
    member.material.unitId === material.unitId &&
    member.material.materialId === material.materialId &&
    member.material.imageDigest === material.imageDigest &&
    member.imageReference.endsWith(`@sha256:${material.imageDigest}`)
  );
  if (matches.length !== 1) return undefined;
  return matches[0];
}

async function observationIsHealthy(
  observer: CapabilityRuntimeStateObserver,
  material: CapabilityRuntimeMaterialIdentity,
): Promise<boolean> {
  const observed = await observer.observe([material]);
  const key = capabilityRuntimeMaterialKey(material);
  if (observed.size !== 1 || !observed.has(key)) return false;
  const state = observed.get(key);
  return state?.material === "installed" && state.runtime === "active";
}

function sameSolverRuntime(
  left: SensitivityExperienceSolverRuntimeIdentity,
  right: SensitivityExperienceSolverRuntimeIdentity,
): boolean {
  return left.imageReference === right.imageReference &&
    left.imageDigest.algorithm === right.imageDigest.algorithm &&
    left.imageDigest.digest === right.imageDigest.digest;
}
