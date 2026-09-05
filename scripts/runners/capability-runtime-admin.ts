/**
 * Private local operator CLI. It is not registered as an MCP operation and
 * deliberately has no Docker/provider/tool/endpoint/argument switches.
 */

import {
  FileCapabilityRuntimeHostMutationLock,
  FileCapabilityRuntimeLeaseStore,
} from "../../src/adapters/control-plane/file-capability-runtime-host-stores.ts";
import { FileCapabilityRuntimeCachePreparationJournal } from "../../src/adapters/control-plane/file-capability-runtime-cache-preparation-journal.ts";
import { FileCapabilityRuntimeNonpersistentMaterialRemovalJournal } from "../../src/adapters/control-plane/file-capability-runtime-nonpersistent-material-removal-journal.ts";
import { DockerCacheCapabilityRuntimeMaterialRemovalHost } from "../../src/adapters/control-plane/docker-cache-capability-runtime-material-removal.ts";
import { MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost } from "../../src/adapters/control-plane/microsandbox-cache-capability-runtime-material-removal.ts";
import { LocalNonpersistentMaterialRemovalHost } from "../../src/adapters/control-plane/local-nonpersistent-material-removal-host.ts";
import { createFirstPartyNonpersistentMicrosandboxExpectations } from "../../src/adapters/control-plane/first-party-capability-runtime-nonpersistent-materials.ts";
import { createCapabilityRuntimeHostAdapter } from "../../src/adapters/control-plane/compose-capability-runtime-host.ts";
import { createLocalCapabilityRuntimeReadComposition } from "../../src/adapters/control-plane/local-capability-runtime-read-composition.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "../../src/adapters/control-plane/first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "../../src/adapters/control-plane/first-party-capability-runtime-qualification-specifications.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/shared/stores/engineering-project-store.ts";
import { createLocalMicrosandboxSdk } from "../../src/adapters/shared/execution/microsandbox-ephemeral-execution-backend.ts";
import {
  LocalCapabilityRuntimeAdminService,
  type LocalCapabilityRuntimeRemovalTarget,
} from "../../src/application/control-plane/local-capability-runtime-admin-service.ts";
import { ProjectCapabilityAuthorizationService } from "../../src/application/control-plane/project-capability-authorization-service.ts";
import { ProjectCapabilityJitDemandReader } from "../../src/application/control-plane/project-capability-jit-demand-reader.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";

export type CapabilityRuntimeAdminCliRequest =
  | { readonly command: "status" }
  | { readonly command: "lock-review" }
  | {
    readonly command: "lock-apply";
    readonly reviewFingerprint: ContentFingerprint;
    readonly confirm: boolean;
  }
  | { readonly command: "rollback-review"; readonly revision: number }
  | {
    readonly command: "rollback-apply";
    readonly revision: number;
    readonly reviewFingerprint: ContentFingerprint;
    readonly confirm: boolean;
  }
  | {
    readonly command: "revoke-review";
    readonly projectId: string;
    readonly reason: string;
  }
  | {
    readonly command: "revoke-apply";
    readonly projectId: string;
    readonly reason: string;
    readonly reviewFingerprint: ContentFingerprint;
    readonly confirm: boolean;
  }
  | {
    readonly command: "remove-review";
    readonly target: LocalCapabilityRuntimeRemovalTarget;
  }
  | {
    readonly command: "remove-apply";
    readonly target: LocalCapabilityRuntimeRemovalTarget;
    readonly reviewFingerprint: ContentFingerprint;
    readonly confirm: boolean;
  };

const USAGE =
  "Usage: capability-runtime-admin <status|lock-review|lock-apply|rollback-review|rollback-apply|revoke-review|revoke-apply|remove-review|remove-apply> [--unit-id=<id>|--launch-group-id=<id>|--unit-id=<id> --material-id=<id>] [--review-fingerprint=<sha256>] [--confirm]";

