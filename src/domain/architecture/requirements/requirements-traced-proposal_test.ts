/**
 * Closed grammar tests for `model.write-requirements@2`.
 *
 * Fixtures are synthetic. These tests do not claim live SysON execution.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  parseRequirementsProposalParameters,
  RequirementsProposalParseError,
} from "./requirements-proposal.ts";
import {
  MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
  parseTracedRequirementsProposalParameters,
  tracedRequirementsProposalParameters,
} from "./requirements-traced-proposal.ts";

const APPROVED_DIGEST = "a".repeat(64);
const CONTENT_DIGEST = "b".repeat(64);
const APPROVED_FINGERPRINT = `sha256:${APPROVED_DIGEST}`;
const CONTENT_FINGERPRINT = `sha256:${CONTENT_DIGEST}`;

function param(
  key: string,
  value: string | number | boolean,
  unit?: string,
): EngineeringDecisionProposalParameter {
  return unit === undefined ? { key, label: key, value } : {
    key,
    label: key,
    value,
    unit,
  };
}

function identityParams(): EngineeringDecisionProposalParameter[] {
  return [
    param("requirements.containerComponent", "DripTray"),
    param("requirements.sourceProjectId", "project:dt01"),
    param("requirements.sourceProjectSnapshotId", "project-snap:dt01:r3"),
    param("requirements.sourceProjectRevision", 3),
    param("requirements.sourceBriefId", "brief:dt01"),
    param("requirements.sourceBriefSnapshotId", "brief-snap:dt01:r2"),
    param("requirements.sourceBriefRevision", 2),
    param("requirements.sourceBriefFingerprint", APPROVED_FINGERPRINT),
    param("requirements.sourceBriefContentFingerprint", CONTENT_FINGERPRINT),
    param("requirements.containerSourceItemId", "item:container"),
    param("requirement.r1.name", "Max displacement"),
    param("requirement.r1.metric", "maxDisplacement"),
    param("requirement.r1.operator", "<="),
    param("requirement.r1.threshold", 15, "mm"),
    param("requirement.r1.sourceItemId", "item:max-displacement"),
    param("requirement.r1.declaredThreshold", 15, "mm"),
  ];
}

function mpaParams(): EngineeringDecisionProposalParameter[] {
  return [
    param("requirements.containerComponent", "DripTray"),
    param("requirements.sourceProjectId", "project:dt01"),
    param("requirements.sourceProjectSnapshotId", "project-snap:dt01:r3"),
    param("requirements.sourceProjectRevision", 3),
    param("requirements.sourceBriefId", "brief:dt01"),
    param("requirements.sourceBriefSnapshotId", "brief-snap:dt01:r2"),
    param("requirements.sourceBriefRevision", 2),
    param("requirements.sourceBriefFingerprint", APPROVED_FINGERPRINT),
    param("requirements.sourceBriefContentFingerprint", CONTENT_FINGERPRINT),
    param("requirements.containerSourceItemId", "item:container"),
    param("requirement.stress.name", "Max von Mises stress"),
    param("requirement.stress.metric", "maxVonMises"),
    param("requirement.stress.operator", "<="),
    param("requirement.stress.threshold", 90_000_000, "Pa"),
    param("requirement.stress.sourceItemId", "item:max-stress"),
    param("requirement.stress.declaredThreshold", 90, "MPa"),
  ];
}

function replaceKey(
  parameters: readonly EngineeringDecisionProposalParameter[],
  key: string,
  value: string | number | boolean,
  unit?: string,
): EngineeringDecisionProposalParameter[] {
  return parameters.map((parameter) =>
    parameter.key === key ? param(key, value, unit) : parameter
  );
}

function omitKey(
  parameters: readonly EngineeringDecisionProposalParameter[],
  key: string,
): EngineeringDecisionProposalParameter[] {
  return parameters.filter((parameter) => parameter.key !== key);
}

function briefIdentity(): EngineeringDecisionProposalParameter[] {
  return identityParams().filter((parameter) =>
    !parameter.key.startsWith("requirement.")
  );
}

const REQUIRED_SOURCE_KEYS = [
  "requirements.sourceProjectId",
  "requirements.sourceProjectSnapshotId",
  "requirements.sourceProjectRevision",
  "requirements.sourceBriefId",
  "requirements.sourceBriefSnapshotId",
  "requirements.sourceBriefRevision",
  "requirements.sourceBriefFingerprint",
  "requirements.sourceBriefContentFingerprint",
  "requirements.containerSourceItemId",
  "requirement.r1.sourceItemId",
  "requirement.r1.declaredThreshold",
] as const;

Deno.test("traced requirements operation is model.write-requirements version 2", () => {
  assertEquals(MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION, {
    id: "model.write-requirements",
    version: "2",
  });
  assertEquals(MODEL_WRITE_REQUIREMENTS_OPERATION, {
    id: "model.write-requirements",
    version: "1",
  });
});

Deno.test(
  "parseTracedRequirementsProposalParameters accepts an identity mm threshold",
  () => {
    const proposal = parseTracedRequirementsProposalParameters(identityParams());
    assertEquals(proposal.containerComponent, "DripTray");
    assertEquals(proposal.partDefName, "DripTrayRequirements");
    assertEquals(proposal.requirements.length, 1);
    assertEquals(proposal.requirements[0]!.metric, "maxDisplacement");
    assertEquals(proposal.requirements[0]!.threshold, { value: 15, unit: "mm" });
    assertEquals(proposal.briefSource.basis, {
      kind: "approved-brief",
      projectId: "project:dt01",
      projectSnapshotId: "project-snap:dt01:r3",
      projectRevision: 3,
      briefId: "brief:dt01",
      briefSnapshotId: "brief-snap:dt01:r2",
      briefRevision: 2,
      approvedBriefFingerprint: {
        algorithm: "sha256",
        digest: APPROVED_DIGEST,
      },
    });
    assertEquals(proposal.briefSource.briefContentFingerprint, {
      algorithm: "sha256",
      digest: CONTENT_DIGEST,
    });
    assertEquals(proposal.briefSource.containerSourceItemId, "item:container");
    assertEquals(proposal.briefSource.requirements, [{
      requirementId: "maxDisplacement",
      sourceItemId: "item:max-displacement",
      declaredThreshold: { value: 15, unit: "mm" },
      transformation: "identity",
    }]);
  },
);

Deno.test(
  "parseTracedRequirementsProposalParameters rescales declared MPa onto canonical Pa",
  () => {
    const proposal = parseTracedRequirementsProposalParameters(mpaParams());
    assertEquals(proposal.requirements[0]!.metric, "maxVonMises");
    assertEquals(proposal.requirements[0]!.threshold, {
      value: 90_000_000,
      unit: "Pa",
    });
    assertEquals(proposal.briefSource.requirements[0], {
      requirementId: "maxVonMises",
      sourceItemId: "item:max-stress",
      declaredThreshold: { value: 90, unit: "MPa" },
      transformation: "MPa-to-Pa",
    });
  },
);

Deno.test(
  "traced source declarations follow parsed metric order and use metric as requirementId",
  () => {
    const proposal = parseTracedRequirementsProposalParameters([
      ...briefIdentity(),
      param("requirement.stress.name", "Max von Mises stress"),
      param("requirement.stress.metric", "maxVonMises"),
      param("requirement.stress.operator", "<="),
      param("requirement.stress.threshold", 90_000_000, "Pa"),
      param("requirement.stress.sourceItemId", "item:max-stress"),
      param("requirement.stress.declaredThreshold", 90, "MPa"),
      param("requirement.disp.name", "Max displacement"),
      param("requirement.disp.metric", "maxDisplacement"),
      param("requirement.disp.operator", "<="),
      param("requirement.disp.threshold", 15, "mm"),
      param("requirement.disp.sourceItemId", "item:max-displacement"),
      param("requirement.disp.declaredThreshold", 15, "mm"),
    ]);
    assertEquals(proposal.requirements.map((entry) => entry.metric), [
      "maxDisplacement",
      "maxVonMises",
    ]);
    assertEquals(
      proposal.briefSource.requirements.map((entry) => entry.requirementId),
      ["maxDisplacement", "maxVonMises"],
    );
    assertEquals(
      proposal.briefSource.requirements.map((entry) => entry.transformation),
      ["identity", "MPa-to-Pa"],
    );
  },
);

Deno.test(
  "tracedRequirementsProposalParameters round-trips through the parser",
  () => {
    const parsed = parseTracedRequirementsProposalParameters(mpaParams());
    const encoded = tracedRequirementsProposalParameters(parsed);
    assertEquals(parseTracedRequirementsProposalParameters(encoded), parsed);
  },
);

for (const key of REQUIRED_SOURCE_KEYS) {
  Deno.test(
    `parseTracedRequirementsProposalParameters rejects absent ${key}`,
    () => {
      assertThrows(
        () =>
          parseTracedRequirementsProposalParameters(
            omitKey(identityParams(), key),
          ),
        TypeError,
      );
    },
  );
}

Deno.test(
  "parseTracedRequirementsProposalParameters rejects a source declaration for the wrong slug",
  () => {
    assertThrows(
      () =>
        parseTracedRequirementsProposalParameters([
          ...identityParams(),
          param("requirement.other.sourceItemId", "item:other"),
          param("requirement.other.declaredThreshold", 15, "mm"),
        ]),
      TypeError,
    );
  },
);

Deno.test(
  "parseTracedRequirementsProposalParameters rejects a duplicated full key",
  () => {
    assertThrows(
      () =>
        parseTracedRequirementsProposalParameters([
          ...identityParams(),
          param("requirement.r1.sourceItemId", "item:duplicate"),
        ]),
      TypeError,
    );
  },
);

Deno.test(
  "parseTracedRequirementsProposalParameters rejects an unknown provenance key",
  () => {
    const error = assertThrows(
      () =>
        parseTracedRequirementsProposalParameters([
          ...identityParams(),
          param("requirements.sourceRefs", "forged"),
        ]),
      RequirementsProposalParseError,
    );
    assertEquals((error as RequirementsProposalParseError).code, "unknown_key");
  },
);

Deno.test(
  "parseTracedRequirementsProposalParameters rejects forged extra requirement metadata",
  () => {
    const error = assertThrows(
      () =>
        parseTracedRequirementsProposalParameters([
          ...identityParams(),
          param("requirement.r1.transformation", "MPa-to-Pa"),
        ]),
      RequirementsProposalParseError,
    );
    assertEquals((error as RequirementsProposalParseError).code, "unknown_key");
  },
);

const MALFORMED_FINGERPRINTS: readonly unknown[] = [
  "a".repeat(64),
  `sha256:${"A".repeat(64)}`,
  `SHA256:${"a".repeat(64)}`,
  `sha256:${"a".repeat(63)}`,
  `sha256:${"a".repeat(65)}`,
  `md5:${"a".repeat(32)}`,
  `sha256:${"g".repeat(64)}`,
  "",
  1,
];

for (
  const key of [
    "requirements.sourceBriefFingerprint",
    "requirements.sourceBriefContentFingerprint",
  ] as const
) {
  for (const value of MALFORMED_FINGERPRINTS) {
    Deno.test(
      `parseTracedRequirementsProposalParameters rejects ${key} value ${
        JSON.stringify(value)
      }`,
      () => {
        const parameters = identityParams().map((parameter) =>
          parameter.key === key
            ? {
              key,
              label: key,
              value: value as string | number | boolean,
            }
            : parameter
        );
        assertThrows(
          () => parseTracedRequirementsProposalParameters(parameters),
          TypeError,
        );
      },
    );
  }
}

Deno.test(
  "parseTracedRequirementsProposalParameters rejects a normalisation mismatch",
  () => {
    assertThrows(
      () =>
        parseTracedRequirementsProposalParameters(
          replaceKey(mpaParams(), "requirement.stress.threshold", 90, "Pa"),
        ),
      TypeError,
    );
  },
);

Deno.test(
  "parseTracedRequirementsProposalParameters rejects a mismatched identity threshold",
  () => {
    assertThrows(
      () =>
        parseTracedRequirementsProposalParameters(
          replaceKey(identityParams(), "requirement.r1.declaredThreshold", 16, "mm"),
        ),
      TypeError,
    );
  },
);

for (const decimal of [0.5, 1.5]) {
  Deno.test(
    `parseTracedRequirementsProposalParameters rejects decimal normalised threshold ${decimal}`,
    () => {
      const error = assertThrows(
        () =>
          parseTracedRequirementsProposalParameters(
            replaceKey(identityParams(), "requirement.r1.threshold", decimal, "mm")
              .map((parameter) =>
                parameter.key === "requirement.r1.declaredThreshold"
                  ? param(parameter.key, decimal, "mm")
                  : parameter
              ),
          ),
        RequirementsProposalParseError,
      );
      assertEquals(
        (error as RequirementsProposalParseError).code,
        "invalid_threshold_value",
      );
    },
  );
}

Deno.test(
  "parseTracedRequirementsProposalParameters rejects a decimal degC-normalised kelvin threshold",
  () => {
    const error = assertThrows(
      () =>
        parseTracedRequirementsProposalParameters([
          ...omitKey(identityParams(), "requirement.r1.threshold"),
          param("requirement.r1.threshold", 295.15, "K"),
        ].map((parameter) => {
          if (parameter.key === "requirement.r1.declaredThreshold") {
            return param(parameter.key, 22, "degC");
          }
          if (parameter.key === "requirement.r1.metric") {
            return param(parameter.key, "operatingTemperature");
          }
          return parameter;
        })),
      RequirementsProposalParseError,
    );
    assertEquals(
      (error as RequirementsProposalParseError).code,
      "invalid_threshold_value",
    );
  },
);

Deno.test(
  "parseTracedRequirementsProposalParameters rejects a unit on brief-source metadata",
  () => {
    assertThrows(
      () =>
        parseTracedRequirementsProposalParameters(
          identityParams().map((parameter) =>
            parameter.key === "requirements.sourceProjectRevision"
              ? param(parameter.key, 3, "rev")
              : parameter
          ),
        ),
      TypeError,
    );
  },
);

Deno.test(
  "changing only sourceItemId changes the canonical proposal fingerprint",
  async () => {
    const base = parseTracedRequirementsProposalParameters(identityParams());
    const changed = parseTracedRequirementsProposalParameters(
      replaceKey(
        identityParams(),
        "requirement.r1.sourceItemId",
        "item:max-displacement-v2",
      ),
    );
    assertEquals(
      base.briefSource.basis.approvedBriefFingerprint,
      changed.briefSource.basis.approvedBriefFingerprint,
    );
    const baseFp = await sha256Fingerprint(base);
    const changedFp = await sha256Fingerprint(changed);
    assertEquals(baseFp.digest === changedFp.digest, false);
  },
);

Deno.test("traced metadata rejects even an empty unit and unknown parameter fields", () => {
  for (const forged of [{ unit: "" }, { sourceRefs: [] }]) {
    assertThrows(() =>
      parseTracedRequirementsProposalParameters(
        identityParams().map((parameter) =>
          parameter.key === "requirements.sourceProjectRevision"
            ? { ...parameter, ...forged }
            : parameter
        ),
      ), TypeError);
  }
});

Deno.test(
  "changing only brief revision changes the canonical proposal fingerprint",
  async () => {
    const base = parseTracedRequirementsProposalParameters(identityParams());
    const changed = parseTracedRequirementsProposalParameters(
      replaceKey(identityParams(), "requirements.sourceBriefRevision", 3),
    );
    assertEquals(
      base.briefSource.basis.approvedBriefFingerprint,
      changed.briefSource.basis.approvedBriefFingerprint,
    );
    assertEquals(changed.briefSource.basis.briefRevision, 3);
    const baseFp = await sha256Fingerprint(base);
    const changedFp = await sha256Fingerprint(changed);
    assertEquals(baseFp.digest === changedFp.digest, false);
  },
);

Deno.test(
  "legacy @1 parser remains unchanged and rejects V2 brief-source metadata",
  () => {
    const v1 = parseRequirementsProposalParameters([
      param("requirements.containerComponent", "DripTray"),
      param("requirement.r1.name", "Max displacement"),
      param("requirement.r1.metric", "maxDisplacement"),
      param("requirement.r1.operator", "<="),
      param("requirement.r1.threshold", 15, "mm"),
    ]);
    assertEquals(v1.requirements[0]!.threshold, { value: 15, unit: "mm" });

    const error = assertThrows(
      () => parseRequirementsProposalParameters(identityParams()),
      RequirementsProposalParseError,
    );
    assertEquals((error as RequirementsProposalParseError).code, "unknown_key");
  },
);
