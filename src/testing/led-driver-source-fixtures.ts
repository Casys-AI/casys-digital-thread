/**
 * E01 fixtures for `led-driver-human-source/1.0`.
 *
 * The text is the exact UTF-8 authority. No component, supply, observation,
 * criterion or D1 representation is invented here; those stay declared
 * `unresolved` unknowns.
 */

export function validLedDriverHumanSourceText(): string {
  return [
    "{",
    '  "schemaVersion": "led-driver-human-source/1.0",',
    '  "id": "fiche.led-driver.desk-lamp",',
    '  "revision": 1,',
    '  "provenance": {',
    '    "kind": "human",',
    '    "authorId": "human.product-owner",',
    '    "reference": "G5-electrical-circuit-and-criterion"',
    "  },",
    '  "circuit": {',
    '    "id": "circuit.led-driver",',
    '    "name": "led-driver"',
    "  },",
    '  "testCondition": {',
    '    "id": "condition.reviewed-supply",',
    '    "name": "reviewed-supply"',
    "  },",
    '  "unknowns": [',
    "    {",
    '      "id": "unknown.circuit-representation",',
    '      "status": "unresolved",',
    '      "name": "circuit-representation"',
    "    },",
    "    {",
    '      "id": "unknown.component-models",',
    '      "status": "unresolved",',
    '      "name": "component-models"',
    "    },",
    "    {",
    '      "id": "unknown.supply-and-test-values",',
    '      "status": "unresolved",',
    '      "name": "supply-and-test-values"',
    "    },",
    "    {",
    '      "id": "unknown.requested-observations",',
    '      "status": "unresolved",',
    '      "name": "requested-observations"',
    "    },",
    "    {",
    '      "id": "unknown.named-criteria",',
    '      "status": "unresolved",',
    '      "name": "named-criteria"',
    "    }",
    "  ]",
    "}",
    "",
  ].join("\n");
}

export function emptyUnknownsLedDriverHumanSourceText(): string {
  return [
    "{",
    '  "schemaVersion": "led-driver-human-source/1.0",',
    '  "id": "fiche.led-driver.no-unknowns",',
    '  "revision": 1,',
    '  "provenance": {',
    '    "kind": "document",',
    '    "authorId": "human.product-owner",',
    '    "reference": "reviewed-fiche-without-open-unknowns"',
    "  },",
    '  "circuit": {',
    '    "id": "circuit.led-driver",',
    '    "name": "led-driver"',
    "  },",
    '  "testCondition": {',
    '    "id": "condition.reviewed-supply",',
    '    "name": "reviewed-supply"',
    "  },",
    '  "unknowns": []',
    "}",
    "",
  ].join("\n");
}
