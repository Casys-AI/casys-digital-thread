# ID01 — import du catalogue ERP local, 2026-09-13

Audience: both · Diátaxis: none · Kind: dated execution receipt

L'humain a autorisé la création du catalogue de démo dans l'ERPNext local sur
`http://localhost:8080`. L'exécution du 2026-09-13, de `08:00:43.463Z` à
`08:00:53.398Z`, a créé dix documents : l'unité `Kg` manquante, le groupe `DEMO-ID01`,
la liste `DEMO-ID01-PUBLIC-CATALOGUE`, cinq articles et deux prix. L'unité `Nos`
existante a été réutilisée.

Chaque document a été relu sans cache et comparé aux champs demandés. Aucun document
divergent n'a été écrasé. Le script ponctuel réutilise les handlers Item/document du MCP
propriétaire et le planner offline ; il ne constitue pas un second moteur d'import. La
[PR propriétaire](https://github.com/Casys-AI/mcp-erpnext/pull/45) est mergée au commit
`930a44a9ea3d99b579f89888fd05a323fb94f659`.

## Documents observés

Les valeurs `modified` ci-dessous sont les chaînes réellement retournées par ERPNext,
sans conversion de fuseau ni interprétation en date de validité du prix.

| Doctype    | Nom réel                            | `modified` ERPNext           |
| ---------- | ----------------------------------- | ---------------------------- |
| UOM        | `Kg`                                | `2026-09-13 10:00:43.946841` |
| Item Group | `DEMO-ID01`                         | `2026-09-13 10:00:44.829979` |
| Price List | `DEMO-ID01-PUBLIC-CATALOGUE`        | `2026-09-13 10:00:45.428328` |
| Item       | `DEMO-ID01-PIXHAWK-6C-MINI-A-11088` | `2026-09-13 10:00:49.988130` |
| Item       | `DEMO-ID01-THOBBY-F1404-KV4600`     | `2026-09-13 10:00:50.876766` |
| Item       | `DEMO-ID01-RPI-ZERO-2-W`            | `2026-09-13 10:00:51.615995` |
| Item       | `DEMO-ID01-RPI-CAM-MOD3-STD`        | `2026-09-13 10:00:52.010597` |
| Item       | `DEMO-ID01-PRUSAMENT-PETG-JB-1KG`   | `2026-09-13 10:00:52.208950` |
| Item Price | `sghv9am037`                        | `2026-09-13 10:00:52.848384` |
| Item Price | `sgkpg75e2s`                        | `2026-09-13 10:00:53.258520` |

Une lecture supplémentaire de toute la liste dédiée à `08:01:50.265Z` confirme
exactement deux Item Prices, tous deux en USD par `Nos` : `130.99` pour le Pixhawk 6C
Mini A SKU 11088, variante sans Power Module, et `16.90` pour un moteur F1404 KV4600.
Les trois autres articles n'ont aucun Item Price dans cette liste.

Les prix proviennent des deux observations publiques datées de
[la préparation sourcée](buy-preparation/price-source-manifest.json). Le catalogue
utilisé référence les octets de ce manifeste par
`sha256:5343f5ce94b4b20aeebf7a0c51bd6f55f53474e337cc07cb5ba3c57528482f4c` ; le hash a
été vérifié avant les écritures. Les propositions, leurs références et les trois
observations non exploitables restent dans
[le catalogue compagnon](buy-preparation/erp-demo-catalogue.json).

## Portée et suite

Cet import est un catalogue `demo`. Il ne sélectionne pas la configuration du drone, ne
crée aucune BOM ou commande, ne qualifie pas le binding ERPNext, ne capture/scelle aucun
coût Buy et ne prouve aucune compatibilité. Les coûts de production restent
`unresolved`. Les identifiants et lectures ERP constituent des données d'exécution
documentaires ; ils ne remplacent pas une admission ou un MRTR.

La suite est la préparation et qualification du binding local, les décisions de
configuration/quantités applicables, puis la capture et le scellement Buy par le
parcours serveur existant. Voir [le dossier de démo](be-demo-preparation-20260913.md).
