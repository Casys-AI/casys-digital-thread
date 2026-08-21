# RFC 06 — Boucle d'impact controlee : puissance/brillance -> electrique + thermique

Statut : spec d'implementation · Audience : agent implementer · Portee : demonstrateur
`articulated-led-desk-lamp-demo`

## Resultat vise

Lorsqu'un changement **revu** de puissance ou de brillance est accepte, ne recalculer
que les branches electrique et thermique que la ligne causale explicite designe. Les
preuves mecaniques sont conservees si, et seulement si, leur independance causale est
declaree et re-verifiee contre les artefacts exacts. Cette RFC ajoute une boucle
d'impact auditable; elle refuse une cascade cachee, une inference par label ou une
invalidaton globale "par prudence".

Pendant le developpement de RFC 05, la branche electrique peut rester `unavailable`. Le
lot d'integration X13 et le closeout de la demo exigent toutefois sa methode qualifiee
et sa preuve propre : `unavailable` est alors un blocker visible, pas une version
reduite de la demo. La branche thermique est celle de RFC 04. La mecanique existante
reste sa propre verticale FEA : aucune evaluation thermique/electrique ne reinterprete
ou ne remplace un verdict mecanique.

## Regle normative de portee

```text
change approuve + impact manifest exact
  -> impacts declares : electrique, thermique
  -> impact explicitement absent : mecanique
  -> marque les gateClaims concernes
  -> ne reexecute rien automatiquement
  -> propose des work items/MRTR independants pour les seuls branches impactees
```

Un changement de puissance/brillance n'est pas un fait causal par lui-meme. Il devient
un input de branche uniquement si le manifeste ci-dessous rattache son exacte source a
un parametre/observation consomme par cette branche. Une absence de relation est
`impact-unresolved`, jamais "mecanique preservee" par defaut.

## Artefact : manifeste d'impact inter-domaines

Ajouter `cross-domain-impact-manifest/1.0` comme document server-validated et
human-reviewed. Il est reutilisable pour tout produit et ne contient aucune equation,
valeur, seuil, unite, materiau, densite, enveloppe SPICE/OMC/CalculiX, image ou
commande.

| Champ ferme                   | Regle                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `project`, `subject`, `basis` | Identite exacte et Thread snapshot/empreinte a partir desquels le manifeste est valable.                                                                                                         |
| `changeKinds`                 | Vocabulaire ferme comprenant les concepts revus de puissance/brillance; pas de texte libre interprete par l'agent. Le choix final de tokens est a valider avec le schema de changement existant. |
| `sourceAnchors[]`             | Pour chaque changement : artifact/requirement/SysML element exact, fingerprint et role. Aucun join par nom affiche.                                                                              |
| `branches[]`                  | Branch id stable (`electrical`, `thermal`, `mechanical` pour ce demonstrateur), operation(s) autorisee(s), gates cibles et evidence attendue. Les ids restent generiques et versionnes.          |
| `causalEdges[]`               | `fromAnchor -> branchInput`, type de relation, assertion sourcee, scope et evidence fingerprints. Une edge est positive; absence d'edge n'est pas une edge negative.                             |
| `independenceAssertions[]`    | Seul moyen de conserver une branche : branche cible, sources inspectees, input-artifact ids/empreintes, affirmation d'independance, auteur humain, source/justification et trigger de revue.     |
| `gateMap[]`                   | `gateItemId` canonique -> branche + role `contributes-to\|satisfies`; pas un binding d'operation.                                                                                                |
| `limitations`                 | Ce que le manifest ne prouve pas, dont les interactions sans edge.                                                                                                                               |
| `fingerprint`                 | SHA-256 du corps canonique; chaque relecture valide a nouveau tous les joins.                                                                                                                    |

Pour la lampe : une edge peut declarer que le changement electrique est un input d'un
parametre du modele thermique admis. La mecanique n'est `carried-forward` que si une
assertion d'independance nomme l'exact evidence FEA et que le controle confirme que ni
le changement ni les nouvelles preuves electrique/thermique ne remplacent un artefact
qu'elle consomme. Cette RFC ne suppose pas si cela est physiquement vrai : la personne
responsable doit le sourcer et le signer.

## GateClaims et dependances exacts

Le mecanisme existant distingue deja les `gateClaims` de l'evidence et des bindings.
Conserver cette separation :

| Objet                   | Emplacement / signification                                                                                | Interdit                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Dependances de mandat   | `ProjectBriefRevision` V2, `dependsOnItemIds` sur chaque `success-criterion`/`verification-activity` gate. | Les deduire d'un graphe de simulation ou d'un libelle.                                |
| Coverage claim          | `EngineeringWorkItem.gateClaims[]` : `{gateItemId, role, status}`.                                         | Le mettre dans `operation.bindings` ou le presenter comme une consommation technique. |
| Consommation technique  | `ThreadArtifactConsumption` + `ThreadProvenanceLink`, fingerprints producer/consumer.                      | L'inferer parce que deux work items partagent une branche.                            |
| Changement et freshness | `ThreadSnapshot.changeSet` + entites `freshness.invalidatedByChangeIds`.                                   | Archiver/effacer l'ancien evidence ou marquer tout le Thread stale.                   |
| Impact declare          | Nouveau manifeste + evaluation d'impact capturee.                                                          | Reexecuter une branche au moment du calcul d'impact.                                  |

