# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in
this repository.

# Casys Digital Thread — contexte projet

Ce repo est **l'atelier** de la chaîne « executable digital thread » : exigence → modèle
SysML v2 → géométrie → physique → preuve. Les serveurs MCP d'ingénierie vivent dans
leurs propres repos et s'exécutent depuis des images publiées : `engineering-toolchain`
pour SysON/CAD, `mcp-calculix` pour CalculiX et `mcp-modelica` pour OpenModelica + MSL.
On ne clone ici aucune source de ces serveurs. Ce repo contient en revanche la source de
la Console MCP read-only, du workflow lié et du Workbench natif (`server.ts`, `src/`).
Pour éditer un serveur d'ingénierie, cloner son repo (`Casys-AI/mcp-syson`,
`mcp-build123d`, `mcp-calculix`, `mcp-modelica`, `constraint-solver`).

> **Statut CM-01.** CM-01 est retiré du code, de la configuration, des scripts, des
> catalogues et des surfaces actives. Il ne reste que la fixture golden statique sous
> `state/fixtures/retired/cm01-v3/` et les révisions historiques immuables déjà écrites
> sous `state/local/`. Ne jamais les enregistrer, les rejouer, les prendre comme
> fallback ou les présenter comme une admission provider. Le Workbench est focus-only ;
> `desk-lamp-dl04` est le projet générique qui porte les qualifications successives.
>
> **Agents.** Lire d'abord [AGENTS.md](AGENTS.md) puis
> [docs/reference/agent-workspace.md](docs/reference/agent-workspace.md). Ces pages
> listent les paires d'opérations qui se ressemblent (`model.write-architecture@1` ≠
> `model.seal-architecture-sysml@1`, CAD sandbox ≠ microVM, FEA `@1`/`@2`/`@3`) et les
> grants exacts des outils. Ne pas fusionner deux autorités.

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

## Principes d'implémentation

- Pour le compilateur et l'exécution isolée, choisir les bibliothèques et
  infrastructures matures sur leurs garanties réelles ; aucune contrainte artificielle
  de taille de bundle ne justifie de réimplémenter un parseur, un validateur ou une
  sandbox moins robuste.
- Conserver les backends derrière des ports interchangeables : une intégration Deno
  Sandbox, OCI ou microVM ne doit jamais devenir l'autorité du domaine ni contaminer les
  contrats publics avec ses handles, chemins ou options.
- Quand un changement traverse un fichier ou un dossier mal organisé, faire le refactor
  local qui améliore réellement les frontières, la lisibilité et l'expérience
  développeur/agent ; éviter en revanche la réorganisation sans rapport causal avec le
  vertical en cours.
- Pendant l'implémentation, préférer les checks ciblés et causaux. Réserver les suites
  globales systématiques aux vrais jalons d'intégration ou de release, après
  stabilisation des écritures concurrentes.

Un seul fichier de test, ou un seul cas — les permissions doivent être reprises à la
main, `deno task test` ne prend pas d'argument de chemin :

```bash
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/domain/thread/thread-snapshot_test.ts
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/domain/thread/thread-snapshot_test.ts --filter "strictly JSON serializable"
```

Surfaces interactives locales (chacune rebuild son bundle puis sert un BFF loopback) :

```bash
deno task preview:browser     # :3021 — harness navigateur de la Console MCP App
deno task preview:thread      # :5173 — cockpit projet natif (reads/SSE passifs)
deno task preview:cockpit     # :5175 — même cockpit, port explicite de démonstration
```

Diagnostic pur, sans écriture ni révision — `probe:constraint-solver` lit les
contraintes d'un contexte SysON explicitement nommé puis interroge z3. Il n'a aucun
contexte produit par défaut et ne publie rien :

```bash
deno task probe:constraint-solver \
  --editing-context-id=<editing-context-id> \
  --element-id=<element-id>
```

