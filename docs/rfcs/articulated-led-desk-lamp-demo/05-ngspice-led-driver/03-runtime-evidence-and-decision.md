Audience: agent · Diátaxis: none · Kind: RFC Status: active Parent:
[ngspice LED-driver vertical](README.md)

# RFC 05.3 — provider, WAL, evidence, evaluation and decision lots E08–E15

## Runtime backlog

### E08 — faire le préflight D2 et geler l'adapter provider

Ce lot est une porte, pas un exercice de découverte à l'exécution. Lire le contrat
versionné du provider hors repo et/ou sonder l'image disponible sans modifier de projet.
Enregistrer la preuve sous forme de contrat de méthode ou fixture de protocole
explicitement estampillée ; ne cloner ni ne modifie le repo provider.

- Vérifier que `mcp-spice` est observé `available` avant un test d'intégration réel. Si
  non, conserver `unavailable` et ne pas transformer ce statut en défaut de code.
- Définir l'interface out `SpiceElectricalEngine` sous
  `src/application/ports/out/electrical/`. Elle accepte une commande sémantique fermée,
  jamais le client MCP brut.
- Implémenter `src/adapters/electrical/spice/mcp-spice-electrical-engine.ts` seulement
  après D2 : `operating-point -> spice_simulate_op`,
  `reduced-transient ->
  spice_simulate_tran`, avec enveloppes et limites intégralement
  code-owned.
- L'adapter sélectionne par le `analysis.kind` validé ; aucune sélection utilisateur,
  aucun passthrough, aucun outil générique, aucune chaîne `.control`.

**Acceptation :** fake contractuel prouve le routage fixe et le rejet de données non
fermées. Quand le provider est disponible, une sonde/integ prouve le schéma réellement
retourné et que l'adapter capture son envelope exacte. Si le contrat ne livre pas une
mesure déclarée, le cas est `unresolved`, jamais complété.

**Stop :** absence de contrat/D2, réponse non attestable, ou tool réel non conforme : ne
pas merger un executor de production ; archiver l'écart et revenir à E04.

**Commit :** `feat(electrical): add fixed mcp-spice engine adapter`.

### E09 — WAL de l'exécution électrique

Créer les ports et store typés sous `src/application/ports/out/electrical/` et
`src/adapters/electrical/spice/`, en réutilisant uniquement les helpers génériques de
`src/adapters/shared/wal/`. Ne pas réutiliser le journal CalculiX si ses transitions
Microsandbox ne s'appliquent pas à MCP.

États minimaux :

```text
prepared
  -> dispatch-intent-durable
  -> provider-response-captured
  -> evidence-captured
  -> evaluation-intent-durable
  -> evaluation-captured
  -> thread-published
```

- Avant chaque appel non idempotent, écrire/synchroniser l'intent avec identité de run,
  fingerprint ROP, request id et fingerprint de requête.
- Après un crash après intent et avant capture : seulement readback si D2 fournit une
  identité de consultation sûre ; sinon `quarantine-for-human-review`, sans deuxième
  dispatch.
- Après `provider-response-captured`, toute reprise est CAS-only : jamais de provider.
- L'appel d'évaluation est un second effet externe avec son propre intent/capture. Un
  résultat d'évaluation inconnu n'est pas appelé deux fois.
- Chaque transition est canonique, verrouillée, idempotente à données identiques et
  refuse toute divergence de run/ROP/requête/capture.

**Acceptation :** tests de crash simulé prouvent : aucun dispatch avant WAL ; capture
perdue ne donne pas droit à redispatch ; replay post-capture n'appelle ni ngspice ni
l'évaluateur ; WAL altéré versus CAS est refusé.

**Commit :** `feat(electrical): journal spice proof dispatch and evaluation`.

### E10 — capture et evidence relisible

Implémenter service de capture et `spice-electrical-evidence/1.0`.

- Sauver/re-lire les bytes de la requête réellement envoyée, réponse réellement reçue,
  métadonnées MCP/identité provider disponibles et document de capture canonique.
- Le parser de résultats vit dans `src/adapters/electrical/spice/` ; le modèle
  normalisé, ses invariants et les observations vivent dans `src/domain/electrical/`.
- Valider media type, byte count, SHA-256, statut et champs requis par le profile.
- Préserver réponse/provider error comme evidence avec état `error` ; ne transformer ni
  un code succès ni une métrique présente en verdict.

**Acceptation :** evidence est recréable à partir de CAS sans provider ; tout mismatch
de bytes, hash, méthode ou request id est bloquant ; le run retourne uniquement facts,
observations et états littéraux.

**Commit :** `feat(electrical): capture replayable spice proof evidence`.

### E11 — normaliser les observations et leur provenance

Implémenter le mapper fermé des résultats capturés vers V/A/W/s ; aucune heuristique par
nom de composant ou nœud.

- Chaque observation pointe vers le signal déclaré, le proof capture, l'evidence
  fingerprint, l'analyse, l'horodatage/portée et l'unité.
- Les W calculés conservent les deux observations sources, la convention de signe et le
  fingerprint/version du calcul. Aucun `Math.abs` implicite.