export function parseCapabilityRuntimeAdminCli(
  args: readonly string[],
): CapabilityRuntimeAdminCliRequest {
  const [command, ...argumentsList] = args;
  const flags = parseFlags(argumentsList);
  assertAllowedFlags(command, flags);
  switch (command) {
    case "status":
    case "lock-review":
      return { command };
    case "lock-apply":
      return {
        command,
        reviewFingerprint: fingerprint(flags, "review-fingerprint"),
        confirm: confirmed(flags),
      };
    case "rollback-review":
      return { command, revision: integer(flags, "revision") };
    case "rollback-apply":
      return {
        command,
        revision: integer(flags, "revision"),
        reviewFingerprint: fingerprint(flags, "review-fingerprint"),
        confirm: confirmed(flags),
      };
    case "revoke-review":
      return {
        command,
        projectId: required(flags, "project-id"),
        reason: required(flags, "reason"),
      };
    case "revoke-apply":
      return {
        command,
        projectId: required(flags, "project-id"),
        reason: required(flags, "reason"),
        reviewFingerprint: fingerprint(flags, "review-fingerprint"),
        confirm: confirmed(flags),
      };
    case "remove-review":
      return { command, target: removalTarget(flags) };
    case "remove-apply":
      return {
        command,
        target: removalTarget(flags),
        reviewFingerprint: fingerprint(flags, "review-fingerprint"),
        confirm: confirmed(flags),
      };
    default:
      throw new Error(USAGE);
  }
}

if (import.meta.main) {
  await main(parseCapabilityRuntimeAdminCli(Deno.args));
}

async function main(request: CapabilityRuntimeAdminCliRequest): Promise<void> {
  const capability = await createLocalCapabilityRuntimeReadComposition();
  const catalog = capability.catalog;
  const lock = capability.lock;
  const ledgers = capability.ledgers;
  const hostMutationLock = new FileCapabilityRuntimeHostMutationLock();
  const leases = new FileCapabilityRuntimeLeaseStore();
  const host = createCapabilityRuntimeHostAdapter({
    registry: capability.launchGroups,
    journal: capability.journal,
    secrets: capability.secrets,
  });
  const projects = new FileEngineeringProjectRevisionStore();
  const jitDemand = new ProjectCapabilityJitDemandReader({
    projects,
    contexts: capability.contexts,
  });
  const authorization = new ProjectCapabilityAuthorizationService({
    ledgers,
    registry: { list: () => [] },
    recordedPlans: {
      read: () =>
        Promise.reject(
          new TypeError("Recorded run plans are not composed in this admin path."),
        ),
    },
    catalog,
    qualificationSpecs:
      await createFirstPartyCapabilityRuntimeQualificationSpecifications(),
    qualificationCandidates:
      await createFirstPartyCapabilityRuntimeQualificationCandidates(),
    policy: await capability.policy.read(),
    host: capability.host,
    lock,
    lockWriter: lock,
    hostMutationLock,
  });
  const admin = new LocalCapabilityRuntimeAdminService({
    catalog,
    ledgers,
    lock,
    hostMutationLock,
    authorization,
    removal: {
      groups: capability.launchGroups,
      journal: capability.journal,
      leases,
      host,
      jitDemand,
    },
    nonpersistentRemoval: {
      journal: new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(),
      leases,
      groups: capability.launchGroups,
      cachePreparations: new FileCapabilityRuntimeCachePreparationJournal(),
      jitDemand,
      host: new LocalNonpersistentMaterialRemovalHost(
        new DockerCacheCapabilityRuntimeMaterialRemovalHost(),
        new MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost({
          sdk: createLocalMicrosandboxSdk,
          expectations: createFirstPartyNonpersistentMicrosandboxExpectations(
            catalog,
          ),
        }),
      ),
    },
  });

  switch (request.command) {
    case "status":
      print(await admin.status());
      break;
    case "lock-review":
      print(await admin.lockReview());
      break;
    case "lock-apply":
      print(await admin.lockApply(request.reviewFingerprint, request.confirm));
      break;
    case "rollback-review":
      print(await admin.rollbackReview(request.revision));
      break;
    case "rollback-apply":
      print(
        await admin.rollbackApply(
          request.revision,
          request.reviewFingerprint,
          request.confirm,
        ),
      );
      break;
    case "revoke-review":
      print(await admin.revokeReview(request.projectId, request.reason));
      break;
    case "revoke-apply":
      await admin.revokeApply(
        request.projectId,
        request.reason,
        request.reviewFingerprint,
        request.confirm,
      );
      print({ status: "revoked" });
      break;
    case "remove-review":
      print(await admin.removeReview(request.target));
      break;
    case "remove-apply":
      print(
        await admin.removeApply(
          request.target,
          request.reviewFingerprint,
          request.confirm,
        ),
      );
      break;
  }
}

