import { assertEquals, assertThrows } from "@std/assert";
import {
  MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
  validateModelicaMicrosandboxQualificationReference,
} from "./microsandbox-qualification.ts";

const CAPTURE_DIGEST = "a".repeat(64);
const PROFILE_DIGEST = "b".repeat(64);

Deno.test("Modelica Microsandbox qualification reference closes URI and profile", () => {
  const expectedProfile = {
    algorithm: "sha256" as const,
    digest: PROFILE_DIGEST,
  };
  const reference = validateModelicaMicrosandboxQualificationReference({
    schemaVersion: MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
    uri: `casys://modelica-microsandbox-qualification/sha256/${CAPTURE_DIGEST}`,
    fingerprint: { algorithm: "sha256", digest: CAPTURE_DIGEST },
    executionProfileFingerprint: expectedProfile,
  }, expectedProfile);
  assertEquals(reference.executionProfileFingerprint, expectedProfile);

  assertThrows(
    () =>
      validateModelicaMicrosandboxQualificationReference({
        ...reference,
        uri: `casys://modelica-microsandbox-qualification/sha256/${"c".repeat(64)}`,
      }, expectedProfile),
    TypeError,
    "exact qualification capture",
  );
  assertThrows(
    () =>
      validateModelicaMicrosandboxQualificationReference(reference, {
        algorithm: "sha256",
        digest: "d".repeat(64),
      }),
    TypeError,
    "another execution profile",
  );
});
