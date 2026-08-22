import {
  HANDSHAKE_SCHEMA,
  PRODUCT_VERSION,
  type ReadinessHandshake,
  SERVER_VERSION,
} from "./contracts.ts";

export function createHandshake(
  launchId: string,
  configDigest: string,
): ReadinessHandshake {
  return {
    schema: HANDSHAKE_SCHEMA,
    status: "ready",
    productVersion: PRODUCT_VERSION,
    serverVersion: SERVER_VERSION,
    launchId,
    configDigest,
  };
}

export function serializeHandshake(handshake: ReadinessHandshake): string {
  return `${
    JSON.stringify({
      schema: handshake.schema,
      status: handshake.status,
      productVersion: handshake.productVersion,
      serverVersion: handshake.serverVersion,
      launchId: handshake.launchId,
      configDigest: handshake.configDigest,
    })
  }\n`;
}