Les statuts autorises restent ceux du domaine projet : `current`, `impact-unresolved`,
`invalidated`, `carried-forward`. Ils ne sont ni `stale` (freshness technique), ni
`pass`, ni `fail`. La transition de statut est une decision d'impact explicite, pas un
effet de bord d'un changement de brief.

### Matrice de transition pour le demonstrateur

| Branche    | Condition exacte apres changement                                                                                                                                     | gateClaim                                                | Freshness/evidence                                                                         | Suite autorisee                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Electrique | Edge manifeste depuis sourceAnchor change vers input de branche et methode qualifiee disponible.                                                                      | `invalidated`.                                           | Les anciennes preuves restent historiques; aucune preuve nouvelle n'est fabriquee.         | Nouveau review/MRTR/run/evaluation de la methode electrique.                                         |
| Electrique | Edge existe mais methode pas encore qualifiee.                                                                                                                        | `impact-unresolved`.                                     | Rien n'est appele.                                                                         | Publier le gap/methode manquante; decision humaine de priorite.                                      |
| Thermique  | Edge vers un parametre de la fiche/admission RFC 04, joins fingerprint exacts.                                                                                        | `invalidated`.                                           | Les observations/evaluations L4/L5 precedentes ne supportent plus la consequence nouvelle. | Nouveau capture/admission si source ou bindings changent, sinon nouveau run review/MRTR, L3, L4, L5. |
| Thermique  | Edge manquante, ambiguë, sourcee par label, ou fiche/binding non relisible.                                                                                           | `impact-unresolved`.                                     | Ancienne evidence reste visible mais ne ferme pas la nouvelle question.                    | Stop humain : completer/fixer le manifeste ou declarer qu'aucune conclusion n'est possible.          |
| Mecanique  | Aucune edge causale vers les inputs exacts de la preuve FEA **et** assertion d'independance reouverte, sourcee, non expirée et sans remplacement d'artefact consomme. | `carried-forward`.                                       | Evidence FEA conserve sa propre freshness et son L4/L5 existant.                           | Aucun run FEA; enregistrer la capture de controle et les fingerprints.                               |
| Mecanique  | Assertion manquante/stale/ambiguë, edge presente, ou artifact FEA input remplace.                                                                                     | `impact-unresolved` ou `invalidated` selon edge prouvee. | Ne pas dire "preservee".                                                                   | Stop humain puis requalification/revue FEA si impact confirme.                                       |

Cette matrice est directionnelle. Une evidence thermique ne cree pas une edge vers la
mecanique; une evidence mecanique ne valide pas l'electrique. Les relations doivent etre
materialisees une par une dans le Thread avec leur base epistemique et les exactes
empreintes qui les soutiennent.

## Operations proposees et autorite

1. `verify.seal-cross-domain-impact-manifest@1` : ferme et publie le manifeste relu,
   sans appel moteur. MRTR humaine distincte.
2. `analyze.evaluate-cross-domain-impact@1` : reouvre le manifeste, le changement
   approuve, le brief V2, gate claims, Thread lineage et artefacts; publie un capture
   d'impact et des propositions de work items. Il ne lance ni SPICE, ni OMC, ni CalculiX
   et ne mutile aucun gate claim existant silencieusement.
3. `decide.accept-cross-domain-impact@1` : action humaine qui confirme les statuts et
   les work items proposes. Elle est obligatoire avant la modification des gateClaims ou
   la queue de nouveaux runs.

Les noms restent a figer dans le registre une fois la revue d'API realisee. Quel que
soit le nom final, les outils agent-facing acceptent seulement `projectId` et les
identites opaques retournees par le serveur; aucun `branch`, `impact`, provider, outil,
args, paths ou liste d'artefacts bruts choisis par l'agent.

### Lineage que l'executor doit prouver

```text
human-approved change
  -> exact sourceAnchor / fingerprint
  -> sealed impact manifest / fingerprint
  -> current approved Brief V2 gate + declared dependencies
  -> exact prior branch evidence + its input consumptions
  -> impact-evaluation capture
  -> human decision on statuses/work items
  -> only then: one independent run path per invalidated branch
```

Le capture contient les identites de chaque entite examinee, la rationale de chaque
edge/assertion, l'ancien/nouveau statut des claims, les IDs de change qui causent la
freshness, et les work items proposes. Il ne re-ecrit pas les old artifacts. Le Thread
successor utilise `applyThreadSnapshotExtensionIfNew` et valide que chaque
`invalidatedByChangeIds` vise un changement present dans le snapshot.

## Lots atomiques pour implementation rapide

