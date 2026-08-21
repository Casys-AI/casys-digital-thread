Audience: agent · Diátaxis: none · Kind: RFC Status: active Parent:
[ngspice LED-driver vertical](README.md)

# RFC 05.2 — closed contracts and source-to-seal lots E01–E07

## 4. Contrats cibles minimaux

Les noms ci-dessous sont des propositions de placement et de version ; l'implémenteur
les fige au premier lot de domaine correspondant et ne renomme pas ensuite de manière
opportuniste.

| Document / record                                                | Rôle                                                             | Invariants V1                                                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `led-driver-source-capture/1.0`                                  | Capture de fiche humaine/source et, selon D1, de l'IR ou netlist | UTF-8/octet exact, auteur/source, identité, SHA-256, byte count ; jamais un alias mutable                                                            |
| `electrical-proof-case/1.0`                                      | Cas sémantique fermé de la lampe                                 | Une seule analyse `operating-point` ou `reduced-transient` par cas ; signaux nommés, observations demandées, critères référencés, limites explicites |
| `electrical-proof-capture/1.0`                                   | Document Thread après seal                                       | Lie exact fiche/circuit, cas, architecture/exigences lorsque présentes, method qualification et MRTR de seal                                         |
| `qualified-spice-led-driver-method/1.0`                          | Méthode qualifiée serveur-owned                                  | Provider/contrats/lowering épinglés, unités, hypothèses, limites, mapper de résultats, timeout/limites code-owned                                    |
| `resolved-operation-plan/2.0` action `spice-electrical-analysis` | Une autorisation de run                                          | MRTR de run, qualification, basis Thread, sources exactes, action et recovery ; jamais un workflow ni un payload MCP                                 |
| `spice-electrical-provider-capture/1.0`                          | Capture exacte de chaque appel réellement fait                   | Requête effectivement dispatchée, réponse MCP structurée/brute, identité provider disponible, hash/bytes et parse validé                             |
| `spice-electrical-evidence/1.0`                                  | Evidence locale relisible du run                                 | Reprend le ROP, la capture provider, les observations normalisées et leur provenance ; aucune conclusion                                             |
| `electrical-evaluation-capture/1.0`                              | L4                                                               | Méthode, critères, valeurs/units, evidence fingerprints, statut par critère, violations et limites                                                   |

### 4.1 Cas électrique fermé

Le case doit rejeter les clés inconnues et les ambiguïtés. Il ne contient aucun
endpoint, credential, outil MCP, `.control`, commande shell, chemin hôte, image, délai
ou option ngspice choisi par l'appelant. Le serveur possède ces données dans le profil
qualifié.

Champs conceptuels nécessaires (les formes exactes doivent être validées au `E04`) :

- identité stable du cas et `lampRevision`/basis référencé ;
- référence exacte de fiche humaine/source ;
- `analysis.kind`: `operating-point` ou `reduced-transient` ;
- condition d'essai nommée et entièrement sourcée ;
- représentation D1 (IR fermé **ou** netlist attesté), avec fingerprint et media type ;
- liste fermée de signaux demandés avec identité et type : tension, courant, puissance
  ou événement temporel ;
- sémantique de chaque mesure : sujet, polarité/référence et, pour une puissance, les
  deux observables/une définition de puissance explicitement revue ;
- critères nommés qui pointent vers les exigences relues et une unité native admise ;
- hypothèses, limitations et critères d'applicabilité explicites.

Le cas ne porte pas une valeur fictive. Les données numériques qui existent dans la
fiche sont des données humaines/sourcées et deviennent visibles au MRTR ; les absences
restent des absences.

### 4.2 Observations V / A / W / s

Une observation est une valeur normalisée avec unité, portée et preuve, pas un verdict.
V1 n'admet que les quatre familles suivantes :

| Famille       | Source autorisée                                                                              | Règle de normalisation                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tension `V`   | Valeur OP ou statistique transient explicitement déclarée                                     | L'identité de nœud/paire de nœuds vient du circuit fermé ; aucune recherche heuristique par label                              |
| Courant `A`   | Valeur OP ou statistique transient explicitement déclarée                                     | La direction/signe est celle revue dans le cas ; l'adapter ne l'inverse pas « pour aider »                                     |
| Puissance `W` | Champ provider attesté, ou calcul déterministe qualifié à partir de tension et courant exacts | Le cas fixe sujet, polarité et règle de signe ; la capture conserve les opérandes et l'algorithme/fingerprint                  |
| Temps `s`     | Champ transient réduit expressément défini par le contrat provider/méthode                    | La méthode fixe la sémantique (événement, fenêtre ou statut) ; sans celle-ci, publication `unresolved`, pas une durée inventée |

