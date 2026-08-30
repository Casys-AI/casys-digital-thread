/**
 * Phase-1 fixed publication for the SysON seed canary.
 *
 * The adapter derives the current server-owned SysON loopback URL from the
 * exact sealed casys-syson Compose publication. Callers receive only an
 * opaque process-local handle. This is not a provider registry, gateway,
 * pool or supervisor.
 */

import type {
  CapabilityRuntimeBoundMcpClient,
  CapabilityRuntimeConnectionBroker,
  CapabilityRuntimeConnectionHandle,
  CapabilityRuntimeConnectionRequest,
  CapabilityRuntimeMcpClientOpener,
} from "../../application/ports/out/capability/capability-runtime-connection.ts";
import { CapabilityRuntimeConnectionError } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import type { CapabilityRuntimeLeaseStore } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { McpToolClient } from "../../application/ports/out/mcp-tool-client.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts,
  type CapabilityRuntimeLaunchGroupReference,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
  validateCapabilityRuntimeLaunchGroup,
  validateCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  type CapabilityRuntimeLease,
  validateCapabilityRuntimeLease,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { HttpMcpToolClient } from "../shared/mcp/http-mcp-tool-client.ts";

const SYSON_AUTHOR_SYSTEM_BINDING = {
  id: "syson-author-system",
  version: "1",
} as const;
const SYSON_LAUNCH_GROUP_ID = "casys-syson" as const;
const SYSON_LAUNCH_GROUP_VERSION = "1.0.0" as const;
const SYSON_CLIENT_TIMEOUT_MS = 30_000;

interface BoundPublication {
  readonly lease: CapabilityRuntimeLease;
  readonly binding: { readonly id: string; readonly version: string };
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly mcpUrl: string;
}

export interface LocalFixedSysonCapabilityRuntimeConnectionOptions {
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly launchGroup: unknown;
  readonly fleetMcpUrl?: string;
  readonly now?: () => string;
  readonly fetch?: typeof fetch;
}

export function createLocalFixedSysonCapabilityRuntimeConnection(
  options: LocalFixedSysonCapabilityRuntimeConnectionOptions,
): Promise<LocalFixedSysonCapabilityRuntimeConnection> {
  return LocalFixedSysonCapabilityRuntimeConnection.create(options);
}

export class LocalFixedSysonCapabilityRuntimeConnection
  implements CapabilityRuntimeConnectionBroker, CapabilityRuntimeMcpClientOpener {
  readonly #leases: CapabilityRuntimeLeaseStore;
  readonly #launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly #mcpUrl: string;
  readonly #now: () => string;
  readonly #fetch: typeof fetch | undefined;
  readonly #handles = new WeakMap<
    CapabilityRuntimeConnectionHandle,
    BoundPublication
  >();

  static async create(
    options: LocalFixedSysonCapabilityRuntimeConnectionOptions,
  ): Promise<LocalFixedSysonCapabilityRuntimeConnection> {
    const group = await admittedSysonLaunchGroup(options.launchGroup);
    const mcpUrl = derivedSysonLoopbackMcpUrl(group);
    if (options.fleetMcpUrl !== undefined && options.fleetMcpUrl !== mcpUrl) {
      throw new CapabilityRuntimeConnectionError(
        "Local fixed SysON publication does not match the sealed casys-syson loopback host port.",
      );
    }
    return new LocalFixedSysonCapabilityRuntimeConnection({
      leases: options.leases,
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      mcpUrl,
      now: options.now,
      fetch: options.fetch,
    });
  }

  private constructor(options: {
    readonly leases: CapabilityRuntimeLeaseStore;
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
    readonly mcpUrl: string;
    readonly now?: () => string;
    readonly fetch?: typeof fetch;
  }) {
    this.#leases = options.leases;
    this.#launchGroup = options.launchGroup;
    this.#mcpUrl = options.mcpUrl;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#fetch = options.fetch;
  }

  boundClient(): CapabilityRuntimeBoundMcpClient {
    return {
      broker: this,
      openMcpClient: (handle) => this.open(handle),
    };
  }

  async connect(
    request: CapabilityRuntimeConnectionRequest,
  ): Promise<CapabilityRuntimeConnectionHandle> {
    const lease = admittedLease(request.lease);
    const binding = admittedBinding(request.binding);
    const launchGroup = admittedLaunchGroup(request.launchGroup);
    if (
      binding.id !== SYSON_AUTHOR_SYSTEM_BINDING.id ||
      binding.version !== SYSON_AUTHOR_SYSTEM_BINDING.version ||
      !sameCapabilityRuntimeLaunchGroupReference(launchGroup, this.#launchGroup)
    ) {
      throw new CapabilityRuntimeConnectionError(
        "Capability runtime connection requires the exact trusted SysON binding and casys-syson launch group.",
      );
    }
    if (
      !lease.bindingIds.includes(binding.id) ||
      !lease.launchGroups.some((candidate) =>
        sameCapabilityRuntimeLaunchGroupReference(candidate, launchGroup)
      )
    ) {
      throw new CapabilityRuntimeConnectionError(
        "Capability runtime connection requires an exact active lease covering the requested binding and launch group.",
      );
    }
    const stored = await this.requireActiveLease(lease);
    const handle = Object.freeze({}) as CapabilityRuntimeConnectionHandle;
    this.#handles.set(handle, {
      lease: stored,
      binding,
      launchGroup,
      mcpUrl: this.#mcpUrl,
    });
    return handle;
  }

  async open(handle: CapabilityRuntimeConnectionHandle): Promise<McpToolClient> {
    const bound = this.#handles.get(handle);
    if (!bound) {
      throw new CapabilityRuntimeConnectionError(
        "Capability runtime connection handle is unknown.",
      );
    }
    try {
      const stored = await this.requireActiveLease(bound.lease);
      if (
        !stored.bindingIds.includes(bound.binding.id) ||
        !stored.launchGroups.some((candidate) =>
          sameCapabilityRuntimeLaunchGroupReference(candidate, bound.launchGroup)
        )
      ) {
        throw new CapabilityRuntimeConnectionError(
          "Capability runtime connection handle no longer matches its active lease.",
        );
      }
    } catch (error) {
      this.#handles.delete(handle);
      throw error;
    }
    return new HttpMcpToolClient({
      mcpUrl: bound.mcpUrl,
      timeoutMs: SYSON_CLIENT_TIMEOUT_MS,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
    });
  }

  private async requireActiveLease(
    expected: CapabilityRuntimeLease,
  ): Promise<CapabilityRuntimeLease> {
    const storedValue = await this.#leases.read(expected.id);
    if (!storedValue) {
      throw new CapabilityRuntimeConnectionError(
        "Capability runtime connection handle is not bound to an active lease.",
      );
    }
    const stored = admittedLease(storedValue);
    if (!sameLease(stored, expected) || stored.expiresAt <= this.#now()) {
      throw new CapabilityRuntimeConnectionError(
        "Capability runtime connection handle is not bound to an active lease.",
      );
    }
    return stored;
  }
}

