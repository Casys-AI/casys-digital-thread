import {
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../domain/compile/isolation/local-isolation-runtime.ts";
import {
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
} from "../application/control-plane/read-model/capability-demand.ts";

const sha = (character: string) => character.repeat(64);

/**
 * Synthetic conformance fixture, never a deployable pack or a runtime catalogue.
 * The service graph mirrors the intended Behave foundation shape while every
 * example.invalid image makes accidental operational use impossible.
 */
export function syntheticBehaveFoundationPack(): unknown {
  return {
    schemaVersion: "capability-pack-candidate/0.1",
    id: "test.casys.behave-foundation",
    version: "0.1.0",
    bindingClaims: [
      {
        id: "test.binding.syson-model",
        version: "0.1.0",
        capability: { ...MODEL_AUTHOR_SYSTEM_CAPABILITY },
        materialIds: ["mcp-syson"],
      },
      {
        id: "test.binding.syson-requirement-evaluation",
        version: "0.1.0",
        capability: { ...MODEL_EVALUATE_REQUIREMENT_CAPABILITY },
        materialIds: ["mcp-syson"],
      },
      {
        id: "test.binding.build123d-export",
        version: "0.1.0",
        capability: { ...GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY },
        materialIds: ["mcp-build123d-sandbox"],
      },
      {
        id: "test.binding.calculix-static-proof",
        version: "0.1.0",
        capability: { ...MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY },
        materialIds: ["calculix-worker"],
      },
    ],
    materials: [
      {
        id: "syson-db",
        kind: "compose-service",
        image: `example.invalid/casys/syson-db@sha256:${sha("1")}`,
        platforms: ["linux/amd64", "linux/arm64"],
        dependsOn: [],
        estimatedBytes: 100,
        serviceName: "syson-db",
        exposure: "internal",
      },
      {
        id: "syson-app",
        kind: "compose-service",
        image: `example.invalid/casys/syson-app@sha256:${sha("2")}`,
        platforms: ["linux/amd64", "linux/arm64"],
        dependsOn: ["syson-db"],
        estimatedBytes: 200,
        serviceName: "syson-app",
        exposure: "loopback-only",
      },
      {
        id: "mcp-syson",
        kind: "compose-service",
        image: `example.invalid/casys/mcp-syson@sha256:${sha("3")}`,
        platforms: ["linux/amd64", "linux/arm64"],
        dependsOn: ["syson-app"],
        estimatedBytes: 300,
        serviceName: "mcp-syson",
        exposure: "loopback-only",
      },
      {
        id: "mcp-build123d-sandbox",
        kind: "compose-service",
        image: `example.invalid/casys/build123d@sha256:${sha("4")}`,
        platforms: ["linux/amd64", "linux/arm64"],
        dependsOn: [],
        estimatedBytes: 400,
        serviceName: "mcp-build123d-sandbox",
        exposure: "loopback-only",
      },
      {
        id: "calculix-worker",
        kind: "microvm-image",
        image: `example.invalid/casys/calculix-worker@sha256:${sha("5")}`,
        platforms: ["linux/amd64", "linux/arm64"],
        dependsOn: [],
        estimatedBytes: 500,
        runner: MICROSANDBOX_LOCAL_RUNTIME_REF,
        policyFingerprint: { algorithm: "sha256", digest: sha("a") },
        network: "deny-all",
      },
    ],
  };
}

export function emptyCapabilityInstallationLock(): unknown {
  return {
    schemaVersion: "capability-installation-lock-candidate/0.1",
    revision: 1,
    previous: null,
    packs: [],
  };
}
