/**
 * Closed local secret handling for the fixed mcp-chrono launch group.
 *
 * The bearer token never leaves this module as a string.  A private WeakMap
 * binds one token generation to one opaque runtime snapshot, which is shared
 * by the Compose `up` overlay and the fixed loopback MCP client.  No project,
 * Thread, CAS, WAL, command line, log or agent-facing tool can serialize it.
 */

import type {
  CapabilityRuntimeLaunchSecretInjector,
  CapabilityRuntimeSecretSnapshot,
  CapabilityRuntimeSecretSnapshotResolver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeLaunchGroup,
  CapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  firstPartyChronoLaunchGroupReference,
} from "./first-party-capability-runtime-launch-groups.ts";
import type {
  ChronoMcpBearerCredentialResolver,
} from "../mechanics/chrono/chrono-prescribed-kinematics-client.ts";
import {
  createInternalMcpBearerCredential,
  type InternalMcpBearerCredential,
} from "../shared/mcp/stateless-mcp-http-transport.ts";

export const CHRONO_MCP_BEARER_TOKEN_SLOT = "chrono-mcp-bearer-token" as const;
export const CHRONO_MCP_BEARER_TOKEN_ENV = "CASYS_CHRONO_MCP_BEARER_TOKEN" as const;
const CHRONO_GROUP_ID = "casys-chrono" as const;
const CHRONO_GROUP_VERSION = "1.0.0" as const;
const CHRONO_SERVICE = "mcp-chrono" as const;
const CHRONO_SERVICE_ENV = "MCP_BEARER_TOKEN" as const;

/**
 * The only server-side implementation that can observe, mint, inject and use
 * the Chrono bearer token. If the optional host-local override is absent, it
 * mints one CSPRNG bearer generation for this server process. `readToken` is
 * deliberately a scalar test seam, never a caller-supplied environment map
 * or slot-to-variable mapping.
 */
export class LocalChronoRuntimeSecretResolver
  implements
    CapabilityRuntimeSecretSnapshotResolver,
    CapabilityRuntimeLaunchSecretInjector,
    ChronoMcpBearerCredentialResolver {
  readonly #values = new WeakMap<object, string>();
  readonly #credentials = new WeakMap<object, InternalMcpBearerCredential>();
  readonly #readToken: () => string | undefined;
  #tokenRead = false;
  #processToken: string | undefined;

  constructor(options: { readonly readToken?: () => string | undefined } = {}) {
    this.#readToken = options.readToken ??
      (() => Deno.env.get(CHRONO_MCP_BEARER_TOKEN_ENV));
  }

  observe(
    slots: readonly string[],
  ): Promise<ReadonlyMap<string, "available" | "unavailable" | "unknown">> {
    const value = new Map<string, "available" | "unavailable" | "unknown">();
    const token = this.#token();
    for (const slot of slots) {
      value.set(
        slot,
        slot === CHRONO_MCP_BEARER_TOKEN_SLOT
          ? token === undefined ? "unavailable" : "available"
          : "unknown",
      );
    }
    return Promise.resolve(value);
  }

  async beginSnapshot(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly slots: readonly string[];
  }): Promise<CapabilityRuntimeSecretSnapshot> {
    await assertChronoGroupReference(input.group);
    assertExactSlots(input.slots);
    const token = this.#token();
    if (token === undefined) {
      throw new Error("Chrono local bearer credential is unavailable.");
    }
    const snapshot = Object.freeze({}) as CapabilityRuntimeSecretSnapshot;
    this.#values.set(snapshot, token);
    return snapshot;
  }

  bearerCredentialFor(
    snapshot: CapabilityRuntimeSecretSnapshot,
  ): InternalMcpBearerCredential {
    const cached = this.#credentials.get(snapshot);
    if (cached !== undefined) return cached;
    const credential = createInternalMcpBearerCredential(this.#value(snapshot));
    this.#credentials.set(snapshot, credential);
    return credential;
  }

  async composeOverlay(input: {
    readonly group: CapabilityRuntimeLaunchGroup;
    readonly snapshot: CapabilityRuntimeSecretSnapshot;
  }): Promise<Uint8Array> {
    await assertChronoGroup(input.group);
    const source = JSON.parse(input.group.compose.content) as Record<string, unknown>;
    const services = object(source.services, "Chrono sealed Compose services");
    const service = object(services[CHRONO_SERVICE], "Chrono sealed Compose service");
    if (service.environment !== undefined) {
      throw new Error(
        "Chrono sealed Compose descriptor must not carry a bearer environment.",
      );
    }
    const document = {
      ...source,
      services: {
        ...services,
        [CHRONO_SERVICE]: {
          ...service,
          // This one exact environment key is injected in memory only.  It is
          // not a Compose interpolation and its source descriptor stays sealed.
          environment: { [CHRONO_SERVICE_ENV]: this.#value(input.snapshot) },
        },
      },
    };
    return new TextEncoder().encode(deterministicJson(document));
  }

  #token(): string | undefined {
    // A server process keeps one generation across every shared lease. That
    // avoids two concurrent starts/client constructions observing different
    // bearer values. A process restart deliberately gets a fresh generation
    // and forces the secret-bearing group reconciliation above.
    if (!this.#tokenRead) {
      const configured = this.#readToken();
      // A missing optional override is code-owned local setup, so mint the
      // process generation here. Compose performs `$` interpolation even when
      // a descriptor is supplied on stdin: an explicitly configured but
      // invalid value must therefore fail closed rather than be replaced.
      if (configured === undefined) {
        this.#processToken = mintChronoBearerToken();
      } else {
        this.#processToken = isChronoBearerToken(configured) ? configured : undefined;
      }
      this.#tokenRead = true;
    }
    return this.#processToken;
  }

  #value(snapshot: CapabilityRuntimeSecretSnapshot): string {
    const token = this.#values.get(snapshot);
    if (token === undefined) {
      throw new Error(
        "Chrono runtime secret snapshot is not available in this process.",
      );
    }
    return token;
  }
}

function mintChronoBearerToken(): string {
  return crypto.getRandomValues(new Uint8Array(32)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
}

function isChronoBearerToken(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]+$/.test(value) &&
    !value.includes("$");
}

async function assertChronoGroupReference(
  group: CapabilityRuntimeLaunchGroupReference,
): Promise<void> {
  const expected = await firstPartyChronoLaunchGroupReference();
  if (
    group.id !== CHRONO_GROUP_ID || group.version !== CHRONO_GROUP_VERSION ||
    !sameCapabilityRuntimeLaunchGroupReference(group, expected)
  ) {
    throw new TypeError(
      "Chrono secret snapshot is limited to the exact Chrono launch group.",
    );
  }
}

async function assertChronoGroup(group: CapabilityRuntimeLaunchGroup): Promise<void> {
  await assertChronoGroupReference(group);
  if (
    group.secretSlots.length !== 1 ||
    group.secretSlots[0] !== CHRONO_MCP_BEARER_TOKEN_SLOT ||
    group.materials.length !== 1 ||
    group.materials[0]?.serviceName !== CHRONO_SERVICE
  ) {
    throw new TypeError(
      "Chrono launch group secret scope drifted from the fixed local binding.",
    );
  }
}

function assertExactSlots(slots: readonly string[]): void {
  if (slots.length !== 1 || slots[0] !== CHRONO_MCP_BEARER_TOKEN_SLOT) {
    throw new TypeError(
      "Chrono secret snapshots require only the fixed bearer-token slot.",
    );
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}