OP ne publie jamais de temps transitoire fictif. Un transient réduit qui ne retourne pas
la statistique/événement requis peut publier ses autres observations mais l'observation
en `s` et son évaluation restent `unresolved`.

## 5. Backlog atomique

### E01 — verrouiller la fiche de décision humaine

Créer le contrat de capture de la fiche LED driver et son lecteur CAS, sans solveur.

- Placer les invariants purs dans `src/domain/electrical/led-driver/` ; capture/stockage
  dans `src/adapters/electrical/led-driver/` ; port de lecture dans
  `src/application/ports/out/electrical/`.
- Accepter seulement une source avec identité, contenu, provenance et révision
  explicites. Capturer/re-lire/hash-er les octets avant tout parse.
- Rejeter une fiche qui ne désigne pas le circuit, sa condition d'essai et le statut de
  ses inconnues ; ne pas exiger que l'humain fournisse un payload ngspice.
- Ajouter le résultat de capture à une proposition/revue project-control en lecture :
  elle n'autorise encore ni seal ni run.

**Acceptation :** capture canonique relue identique ; hash, byte count et provenance
divergents bloquent ; une lacune est exposée comme `unresolved`. Aucune dépendance
`mcp-spice`, aucun appel provider, aucun `ThreadSnapshot` de résultat.

**Commit :** `feat(electrical): capture led-driver source evidence`.

### E02 — enregistrer D1 et geler une seule frontière source

Ajouter un review use case/project port qui expose D1, le choix A/B, ses conséquences et
le fingerprint de `E01`. L'approbation reste l'interaction MRTR humaine existante ; ne
pas créer une seconde approbation maison.

- A : définir l'IR fermé minimal et le renderer pur circuit-only dans
  `src/domain/electrical/spice/`; l'adapter pourra le rendre mais ne l'exécutera pas.
- B : définir l'attestation opaque du netlist circuit-only dans
  `src/domain/electrical/spice/`; interdire toute réécriture, normalisation sémantique
  ou ajout de modèle après capture.
- Dans les deux cas, interdire `.control`, `.include`, `.lib`, shell et toute directive
  hors périmètre avant le provider ; ce filtre local ne remplace pas le rejet provider.
- Choix absent, multiple ou divergent avec le source capture : `unresolved`/refus.

**Acceptation :** exactement un choix signé pour une fiche exacte ; A produit toujours
les mêmes bytes pour un IR exact ; B conserve les bytes d'origine ; ni option ni outil
provider n'entre dans l'objet MRTR.

**Stop :** sans décision humaine D1, ne pas commencer E03.

**Commit :** `feat(electrical): seal one led-driver circuit boundary`.

### E03 — définir le cas `electrical-proof-case/1.0`

Créer schema, canonicalisation, validation et tests purs du cas. Seuls OP et reduced
transient sont possibles ; l'analyse est choisie par le cas qualifié et non par l'agent
au moment du run.

- Réutiliser les primitives de `src/domain/kernel/` pour ids, unités, fingerprints,
  canonical JSON et rejets de doublons.
- Référencer des critères/exigences exacts, pas du texte libre interprété.
- Valider les familles V/A/W/s, les références de signaux, l'unicité, l'unité, la
  sémantique de puissance et les obligations propres au transient.
- `dB`, `deg`, ratios, AC, phase, gain, sweep, température, bruit et toute métrique non
  listée sont des clés/valeurs refusées, pas des TODO silencieux.

**Acceptation :** le parseur est fermé ; aucune valeur manquante n'est remplacée ; OP
avec observation de temps est refusé ou explicitement `unresolved` selon le contrat figé
; deux signaux ne peuvent pas se faire passer pour la même mesure.

**Commit :** `feat(electrical): define bounded led-driver proof case`.

### E04 — qualifier la méthode, sans provider live