**Piège `deno task check`** : la tâche énumère les fichiers un par un dans `deno.json`.
Un nouveau module non-test qui n'y est pas ajouté n'est jamais type-checké — l'oubli est
silencieux. La liste doit couvrir tous les modules non-test hors `src/ui/` (celui-ci
relève de `check:ui`) ; elle est complète, et le rester demande d'y ajouter chaque
nouveau module. Méfiance particulière envers les tâches `check:*` dédiées : deux d'entre
elles visaient des gates de release absentes du `check` principal, ce qui ressemblait à
une couverture sans en être une. Ne jamais rapporter une suite verte obtenue avec
`--no-check` : c'est un résultat faux, la vérification ayant été désactivée plutôt que
satisfaite.

**Piège bundles** : `src/ui/dist/**` est **commité**. Toute modification de
`src/ui/src/` exige de rebuilder les surfaces concernées (`build`, `build:thread`) et de
commiter le bundle régénéré, sinon le preview et la ressource MCP servent l'ancienne UI.

## Architecture du code

Hexagonal explicite ; les dépendances pointent vers les contrats intérieurs de
`src/domain/` et `src/application/ports/`, jamais vers une implémentation d'adapter.

| Couche                          | Rôle                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/`                   | Agrégats, validation stricte et transitions pures. **Aucun I/O** : pas de `fetch`, pas de `Deno.*`. Sous-familles : `kernel/` (primitives, hashing, validation), `thread/` (snapshot, catalogues), `project/` (agrégats, brief, focus, invariants), `engineering/` (architecture, exigences, géométrie et seed SysON), `analysis/` (proof-case, sensibilité, correction)      |
| `src/application/`              | Cas d'usage et ports entrants/sortants : `control-plane/` orchestre les lectures Console, `ports/in/` expose les contrats appelés par les outils, `ports/out/` décrit les capacités fournies par l'infrastructure, `use-cases/project/` porte les commandes projet/brief et `use-cases/registered-project-run-executor.ts` le dispatch exact ; aucun import d'adapter concret |
| `src/adapters/`                 | I/O : gardes plats (composition root, cross-boundary) + sous-familles `assets/`, `executors/`, `captures/`, `stores/`, `wal/`, `projectors/`, `extractors/`, `validators/`, `historical/`                                                                                                                                                                                     |
| `src/orchestration/operations/` | Registre code-owned des opérations d'ingénierie revues, exposées au planning                                                                                                                                                                                                                                                                                                  |
| `src/tools/`                    | Surfaces MCP : `register.ts` (fleet read-only), `project-control.ts`                                                                                                                                                                                                                                                                                                          |
| `src/contracts/`                | DTO browser-safe partagés backend ↔ UI (`thread-workbench.ts`, `engineering-workbench.ts`, `console.ts`)                                                                                                                                                                                                                                                                      |
| `src/ui/src/`                   | Preact : `project/` (cockpit, brief, projection), `thread/` (feed, graphe, inspecteurs)                                                                                                                                                                                                                                                                                       |
| `src/testing/`                  | Fixtures partagées entre suites                                                                                                                                                                                                                                                                                                                                               |
| `scripts/`                      | Entry points par rôle : `runners/` (écritures immuables), `gates/` (vérification read-only), `probes/` (sondes diagnostiques), `serve/` (preview). `lib/` : modules partagés, pas des entry points.                                                                                                                                                                           |
| `server.ts`                     | **Composition root** : c'est là que les adapters sont câblés aux ports et cas d'usage applicatifs                                                                                                                                                                                                                                                                             |

Les invariants suivants sont structurels — les casser casse le produit, pas seulement un
test :

1. **Immutabilité + CAS** — `EngineeringProjectSnapshot` et `ThreadSnapshot` ne sont
   jamais mutés. Toute commande nomme la révision attendue et écrit une nouvelle
   révision. Une révision publiée est relue avant d'être considérée comme vraie.
2. **Hash déterministe** — toute empreinte passe par `deterministicJson` /
   `sha256Fingerprint` (`src/domain/kernel/deterministic-json.ts`) : clés triées,
   `undefined` omis, nombres non finis rejetés. Ne jamais hasher un `JSON.stringify`
   brut.
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

- `_test.ts` co-localisé à côté du module (`src/domain/kernel/foo.ts` ↔
  `src/domain/kernel/foo_test.ts` — la sous-famille détermine le répertoire).
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
- `calculix_solve_static`, `calculix_solve_modal`, `calculix_solve_buckling`,
  `calculix_solve_creep`, `calculix_solve_coupled_thermal`,
  `calculix_solve_static_recorded` et `calculix_run_get` — CalculiX. La statique prend
  un STEP, maille avec Gmsh (faces par bounding boxes nommées, mm) et rend déplacement
  max + von Mises max ; tout le physique reste explicite. Les runs enregistrés vivent
  dans leur volume dédié et sont récupérables par identité. CalculiX ne monte `/exports`
  qu'en lecture seule. Le flux FEA générique stage un asset content-addressed dans son
  volume `/inputs` privé, jamais dans l'échange CAD ni le ledger ; CalculiX le
  snapshotte vers son workdir privé avant le solve.
- `modelica_kit_list`, `modelica_simulate`, `modelica_run_list`, `modelica_run_get`,
  leurs quatre variantes `_recorded`, `modelica_simulation_manifest_get`,
  `modelica_simulation_submit` et `modelica_simulation_request_get` — simulation système
  OpenModelica de kits approuvés : température, temps, énergie et puissance. Le cockpit
  découvre les records via les outils de lecture, jamais via le volume Docker. Une
  simulation réussie produit des observations et artefacts hashés ; le verdict reste du
  ressort de SysON + `constraint-solver`.
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

Un verdict `fail` est publiable : `thread-snapshot-validation.ts` exige qu'une
évaluation en échec nomme une violation et qu'une violation ouverte porte une action
proposée. Les critères d'une preuve mécanique viennent d'un proof-case revu ; le solver
produit des observations, puis `syson_constraint_evaluate` porte le verdict avec ses
unités. Un test de verdict doit passer par `validateThreadSnapshot`, pas seulement
inspecter un objet en mémoire.

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

Ouvrir la page ne lance aucun solver. Les MCP Apps restent des réponses riches unitaires
pour les agents, jamais des panneaux du produit. Le moteur de DAG YAML
(`experiments/thread-workflow/`) est un prototype d'authoring gelé — décision revue du
2026-08-09 : aucun code de production ne l'importe, un test d'architecture l'interdit,
et la voie d'exécution reste les executors serveur-fixes du registre. Ports, contrats et
frontières exacts : `docs/reference/workspace-map.md`.

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
- **Demo ≠ live** : une fixture de démonstration hashée n'est jamais présentée comme un
  solve fraîchement exécuté ni rattachée automatiquement au thread courant.

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

## État actuel

Les parcours actifs sont génériques et passent par le registre, une décision humaine
MRTR exacte, des exécutants serveur-fixes, une capture persistée et une relecture. Le
scellement d'un proof-case et l'admission de son exécution sont deux autorités
distinctes pour `verify.seal-proof-case@1` et `verify.run-fea-static-proof@2`.

`desk-lamp-dl04` est le candidat courant pour qualifier le chemin CalculiX enregistré.
Il ne devient une preuve `@2` réelle qu'après le run provider, la persistance de toutes
ses ressources et leur relecture. L'archive CM-01 ne peut satisfaire aucune de ces
étapes.

Un run seulement `queued` peut être annulé avec `project_agent_run_cancel` après
confirmation humaine signée. `.github/workflows/quality.yml` exécute sur PR et sur
`main` les gates de formatage, lint, type-check, tests, vérification d'évidence et
Workbench.