| Lot | Depend              | Changement exact et placement DDD/hexa                                                                                                                                       | Acceptance du commit                                                                                                               |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| X01 | —                   | Fixtures minimales dans `src/testing/`: manifest valide, edge manquante, assertion stale, mismatch de digest, Brief V2 independant/non declare.                              | Aucune valeur physique n'est ajoutee; les fixtures ne font aucune inference.                                                       |
| X02 | X01                 | `src/domain/impact/cross-domain-impact-manifest.ts`: schema ferme, hashes, IDs, relations positives et independence assertions.                                              | Refuse cle extra, doublon, branche libre, sourceAnchor sans fingerprint et assertion negative implicite.                           |
| X03 | X02                 | Ajouter `src/domain/impact/cross-domain-impact-evaluation.ts`: resultats de branche, transitions statut, capture canonical.                                                  | La matrice refuse `carried-forward` mecanique sans assertion+evidence exactes; refuse `pass/fail` comme status gateClaim.          |
| X04 | X02                 | Ports out `src/application/ports/out/impact/` : manifest reader, Thread lineage reader, brief gate/dependency reader, capture store.                                         | Aucun port ne depend d'un MCP provider ou d'un workbench.                                                                          |
| X05 | X03,X04             | Use case review/seal sous `src/application/use-cases/impact/`; adapter CAS/Thread sous `src/adapters/impact/`.                                                               | Rouvre et recroise manifeste/brief/Thread; no solver; mismatch => unavailable/unresolved literal.                                  |
| X06 | X05                 | MRTR grammar et descripteur operation dans `src/orchestration/operations/`; project-control review tool.                                                                     | Le caller ne peut selectionner branche/edge/artefact par JSON ni contourner MRTR.                                                  |
| X07 | X03,X04             | Implementer l'analyse d'impact pure : graph directionnel, regles de matrice, propositions sans mutation.                                                                     | Tests couvrent exactement electrical/thermal invalidated, electrical unavailable, mechanical carried-forward et impact-unresolved. |
| X08 | X07                 | Persist capture + extension Thread dans `src/adapters/impact/`; utiliser facts/links/consumptions existants, pas un second graph UI.                                         | Tous les artifacts/claims/changements ont provenance et freshness validables; les anciens artifacts ne disparaissent pas.          |
| X09 | X08                 | Operation MRTR human-only de decision d'impact + changement explicite de work items/gateClaims dans les use cases project.                                                   | Aucune transition automatique; retry idempotent; mauvais basis/brief gate/claim refuses.                                           |
| X10 | X09, RFC 04, RFC 05 | Integrer les propositions de rerun thermique et electrique vers leurs operations propres. Une verticale encore absente reste un blocker litteral du closeout.                | Aucun call OMC/ngspice lors de X07-X09; chaque rerun demande sa propre MRTR via son operation enregistree.                         |
| X11 | X09                 | Integrer la preservation mecanique : inspecter preuve FEA, consumptions et independence assertion, publier resultat carried-forward ou unresolved.                           | Aucun CalculiX call; test adversarial ou une input FEA est remplacee => jamais carried-forward.                                    |
| X12 | X10,X11             | Deuxieme **stop humain** : faire approuver la carte de causalite lampe, les sources de puissance/brillance, les gates brief V2 et l'assertion d'independance mecanique.      | En l'absence de ces decisions, la demo affiche/retient `impact-unresolved`; aucun statut favorable fictif.                         |
| X13 | X12                 | Executer une boucle reelle : changement approuve -> impact decision -> seulement thermique/electrique applicable -> L4/L5 RFC 04 -> preservation mecanique ou gap explicite. | Capture/Thread reouvrables; l'ordre des MRTR est visible; pas de cascade cachee.                                                   |
| X14 | X13                 | Mettre a jour docs/reference/how-to et ajouter tests integration/recovery.                                                                                                   | La surface publique liste exactement le SPICE borne implemente et ses exclusions; elle ne promet ni SPICE general ni modal.        |

## Tests proportionnels

- Domain : manifest canonical, types de branche fermes, no edge-by-absence, assertions
  d'independance expirées, gate mapping duplique et fingerprint corrompu.
- Brief/gate : gate absent/non-V2, `dependsOnItemIds` omit, dependance declaree vide vs
  inconnue, `gateClaims` qui seraient illégalement convertis en bindings.
- Lineage : mauvais producer/run/fingerprint, artifact termine mais stale, consumer FEA
  d'un ancien STEP, sourceAnchor remplacee, relation transitive non declaree.
- Execution : aucune invocation moteur pendant review/seal/analyse/decision; seules les
  operations explicitement queuées post-decision peuvent arriver a leurs executors.
- Recovery : WAL/attempt du capture d'impact si l'operation devient non idempotente;
  rerun d'une analyse terminee relit le capture et ne modifie pas une seconde fois les
  claims/work items.

## Gate global unique (apres X14 et RFC 04/T18)

Realiser une seule boucle, avec changement humain reel et sources reelles : produire le
capture d'impact, obtenir la decision humaine, demontrer que les branches thermique et
electrique invalidees suivent chacune leur propre review/run/L4/L5 qualifie, et que la
mecanique n'est carried-forward que par assertion d'independance recroisee. Puis rejouer
les captures sans appel moteur. Le gate echoue si un label, une cascade automatique, une
valeur inventee ou une reexecution non autorisee a participe au resultat.
