import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import {
  GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_USAGE,
  parseGeometryModuleAssemblerWorkerCandidateQualificationCli,
} from "./verify-geometry-module-assembler-worker-candidate-qualification.ts";

Deno.test("geometry candidate qualification CLI is planning by default and allows recover", () => {
  assertEquals(
    parseGeometryModuleAssemblerWorkerCandidateQualificationCli(["--help"]),
    { mode: "help" },
  );
  assertEquals(
    parseGeometryModuleAssemblerWorkerCandidateQualificationCli([
      "--import-record=record.json",
    ]),
    { mode: "plan", importRecordPath: "record.json" },
  );
  assertEquals(
    parseGeometryModuleAssemblerWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--run",
    ]),
    { mode: "run", importRecordPath: "record.json" },
  );
  assertEquals(
    parseGeometryModuleAssemblerWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--recover",
    ]),
    { mode: "recover", importRecordPath: "record.json" },
  );
  assertThrows(
    () => parseGeometryModuleAssemblerWorkerCandidateQualificationCli([]),
    TypeError,
    "eligibleForPromotion remains false",
  );
  assertThrows(
    () =>
      parseGeometryModuleAssemblerWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--image=caller",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertEquals(
    parseGeometryModuleAssemblerWorkerCandidateQualificationCli([
      "--import-record=record.json",
      "--retry-infrastructure-failure",
    ]),
    {
      mode: "retry-infrastructure-failure",
      importRecordPath: "record.json",
    },
  );
  assertThrows(
    () =>
      parseGeometryModuleAssemblerWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--run",
        "--recover",
      ]),
    TypeError,
    "only one of --run, --recover, or --retry-infrastructure-failure",
  );
  assertThrows(
    () =>
      parseGeometryModuleAssemblerWorkerCandidateQualificationCli([
        "--import-record=record.json",
        "--image=caller",
        "--retry-infrastructure-failure",
      ]),
    TypeError,
    "does not accept provider, image, digest, platform",
  );
  assertMatch(
    GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    /eligibleForPromotion remains false/u,
  );
});
