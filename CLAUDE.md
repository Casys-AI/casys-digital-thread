# CLAUDE.md

Ce fichier est un **pointeur**, pas une source. Il ne porte que les commandes et les
pièges qui font échouer silencieusement. Tout le reste — autorités, opérations,
frontières, contrats — vit dans les pages ci-dessous, qui sont la vérité.

## Lire d'abord

1. [AGENTS.md](AGENTS.md) — autorités, pièges de paires qui se ressemblent, labels
2. [docs/reference/agent/agent-workspace.md](docs/reference/agent/agent-workspace.md) — surfaces
   appelables, opérations enregistrées, grants exacts
3. [docs/reference/agent/lookalike-traps.md](docs/reference/agent/lookalike-traps.md) — paires qui
   ne sont pas des substituts
4. [docs/reference/runtime/workspace-map.md](docs/reference/runtime/workspace-map.md) — ports, YOLO.
   Census fichiers : [workspace source map](docs/reference/runtime/workspace-source-map.md)
5. [docs/reference/pipeline/analysis-authority-pipeline.md](docs/reference/pipeline/analysis-authority-pipeline.md)
   — capture → analyse → MRTR → dispatch
6. [docs/tutorials/first-engineering-loop.md](docs/tutorials/first-engineering-loop.md)
   — la boucle de bout en bout

Les serveurs MCP d'ingénierie vivent dans leurs propres repos et tournent depuis des
images publiées. Ne jamais les cloner ici pour « corriger » une opération.

## Commandes

Runtime backend : **Deno** (tâches dans `deno.json`). Bundles UI : **npm + Vite** dans
`src/ui/`. Providers : **Docker Compose**.

```bash
docker compose up -d              # topologie provider ; SysON UI sur :8180
npm --prefix src/ui ci
npm --prefix src/ui run build:thread # bundle cockpit → src/ui/dist/thread/
deno task start                   # serveur MCP Console + project control, :3020/mcp
deno task dev                     # idem avec --watch
deno task start:yolo              # loopback : auto-confirme les MRTR positifs
deno task mcp:call --name=<tool> --args='{}'  # tools/call loopback :3020/mcp
```

Qualité — à passer avant tout commit :

```bash
deno task check       # type-check Deno (globs ; Vite UI = check:ui)
deno task lint
deno task fmt         # --check seulement ; pour écrire : deno fmt <chemin>
deno task test        # suite Deno complète
deno task check:ui    # tsc --noEmit sur src/ui
deno task verify:thread:presentation   # gate de release : bundle natif sans handshake Apps
deno task verify:evidence              # cohérence des fixtures console
```

Un seul fichier ou un seul cas — les permissions se reprennent à la main,
`deno task test` ne prend pas d'argument de chemin :

```bash
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/domain/thread/thread-snapshot_test.ts --filter "strictly JSON serializable"
```

Surfaces interactives locales (chacune rebuild son bundle puis sert un BFF loopback) :

```bash
deno task preview:thread      # :5173 Vite HMR → BFF :5175 (reads/SSE passifs)
deno task preview:cockpit     # :5175 — même BFF, HTML + JS/CSS hashés
```

`deno task preview:browser` refuse : l'ancienne Console MCP App (`:3021`) n'est plus une
page produit. La santé de flotte reste `console_snapshot` sur `:3020/mcp`.

Sondes diagnostiques, sans écriture ni révision :

```bash
deno task probe:constraint-solver --editing-context-id=<id> --element-id=<id>
deno task probe:requirement-units --unit=<unit> --type=<SysmlType>
```

## Les deux pièges qui ne préviennent pas

**`deno task check`** type-check par globs (`server.ts`,
`src/{adapters,application,contracts,domain,orchestration,testing,tools}/**/*.ts`,
`scripts/**/*.ts`, `experiments/**/*.ts`). Un module Deno nouveau est pris
automatiquement. **`src/ui/src`** reste hors de ce graphe — c'est `deno task check:ui`
(tsc). Exception Deno : `src/ui/*_test.ts` et `src/ui/src/project/record-status.ts`. Ne
jamais rapporter une suite verte obtenue avec `--no-check` : la vérification a été
désactivée, pas satisfaite.

**`src/ui/dist/**` est commité.** Toute modification de `src/ui/src/` exige de rebuilder
les surfaces concernées et de commiter le bundle régénéré, sinon le preview et la
ressource MCP servent l'ancienne UI.

## Conventions

- `deno fmt` : `lineWidth` 88, sauf `src/ui/src` à 80. Seule vérité : `deno task fmt`
  complet, qui enchaîne les deux passes.
- Dépendances via l'import map de `deno.json` (JSR uniquement) ; `minimumDependencyAge`
  d'un jour, sauf `@casys/mcp-server`.
- Commits conventionnels (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`), suffixe
  `[skip ci]` sur les commits de travail courants.
- Tests `_test.ts` co-localisés ; les tests UI sont des tests **Deno** à la racine de
  `src/ui/`. `@std/assert` uniquement ; noms de tests en phrases décrivant l'invariant.
- Documentation en Diátaxis sous `docs/`. Une nouvelle frontière ou un nouveau port se
  documente dans `docs/reference/runtime/workspace-map.md`.
- Pendant l'implémentation, préférer les checks ciblés et causaux ; réserver les suites
  globales aux vrais jalons d'intégration.
