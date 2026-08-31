import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  ChronoPrescribedKinematicsClient,
  ChronoPrescribedKinematicsDispatchUncertainError,
  ChronoPrescribedKinematicsProtocolError,
  ChronoPrescribedKinematicsRequestError,
} from "./chrono-prescribed-kinematics-client.ts";
import type {
  CapabilityRuntimeSecretSnapshot,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  createInternalMcpBearerCredential,
} from "../../shared/mcp/stateless-mcp-http-transport.ts";

const CASE_TEXT = '{"schema_id":"chrono-prescribed-kinematics-case/1.0"}';
const CASE_SHA = "727daf35c32fd826cb4adcb79b9792437aca4afe5ff76396f2c73a3588a1947c";
const OTHER_CASE_SHA = "e".repeat(64);
const RECEIPT_SHA = "b".repeat(64);
const OUTCOME_SHA = "c".repeat(64);
const WORKER_SHA = "d".repeat(64);
const REQUEST_ID = "chrono-run-1";
const TOKEN = "chrono-bearer-secret";
const CASE_URI = `chrono-case:sha256:${CASE_SHA}`;
const TEST_SECRET_SNAPSHOT = Object.freeze({}) as CapabilityRuntimeSecretSnapshot;
const testSecretResolver = {
  bearerCredentialFor: () => createInternalMcpBearerCredential(TOKEN),
};

Deno.test("Chrono adapter sends fixed tool sequence with bearer at fetch only", async () => {
  const calls: Array<
    { name: string; arguments: Record<string, unknown>; headers: Headers }
  > = [];
  const client = clientWith((body, headers) => {
    const params = body.params as Record<string, unknown>;
    const argumentsValue = params.arguments as Record<string, unknown>;
    calls.push({ name: String(params.name), arguments: argumentsValue, headers });
    switch (params.name) {
      case "chrono_case_submit":
        return complete({ ok: true, case_sha256: CASE_SHA, case_uri: CASE_URI });
      case "chrono_run_prescribed_kinematics":
        return complete({ ok: true, replayed: false, record: recordView() });
      case "chrono_run_get":
        return complete({
          ok: true,
          state: "recorded",
          record: recordView({ offset: 1, limit: 2 }),
        });
      case "chrono_run_receipt_get":
        return complete({ ok: true, record: recordView({ offset: 1, limit: 2 }) });
      default:
        throw new Error(`unexpected tool ${params.name}`);
    }
  });

  const submitted = await client.submitCase({
    exactCaseText: CASE_TEXT,
    requestFingerprint: { algorithm: "sha256", digest: CASE_SHA },
  });
  const run = await client.run({
    requestId: REQUEST_ID,
    caseSha256: submitted.caseSha256,
    caseUri: submitted.caseUri,
  });
  const readback = await client.readRun(runRequest(), {
    sampleOffset: 1,
    sampleLimit: 2,
  });
  const receipt = await client.readReceipt(RECEIPT_SHA, {
    sampleOffset: 1,
    sampleLimit: 2,
  });

  assertEquals(run.state, "recorded");
  if (run.state !== "recorded") throw new Error("The fixture must record a run.");
  // mcp-chrono 0.3.2 publishes exactly these nine provider-owned limits. It
  // deliberately does not know the Digital Thread manufacturability limit.
  assertEquals(run.record.notEvaluated, [
    "collision",
    "clearance",
    "contact",
    "forces",
    "torques",
    "dynamics",
    "strength",
    "safety",
    "product fitness",
  ]);
  assertEquals(readback.state, "recorded");
  assertEquals(receipt.receipt.receiptSha256, RECEIPT_SHA);
  assertEquals(calls.map((call) => call.name), [
    "chrono_case_submit",
    "chrono_run_prescribed_kinematics",
    "chrono_run_get",
    "chrono_run_receipt_get",
  ]);
  assertEquals(calls[0]?.arguments, {
    case_json: CASE_TEXT,
    case_sha256: CASE_SHA,
  });
  assertEquals(calls[1]?.arguments, {
    request_id: REQUEST_ID,
    case_sha256: CASE_SHA,
    case_uri: CASE_URI,
  });
  assertEquals(calls[2]?.arguments, {
    request_id: REQUEST_ID,
    sample_offset: 1,
    sample_limit: 2,
  });
  assertEquals(calls[3]?.arguments, {
    receipt_sha256: RECEIPT_SHA,
    sample_offset: 1,
    sample_limit: 2,
  });
  for (const call of calls) {
    assertEquals(call.headers.get("authorization"), `Bearer ${TOKEN}`);
    assertEquals(JSON.stringify(call.arguments).includes(TOKEN), false);
  }
});

