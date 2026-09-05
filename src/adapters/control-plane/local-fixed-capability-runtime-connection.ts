/**
 * Phase-1 fixed publication locator for one sealed binding and launch group.
 *
 * Composition supplies the exact trusted binding and the exact validated
 * persistent Compose group. The adapter derives one loopback `/mcp` URL from
 * that group. Callers receive only an opaque process-local handle. This is not
 * a provider registry, gateway, pool, health checker, or supervisor.
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

const DEFAULT_CLIENT_TIMEOUT_MS = 30_000;

interface BoundPublication {
  readonly lease: CapabilityRuntimeLease;
  readonly binding: { readonly id: string; readonly version: string };
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly mcpUrl: string;
}

export interface LocalFixedCapabilityRuntimeConnectionOptions {
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly binding: { readonly id: string; readonly version: string };
  readonly launchGroup: unknown;
  readonly fleetMcpUrl?: string;
  readonly timeoutMs?: number;
  readonly now?: () => string;
  readonly fetch?: typeof fetch;
}

export function createLocalFixedCapabilityRuntimeConnection(
  options: LocalFixedCapabilityRuntimeConnectionOptions,
): Promise<LocalFixedCapabilityRuntimeConnection> {
  return LocalFixedCapabilityRuntimeConnection.create(options);
}

export class LocalFixedCapabilityRuntimeConnection
  implements CapabilityRuntimeConnectionBroker, CapabilityRuntimeMcpClientOpener {
  readonly #leases: CapabilityRuntimeLeaseStore;
  readonly #binding: { readonly id: string; readonly version: string };
  readonly #launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly #mcpUrl: string;
  readonly #timeoutMs: number;
  readonly #now: () => string;
  readonly #fetch: typeof fetch | undefined;
  readonly #handles = new WeakMap<
    CapabilityRuntimeConnectionHandle,
    BoundPublication
  >();

  static async create(
    options: LocalFixedCapabilityRuntimeConnectionOptions,
  ): Promise<LocalFixedCapabilityRuntimeConnection> {
    const binding = admittedBinding(options.binding);
    const group = await admittedLaunchGroup(options.launchGroup);
    const mcpUrl = derivedLoopbackMcpUrl(group);
    if (options.fleetMcpUrl !== undefined && options.fleetMcpUrl !== mcpUrl) {
      throw new CapabilityRuntimeConnectionError(
        "Local fixed publication does not match the sealed launch-group loopback host port.",
      );
    }
    return new LocalFixedCapabilityRuntimeConnection({
      leases: options.leases,
      binding,
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      mcpUrl,
      timeoutMs: options.timeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS,
      now: options.now,
      fetch: options.fetch,
    });
  }

  private constructor(options: {
    readonly leases: CapabilityRuntimeLeaseStore;
    readonly binding: { readonly id: string; readonly version: string };
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
    readonly mcpUrl: string;
    readonly timeoutMs: number;
    readonly now?: () => string;
    readonly fetch?: typeof fetch;
  }) {
    this.#leases = options.leases;
    this.#binding = options.binding;
    this.#launchGroup = options.launchGroup;
    this.#mcpUrl = options.mcpUrl;
    this.#timeoutMs = options.timeoutMs;
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
    const launchGroup = admittedLaunchGroupReference(request.launchGroup);
    if (
      binding.id !== this.#binding.id ||
      binding.version !== this.#binding.version ||
      !sameCapabilityRuntimeLaunchGroupReference(launchGroup, this.#launchGroup)
    ) {
      throw new CapabilityRuntimeConnectionError(
        "Capability runtime connection requires the exact trusted binding and launch group.",
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
      timeoutMs: this.#timeoutMs,
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

async function admittedLaunchGroup(
  value: unknown,
): Promise<CapabilityRuntimeLaunchGroup> {
  try {
    return await validateCapabilityRuntimeLaunchGroup(value);
  } catch {
    throw new CapabilityRuntimeConnectionError(
      "Local fixed publication binds only a validated persistent-Compose launch group.",
    );
  }
}

function derivedLoopbackMcpUrl(group: CapabilityRuntimeLaunchGroup): string {
  const ports = capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(group);
  if (ports.length !== 1) {
    throw new CapabilityRuntimeConnectionError(
      "Local fixed publication requires exactly one published loopback host port.",
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

function admittedLaunchGroupReference(
  value: unknown,
): CapabilityRuntimeLaunchGroupReference {
  try {
    return validateCapabilityRuntimeLaunchGroupReference(value);
  } catch {
    throw new CapabilityRuntimeConnectionError(
      "Capability runtime connection requires the exact trusted binding and launch group.",
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
      "Capability runtime connection requires the exact trusted binding and launch group.",
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
