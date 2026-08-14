# CLAUDE.md

Ce fichier est un **pointeur**, pas une source. Il ne porte que les commandes et les
pièges qui font échouer silencieusement. Tout le reste — autorités, opérations,
frontières, contrats — vit dans les pages ci-dessous, qui sont la vérité.

## Lire d'abord

1. [AGENTS.md](AGENTS.md) — autorités, pièges de paires qui se ressemblent, labels
2. [docs/reference/agent-workspace.md](docs/reference/agent-workspace.md) — surfaces
   appelables, opérations enregistrées, grants exacts
3. [docs/reference/workspace-map.md](docs/reference/workspace-map.md) — fichiers, ports,
   frontières, racines CAS
4. [docs/reference/analysis-authority-pipeline.md](docs/reference/analysis-authority-pipeline.md)
   — capture → analyse → MRTR → dispatch
5. [docs/tutorials/first-engineering-loop.md](docs/tutorials/first-engineering-loop.md)
   — la boucle de bout en bout

Les serveurs MCP d'ingénierie vivent dans leurs propres repos et tournent depuis des
images publiées. Ne jamais les cloner ici pour « corriger » une opération.

## Commandes

Runtime backend : **Deno** (tâches dans `deno.json`). Bundles UI : **npm + Vite** dans
`src/ui/`. Providers : **Docker Compose**.

```bash
docker compose up -d              # topologie provider ; SysON UI sur :8180
npm --prefix src/ui ci
npm --prefix src/ui run build     # bundle Console MCP App → src/ui/dist/console/
deno task start                   # serveur MCP Console + project control, :3020/mcp
deno task dev                     # idem avec --watch
deno task start:yolo              # loopback : auto-confirme les MRTR positifs
```

Qualité — à passer avant tout commit :

```bash
deno task check       # type-check ; liste explicite de fichiers (voir piège plus bas)
deno task lint
deno task fmt         # --check seulement ; pour écrire : deno fmt <chemin>
deno task test        # suite Deno complète
deno task check:ui    # tsc --noEmit sur src/ui
deno task verify:thread:presentation   # gate de release : frontière mcp-view
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
deno task preview:browser     # :3021 — harness navigateur de la Console MCP App
deno task preview:thread      # :5173 — cockpit projet natif (reads/SSE passifs)
deno task preview:cockpit     # :5175 — même cockpit, port de démonstration
```

Sondes diagnostiques, sans écriture ni révision :

```bash
deno task probe:constraint-solver --editing-context-id=<id> --element-id=<id>
deno task probe:requirement-units --unit=<unit> --type=<SysmlType>
```

## Les deux pièges qui ne préviennent pas

**`deno task check`** énumère les fichiers un par un dans `deno.json`. Un nouveau module
non-test qui n'y est pas ajouté **n'est jamais type-checké** — l'oubli est silencieux. Y
ajouter chaque nouveau module. Ne jamais rapporter une suite verte obtenue avec
`--no-check` : la vérification a été désactivée, pas satisfaite.

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
  documente dans `docs/reference/workspace-map.md`.
- Pendant l'implémentation, préférer les checks ciblés et causaux ; réserver les suites
  globales aux vrais jalons d'intégration.
