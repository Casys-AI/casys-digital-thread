/**
 * Private local operator CLI. It is not registered as an MCP operation and
 * deliberately has no Docker/provider/tool/endpoint/argument switches.
 */

import {
  FileCapabilityRuntimeHostMutationLock,
  FileCapabilityRuntimeLeaseStore,
} from "../../src/adapters/control-plane/file-capability-runtime-host-stores.ts";
import { createCapabilityRuntimeHostAdapter } from "../../src/adapters/control-plane/compose-capability-runtime-host.ts";
import { createLocalCapabilityRuntimeReadComposition } from "../../src/adapters/control-plane/local-capability-runtime-read-composition.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "../../src/adapters/control-plane/first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "../../src/adapters/control-plane/first-party-capability-runtime-qualification-specifications.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/shared/stores/engineering-project-store.ts";
import { LocalCapabilityRuntimeAdminService } from "../../src/application/control-plane/local-capability-runtime-admin-service.ts";
import { ProjectCapabilityAuthorizationService } from "../../src/application/control-plane/project-capability-authorization-service.ts";
import { ProjectCapabilityJitDemandReader } from "../../src/application/control-plane/project-capability-jit-demand-reader.ts";

const [command, ...argumentsList] = Deno.args;
const flags = parseFlags(argumentsList);
assertAllowedFlags(command, flags);
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
const authorization = new ProjectCapabilityAuthorizationService({
  ledgers,
  registry: { list: () => [] },
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
    jitDemand: new ProjectCapabilityJitDemandReader({
      projects: new FileEngineeringProjectRevisionStore(),
      contexts: capability.contexts,
    }),
  },
});

switch (command) {
  case "status":
    print(await admin.status());
    break;
  case "lock-review":
    print(await admin.lockReview());
    break;
  case "lock-apply":
    print(
      await admin.lockApply(fingerprint(flags, "review-fingerprint"), confirmed(flags)),
    );
    break;
  case "rollback-review":
    print(await admin.rollbackReview(integer(flags, "revision")));
    break;
  case "rollback-apply":
    print(
      await admin.rollbackApply(
        integer(flags, "revision"),
        fingerprint(flags, "review-fingerprint"),
        confirmed(flags),
      ),
    );
    break;
  case "revoke-review":
    print(
      await admin.revokeReview(
        required(flags, "project-id"),
        required(flags, "reason"),
      ),
    );
    break;
  case "revoke-apply":
    await admin.revokeApply(
      required(flags, "project-id"),
      required(flags, "reason"),
      fingerprint(flags, "review-fingerprint"),
      confirmed(flags),
    );
    print({ status: "revoked" });
    break;
  case "remove-review":
    print(await admin.removeReview(removalTarget(flags)));
    break;
  case "remove-apply":
    print(
      await admin.removeApply(
        removalTarget(flags),
        fingerprint(flags, "review-fingerprint"),
        confirmed(flags),
      ),
    );
    break;
  default:
    throw new Error(
      "Usage: capability-runtime-admin <status|lock-review|lock-apply|rollback-review|rollback-apply|revoke-review|revoke-apply|remove-review|remove-apply> [--unit-id=<id>|--launch-group-id=<id>] [--review-fingerprint=<sha256>] [--confirm]",
    );
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
      ? ["unit-id", "launch-group-id"]
      : command === "remove-apply"
      ? ["unit-id", "launch-group-id", "review-fingerprint", "confirm"]
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
  if (flags.size === 0 || flags.get("confirm") !== true) return false;
  return true;
}

function removalTarget(flags: ReadonlyMap<string, string | true>) {
  const unitId = flags.get("unit-id");
  const launchGroupId = flags.get("launch-group-id");
  if (typeof unitId === "string" && !launchGroupId) {
    return { kind: "unit" as const, id: required(flags, "unit-id") };
  }
  if (typeof launchGroupId === "string" && !unitId) {
    return {
      kind: "launch-group" as const,
      id: required(flags, "launch-group-id"),
    };
  }
  throw new Error(
    "Administrative removal requires exactly one --unit-id or --launch-group-id.",
  );
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
