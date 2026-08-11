import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assertProposalMatchesOperationGrammar,
  gatedProposalOperations,
  ProposalGrammarError,
} from "./proposal-validation.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/platform/architecture-proposal.ts";
import { RECONCILE_UNCERTAIN_WRITER_OPERATION } from "../../domain/project/reconcile-uncertain-writer-proposal.ts";

const VALID_ARCHITECTURE = [
  { key: "architecture.package", label: "Package", value: "DemoArchitecture" },
  { key: "system.name", label: "System", value: "DemoSystem" },
  { key: "component.part.name", label: "Part", value: "DemoPart" },
  { key: "component.part.usage", label: "Usage", value: "demoPart" },
  { key: "component.part.parent", label: "Parent", value: "DemoSystem" },
];

Deno.test("a proposal the authorising operation cannot parse is refused before it is recorded", () => {
  const misspelledSlug = VALID_ARCHITECTURE.map((parameter) =>
    parameter.key === "component.part.name"
      ? { ...parameter, key: "component.demo-part.name" }
      : parameter
  );
  const error = assertThrows(
    () =>
      assertProposalMatchesOperationGrammar(
        MODEL_WRITE_ARCHITECTURE_OPERATION,
        misspelledSlug,
      ),
    ProposalGrammarError,
  );
  assertEquals(error.operationKey, "model.write-architecture@1");
  // The underlying grammar message is carried verbatim: the agent needs the
  // offending key, not a generic rejection.
  assert(error.message.includes("component.demo-part.name"));
});

Deno.test("a proposal naming an unknown parent is refused with the offending component", () => {
  const unknownParent = VALID_ARCHITECTURE.map((parameter) =>
    parameter.key === "component.part.parent"
      ? { ...parameter, value: "system" }
      : parameter
  );
  const error = assertThrows(
    () =>
      assertProposalMatchesOperationGrammar(
        MODEL_WRITE_ARCHITECTURE_OPERATION,
        unknownParent,
      ),
    ProposalGrammarError,
  );
  assert(error.message.includes("DemoPart"));
});

Deno.test("a proposal the operation can parse passes the gate untouched", () => {
  assertProposalMatchesOperationGrammar(
    MODEL_WRITE_ARCHITECTURE_OPERATION,
    VALID_ARCHITECTURE,
  );
});

Deno.test("a decision bound to no operation is never gated", () => {
  assertProposalMatchesOperationGrammar(undefined, [
    { key: "anything", label: "Free form", value: "accepted" },
  ]);
});

Deno.test("an operation without a declared grammar is left untouched", () => {
  assertProposalMatchesOperationGrammar(
    { id: "record.archive-lineage", version: "1" },
    [{ key: "archiveAction", label: "Action", value: "retire-lineage" }],
  );
});

Deno.test("reconciliation grammar rejects duplicate, extra, typed and invalid-outcome parameters", () => {
  const valid = [
    { key: "reconcileAction", label: "Action", value: "resolve-uncertain-writer" },
    {
      key: "reconcileOperation",
      label: "Operation",
      value: "record.reconcile-uncertain-writer@1",
    },
    { key: "reconcileRunId", label: "Run", value: "run:failed" },
    {
      key: "reconcileFailureCode",
      label: "Failure",
      value: "provider-outcome-unknown",
    },
    { key: "reconcileBasisSnapshotId", label: "Basis", value: "thread:r4" },
    { key: "reconcileOutcome", label: "Outcome", value: "write-effect-accepted" },
    {
      key: "reconcileAttestation",
      label: "Attestation",
      value: "Inspected provider history.",
    },
  ];
  for (
    const invalid of [
      [...valid, { key: "extra", label: "Extra", value: "x" }],
      [...valid, valid[0]!],
      valid.map((item) =>
        item.key === "reconcileOutcome" ? { ...item, value: "maybe" } : item
      ),
      valid.map((item) =>
        item.key === "reconcileRunId" ? { ...item, value: 42 } : item
      ),
    ]
  ) {
    assertThrows(
      () =>
        assertProposalMatchesOperationGrammar(
          RECONCILE_UNCERTAIN_WRITER_OPERATION,
          invalid,
        ),
      ProposalGrammarError,
    );
  }
});

Deno.test("a decision shared by distinct operations must satisfy every declared grammar", () => {
  assertThrows(
    () =>
      assertProposalMatchesOperationGrammar([
        { id: "record.archive-lineage", version: "1" },
        MODEL_WRITE_ARCHITECTURE_OPERATION,
      ], [{ key: "anything", label: "Free form", value: "accepted" }]),
    ProposalGrammarError,
  );
});

Deno.test("every operation carrying an MRTR grammar is gated", () => {
  // Adding a sealed or model-writing operation without registering its grammar
  // would silently reopen the round trip this module exists to close.
  assertEquals(gatedProposalOperations(), [
    "design.write-geometry@1",
    "model.write-architecture@1",
    "model.write-requirements@1",
    "record.reconcile-uncertain-writer@1",
    "simulate.seal-simulation-case@1",
    "verify.seal-proof-case@1",
  ]);
});
