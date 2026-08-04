# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in
this repository.

# Casys Digital Thread — contexte projet

Ce repo est **l'atelier** de la chaîne « executable digital thread » : exigence → modèle
SysML v2 → géométrie → physique → preuve. Les serveurs MCP d'ingénierie vivent dans
leurs propres repos et s'exécutent depuis des images publiées : `engineering-toolchain`
pour SysON/CAD/CalculiX, et `mcp-modelica` pour OpenModelica + MSL. On ne clone ici
aucune source de ces serveurs. Ce repo contient en revanche la source de la Console MCP
read-only, du workflow lié et du Workbench natif (`server.ts`, `src/`). Pour éditer un
serveur d'ingénierie, cloner son repo (`Casys-AI/mcp-syson`, `mcp-build123d`,
`mcp-calculix`, `mcp-modelica`, `constraint-solver`).

## Commandes

Runtime backend : **Deno** (tâches dans `deno.json`). Bundles UI : **npm + Vite** dans
`src/ui/`. Providers d'ingénierie : **Docker Compose**.

```bash
docker compose up -d              # topologie provider ; SysON UI sur :8180
npm --prefix src/ui ci
npm --prefix src/ui run build     # bundle Console MCP App → src/ui/dist/console/
deno task start                   # serveur MCP Console + project control, :3020/mcp
deno task dev                     # idem avec --watch sur server.ts, src, config
```

Qualité — à passer avant tout commit :

```bash
deno task check       # type-check ; liste explicite de fichiers (voir le piège plus bas)
deno task lint
deno task fmt         # --check seulement ; pour écrire : deno fmt <chemin>
deno task test        # suite Deno complète : src/ + scripts/*_test.ts
deno task check:ui    # tsc --noEmit sur src/ui
deno task verify:thread:presentation   # gate de release : frontière mcp-view du cockpit natif
deno task verify:evidence              # cohérence des fixtures console
```

Un seul fichier de test, ou un seul cas — les permissions doivent être reprises à la
main, `deno task test` ne prend pas d'argument de chemin :

```bash
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/domain/thread-snapshot_test.ts
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/domain/thread-snapshot_test.ts --filter "strictly JSON serializable"
```

Surfaces interactives locales (chacune rebuild son bundle puis sert un BFF loopback) :

```bash
deno task preview:browser     # :3021 — harness navigateur de la Console MCP App
deno task preview:thread      # :5173 — cockpit projet natif (reads/SSE passifs)
deno task preview:cockpit     # :5175 — même cockpit, port explicite de démonstration
```

Chaîne CM-01 historique r5/r6 — **n'exécuter que pour produire délibérément de nouvelles
preuves locales**, jamais « pour voir » : les runners provider écrivent des révisions
immuables sous `state/local/`.

```bash
deno task thread:assemble                        # assemblage read-only des branches CM-01
deno task thread:run-coffee-machine-build        # SysON → build123d
deno task thread:attach-coffee-machine-build     # valide, publie, réconcilie le feed
deno task thread:run-coffee-machine-mechanical --run-id=<id>      # run humain-autorisé
deno task thread:attach-coffee-machine-mechanical --run-id=<id>
deno task thread:attach-modelica
```

Le chemin fermé `coffee-machine-cm01-v3` est distinct de cette référence historique. Ses
runners de correction et de récupération appellent le plan de contrôle MCP seulement
après consentement explicite ;
`thread:recover-coffee-machine-cm01-v3-mechanical-r3-identity` reconstruit une identité
R3 depuis une capture achevée, et `thread:close-coffee-machine-cm01-v3-r11` crée le
closeout R12. Ces deux dernières étapes ne rejouent aucun provider ; elles restent
néanmoins des écritures immuables, pas des commandes de diagnostic.

Diagnostic pur, sans écriture ni révision — `probe:constraint-solver` lit les
contraintes d'un contexte SysON puis interroge z3. Il ne publie rien ; on peut le lancer
librement :

```bash
deno task probe:constraint-solver
```

**Piège `deno task check`** : la tâche énumère les fichiers un par un dans `deno.json`.
Un nouveau module non-test qui n'y est pas ajouté n'est jamais type-checké — l'oubli est
silencieux. Ne jamais rapporter une suite verte obtenue avec `--no-check` : c'est un
résultat faux, la vérification ayant été désactivée plutôt que satisfaite.

**Piège bundles** : `src/ui/dist/**` est **commité**. Toute modification de
`src/ui/src/` exige de rebuilder les surfaces concernées (`build`, `build:thread`) et de
commiter le bundle régénéré, sinon le preview et la ressource MCP servent l'ancienne UI.

