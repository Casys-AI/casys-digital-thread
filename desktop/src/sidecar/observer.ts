import { COMPOSE_UNAVAILABLE_ERROR } from "./contracts.ts";

export interface ObservedContainer {
  readonly runtimeAvailable: false;
  readonly present: false;
  readonly error: string;
}

export interface DesiredServerIdentity {
  readonly id: string;
}

/**
 * Fail-closed provider-container observation. Lot 2 never executes Docker and
 * never walks parent directories for a compose root.
 */
export class UnavailableComposeObserver {
  observe(
    servers: readonly DesiredServerIdentity[],
  ): Promise<Map<string, ObservedContainer>> {
    return Promise.resolve(
      new Map(
        servers.map((server) => [
          server.id,
          {
            runtimeAvailable: false,
            present: false,
            error: COMPOSE_UNAVAILABLE_ERROR,
          } satisfies ObservedContainer,
        ]),
      ),
    );
  }
}
