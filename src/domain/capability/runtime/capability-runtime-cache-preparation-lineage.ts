import { deepFreeze, rejectDuplicates } from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import {
  CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS,
  CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA,
  type CapabilityRuntimeCachePreparation,
  type CapabilityRuntimeCachePreparationIntent,
  type CapabilityRuntimeCachePreparationTerminal,
} from "./capability-runtime-cache-preparation-model.ts";
import { capabilityRuntimeCachePreparationScopeFingerprint } from "./capability-runtime-cache-preparation-recipe.ts";
import {
  validateCapabilityRuntimeCachePreparationIntent,
  validateCapabilityRuntimeCachePreparationTerminal,
} from "./capability-runtime-cache-preparation-attempt.ts";

export async function resolveCapabilityRuntimeCachePreparations(input: {
  readonly intents: readonly CapabilityRuntimeCachePreparationIntent[];
  readonly terminals: readonly CapabilityRuntimeCachePreparationTerminal[];
}): Promise<readonly CapabilityRuntimeCachePreparation[]> {
  const intents = await Promise.all(
    input.intents.map((intent) =>
      validateCapabilityRuntimeCachePreparationIntent(intent)
    ),
  );
  rejectDuplicates(intents.map((intent) => intent.id), "$cachePreparation.intents");
  const terminals = await Promise.all(
    input.terminals.map((terminal) =>
      validateCapabilityRuntimeCachePreparationTerminal(terminal)
    ),
  );
  rejectDuplicates(
    terminals.map((terminal) => terminal.preparationId),
    "$cachePreparation.terminals",
  );
  const intentIds = new Set(intents.map((intent) => intent.id));
  if (terminals.some((terminal) => !intentIds.has(terminal.preparationId))) {
    throw new TypeError("$cachePreparation terminal has no matching intent.");
  }
  const terminalById = new Map(
    terminals.map((terminal) => [terminal.preparationId, terminal]),
  );
  const preparations = await Promise.all(intents.map(async (intent) => {
    const terminal = terminalById.get(intent.id) ?? null;
    if (terminal) await assertTerminalBelongsToIntent(terminal, intent);
    return deepFreeze({ intent, terminal });
  }));
  return deepFreeze(
    preparations.toSorted((left, right) =>
      capabilityRuntimeCachePreparationLineageKey(left.intent).localeCompare(
        capabilityRuntimeCachePreparationLineageKey(right.intent),
      ) || left.intent.generation - right.intent.generation
    ),
  );
}

export function validateCapabilityRuntimeCachePreparationLineages(
  preparations: readonly CapabilityRuntimeCachePreparation[],
): void {
  assertPreparationLineages(preparations);
}

export function capabilityRuntimeCachePreparationLineageKey(
  intent: CapabilityRuntimeCachePreparationIntent,
): string {
  return `${intent.projectId}\u0000${intent.recipe.id}\u0000${intent.recipe.version}\u0000${intent.recipe.fingerprint.digest}\u0000${intent.scopeFingerprint.digest}`;
}

async function assertTerminalBelongsToIntent(
  terminal: CapabilityRuntimeCachePreparationTerminal,
  intent: CapabilityRuntimeCachePreparationIntent,
): Promise<void> {
  if (
    terminal.preparationId !== intent.id ||
    !fingerprintsEqual(terminal.preparationFingerprint, intent.fingerprint)
  ) {
    throw new TypeError("$cachePreparation terminal does not bind its exact intent.");
  }
  const recordedAt =
    terminal.schemaVersion === CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA
      ? terminal.observedAt
      : terminal.failedAt;
  if (recordedAt < intent.plannedAt) {
    throw new TypeError("$cachePreparation terminal predates its durable intent.");
  }
  if (terminal.schemaVersion === CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA) {
    const scope = await capabilityRuntimeCachePreparationScopeFingerprint(intent.scope);
    if (!fingerprintsEqual(terminal.scopeFingerprint, scope)) {
      throw new TypeError(
        "$cachePreparation observed record does not bind its exact scope.",
      );
    }
  }
}

function assertPreparationLineages(
  preparations: readonly CapabilityRuntimeCachePreparation[],
): void {
  const lineages = new Map<string, CapabilityRuntimeCachePreparation[]>();
  for (const preparation of preparations) {
    const key = capabilityRuntimeCachePreparationLineageKey(preparation.intent);
    const lineage = lineages.get(key) ?? [];
    lineage.push(preparation);
    lineages.set(key, lineage);
  }
  for (const lineage of lineages.values()) {
    const ordered = lineage.toSorted((left, right) =>
      left.intent.generation - right.intent.generation
    );
    if (ordered.length > CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS) {
      throw new TypeError("$cachePreparation lineage exceeds the recovery bound.");
    }
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index]!.intent;
      if (current.generation !== index + 1) {
        throw new TypeError(
          "$cachePreparation lineage generations must be contiguous.",
        );
      }
      const previous = index === 0 ? undefined : ordered[index - 1]!;
      if (!previous) {
        if (current.predecessor !== null) {
          throw new TypeError(
            "$cachePreparation initial generation has a predecessor.",
          );
        }
        continue;
      }
      if (
        current.predecessor?.id !== previous.intent.id ||
        !fingerprintsEqual(current.predecessor.fingerprint, previous.intent.fingerprint)
      ) {
        throw new TypeError(
          "$cachePreparation successor does not bind its exact predecessor.",
        );
      }
      if (previous.terminal === null) {
        throw new TypeError(
          "$cachePreparation successor cannot bypass a pending predecessor.",
        );
      }
    }
  }
}