Deno.test("Chrono adapter retains literal provider uncertainty and never retries", async () => {
  let calls = 0;
  const client = clientWith(() => {
    calls += 1;
    return complete(
      {
        ok: false,
        error: { code: "run_uncertain", message: "intent remains pending" },
      },
      true,
    );
  });

  const result = await client.run(runRequest());

  assertEquals(result, {
    state: "uncertain",
    requestId: REQUEST_ID,
    caseSha256: CASE_SHA,
    caseUri: CASE_URI,
  });
  assertEquals(calls, 1);
});

Deno.test("Chrono adapter keeps published pre-intent rejections definite", async () => {
  for (
    const code of [
      "case_not_found",
      "case_uri_mismatch",
      "invalid_timeout",
      "invalid_request_id",
      "request_conflict",
    ] as const
  ) {
    const client = clientWith(() =>
      complete(
        { ok: false, error: { code, message: "definite pre-intent rejection" } },
        true,
      )
    );
    assertEquals(await client.run(runRequest()), { state: "rejected", code });
  }
});

Deno.test("Chrono adapter forces readback after post-intent runner and store outcomes", async () => {
  for (
    const code of [
      "runner_timeout",
      "worker_failed",
      "worker_invalid_output",
      "store_corrupt",
      "persisted_ledger_invalid",
    ] as const
  ) {
    const client = clientWith(() =>
      complete({
        ok: false,
        error: { code, message: "post-intent state requires readback" },
      }, true)
    );
    assertEquals(await client.run(runRequest()), {
      state: "uncertain",
      requestId: REQUEST_ID,
      caseSha256: CASE_SHA,
      caseUri: CASE_URI,
    });
  }
});

Deno.test("Chrono adapter exposes failed dispatch as uncertain without an automatic retry", async () => {
  let calls = 0;
  const client = ChronoPrescribedKinematicsClient.fromTrustedRuntime({
    secretResolver: testSecretResolver,
    secretSnapshot: TEST_SECRET_SNAPSHOT,
    fetch: (() => {
      calls += 1;
      return Promise.reject(new Error("socket reset after send"));
    }) as typeof fetch,
  });

  await assertRejects(
    () => client.run(runRequest()),
    ChronoPrescribedKinematicsDispatchUncertainError,
    "read the same request identity instead of retrying",
  );
  assertEquals(calls, 1);
});

Deno.test("Chrono adapter treats malformed HTTP 200 run acknowledgement as uncertain", async () => {
  let calls = 0;
  const client = ChronoPrescribedKinematicsClient.fromTrustedRuntime({
    secretResolver: testSecretResolver,
    secretSnapshot: TEST_SECRET_SNAPSHOT,
    fetch: (() => {
      calls += 1;
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 99,
        result: { resultType: "complete" },
      }));
    }) as typeof fetch,
  });

  await assertRejects(
    () => client.run(runRequest()),
    ChronoPrescribedKinematicsDispatchUncertainError,
    "read the same request identity instead of retrying",
  );
  assertEquals(calls, 1);
});

Deno.test("Chrono adapter treats malformed tool results and run records as uncertain", async () => {
  const malformedToolResult = clientWith(() => ({ resultType: "incomplete" }));
  await assertRejects(
    () => malformedToolResult.run(runRequest()),
    ChronoPrescribedKinematicsDispatchUncertainError,
    "read the same request identity instead of retrying",
  );

  const malformedRecord = clientWith(() =>
    complete({ ok: true, replayed: false, record: {} })
  );
  await assertRejects(
    () => malformedRecord.run(runRequest()),
    ChronoPrescribedKinematicsDispatchUncertainError,
    "read the same request identity instead of retrying",
  );
});

Deno.test("Chrono adapter keeps a definite proxy auth rejection out of uncertainty", async () => {
  let calls = 0;
  const client = ChronoPrescribedKinematicsClient.fromTrustedRuntime({
    secretResolver: testSecretResolver,
    secretSnapshot: TEST_SECRET_SNAPSHOT,
    fetch: (() => {
      calls += 1;
      return Promise.resolve(new Response(`proxy reflected ${TOKEN}`, { status: 401 }));
    }) as typeof fetch,
  });

  let thrown: unknown;
  try {
    await client.run(runRequest());
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof ChronoPrescribedKinematicsRequestError);
  assertEquals(thrown.kind, "http-rejection");
  assertEquals(thrown.httpStatus, 401);
  assertEquals(thrown.message.includes(TOKEN), false);
  assertEquals(calls, 1);
});

