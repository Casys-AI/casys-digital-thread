/** Exact first-party persistent topology registry. */

import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../application/control-plane/capability-runtime-launch-group-registry.ts";

export const POSTGRES_IMAGE_REFERENCE =
  "docker.io/library/postgres@sha256:926f8799aef36e00001cfe15fba7abbd37d3c5224ea57e4c858e4bb670f10561" as const;
export const SYSON_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/syson@sha256:fc599abb95587913de11ff6de68060b5593956abc0c47bc753cd19e2987141a6" as const;
export const MCP_SYSON_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-syson@sha256:87eee6e35a636124d5ba6911492a245d69edcdf1ba67575676c22a0e9d7ce65e" as const;

/**
 * SysON is only exposed through mcp-syson on 3009. The UI's historical 8180
 * mapping is intentionally absent: it is neither needed by FEA nor approved
 * by this capability group. No shared Compose network is named; Compose uses
 * the project-scoped default network derived from `casys-syson`.
 */
export async function createFirstPartyCapabilityRuntimeLaunchGroups(): Promise<
  readonly CapabilityRuntimeLaunchGroup[]
> {
  const composeContent = deterministicJson({
    services: {
      "syson-db": {
        image: POSTGRES_IMAGE_REFERENCE,
        environment: {
          POSTGRES_DB: "syson",
          POSTGRES_PASSWORD: "syson",
          POSTGRES_USER: "syson",
        },
        volumes: ["syson-db-data:/var/lib/postgresql/data"],
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U syson -d syson"],
          interval: "5s",
          timeout: "5s",
          retries: 10,
        },
      },
      "syson-app": {
        image: SYSON_IMAGE_REFERENCE,
        environment: {
          MANAGEMENT_HEALTH_ELASTICSEARCH_ENABLED: "false",
          SERVER_PORT: "8080",
          SIRIUS_COMPONENTS_CORS_ALLOWEDORIGINPATTERNS: "*",
          SPRING_DATASOURCE_PASSWORD: "syson",
          SPRING_DATASOURCE_URL: "jdbc:postgresql://syson-db/syson",
          SPRING_DATASOURCE_USERNAME: "syson",
        },
        depends_on: { "syson-db": { condition: "service_healthy" } },
        healthcheck: {
          test: [
            "CMD",
            "wget",
            "-q",
            "--spider",
            "http://localhost:8080/actuator/health",
          ],
          interval: "10s",
          timeout: "5s",
          retries: 20,
          start_period: "240s",
        },
      },
      "mcp-syson": {
        image: MCP_SYSON_IMAGE_REFERENCE,
        command: ["--port=3009", "--hostname=0.0.0.0"],
        environment: { SYSON_URL: "http://syson-app:8080" },
        depends_on: { "syson-app": { condition: "service_healthy" } },
        ports: ["127.0.0.1:3009:3009"],
        healthcheck: {
          test: [
            "CMD",
            "deno",
            "eval",
            "--allow-net=127.0.0.1:3009",
            "const r=await fetch('http://127.0.0.1:3009/health');if(!r.ok)Deno.exit(1)",
          ],
          interval: "10s",
          timeout: "5s",
          retries: 12,
          start_period: "10s",
        },
      },
    },
    volumes: { "syson-db-data": {} },
  });
  const compose = {
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content: composeContent,
    fingerprint: await fingerprintCapabilityRuntimeComposeContent(composeContent),
  };
  const body = {
    schemaVersion: "capability-runtime-launch-group/1.0" as const,
    id: "casys-syson",
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName: "casys-syson" },
    materials: [
      material(
        "casys.syson-stack",
        "syson-db-image",
        POSTGRES_IMAGE_REFERENCE,
        "syson-db",
      ),
      material(
        "casys.syson-stack",
        "syson-app-image",
        SYSON_IMAGE_REFERENCE,
        "syson-app",
      ),
      material(
        "casys.syson-stack",
        "mcp-syson-image",
        MCP_SYSON_IMAGE_REFERENCE,
        "mcp-syson",
      ),
    ],
    compose,
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: [],
    security: "reviewed" as const,
    qualification: "qualified" as const,
  };
  return [{
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  }];
}

export async function createFirstPartyCapabilityRuntimeLaunchGroupRegistry(): Promise<
  FixedCapabilityRuntimeLaunchGroupRegistry
> {
  return new FixedCapabilityRuntimeLaunchGroupRegistry(
    await createFirstPartyCapabilityRuntimeLaunchGroups(),
  );
}

export async function firstPartySysonLaunchGroupReference() {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  return capabilityRuntimeLaunchGroupReference(groups[0]!);
}

function material(
  unitId: string,
  materialId: string,
  imageReference: string,
  serviceName: string,
) {
  const digest = imageReference.slice(
    imageReference.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  return {
    material: { unitId, materialId, imageDigest: digest },
    serviceName,
    imageReference,
    ownership: [
      { key: "com.docker.compose.project", value: "casys-syson" },
      { key: "com.docker.compose.service", value: serviceName },
    ],
  } as const;
}