## Architecture du code

Hexagonal explicite ; les dépendances pointent toujours vers `src/domain/`.

| Couche                          | Rôle                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/domain/`                   | Contrats, validation stricte, transitions. **Aucun I/O** : pas de `fetch`, pas de `Deno.*` |
| `src/adapters/`                 | I/O : stores fichier immuables, clients MCP HTTP, sondes Docker, exécuteurs, projecteurs   |
| `src/orchestration/operations/` | Registre code-owned des opérations d'ingénierie revues, exposées au planning               |
| `src/tools/`                    | Surfaces MCP : `register.ts` (fleet read-only), `project-control.ts`                       |
| `src/workflow/`                 | Loader → compiler → executor des DAG YAML de `config/thread-workflows/`                    |
| `src/contracts/`                | DTO browser-safe partagés backend ↔ UI (`thread-workbench.ts`)                             |
| `src/ui/src/`                   | Preact : `project/` (cockpit, brief, projection), `thread/` (feed, graphe, inspecteurs)    |
| `src/testing/`                  | Fixtures partagées entre suites                                                            |
| `scripts/`                      | Entry points exécutables : BFF, runners CM-01, harness, gates de release                   |
| `server.ts`                     | **Composition root** : c'est là que les adapters sont câblés aux services domaine          |

Les invariants suivants sont structurels — les casser casse le produit, pas seulement un
test :

1. **Immutabilité + CAS** — `EngineeringProjectSnapshot` et `ThreadSnapshot` ne sont
   jamais mutés. Toute commande nomme la révision attendue et écrit une nouvelle
   révision. Une révision publiée est relue avant d'être considérée comme vraie.
2. **Hash déterministe** — toute empreinte passe par `deterministicJson` /
   `sha256Fingerprint` (`src/domain/deterministic-json.ts`) : clés triées, `undefined`
   omis, nombres non finis rejetés. Ne jamais hasher un `JSON.stringify` brut.
3. **Validation fail-closed** — le pattern dominant est
   `exactRecord(value, [clés], path)` : une clé en trop _ou_ en moins est un rejet. Voir
   `src/orchestration/operations/registry.ts` pour la forme canonique (codes d'erreur
   typés + message sans détail provider).
4. **Le navigateur ne reçoit jamais d'autorité MCP** — l'UI lit le dossier lié par
   GET/SSE et ne poste aucune commande projet. Les `tools/call` restent backend-only ;
   le chat MCP est l'interface de commande et de décision.
5. **Loopback = garde de déploiement, pas authentification** — l'identité opérateur
   affichée est auto-déclarée. Un binding non-loopback désactive les outils projet
   (`requestUsesExplicitLoopbackHost`, `server.ts:319`).
6. **Exécuteurs serveur-fixes** — un agent ne fournit ni nom de provider, ni nom
   d'outil, ni arguments, ni texte SysML. Il déclenche une opération enregistrée ; la
   séquence est codée côté serveur. Les écritures non idempotentes sont journalisées
   avant dispatch et un résultat incertain s'arrête pour revue au lieu de retenter à
   l'aveugle.

Répartition des autorités, qui explique la plupart des refus de code : l'**agent**
propose, planifie, met en file et exécute uniquement des opérations enregistrées ;
l'**humain** exprime ses choix dans le chat et confirme les décisions conséquentes par
MRTR signé ; le **serveur** possède les séquences provider et les arguments techniques.
Le Workbench est une projection read-only. Aucun acteur ne peut prendre le rôle d'un
autre.

### Tests

- `_test.ts` co-localisé à côté du module (`src/domain/foo.ts` ↔
  `src/domain/foo_test.ts`).
- Les tests UI sont des tests **Deno**, placés à la **racine de `src/ui/`** (ex.
  `src/ui/project-model_test.ts`) et non à côté des `.tsx`. Ils importent depuis
  `src/ui/src/` et testent les modèles (`*-model.ts`) et les contrats, pas le rendu
  Preact. Corollaire : toute logique d'affichage non triviale vit dans un `*-model.ts`
  testable.
- `@std/assert` uniquement ; noms de tests en phrases décrivant l'invariant, pas la
  méthode (« ThreadSnapshot never accepts an observation without an explicit unit »).

## Les outils de la chaîne (MCP stateless)

Les serveurs exposent `/mcp` avec le protocole stateless `2026-07-28`. Démarrer les
services requis avec Compose ; ce repo n'embarque plus de configuration stdio ni de
chemin de compatibilité legacy.

- `syson_*` — modèle SysML v2 (31 tools) : projets, éléments, AQL, contraintes
  (`syson_constraint_validate`, `syson_constraint_solve` — z3), structure produit
  (`syson_part_structure`), valeurs. Nécessite SysON sur `localhost:8180`
  (`docker compose up -d syson-db syson-app`).
- `build123d_execute` / `build123d_export` — CAD as code (Python/OCCT) : le script
  assigne `result`, masse **uniquement** si `density_kg_m3` explicite. Exports
  STEP/STL/GLB dans le volume partagé `/exports`.
- `calculix_solve_static` — FEA : STEP → maillage Gmsh (faces désignées par bounding
  boxes nommées, mm) → statique linéaire → déplacement max + von Mises max. Tout le
  physique est explicite (mesh_size_mm, e_mpa, nu, forces totales). Unités fixes : mm,
  N, MPa.
- `modelica_kit_list` / `modelica_simulate` / `modelica_run_list` / `modelica_run_get` —
  simulation système OpenModelica de kits approuvés : température, temps, énergie et
  puissance. Le cockpit découvre les records via les deux outils de lecture, jamais via
  le volume Docker. Une simulation réussie produit des observations et artefacts hashés
  ; le verdict reste du ressort de SysON + `constraint-solver`.
- `erpnext_*` — chiffrage et manufacturing : un bridge provider-native sur `3012`. Le
  backend appelle seulement les tools revus par le workflow ; le navigateur ne reçoit ni
  credentials ERP ni autorité MCP générique.
- `console_*` — cockpit read-only : état désiré/observé des MCP, dérive, runs et preuves
  hashées. `console_refresh` est app-only ; aucun outil de cycle de vie n'est exposé.

Composition type : l'orchestrateur appelle `build123d_export`, qui écrit et hashe
`/exports/piece.step` → `calculix_solve_static` snapshotte l'entrée et atteste le même
SHA-256 → le résultat (masse, contrainte) se vérifie contre le modèle via
`syson_constraint_evaluate` avec valeurs unitées (`{"value": 0.0569, "unit": "kg"}`).
Les runs Modelica restent dans leur volume dédié `/runs` : ils ne partagent ni export
CAD ni socket Docker.

Dans le baseline CM-01 r5, le seul verdict CoffeeMachine est le contrat de scénario
provisoire `config/verification-plans/coffee-machine-nominal-v1.json` :
`water_temperature_max >= 90 degC`, appelé en lecture seule via
`syson_constraint_evaluate` et lié aux hashes modèle/scénario. Ce n'est pas une exigence
produit/SysON ; les 900 s sont seulement la provenance du scénario. Le chemin CM-01 V3
fermé porte séparément deux critères mécaniques de concept DripTray et leurs évaluations
courantes ; il ne prouve ni la machine entière, ni une fabrication, ni une
certification.

Ces deux évaluations mécaniques sont désormais rendues par `syson_constraint_evaluate`
et non plus par une comparaison TypeScript : les unités sont comparées comme des
valeurs, et `error` comme `unresolved` atteignent le snapshot publié sans jamais devenir
`pass`. Les seuils, eux, viennent encore d'un proof-case revu et non du modèle SysML —
le golden path n'écrit dans SysON que de la structure (`part def`, `part usage`,
`attribute`), jamais de contrainte ni d'exigence. `syson_constraint_solve` (z3) reste
délibérément hors du chemin de run : toutes les contraintes ayant la forme
`feature op littéral` sur des variables indépendantes, il répondrait invariablement
`sat` — une porte qui dit toujours oui.

Le produit est un cockpit Preact natif sur une enveloppe `engineering-workbench/0.2` :
la surface `planning` porte un `EngineeringProjectSnapshot` immuable avant toute preuve
technique ; la surface `evidence` y ajoute un `ThreadSnapshot` lié et l'état explicite
`aligned` ou `thread-ahead`. Les cinq espaces sont `Project`, `Activity`, `Product`,
`Evidence` et `Execution`. Le feed live appartient à `Activity`, le graphe à `Evidence`,
les facettes composants à `Product`, et les runs et outils à `Execution`.

Un nouveau projet commence directement dans un `EngineeringProjectSnapshot` schema-3.0 :
l'agent pose une question compréhensible à la fois, consolide le brief vivant et
l'humain confirme le brief exact dans la conversation par MRTR signé. Le cockpit unique
en donne ensuite une projection passive ; ce passage ne crée ni modèle SysON, ni
`ThreadSnapshot` technique. Aucun moteur réglementaire ne fait partie du Golden Path
actuel.

Le backend compose les données par un DAG explicite sous `config/thread-workflows/` ; la
YAML ne décrit ni layout ni composant. Ouvrir la page ne lance aucun solver. Les MCP
Apps restent des réponses riches unitaires pour les agents, jamais des panneaux du
produit. Ports, contrats et frontières exacts : `docs/reference/workspace-map.md`.

Le projet CM-01 suivi vit sous `config/projects/`. Il référence des IDs de snapshots
exacts, jamais `latest`. `config/projects/baselines/` contient une capture observée r5
et son STL de présentation lossless pour rendre le preview reproductible sans provider.
Le store local actif reste prioritaire ; le baseline ne peut satisfaire que le même ID
ou nom d'asset exact et ne constitue ni un nouveau run ni une preuve de service actif.

## Principes non négociables (hérités des règles AgentCards)

- **Le calcul est l'oracle, pas le produit** : aucune intelligence dans la couche outil
  — jamais d'outil MCP adossé à un LLM.
- **No hidden heuristics** : pas de valeur inventée, pas de défaut qui ressemble à une
  donnée. Une masse sans densité n'existe pas ; une multiplicité illisible est un défaut
  SysML _labellisé_.
- **Les unités sont des valeurs** : 2,5 kg contre un budget de 4 lb → `fail`. Comparer
  dimensionné/adimensionné est une erreur, jamais une comparaison de nombres nus.
- **Fail-fast** : `unresolved`/`error` sont des états de première classe ; « je ne sais
  pas » ne devient jamais « satisfait ».
- **Test de l'équivalent AQL** avant tout nouvel outil : si l'agent peut le faire en une
  expression avec les primitives existantes, l'outil est un raccourci qui n'en est pas
  un.
- **Desired ≠ observed** : le manifeste ne prouve jamais qu'un service tourne. Les
  sondes MCP/Docker restent la vérité d'exécution, y compris lorsqu'elles répondent
  `unavailable`.
- **Demo ≠ live** : l'exemple bracket reste un fixture de démonstration hashé, hors du
  sujet produit CM-01. Son FEA est documenté, jamais présenté comme un solve fraîchement
  exécuté ni rattaché automatiquement au thread courant.

## Conventions

- `deno fmt` : `lineWidth: 88`, point-virgules, guillemets doubles. Le style des
  commentaires est explicatif — un bloc `/** */` documente _pourquoi_ une frontière
  existe, pas ce que fait la fonction.
- Dépendances via l'import map de `deno.json` (JSR uniquement) ; `minimumDependencyAge`
  d'un jour, sauf `@casys/mcp-server`.
- Commits conventionnels (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`), suffixe
  `[skip ci]` sur les commits de travail courants.