Écrire le contrat de `qualified-spice-led-driver-method/1.0` et le catalogue serveur-
owned. Il doit rendre explicites : image/contrat provider épinglés, D1, analyses
permises, unités, résultats attendus, parse/normalisation, bornes de ressources,
hypothèses et limites.

- Le domaine ne contient aucun import MCP, Docker ou variable d'environnement.
- Les versions de lowering et de mapper sont versionnées et fingerprintées.
- Aucun nombre de composant, modèle ou seuil n'est mis dans la méthode : ils viennent du
  cas/fichier exact revu.
- Le catalogue refuse les méthodes sans preuve de préflight D2 ou les expose comme
  non-exécutables jusqu'à E08.

**Acceptation :** une méthode est relisible/canonicalisée ; une méthode sans D1, sans
unité supportée ou sans politique de résultat/erreur est refusée. Aucun outil n'est
appelé.

**Commit :** `feat(electrical): qualify bounded spice led-driver method`.

### E05 — préparer et sceller le cas électrique

Ajouter le port entrant `project_electrical_proof_seal_review` et son use case, par
analogie stricte avec le proof seal FEA, pas avec un preview de solveur.

- Le review relit la fiche, D1, le circuit/IR, le cas, la méthode, les critères et la
  basis Thread exacte ; il ne change aucun état et ne contacte aucun provider.
- Il dérive les paramètres MRTR canoniques du seal ; l'agent ne les recompose pas.
- Ajouter l'opération enregistrée proposée `verify.seal-electrical-proof-case@1`, qui
  rouvre tous les éléments et publie `electrical-proof-capture/1.0` dans le Thread.
- Son executor n'appelle pas ngspice et ne crée pas une évaluation.

**Acceptation :** un seal MRTR ne peut pas être réemployé pour un autre cas/basis ; un
hash ou join divergent bloque avant toute publication ; un seal réussi donne un artefact
Thread exact mais aucun run.

**Commit :** `feat(electrical): seal reviewed led-driver proof case`.

### E06 — étendre le ROP2 d'une seule action SPICE

Étendre `src/domain/compile/rop/resolved-operation-plan-v2.ts` avec une seule action
`spice-electrical-analysis` et son unique recovery policy. Étendre le resolver dans
`src/adapters/compile/plans/resolved-operation-plan-resolver.ts`.

- Sources obligatoires : electrical proof capture et circuit/IR/netlist exact ;
  exigences/basis lorsque l'évaluateur les requiert.
- Autorisation : MRTR de **run** distinct du MRTR de seal, qualification exacte et
  ThreadSnapshot exact.
- Action : kind OP ou reduced transient, fingerprint de lowering/méthode et request id
  server-derived. Ne stocker ni URL, ni nom d'outil, ni arguments MCP, ni timeout
  appelant dans le ROP.
- Ressources attendues : capture request/response et tout identifiant/artifact exact
  réellement garanti par D2. Ne copier aucun profil Modelica ou CalculiX qui supposerait
  un endpoint `resources/read` absent.

**Acceptation :** ROP stable par run id ; un ROP ne peut pas être adopté par un autre
run ; source/basis/MRTR/méthode divergents refusent avant lease/WAL/provider ; le plan
reste une action, pas un DSL de circuit.

**Commit :** `feat(rop): authorize one electrical spice action`.

### E07 — intégration project-control et revue de run

Ajouter le port entrant et le use case `project_electrical_spice_run_review`, puis le
descriptor `verify.run-spice-electrical-proof@1` dans `src/orchestration/operations/` et
`registry.ts`.

- Bindings du descriptor : un artefact `electrical-proof-capture` et le circuit exact
  scellé, pas un texte envoyé par l'agent.
- La revue relit le seal/basis et ne retourne que les paramètres MRTR canoniques du run
  ; `project_agent_run_queue` est le seul endroit qui scelle le ROP.
- Ajouter project snapshot/read models pour montrer distinctement seal, run, evidence,
  L4 et L5 sans faire de la Workbench une surface de commande.
- Mettre à jour seulement les tests de contrat project-control touchés dans ce commit.

**Acceptation :** l'agent ne peut mettre en queue qu'une opération enregistrée avec
review et MRTR corrects ; aucun `netlist`, provider, outil ou arg arbitraire n'est
accepté par l'API agent.

**Commit :** `feat(project): queue reviewed led-driver spice proof`.