Deno.test("Chrono adapter fails closed when a case submit SHA differs from its request", async () => {
  const client = clientWith((body) => {
    const params = body.params as Record<string, unknown>;
    assertEquals(params.name, "chrono_case_submit");
    return complete({
      ok: true,
      case_sha256: OTHER_CASE_SHA,
      case_uri: `chrono-case:sha256:${OTHER_CASE_SHA}`,
    });
  });

  await assertRejects(
    () =>
      client.submitCase({
        exactCaseText: CASE_TEXT,
        requestFingerprint: { algorithm: "sha256", digest: CASE_SHA },
      }),
    ChronoPrescribedKinematicsProtocolError,
    "does not match the expected exact case SHA-256",
  );
});

Deno.test("Chrono adapter canonicalizes a missing stored request URI from the record", async () => {
  const client = clientWith((body) => {
    const params = body.params as Record<string, unknown>;
    assertEquals(params.name, "chrono_run_get");
    return complete({
      ok: true,
      state: "recorded",
      record: recordView({ omitRequestCaseUri: true }),
    });
  });

  const result = await client.readRun(runRequest());

  assertEquals(result.state, "recorded");
  if (result.state === "recorded") {
    assertEquals(result.record.request.caseUri, CASE_URI);
  }
});

Deno.test("Chrono adapter still rejects a stored request URI that is present but invalid", async () => {
  const client = clientWith(() => {
    const record = recordView();
    (record.request as Record<string, unknown>).case_uri =
      `chrono-case:sha256:${OTHER_CASE_SHA}`;
    return complete({ ok: true, state: "recorded", record });
  });

  await assertRejects(
    () => client.readRun(runRequest()),
    ChronoPrescribedKinematicsProtocolError,
    "case_uri",
  );
});

Deno.test("Chrono adapter rejects a non-canonical provider timestamp", async () => {
  const client = clientWith(() => {
    const record = recordView();
    record.recorded_at = "2026-08-29T00:00:00Z";
    (record.receipt as Record<string, unknown>).recorded_at = "2026-08-29T00:00:00Z";
    return complete({ ok: true, state: "recorded", record });
  });

  await assertRejects(
    () => client.readRun(runRequest()),
    ChronoPrescribedKinematicsProtocolError,
    "exact canonical ISO timestamp",
  );
});

Deno.test("Chrono adapter never reflects an unknown structured provider error code", async () => {
  const client = clientWith(() =>
    complete(
      {
        ok: false,
        error: {
          code: TOKEN,
          message: `provider reflected ${TOKEN}`,
          details: { stderr: TOKEN },
        },
      },
      true,
    )
  );

  let thrown: unknown;
  try {
    await client.run(runRequest());
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof ChronoPrescribedKinematicsDispatchUncertainError);
  assertEquals(thrown.message.includes(TOKEN), false);
});

Deno.test("Chrono adapter never reflects structured provider error messages", async () => {
  const client = clientWith(() =>
    complete(
      {
        ok: false,
        error: {
          code: "case_invalid",
          message: `provider reflected ${TOKEN}`,
          details: { stderr: TOKEN },
        },
      },
      true,
    )
  );

  const result = await client.run(runRequest());
  assertEquals(result, { state: "rejected", code: "case_invalid" });
  assertEquals(JSON.stringify(result).includes(TOKEN), false);
});

Deno.test("Chrono adapter rejects stale provider records and malformed page metadata", async () => {
  const stale = clientWith((body) => {
    const params = body.params as Record<string, unknown>;
    assertEquals(params.name, "chrono_run_get");
    const record = recordView();
    // Historical receipt fixture: the former 0.3.1 runtime is intentionally
    // breaking and must be rejected without a receipt migration.
    (record.receipt as Record<string, unknown>).package = {
      name: "@casys/mcp-chrono",
      version: "0.3.1",
    };
    return complete({ ok: true, state: "recorded", record });
  });
  await assertRejects(
    () => stale.readRun(runRequest()),
    ChronoPrescribedKinematicsProtocolError,
    "package.version",
  );

  const malformedPage = clientWith(() => {
    const record = recordView();
    (record.sample_page as Record<string, unknown>).returned = 2;
    return complete({ ok: true, state: "recorded", record });
  });
  await assertRejects(
    () => malformedPage.readRun(runRequest()),
    ChronoPrescribedKinematicsProtocolError,
    "inconsistent bounded-page metadata",
  );

  const inventedManufacturability = clientWith(() => {
    const record = recordView();
    ((record.observation as Record<string, unknown>).not_evaluated as string[])
      .push("manufacturability");
    return complete({ ok: true, state: "recorded", record });
  });
  await assertRejects(
    () => inventedManufacturability.readRun(runRequest()),
    ChronoPrescribedKinematicsProtocolError,
    "fixed literal boundary",
  );
});

