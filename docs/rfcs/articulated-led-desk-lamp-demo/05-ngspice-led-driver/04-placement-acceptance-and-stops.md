Audience: agent · Diátaxis: none · Kind: RFC Status: active Parent:
[ngspice LED-driver vertical](README.md)

# RFC 05.4 — placement, acceptance and stop rules

## 6. Placements hexagonaux attendus

| Zone                                    | Responsabilité proposée                                                     | Interdits                                        |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/domain/electrical/`                | Case, méthode, mapper sémantique, evidence schema, invariants, observations | MCP, fichiers, Docker, SysON, UI                 |
| `src/application/ports/in/electrical/`  | Reviews de seal/run/L5 et entrées explicites                                | Provider wire contracts                          |
| `src/application/ports/out/electrical/` | Lecteurs exacts, CAS, engine sémantique, WAL, lease, evaluator              | `McpToolClient` exposé aux use cases             |
| `src/application/use-cases/electrical/` | Relecture, séquence, recovery, publication                                  | Construction libre de payload/provider           |
| `src/adapters/electrical/spice/`        | Lowering code-owned, `mcp-spice`, parse/capture, attempt store, composition | Décision humaine ou domaine d'exigence           |
| `src/adapters/electrical/oracle/`       | Projection critères/observations et capture SysON ou évaluateur D3          | Appel ngspice ou mutation de circuit             |
| `src/adapters/compile/plans/`           | Résolution/scellement ROP2 de l'action                                      | Sélection au runtime d'un tool demandé par agent |
| `src/orchestration/operations/`         | Descriptor et registry de deux opérations electrical                        | Toute logique provider                           |
| `src/ui/`                               | Projection lecture seulement, si nécessaire après backend                   | Commandes, MCP credentials, raccourci L5         |

Réutiliser `src/adapters/shared/cas/`, `src/adapters/shared/wal/`, locks/leases et le
parseur partagé de réponse SysON quand leurs invariants correspondent. Ne pas déplacer
une particularité ngspice dans `shared` sans au moins deux consommateurs réels.

## 7. Matrice d'acceptation de jalon

| Jalon   | Preuve minimale                                                                    | N'autorise pas                               |
| ------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| L1      | fiche source exacte, inconnues visibles, D1 non ambigu                             | un netlist inventé, seal, run                |
| L2 seal | review serveur + MRTR humain + electrical proof capture                            | ngspice, résultat, verdict                   |
| L2 run  | review run + MRTR distinct + ROP2 scellé                                           | deuxième provider/tool, résultat             |
| L3      | engine réellement exécuté, réponse capturée/rélue, observations et replay CAS-only | verdict, conformité, décision                |
| L4      | évaluateur séparé capturé/réouvert pour critères exacts                            | L5 automatique, changement de circuit        |
| L5      | décision humaine exacte, portée et conséquence enregistrées                        | généralisation vers une autre lampe/révision |

Tests obligatoires au minimum : canonicalisation/fermeture de chaque schema ; allée et
retour CAS ; MRTR/ROP exacts ; rejet avant effets externes ; WAL crash à chaque
frontière externe ; capture altérée ; replay sans redispatch ; provider `unavailable` ;
mapping V/A/W/s, signe et unité ; SysON/evaluator `pass/fail/unresolved/error`; et
séparation L4/L5.

Les tests d'intégration provider sont conditionnels à D2/availability et ne peuvent pas
faire croire que la fixture est une exécution réelle. Les tests Deno sont co-localisés ;
`deno task check`, les checks ciblés, `deno task lint` et `deno task fmt` en mode check
sont les gates de chaque commit. Une intégration réellement disponible ajoute le test
causal minimal, jamais une dépendance à `latest`.

## 8. Ordre de merge et conditions d'arrêt

Ordre normal :
`E01 -> E02 -> E03 -> E04 -> E05 -> E06 -> E07 -> E08 -> E09 -> E10 ->
E11 -> E12 -> E13 -> E14 -> E15`.
Seuls `E01` et le travail de lecture non mutante de D2 peuvent avancer en parallèle. E08
ne précède jamais le contrat D1/D3 ; E12 ne précède jamais E11 ; E14 ne précède jamais
une L4 exacte.

Arrêter et demander une décision plutôt que contourner si :

- la fiche ne donne pas une source/circuit/condition/critère suffisamment identifiés ;
- D1 ne tranche pas IR fermé contre netlist attesté ;
- la grammaire requiert un composant, modèle, directive ou analyse hors V1 ;
- `mcp-spice` est absent, non attestable, ou son schema ne correspond pas à D2 ;
- le transient réduit ne peut pas soutenir la sémantique `s` demandée ;
- une unité/contrainte SysON ne se relit pas ;
- l'issue d'un dispatch ou de l'évaluation est inconnue ;
- une proposition demande d'ajouter dB, phase, AC, rapport dimensionless ou une seconde
  famille de circuit sous couvert de « petite extension ».

Dans tous ces cas, publier au plus une analyse/revue `unresolved` sans run ; ne pas
inventer de provider local, de seuil de démonstration, de composant par défaut, ni de
verdict favorable.