- Les s n'existent que si le reduced transient remplit la sémantique qualifiée.
- Les unités passées à SysON sont les unités effectivement lues/normalisées ; pas de
  conversion invisible pour satisfaire un test.

**Acceptation :** une réponse valide mais sans signal déclaré devient `unresolved` pour
ce signal ; un signe ambigu, unité inconnue ou temps absent interdit l'observation
concernée ; toutes les observations restantes restent inspectables.

**Commit :** `feat(electrical): publish bounded spice observations`.

### E12 — L4, évaluateur séparé de ngspice

Implémenter le projet de critères vers SysON, ou le simple évaluateur D3 approuvé, dans
un adapter séparé de `mcp-spice`.

- Pour SysON, factoriser/reprendre le parseur de réponse commun existant ; ne pas
  dupliquer un second dialecte de `syson_constraint_evaluate`.
- Les valeurs sont indexées par le feature path d'exigence, jamais par le genre de
  mesure ni par un nom de netlist.
- Capturer la requête exacte et la réponse structurée de l'évaluateur, puis relire et
  parser depuis la capture avant publication Thread.
- Publier `pass`, `fail`, `unresolved` ou `error` par critère, plus violation nommée sur
  fail. L'évaluation ne relance pas ngspice, ne corrige pas le netlist et ne décide
  rien.

**Acceptation :** un solver « success » sans évaluation donne L3 seulement ; une unité
non admise ou exigence non relue donne L4 `unresolved` ; la même evidence donne le même
résultat déterministe ou la réponse capturée du moteur nondéterministe.

**Commit :** `feat(electrical): evaluate led-driver evidence at l4`.

### E13 — publication Thread et replay intégral

Assembler l'executor de `verify.run-spice-electrical-proof@1` sous
`src/adapters/electrical/spice/` et son use case sous
`src/application/use-cases/electrical/`.

- Ordre impératif : relecture ROP/sources -> lease -> WAL -> engine -> capture ->
  observations -> WAL évaluation -> capture évaluation -> publication immutable.
- Le Thread lie exact proof capture, source circuit, ROP, evidence, observations,
  évaluations et violations ; il n'invente pas une architecture électrique si elle n'a
  pas été écrite dans SysON.
- Un replay de run terminé relit CAS/WAL/Thread et retourne la même révision sans appel
  à ngspice ni SysON.
- Une erreur publiée reste une erreur, et une capture manquante bloque la publication
  plutôt que de publier une lineage incomplète.

**Acceptation :** test e2e fake : premier run suit la séquence, second run fait zéro
appel externe ; assertions adversariales de ROP/MRTR/basis/circuit modifiés bloquent
avant lease ; aucune Thread entity n'est publiée avant evidence valide.

**Commit :** `feat(electrical): execute and replay led-driver spice proof`.

### E14 — L5 humain, sans automatisation de conséquence

Utiliser la proposition et l'approbation/rejet MRTR génériques déjà en place ; ajouter
seulement un use case de préparation si le système ne peut pas encore lier une
évaluation électrique exacte.

- La proposition L5 cite la revision Thread, chaque L4 concerné, la portée/limites de la
  fiche et la conséquence humaine à accepter ou rejeter.
- Elle refuse `unresolved`/`error` comme preuve d'un `pass`; une personne peut décider
  une conséquence explicitement documentée, mais le système ne la transforme pas en
  conformité.
- La décision human-signed est une nouvelle entity/decision liée à l'évaluation, jamais
  une propriété du run ngspice.

**Acceptation :** pas de L5 sans identité L4 exacte ; l'approbation d'un L5 ne modifie
ni source ni evidence ; nouvelle révision exige une nouvelle proposition.

**Commit :** `feat(project): record led-driver l5 decision`.

### E15 — surfaces et documentation vivante

Après les tests L3/L4/L5 réussis, mettre à jour dans un commit documentaire distinct :

- `docs/reference/domains/` : nouvelle couverture électrique, surface admise et
  exclusions ;
- `docs/reference/providers/provider-analysis-oracle-taxonomy.md` : seulement si le
  nouveau contrat ajoute une précision durable sur engine/method/evaluator ;
- `docs/reference/providers/oracle-units.md` : seulement si une unité a vraiment été
  admise par probe ; V/A/W/s ne demandent pas une nouvelle admission ;
- `docs/reference/runtime/workspace-map.md` : port/adapters/runtimes réellement créés ;
- `docs/reference/agent/agent-workspace.md` et `lookalike-traps.md` : opération/review
  enregistrés et faux amis utiles ;
- `docs/explanations/product/behave-decision-roadmap.md` : ne changer le statut/horizon
  que sur preuve L5, pas quand le code est compilé ;
- un how-to Behave de la lampe, uniquement après une chaîne réellement inspectable.

Ne pas modifier la documentation d'état vivant dans un même commit que le premier
scaffold. Ce RFC reste le brief jusqu'à implémentation ; il n'est pas une preuve de
capacité.

**Commit :** `docs: describe bounded led-driver electrical vertical`.
