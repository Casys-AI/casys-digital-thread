import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeArchitectureSysmlSealParameters,
  parseArchitectureSysmlSealParameters,
} from "./architecture-sysml-seal-proposal.ts";

const admission = {
  schemaVersion: "architecture-sysml-seal-admission/1.0" as const,
  sourceId: "source.architecture",
  profile: {
    id: "sysml-architecture-closed-subset-v1",
    version: "1.0.0",
    fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
  },
  source: {
    sha256: "b".repeat(64),
    byteCount: 32,
    casUri: `casys://architecture-sysml-source/sha256/${"b".repeat(64)}`,
  },
  analysis: {
    analyzer: { id: "architecture-sysml-qualified", version: "1.0.0" },
    policy: {
      profile: "sysml-architecture-closed-subset-v1",
      status: "passed" as const,
    },
    sha256: "c".repeat(64),
    byteCount: 64,
    casUri: `casys://architecture-sysml-source-analysis/sha256/${"c".repeat(64)}`,
  },
};

Deno.test("architecture SysML seal parameters round-trip the exact capture identities", () => {
  const parameters = encodeArchitectureSysmlSealParameters(admission);
  assertEquals(parseArchitectureSysmlSealParameters(parameters), admission);
});

Deno.test("architecture SysML seal grammar rejects a rejected analysis status", () => {
  assertThrows(() =>
    encodeArchitectureSysmlSealParameters({
      ...admission,
      analysis: {
        ...admission.analysis,
        policy: { ...admission.analysis.policy, status: "rejected" },
      },
    })
  );
});
