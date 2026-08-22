/**
 * npm compatibility exposes `process.env` even when Deno denies env access.
 * Some parser modules read optional debug variables at module evaluation. Give
 * that graph an immutable empty view instead of granting or probing host env.
 */
export function sealNodeProcessEnvironment(
  processLike: object | undefined = (
    globalThis as typeof globalThis & { process?: object }
  ).process,
): void {
  if (processLike === undefined) return;
  Object.defineProperty(processLike, "env", {
    value: Object.freeze({}),
    writable: false,
    enumerable: true,
    configurable: false,
  });
}

interface DenoEnvironmentHost {
  env: {
    get(name: string): string | undefined;
    has(name: string): boolean;
    toObject(): Record<string, string>;
    set(name: string, value: string): void;
    delete(name: string): void;
  };
}

/**
 * The MCP library probes optional auth variables even when Desktop auth is
 * disabled. Keep native `--deny-env` and expose a deterministic empty view so
 * optional probes cannot turn into startup failures or observe host secrets.
 */
export function sealDenoEnvironment(
  denoLike: DenoEnvironmentHost = Deno,
): void {
  const deniedMutation = (): never => {
    throw new Deno.errors.NotCapable(
      "The Desktop control-plane environment is sealed read-only and empty.",
    );
  };
  const empty = Object.freeze({});
  const facade = Object.freeze({
    get: (_name: string): undefined => undefined,
    has: (_name: string): false => false,
    toObject: (): Record<string, string> => empty,
    set: (_name: string, _value: string): void => deniedMutation(),
    delete: (_name: string): void => deniedMutation(),
  });
  Object.defineProperty(denoLike, "env", {
    value: facade,
    writable: false,
    enumerable: true,
    configurable: false,
  });
}