async function admittedSysonLaunchGroup(
  value: unknown,
): Promise<CapabilityRuntimeLaunchGroup> {
  let group: CapabilityRuntimeLaunchGroup;
  try {
    group = await validateCapabilityRuntimeLaunchGroup(value);
  } catch {
    throw new CapabilityRuntimeConnectionError(
      "Local fixed SysON publication binds only the exact casys-syson launch group.",
    );
  }
  if (
    group.id !== SYSON_LAUNCH_GROUP_ID ||
    group.version !== SYSON_LAUNCH_GROUP_VERSION
  ) {
    throw new CapabilityRuntimeConnectionError(
      "Local fixed SysON publication binds only the exact casys-syson launch group.",
    );
  }
  return group;
}

function derivedSysonLoopbackMcpUrl(group: CapabilityRuntimeLaunchGroup): string {
  const ports = capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(group);
  if (ports.length !== 1) {
    throw new CapabilityRuntimeConnectionError(
      "Local fixed SysON publication requires exactly one published loopback host port.",
    );
  }
  return `http://127.0.0.1:${ports[0]}/mcp`;
}

function admittedLease(value: unknown): CapabilityRuntimeLease {
  try {
    return validateCapabilityRuntimeLease(value);
  } catch {
    throw new CapabilityRuntimeConnectionError(
      "Capability runtime connection requires an exact active lease.",
    );
  }
}

function admittedLaunchGroup(
  value: unknown,
): CapabilityRuntimeLaunchGroupReference {
  try {
    return validateCapabilityRuntimeLaunchGroupReference(value);
  } catch {
    throw new CapabilityRuntimeConnectionError(
      "Capability runtime connection requires the exact trusted SysON binding and casys-syson launch group.",
    );
  }
}

function admittedBinding(
  value: unknown,
): { readonly id: string; readonly version: string } {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    !("id" in value) || !("version" in value) ||
    typeof value.id !== "string" || typeof value.version !== "string" ||
    value.id.length === 0 || value.version.length === 0
  ) {
    throw new CapabilityRuntimeConnectionError(
      "Capability runtime connection requires the exact trusted SysON binding and casys-syson launch group.",
    );
  }
  return { id: value.id, version: value.version };
}

function sameLease(
  left: CapabilityRuntimeLease,
  right: CapabilityRuntimeLease,
): boolean {
  return left.id === right.id &&
    left.projectId === right.projectId &&
    sameTokens(left.bindingIds, right.bindingIds) &&
    sameTokens(left.materialKeys, right.materialKeys) &&
    left.launchGroups.length === right.launchGroups.length &&
    left.launchGroups.every((group, index) =>
      sameCapabilityRuntimeLaunchGroupReference(group, right.launchGroups[index]!)
    ) &&
    left.acquiredAt === right.acquiredAt &&
    left.expiresAt === right.expiresAt;
}

function sameTokens(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((token, index) => token === right[index]);
}