function parseFlags(values: readonly string[]): ReadonlyMap<string, string | true> {
  const result = new Map<string, string | true>();
  for (const value of values) {
    if (!value.startsWith("--")) {
      throw new Error(`Unsupported local admin argument ${value}.`);
    }
    const [name, ...rest] = value.slice(2).split("=");
    if (!name || result.has(name)) {
      throw new Error(`Invalid repeated local admin flag ${value}.`);
    }
    result.set(name, rest.length === 0 ? true : rest.join("="));
  }
  return result;
}

function assertAllowedFlags(
  command: string | undefined,
  flags: ReadonlyMap<string, string | true>,
): void {
  const allowed = new Set<string>(
    command === "status" || command === "lock-review"
      ? []
      : command === "lock-apply"
      ? ["review-fingerprint", "confirm"]
      : command === "rollback-review"
      ? ["revision"]
      : command === "rollback-apply"
      ? ["revision", "review-fingerprint", "confirm"]
      : command === "revoke-review"
      ? ["project-id", "reason"]
      : command === "revoke-apply"
      ? ["project-id", "reason", "review-fingerprint", "confirm"]
      : command === "remove-review"
      ? ["unit-id", "launch-group-id", "material-id"]
      : command === "remove-apply"
      ? ["unit-id", "launch-group-id", "material-id", "review-fingerprint", "confirm"]
      : [],
  );
  for (const name of flags.keys()) {
    if (!allowed.has(name)) {
      throw new Error(`--${name} is not valid for local admin ${command}.`);
    }
  }
}

function required(flags: ReadonlyMap<string, string | true>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name}=... is required.`);
  }
  return value;
}

function integer(flags: ReadonlyMap<string, string | true>, name: string): number {
  const value = Number(required(flags, name));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }
  return value;
}

function fingerprint(flags: ReadonlyMap<string, string | true>, name: string) {
  const digest = required(flags, name);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`--${name} must be one SHA-256 digest.`);
  }
  return { algorithm: "sha256" as const, digest };
}

function confirmed(flags: ReadonlyMap<string, string | true>): boolean {
  return flags.get("confirm") === true;
}

function removalTarget(
  flags: ReadonlyMap<string, string | true>,
): LocalCapabilityRuntimeRemovalTarget {
  const unitId = flags.get("unit-id");
  const launchGroupId = flags.get("launch-group-id");
  if (flags.has("material-id")) {
    if (flags.has("launch-group-id")) {
      throw new Error(
        "Administrative removal refuses mixed --material-id and --launch-group-id.",
      );
    }
    const materialId = flags.get("material-id");
    if (typeof materialId !== "string" || !materialId.trim()) {
      throw new Error(
        "Administrative non-persistent removal requires --material-id=<id>.",
      );
    }
    if (typeof unitId !== "string") {
      throw new Error(
        "Administrative non-persistent removal requires --unit-id with --material-id.",
      );
    }
    return {
      kind: "material",
      unitId: required(flags, "unit-id"),
      materialId: required(flags, "material-id"),
    };
  }
  if (typeof unitId === "string" && !launchGroupId) {
    return { kind: "unit", id: required(flags, "unit-id") };
  }
  if (typeof launchGroupId === "string" && !unitId) {
    return {
      kind: "launch-group",
      id: required(flags, "launch-group-id"),
    };
  }
  throw new Error(
    "Administrative removal requires exactly one --unit-id, --launch-group-id, or --unit-id with --material-id.",
  );
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