- Documentation en Diátaxis sous `docs/` (`tutorials/`, `how-to/`, `reference/`,
  `explanations/`). Une nouvelle frontière ou un nouveau port se documente dans
  `docs/reference/workspace-map.md`.
- Le vocabulaire produit compte : « demo », « unavailable », « provisional », «
  documentary » et « unverified » sont des labels contractuels. Ne jamais les retirer
  d'une sortie pour la rendre plus lisible.

## État et prochaine étape

Le chemin local CM-01 V3 démontre maintenant une correction bornée `28 mm → 30 mm` : le
run R2 sans preuve reste un échec historique, un successeur R3 correctement identifié
porte la preuve mécanique, puis R12 ferme explicitement la famille d'exigences et la
réconciliation de projet. C'est un seul cas de concept, pas un mécanisme de correction
générique ni une certification.

Deux marches ont été franchies depuis. Les sept capture stores content-addressed sont
maintenant un seul `FileCaptureStore<Kind>` : un nouveau type de preuve coûte un
descripteur, pas une classe, et le paramètre de type continue d'interdire qu'un executor
reçoive le store d'une autre famille. Et le verdict mécanique appartient à l'oracle, à
travers `src/domain/proof-case.ts` — un contrat d'exigence sans rien de CalculiX ni de
CM-01, où l'unité est obligatoire et où le critère ignore d'où vient la mesure. C'est
cette indifférence à la source qui le rend réutilisable par un second projet.

La suite, dans l'ordre : faire vivre les exigences comme éléments SysML du modèle plutôt
que dans un JSON ; y ajouter les **relations** entre attributs de structure et
métriques, sans lesquelles ni z3 ni l'agent ne peuvent déduire quel paramètre corriger ;
puis brancher l'analyse de sensibilité comme second oracle — mesurer
∂métrique/∂paramètre par différences finies en rejouant la chaîne, ce qui produit ces
relations par le calcul plutôt que par supposition. C'est aussi ce qui rend enfin
mesurable l'expérience d'`experiments/oracle/` : nombre de solves nécessaires pour
converger, avec et sans ces arêtes.