Deno.test("Chrono adapter rejects uncertain readback for another request or case", async () => {
  for (
    const [requestId, caseSha256] of [
      ["chrono-run-other", CASE_SHA],
      [REQUEST_ID, OTHER_CASE_SHA],
    ] as const
  ) {
    const caseUri = `chrono-case:sha256:${caseSha256}`;
    const client = clientWith(() =>
      complete({
        ok: true,
        state: "uncertain",
        intent: {
          request: {
            request_id: requestId,
            case_sha256: caseSha256,
            case_uri: caseUri,
          },
          case_uri: caseUri,
          intent_recorded_at: "2026-08-29T00:00:00.000Z",
        },
      })
    );

    await assertRejects(
      () => client.readRun(runRequest()),
      ChronoPrescribedKinematicsProtocolError,
      "exact request and case identity expected by readback",
    );
  }
});

function clientWith(
  responder: (
    body: Record<string, unknown>,
    headers: Headers,
  ) => Record<string, unknown>,
): ChronoPrescribedKinematicsClient {
  return ChronoPrescribedKinematicsClient.fromTrustedRuntime({
    secretResolver: testSecretResolver,
    secretSnapshot: TEST_SECRET_SNAPSHOT,
    fetch: ((_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: responder(body, headers),
      }));
    }) as typeof fetch,
  });
}

function complete(
  structuredContent: Record<string, unknown>,
  isError = false,
): Record<string, unknown> {
  return {
    resultType: "complete",
    content: [{ type: "text", text: "fixture" }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function runRequest() {
  return { requestId: REQUEST_ID, caseSha256: CASE_SHA, caseUri: CASE_URI };
}

function recordView(
  page: { offset?: number; limit?: number; omitRequestCaseUri?: boolean } = {},
): Record<string, unknown> {
  const offset = page.offset ?? 0;
  const limit = page.limit ?? 16;
  const sample = {
    time_s: 0,
    bodies: [{ id: "root", position_m: [0, 0, 0], rotation_wxyz: [1, 0, 0, 0] }],
    motors: [{
      joint_id: "hinge",
      motor_angle_rad: 0,
      declared_limit_observation: "within",
      translation_residual_m: [0, 0, 0],
      rotation_quaternion_imag_residual: [0, 0, 0],
    }],
  };
  return {
    request: {
      request_id: REQUEST_ID,
      case_sha256: CASE_SHA,
      ...(page.omitRequestCaseUri ? {} : { case_uri: CASE_URI }),
    },
    case_uri: CASE_URI,
    recorded_at: "2026-08-29T00:00:00.000Z",
    receipt: {
      schema_id: "chrono-prescribed-kinematics-receipt/1.0",
      receipt_sha256: RECEIPT_SHA,
      case_sha256: CASE_SHA,
      outcome_sha256: OUTCOME_SHA,
      request_id: REQUEST_ID,
      recorded_at: "2026-08-29T00:00:00.000Z",
      package: { name: "@casys/mcp-chrono", version: "0.3.2" },
      provider: { name: "casys-chrono", version: "0.3.2" },
      worker: { source_sha256: WORKER_SHA },
      runtime: { binding: "pychrono", python_version: "3.13.0" },
      server_runtime: { deno_version: "2.9.6" },
      execution_state: "completed",
      kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
    },
    observation: {
      engine: { name: "Project Chrono", version: "10.0.0" },
      runtime: { binding: "pychrono", python_version: "3.13.0" },
      execution_state: "completed",
      kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
      not_evaluated: [
        "collision",
        "clearance",
        "contact",
        "forces",
        "torques",
        "dynamics",
        "strength",
        "safety",
        "product fitness",
      ],
      sample_count: 1,
      sample_time_range_s: { first: 0, last: 0 },
    },
    sample_page: {
      offset,
      limit,
      total: 1,
      returned: offset === 0 ? 1 : 0,
      has_more: false,
      samples: offset === 0 ? [sample] : [],
    },
  };
}
