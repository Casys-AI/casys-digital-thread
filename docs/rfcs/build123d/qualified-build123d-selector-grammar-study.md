Audience: both · Diátaxis: none · Kind: RFC
Status: study
This page is a session brief or study, not the product contract.
Living page: [closed-language compilation](../../explanations/product/closed-language-compilation.md)

> **Status: STUDY — decision superseded.** The A1 "sets-only" decision this study fed
> was superseded on 2026-08-15 by the closed-language compilation direction: selectors
> become one coverage family among others, and index determinism becomes a per-construct
> evidence _class_ instead of an admission gate. The analysis itself (grammar shapes,
> Lezer mechanics, determinism facts) remains the reference for implementing that
> family. See
> [closed-language compilation](../../explanations/product/closed-language-compilation.md).

# Étude : qualifier les sélecteurs build123d dans le frontend fermé

Étude d'architecture, hors lots 1.4.0 / 1.5.0 / 1.6.0. Le décideur est l'orchestrateur.
Ce texte ne choisit pas d'option, n'assigne pas de version d'analyseur, et n'est pas un
brief d'implémentation.

But déclaré : congé / chanfrein **sélectif** (`solid.edges().filter_by(GeomType.LINE)`,
`solid.faces().sort_by(Axis.Z)[-1]`) et, plus tard, désignation de faces pour la FEA. Le
frontend actuel qualifie seulement le congé / chanfrein **global**
`fillet(solid.edges(), radius=)` / `chamfer(solid.edges(), length)`.

Périmètre lu, non modifié : analyseur `build123d-qualified-lezer` 1.3.0, D4, schéma
d'identité `build123d-ast-identity/1.0`, profil `build123d-closed-subset-v1`, worker
isolé `build123d==0.11.1` / OCP `7.9.3.1`. Aucune sonde d'exécution n'a été lancée pour
cette étude.

---

## 0. Cadre contractuel (ce que le frontend est)

Le frontend ne compile pas vers un autre langage et n'exécute pas Python. Il applique D4
puis prouve un sous-ensemble AST plus petit. Ce que D4 admet et que le frontend ne peut
pas prouver reste un `unresolvedConstruct` explicite — jamais une qualification par
omission (`src/adapters/analyzers/qualified-build123d-source-analyzer.ts:27-36`).

L'admission (`technical-compilation/1.0`) refuse de passer en `ready-for-review` dès
qu'un unresolved est présent : chaque construct émet `source.unresolved-construct`
(`src/domain/analysis/technical-compilation.ts:1218-1224`, `1242-1253`). L'exécuteur
isolé relit ensuite **les mêmes octets** admis et les `exec` tels quels
(`images/build123d-microsandbox-worker/execute-build123d-child.py:106-114`). La
projection d'admission recopie `sourceText` sans réécriture
(`src/domain/analysis/technical-compilation.ts:386-390`). Le chemin historique le dit
aussi : « The source text is never regenerated or rewritten »
(`docs/reference/pipeline/analysis-authority-pipeline.md:171`).

Conséquence pour les trois options : toute forme qualifiée doit être soit du Python
build123d exécutable tel quel (A, C), soit un dialecte dont le _lowering_ vers du Python
exécutable est une étape d'autorité nouvelle, distincte de l'analyseur (B).

Le verrou « Next AST lock » écarte déjà explicitement le sujet de cette étude : « Do not
open general MemberExpression, `.faces()`, or `filter_by` »
(`qualified-build123d-source-analyzer.ts:35-36` ;
`docs/reference/agent/agent-workspace.md:253` ; RFC 1.4.0 §2). Les lots 1.4.0 (chaînes
`Pos`/`Rot`), 1.5.0 et 1.6.0 (liaisons nommées `Pos`/`Rot`) ne l'ouvrent pas. C'est le
chantier hors lots.

---

## 1. État des lieux

### 1.1 Exception étroite `.edges()` vide sous fillet / chamfer

`parseShapeExpression` ne connaît pas les sélecteurs. Il accepte parenthèses, nom d'une
shape déjà prouvée, appels positionnels solide / sketch, `Compound`, `scale`, `fillet`,
`chamfer`, `extrude`, puis `*` / `+` / `-`
(`qualified-build123d-source-analyzer.ts:588-696`). `parseEmptyEdgesSelector` n'est
appelé que depuis `parseFilletCall` et `parseChamferCall` (`:999-1006`, `:1071-1078`).

`parseEmptyEdgesSelector` (`:1103-1139`) exige, et seulement cela :

| Nœud Lezer       | Règle                                                               |
| ---------------- | ------------------------------------------------------------------- |
| Racine           | `CallExpression` à exactement 2 enfants                             |
| Callee           | `MemberExpression`                                                  |
| ArgList          | zéro expression (appel vide)                                        |
| MemberExpression | exactement 3 enfants : objet, texte `"."`, `PropertyName` `"edges"` |
| Objet            | `parseShapeExpression` — donc un solide ou sketch déjà qualifié     |

Le genre renvoyé est celui de **l'objet**, pas une liste d'arêtes. `fillet` / `chamfer`
exigent ensuite `geometry === "solid"` (`:1011-1020`, `:1083-1092`) et produisent un
`solid`. L'expression `.edges()` n'existe pas comme valeur du système de genres.

Formes aujourd'hui prouvées (tests `:257-276`, `:342-361`) :

```python
fillet(base.edges(), radius=2)
fillet(base.edges(), radius=radius)
round_edges(Box(10, 10, 10).edges(), radius=2)   # alias
fillet((block - bore).edges(), radius=1)
chamfer(base.edges(), 2)                          # length positionnel
```

Formes volontairement non prouvées (commentaires `:957-964`, `:1031-1038` ; tests
`:410-496`) :

- `fillet(solid, r)` / `chamfer(solid, l)` positionnels
- `solid.fillet(...)` / `solid.chamfer(...)` (méthode)
- `fillet(..., length=)` / kwargs supplémentaires
- `chamfer(..., length=)` / `length2=` / `face=` / `angle=`
- `fillet(base.faces(), ...)` / `chamfer(base.faces(), ...)`
- `fillet(base.edges().filter_by(Axis.Z), radius=2)`
- `result = base.edges()` seul

Quand `parseFilletCall` / `parseChamferCall` renvoient `undefined`, l'affectation tombe
dans `addExpressionUnresolved` (`:400-405`, `:1455-1482`). Ce helper **promène tout le
sous-arbre** et étiquette **chaque** `MemberExpression` :

```
kind:    python-dynamic-attribute
message: Attribute and subscript lookup is not qualified in v1.
```

plus chaque `CallExpression` (`python-dynamic-call`). Ce n'est pas un rejet ciblé de
`filter_by` : c'est le verrou général sur tout attribut et tout indice.

Lezer encode attribut **et** indice dans le même nœud
(`node_modules/@lezer/python/src/python.grammar:189-201`) :

```
MemberExpression { expression !trail (subscript | "." PropertyName) }
subscript { "[" … "]" }
```

D'où le message « Attribute **and subscript** lookup ».
`solid.faces().sort_by(Axis.Z)[-1]` est donc **deux** `MemberExpression` (`.sort_by` et
`[-1]`) plus `Axis.Z`.

Pourquoi l'exception `.edges()` vide ne déclenche pas ce verrou : si `parseFilletCall`
réussit, `parseShapeExpression` retourne un `ShapeExpression` et
`addExpressionUnresolved` n'est jamais appelé sur ce RHS. Le `MemberExpression` est
consommé en silence, uniquement dans ce motif. Le commentaire le dit : « This does not
qualify general MemberExpression — only this empty `.edges()` inside a reviewed fillet
call » (`:962-964`).

Conséquence pour un `filter_by` aujourd'hui, sur le script testé `:474-476` :

```python
from build123d import Axis, Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges().filter_by(Axis.Z), radius=2)
```

1. Import `Axis` : `Axis` n'est pas dans `QUALIFIED_BUILD123D_CALLS` (`:84-102`) →
   `build123d-call-not-qualified` (« admitted by D4 but not qualified », `:255-258`).
2. Premier argument = `CallExpression` dont le callee est `MemberExpression`
   `.filter_by`, pas `.edges` → `parseEmptyEdgesSelector` échoue (`:1127`).
3. `parseFilletCall` échoue → `addExpressionUnresolved` étiquette `base.edges`,
   `.filter_by`, `Axis.Z` (`python-dynamic-attribute`) et les appels
   (`python-dynamic-call`).
4. `build123d-result-not-qualified`.

L'admission de ce script est donc `unresolved`, jamais `ready-for-review`. Le worker,
lui, exécuterait le Python sans difficulté : l'écart est uniquement le frontend.

### 1.2 Ce que D4 laisse passer

D4 (`src/domain/engineering/geometry-script-validation.ts`) est un garde de **portée**,
pas un parseur sémantique. Il tokenise, vérifie les imports nommés, interdit dunders /
noms dangereux / attributs d'I/O, et impose un unique `result` module-level. Il ne
restreint pas les constructions de langage (`:69-75`) : boucles, compréhensions,
attributs, indices restent admissibles.

`validateGeometryScript` ne fait que `tokenize` + `checkImports` +
`checkResultAssignment` (`:1189-1191`).

Conséquences concrètes pour les sélecteurs :

| Construct                                              | D4                                                                  | Frontend 1.3.0                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `.edges()` / `.faces()` / `.vertices()`                | admis (attribut hors `FORBIDDEN_ATTRIBUTES`, `:253-275`)            | seul `.edges()` vide sous fillet/chamfer                                |
| `.filter_by` / `.sort_by` / `.group_by`                | admis (même raison)                                                 | `python-dynamic-attribute`                                              |
| `[0]` / `[-1]` / `[-4:]`                               | `[]` est dans `ALLOWED_OPS` (`:444-445`)                            | `MemberExpression` → dynamic-attribute                                  |
| `from build123d import GeomType, Axis, SortBy, Select` | admis : les quatre sont dans `ALLOWED_BUILD123D_NAMES` (`:392-413`) | `build123d-call-not-qualified` (absents de `QUALIFIED_BUILD123D_CALLS`) |
| `GeomType.LINE`, `Axis.Z`, `SortBy.AREA`               | admis                                                               | dynamic-attribute                                                       |
| `lambda e: e.length == 2`                              | admis (D4 ne bannit pas `lambda`)                                   | appel / expression non qualifiée                                        |
| `from build123d import *`                              | **rejeté** (`forbidden_import`)                                     | n'atteint pas Lezer                                                     |
| `BuildPart` / `part.edges(Select.LAST)`                | `BuildPart` et `Select` sont dans D4                                | import + MemberExpression non qualifiés                                 |
| `shape.faces()[0].type`                                | test D4 vert (`geometry-script-validation_test.ts:719-725`)         | dynamic-attribute                                                       |

`FORBIDDEN_ATTRIBUTES` ne contient que des méthodes d'écriture / sérialisation (`save`,
`to_step`, `export_step`, …). Le commentaire prévient que la liste est incomplète par
construction (`:83-88`, `:246-251`). Ouvrir des attributs de sélection n'élargit pas la
surface I/O D4 ; ça n'ajoute pas non plus une preuve.

D4 admet donc déjà **toute** la grammaire visée par cette étude, plus `group_by`, les
lambdas, `Select`, le mode builder, et le script golden FEA
`fillet(part.edges().filter_by(Axis.Z).group_by(Axis.X)[-1], 5)`
(`scripts/gates/capture-fea-contract-golden.ts:139`) — script qui utilise en plus
`from build123d import *` et `BuildPart`, donc **hors** D4 nommé **et** hors frontend.

`role` dans `QUALIFIED_BUILD123D_CALLS` (`solid` / `sketch` / `placement` / `assembly` /
`transform`) n'est pas lu pour décider le genre. Seul `positionalArguments` sert, et
seulement dans `parsePositionalCall` (`:871-877`). Ajouter `Axis` / `GeomType` dans
cette table avec `positionalArguments: 0` ferait accepter `Axis()` et `GeomType()` comme
appels positionnels vides si un parseur les consommait — piège de table, pas de genre.

### 1.3 Genres actuels et schéma d'identité

Deux genres internes seulement :

```ts
type GeometryKind = "solid" | "sketch";
```

(`qualified-build123d-source-analyzer.ts:105`). Le type n'est **pas exporté**. Il
n'apparaît ni sur `SourceAnalysisSymbol` (`src/domain/analysis/source-analysis.ts:93-98`
: `kind` ∈ `artifact | parameter | variable | …`), ni dans le payload d'identité.

`astStableId` hashe (`:1597-1610`) :

```
schemaVersion: "build123d-ast-identity/1.0"
sourceId, prefix, discriminator, ast: canonicalAst(node)
```

`canonicalAst` est la forme `{ kind, text }` ou `{ kind, children }` (`:1613-1617`). Le
genre géométrique n'entre pas dans le digest. Changer l'union TypeScript `GeometryKind`
**ne change aucun id** des bundles déjà qualifiés.

Le corpus bit-identical 1.2/1.3 inclut déjà fillet et chamfer globaux
(`qualified-build123d-source-analyzer_test.ts:1252-1404`). Leurs ids sont ceux des nœuds
d'affectation `base` / `radius` / `result` et des dépendances, pas d'un symbole « edges
».

Ce qui **casse** si l'on ajoute un genre, ce n'est donc pas le schéma
`build123d-ast-identity/1.0`. C'est le **typage opérationnel** du parseur, aujourd'hui
écrit comme si tout `ShapeExpression` était assemblable.

| Site                                        | Comportement actuel                                                                                                                                                 | Effet d'un genre `edge-list` / `face-list` mal borné                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+` / `-` (`:714-723`)                      | même genre des deux côtés → le genre est conservé                                                                                                                   | `edges_a + edges_b` deviendrait une edge-list prouvée ; `faces - faces` aussi                                                                        |
| `Pos *` (`:763-771`)                        | préserve `shape.geometry`                                                                                                                                           | `Pos(...) * solid.edges()` deviendrait une edge-list placée                                                                                          |
| `Rot *` 1.3.0 (`:781-790`)                  | exige `solid`                                                                                                                                                       | rejet kind-mismatch — sûr par accident, jusqu'à 1.4.0 qui ouvre `Rot * sketch`                                                                       |
| `scale` / `fillet` / `chamfer` / `Compound` | testent `=== "solid"`                                                                                                                                               | restent sûrs                                                                                                                                         |
| `extrude`                                   | teste `=== "sketch"`                                                                                                                                                | reste sûr                                                                                                                                            |
| `result` (`:448-456`)                       | n'accepte que `solid` ; sinon kind-mismatch                                                                                                                         | `result = base.edges()` passerait de « unproven + dynamic-attribute » à « expects a solid, received an edge-list » — **changement de bundle public** |
| `addGeometryKindMismatch` (`:1678-1689`)    | interpolé `expects a ${expected}, received a ${received}`                                                                                                           | les messages restent bien formés                                                                                                                     |
| Catalogue d'admission                       | `requiredBindingSymbolKinds: ["artifact", "parameter"]` (`fixed-technical-compilation-profile-catalog-provider.ts:42`)                                              | une variable `edges = …` de genre edge-list **n'exigerait pas** de binding SysML                                                                     |
| Tests 1.3.0                                 | `result = base.edges()` doit rester non qualifié (`:478-481`) ; `fillet(Rectangle(...).edges(), …)` émet `fillet expects a solid, received a sketch` (`:1010-1014`) | si `.edges()` devient une expression de genre, le mismatch se déplace (sketch→edge-list, ou solid→edge-list puis fillet consomme l'edge-list)        |

Le genre n'est donc pas un champ d'identité ; c'est un **invariant de fermeture des
opérateurs**. L'ajouter sans restreindre `+` / `-` / `Pos *` aux seuls `solid | sketch`
ouvre des combinaisons que build123d n'interprète pas comme le frontend le croirait, et
change les unresolved des scripts déjà testés comme « attribut dynamique ».

Deux sous-dessins existent, même à genre ajouté :

- **Genre interne seulement** : le sélecteur n'est jamais une affectation ;
  `parseSelector` n'est appelé que comme 1er argument de `fillet` / `chamfer` (et plus
  tard d'une primitive FEA). Les opérateurs `+` / `Pos *` ne voient jamais une
  edge-list. Les bundles fillet/chamfer globaux restent bit-identical si les
  `parameterReferences` / `shapeReferences` collectés ne changent pas.
- **Genre first-class** : `edges = solid.edges().filter_by(...)` devient une `variable`.
  Utile pour FEA (nommer une face) et pour l'agent. Oblige à fermer `+` / `-` / `*` sur
  les nouveaux genres, et change le diagnostic de tout RHS qui est aujourd'hui un
  `.edges()` nu.

Changer `schemaVersion` en `build123d-ast-identity/1.1` casserait **tous** les ids, y
compris le corpus 1.2. Ce n'est pas nécessaire pour ajouter un genre.

---

## 2. Déterminisme — faits établis, incertitudes marquées

Ce paragraphe est partagé. Chaque option y renvoie.

### 2.1 Faits (code et doc build123d / worker Casys)

1. La documentation officielle dit qu'une `ShapeList` issue d'un sélecteur est «
   typically unordered », et que le tri est « a critical step when isolating individual
   features »
   ([Topology Selection](https://build123d.readthedocs.io/en/stable/topology_selection.html),
   section Sort).

2. `Shape.edges()` / `Shape.faces()` extraient via `entities()` → `_topods_entities` →
   `TopExp` OCCT, puis (pour les edges) retirent les arêtes dégénérées par
   `filter_by(lambda e: Degenerated, reverse=True)` (`shape_core.py` autour de
   `Shape.edges`, lu sur `gumyr/build123d` / `dev`). L'ordre restant est l'ordre
   d'exploration OCCT, moins les dégénérées.

3. `ShapeList.sort_by(Axis)` fait un `sorted(...)` Python dont la clé est la coordonnée
   Z du `Location(o.center())` ramené dans le repère inverse de l'axe (`shape_core.py`,
   `sort_by`, branche `isinstance(sort_by, Axis)`). `sorted` Python est **stable**
   (Timsort).

4. `ShapeList.filter_by(GeomType)` garde l'ordre d'entrée
   (`ShapeList(filter(predicate, self))`). `filter_by(Axis)` filtre par parallélisme
   (normale de face plane, ou tangente d'arête `GeomType.LINE`) avec tolérance `1e-5`
   par défaut. **Malgré** la docstring (« filter … and sort the results by the given
   axis »), le corps **ne trie pas**. Écart doc / code constaté sur `dev` ; non
   revérifié sur le tag `0.11.1` du worker.

5. `group_by(Axis)` arrondit la même projection de `center()` à `tol_digits=6`, puis
   `itertools.groupby(sorted(...))`. L'indice `[-1]` désigne le groupe de clé maximale,
   pas une entité unique.

6. `GeomType` est l'enum OCCT (`GeomAbs_Line` → `LINE`, etc. ; table `geom_LUT_EDGE` /
   `geom_LUT_FACE` dans `shape_core.py`). Membres : `PLANE`, `CYLINDER`, `CONE`,
   `SPHERE`, `TORUS`, `BEZIER`, `BSPLINE`, `REVOLUTION`, `EXTRUSION`, `OFFSET`, `LINE`,
   `CIRCLE`, `ELLIPSE`, `HYPERBOLA`, `PARABOLA`, `OTHER` (`build_enums.py`, classe
   `GeomType`).

7. `Select.ALL|LAST|NEW` n'est valide que sur un _builder_ (doc officielle : « Select as
   selector criteria is only valid for builder objects! »). Le subset actuel est en mode
   algébrique.

8. Le worker isole et pinne : `build123d==0.11.1`, `cadquery-ocp-novtk==7.9.3.1.1` /
   `OCP.__version__ == '7.9.3.1'`, `PYTHONHASHSEED=0`
   (`images/build123d-microsandbox-worker/Dockerfile:7-17,46` ; `requirements.lock`).
   Une exécution donnée, image donnée, source donnée, est donc reproductible **à image
   constante**. Ce n'est pas une garantie inter-versions OCCT / build123d.

9. Le fillet / chamfer **global** déjà qualifié applique l'opération à **l'ensemble**
   des arêtes. L'ordre d'exploration n'a pas d'effet observable sur le BRep (opération
   de ensemble). C'est pourquoi 1.3.0 peut qualifier `.edges()` vide sans trancher le
   déterminisme d'ordre.

10. La FEA actuelle ne désigne **pas** de faces topologiques du script CAD. Elle pose
    deux dalles AABB autour des faces ±Z d'une `Box` centrée
    (`scripts/gates/fea-provider-smoke-inputs.ts:17-56`). C'est déjà une stratégie «
    hors sélecteur ».

### 2.2 Incertitudes (non tranchées ici)

- OCCT ne documente pas `TopExp_Explorer` comme contrat d'ordre stable entre versions.
  Aucune expérience croisée 7.8 / 7.9 n'a été menée dans cette étude (consigne : pas de
  Docker, pas de sonde).
- Une opération booléenne ou un fillet peut **changer l'ensemble** des arêtes / faces,
  pas seulement l'ordre, lors d'un bump OCCT. Même `filter_by(GeomType.LINE)` peut alors
  sélectionner un ensemble différent.
- `o.center()` (clé de `sort_by` / `group_by`) dépend de l'implémentation `center()` de
  Face / Edge (masse, bounding box, géométrie). Le défaut exact n'a pas été relu pour
  chaque sous-classe dans cette étude.
- En cas d'**égalité de clé** (`sort_by(Axis.Z)` sur deux faces de même Z), le tri
  stable **laisse fuiter** l'ordre OCCT. `[-1]` n'est alors pas une désignation
  géométrique unique.
- `group_by` à `tol_digits=6` peut fusionner ou séparer des groupes selon des erreurs
  d'arrondi millimétriques après transformation.
- L'écart docstring / code de `filter_by(Axis)` sur `0.11.1` n'est pas confirmé. Si
  0.11.1 trie encore, `filter_by(Axis.Z)[-1]` deviendrait un extrême ; si 0.11.1 ne trie
  pas (comme `dev`), l'indice est un index d'explorateur.
- `filter_by(lambda …)` et `|` / `>` / `>>` sont hors grammaire demandée ; leur
  déterminisme n'est pas évalué.

Règle de sûreté déterministe, indépendante de l'option : un **indice** `[n]` / `[-1]`
n'est justifiable que derrière un `sort_by` (ou un `group_by`) dont la clé est unique
pour le solide considéré. Un `filter_by` seul désigne un **ensemble** ; fillet / chamfer
d'un ensemble est commutatif. Un `filter_by` + indice sans tri ne l'est pas.

---

## 3. Option A — chaînes énumérées fermées

### 3.1 Forme

L'agent écrit l'idiome build123d. Le frontend prouve une grammaire explicitement listée,
rien d'autre.

```
selector ::= shape "." ("edges" | "faces") "()"
           ( "." "filter_by" "(" enum-ref ")" )?
           ( "." "sort_by"   "(" enum-ref ")" )?
           ( "[" int "]" | "[" "-" int "]" )?
enum-ref ::= "GeomType" "." MEMBER | "Axis" "." ("X"|"Y"|"Z")
           | "SortBy" "." MEMBER
```

`shape` est un solide déjà qualifié (expression ou nom). Les enums sont des imports
nommés qualifiés (`from build123d import GeomType`, éventuellement `as`). Membres
`GeomType` / `SortBy` : table fermée, égale à l'enum 0.11.1 (voir §2.1.6 et
`SortBy.LENGTH|RADIUS|AREA|VOLUME|DISTANCE`). Pas de `Axis((0,0,0),(0,0,1))`, pas de
`Plane.XY`, pas de lambda, pas de `|` / `>` / `>>`, pas de `group_by`, pas de `Select`,
pas de `filter_by_position`, pas de slice `[-4:]` (un seul entier, y compris négatif).

Genres nouveaux : `edge-list` si la tête est `edges()`, `face-list` si `faces()`.
`fillet` / `chamfer` n'acceptent qu'une `edge-list`. Une future primitive FEA
n'accepterait qu'une `face-list` (ou un singleton issu d'un `sort_by` + indice).
`result` reste un `solid`.

Deux sous-portées, à trancher si A est retenue :

| Sous-portée                          | `edges = solid.edges()…`                    | Opérateurs `+` / `Pos *`                          |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------- |
| A1 — sélecteur seulement en argument | reste unresolved                            | jamais confrontés à une liste                     |
| A2 — liste first-class               | variable de genre `edge-list` / `face-list` | doivent être refusés explicitement sur ces genres |

A2 est le seul qui prépare proprement la désignation de faces FEA comme symbole
nommable. A1 suffit au congé sélectif.

### 3.2 Sûreté (surface d'attributs dynamiques)

A n'ouvre **pas** `MemberExpression` général. Elle ajoute un parseur de chaîne qui
consomme un motif fermé. Tout `MemberExpression` non consommé continue d'émettre
`python-dynamic-attribute` via `addExpressionUnresolved`.

Risques résiduels :

- **Fuite par préfixe.** Si `parseSelector` accepte
  `solid.edges().filter_by(GeomType.LINE)` puis ignore un suffixe (`.mapped(...)`,
  `[1:3]`, `.filter_by(lambda …)`), on qualifierait trop. Règle : la chaîne doit
  **être** le nœud, pas un préfixe.
- **Enum comme appel.** `GeomType` / `Axis` / `SortBy` ne doivent pas entrer dans
  `QUALIFIED_BUILD123D_CALLS` sous la forme actuelle (`positionalArguments`). Table
  séparée `QUALIFIED_BUILD123D_ENUMS`
  - parseur `parseEnumMember` (`MemberExpression` à 3 enfants : nom importé, `"."`,
    `PropertyName` ∈ table). `Axis()` et `GeomType.LINE.foo` restent unproven.
- **Callable.** `filter_by(lambda e: …)` et `sort_by(Face.area)` sont des
  `CallExpression` / `MemberExpression` hors motif → unresolved. À tester explicitement
  pour ne pas les avaler comme `enum-ref`.
- **Méthode sur le solide.** `solid.fillet(2)` reste unproven (déjà le cas).
- **D4.** Aucun élargissement. Les attributs ajoutés ne sont pas des I/O. `getattr`
  reste interdit.

A1 minimise la surface : le `MemberExpression` n'est légal que sous `fillet` / `chamfer`
(et plus tard une primitive FEA). A2 l'étend aux RHS d'affectation, donc à tout
opérateur qui appelle `parseShapeExpression`.

### 3.3 Déterminisme

A peut **encoder** la règle de §2 dans la grammaire :

- `edges()` / `faces()` seuls, ou `+ filter_by(GeomType|Axis)` sans indice → opération
  d'**ensemble**. Admissible pour fillet / chamfer. L'ordre n'importe pas. Un bump OCCT
  qui change _l'ensemble_ (plus ou moins d'arêtes `LINE`) reste un risque réel, non
  éliminé par le parseur ; il est borné par l'image pinnée.
- `+ sort_by(...) + [n]|[-1]` → désignation d'**un** élément. Le frontend peut exiger
  `sort_by` avant tout indice (sinon unresolved dédié, p.ex.
  `build123d-selector-index-without-sort`). L'unicité de clé n'est **pas** prouvable
  statiquement. Deux faces de même Z rendent `[-1]` dépendant de l'ordre OCCT (tri
  stable).
- `filter_by(Axis)` + indice **sans** `sort_by` : si 0.11.1 ne trie pas (comme `dev`),
  c'est un index d'explorateur. A doit soit l'interdire, soit exiger `sort_by` derrière.
- `group_by` (idiome du golden FEA) est hors de la grammaire A telle qu'énoncée.
  `filter_by(Axis.Z).group_by(Axis.X)[-1]` resterait unresolved. L'orchestrateur doit
  savoir que A telle quelle **ne couvre pas** le script golden actuel.

Incertitude assumée : A rend le déterminisme _auditable_ (on voit la chaîne), elle ne le
_prouve_ pas pour les singletons. Le worker pinne la reproductibilité intra-image, pas
l'identité topologique inter-versions.

### 3.4 Identité AST

Préservable pour le corpus 1.2/1.3 **si et seulement si** :

- `parseFilletCall` / `parseChamferCall` sur `.edges()` vide collectent les mêmes
  `parameterReferences` / `shapeReferences` dans le même ordre ;
- aucun symbole nouveau n'est émis pour le sélecteur interne ;
- `schemaVersion` reste `build123d-ast-identity/1.0` ;
- `addExpressionUnresolved` n'est toujours pas appelé sur un fillet global réussi.

A1 respecte ces quatre points : on remplace `parseEmptyEdgesSelector` par
`parseEdgeSelector` qui, sur le motif vide, se comporte comme aujourd'hui.

A2 crée des symboles `variable` pour `edges = …`. Les scripts nouveaux ont de nouveaux
ids (attendu). Un script déjà qualifié qui n'introduit pas de telle affectation reste
bit-identical.

Changer le diagnostic de `result = base.edges()` (dynamic-attribute → kind-mismatch)
**change** le bundle (unresolved ids, kinds). Ce n'est pas le corpus bit-identical (ces
scripts ont déjà des unresolved), mais c'est une incompatibilité de tests et de messages
agents.

### 3.5 Coût d'implémentation (mécanismes Lezer)

Pas de nouveau module obligatoire ; le RFC 1.4.0 a montré qu'un helper dans le même
fichier suffit. Ici les helpers sont plus nombreux :

| Helper                    | Nœuds Lezer                                                                                      | Rôle                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `parseEnumMember`         | `MemberExpression` 3 enfants                                                                     | import enum + membre ∈ table                          |
| `parseSelectorHead`       | `CallExpression` + `MemberExpression` `.edges`/`.faces` + ArgList vide                           | produit le genre liste                                |
| `parseFilterBy`           | `CallExpression` callee `.filter_by`, 1 arg `enum-ref`                                           | conserve le genre                                     |
| `parseSortBy`             | idem `.sort_by`                                                                                  | conserve le genre                                     |
| `parseSelectorIndex`      | `MemberExpression` dont le 2ᵉ enfant est `subscript` à **un** `Number` éventuellement unaire `-` | conserve le genre ; refuse les slices                 |
| `parseSelectorExpression` | enchaînement gauche, ordre imposé ou ordre libre borné                                           | A doit fixer si `sort_by` avant `filter_by` est légal |

Décisions de grammaire à figer avant code :

- ordre imposé (`filter_by` puis `sort_by` puis indice) vs permutations bornées ;
- `filter_by` / `sort_by` répétés (`filter_by(LINE).filter_by(Axis.Z)`) : un seul, ou N
  fermé ;
- `faces()` sous fillet : kind-mismatch (`fillet` attend `edge-list`) plutôt que
  dynamic-attribute.

Imports : table d'enums distincte, messages `build123d-call-not-qualified` retirés pour
`GeomType` / `Axis` / `SortBy` seulement. `Select` reste non qualifié (builder).

Tests : inverser le cas `:474-476` ; ajouter les formes A ; garder le corpus
bit-identical ; ajouter les refus (lambda, slice, `group_by`, `Select.LAST`, `Axis()` ,
`Plane.XY`, indice sans `sort_by`). Version d'analyseur : bump mineur (1.x.0) **si**
l'orchestrateur décide d'implémenter ; cette étude ne le numérote pas.

Worker / admission / D4 : inchangés. Le Python A s'exécute tel quel.

FEA : A ne désigne pas encore de faces dans un contrat CalculiX. Il prépare seulement
une `face-list` prouvable. Le pont AABB → face topologique est un chantier séparé
(contrat provider 0.4.0, NSET).

### 3.6 Expérience agent

Friction résiduelle basse pour un agent qui connaît build123d : il écrit l'idiome des
tutoriels. Friction haute sur les bords fermés : `group_by`, opérateurs `>`, lambda,
`Select.NEW`, `new_edges(...)` resteront des unresolved alors que D4 les admet — même
classe d'échec qu'aujourd'hui, messages à rendre dédiés
(`build123d-selector-not-qualified`) plutôt que `python-dynamic-attribute` générique,
sinon l'agent n'apprend pas la frontière.

A2 réduit la friction FEA (nommer `top = solid.faces().sort_by(Axis.Z)[-1]`). A1 force à
répéter la chaîne dans chaque appel.

### 3.7 Vision « agent libre de langage, compilation traçable »

A reste dans le contrat **implémenté** : l'agent écrit le langage d'exécution ; le
frontend _prouve_ ; l'exécuteur _rejoue les octets_. Ce n'est pas une compilation vers
un autre IR. La traçabilité est celle de l'analyse (symboles, unresolved, admission)
plus le pin d'image.

Par rapport à une vision où l'agent écrirait librement et un compilateur abaisserait : A
élargit la langue d'exécution, elle ne crée pas de lowering. L'agent n'est pas plus
libre hors du motif énuméré. L'avantage est l'absence de deuxième texte (pas de source
réécrite, pas de prelude).

---

## 4. Option B — vocabulaire déclaratif dédié

### 4.1 Forme

Aucun `MemberExpression` de sélection. Le subset gagne des appels plats, keywords
fermés, que l'**exécuteur** (pas l'analyseur) traduit vers des sélecteurs build123d.

Exemples de surface (illustratifs, à figer si B est retenue) :

```python
from build123d import Box, fillet, Axis
result = fillet(Box(10, 10, 10), radius=2, along=Axis.Z)

from build123d import Box, chamfer, GeomType
result = chamfer(Box(10, 10, 10), 1, geom=GeomType.LINE)

from build123d import Box, select_faces, Axis
top = select_faces(Box(10, 10, 10), normal=Axis.Z, extreme="max")
```

`select_faces` / `along=` / `geom=` / `extreme=` **n'existent pas** dans build123d
0.11.1. `fillet(solid, radius=)` positionnel-solide existe côté bibliothèque mais est
précisément le « Next AST lock » actuel (`:34-35`). B ne réutilise donc pas une forme
native déjà exécutable pour le cas sélectif.

Le genre reste `solid | sketch`. Une face FEA serait un solide de travail, un
identifiant de binding, ou un nouveau symbole hors genre géométrique — pas une
`face-list` dans `parseShapeExpression`.

### 4.2 Sûreté

C'est l'option qui **garde le verrou** `MemberExpression` le plus intacte.
`addExpressionUnresolved` continue de tout étiqueter. `parseEmptyEdgesSelector` peut
même rester l'unique exception, ou être remplacée par `fillet(solid, radius=)` (forme
positionnelle solide, aujourd'hui unproven) + keywords nouveaux.

Risques :

- **`Axis.Z` est encore un `MemberExpression`.** B n'échappe au verrou que si les enums
  deviennent des chaînes (`along="Z"`, `geom="LINE"`) ou si B ouvre le _même_
  `parseEnumMember` que A, mais limité aux arguments de mots-clés. Ouvrir
  `parseEnumMember` est une fente MemberExpression, plus étroite qu'une chaîne
  `.edges().filter_by`.
- **Collision avec l'API réelle.** Qualifier `fillet(solid, radius=2,
  along=Axis.Z)`
  alors que build123d 0.11.1 ignore ou refuse `along=` ferait admettre un script que
  `exec` casse — sauf si un lowering réécrit avant exec. B **implique** donc une étape
  d'autorité nouvelle (voir §4.5).
- **Prelude injecté.** Si l'exécuteur définit `select_faces` dans le namespace avant
  `exec`, la surface runtime n'est plus « le script admis ». Il faut attester le prelude
  (empreinte, version) dans le profil d'exécution. Aujourd'hui le namespace enfant est
  vide hormis `__name__` / `__file__` / `__package__`
  (`execute-build123d-child.py:107-111`) ; `export_step` est importé par le child, pas
  par le script.
- **Lambda / getattr.** Toujours fermés. B ne les approche pas.

D4 : si B ajoute des noms (`select_faces`), ils doivent entrer dans
`ALLOWED_BUILD123D_NAMES` **ou** ne jamais apparaître comme identifiants libres
(uniquement fournis par le prelude — alors D4 devrait les interdire en import). C'est un
toucher D4, interdit aux lots 1.4–1.6, licite seulement si l'orchestrateur ouvre D4 pour
B.

### 4.3 Déterminisme

Le déterminisme se joue au **lowering**, pas à l'AST source.

- `along=Axis.Z` peut se compiler en `solid.edges().filter_by(Axis.Z)` (ensemble,
  ordre-indépendant) plutôt qu'en `…sort_by(Axis.Z)[-1]` (singleton). Le serveur
  choisit. C'est un avantage : on peut refuser de lower vers un indice sans clé unique.
- `extreme="max"` + `normal=Axis.Z` se compile en `faces().sort_by(Axis.Z)[-1]`. Même
  limite d'unicité de clé qu'en A, mais centralisée dans le compilateur, testable une
  fois, documentée une fois.
- Un bump OCCT reste un risque d'ensemble / de clé. B ne le supprime pas. Elle peut en
  revanche **versionner le lowering** (`along=Z` v1 = filter ensemble ; v2 = sort+index)
  sans changer les scripts agents.

Incertitude identique à A sur `center()`, égalités, versions OCCT. Incertitude
**supplémentaire** : le lowering doit être bit-stable (mêmes octets Python produits pour
les mêmes keywords) pour que l'image worker reste le seul autre degré de liberté.
Aujourd'hui il n'y a pas d'IR de lowering CAD.

### 4.4 Identité AST

Les scripts **déjà** qualifiés ne portent aucun keyword nouveau. Si B n'altère pas
`parseFilletCall` du motif `.edges()` vide, le corpus 1.2/1.3 reste bit-identical.

Si B **remplace** le motif `.edges()` par `fillet(solid, radius=)` (forme positionnelle
solide), deux chemins :

- on garde l'ancien motif **et** on ajoute le nouveau → corpus inchangé, deux façons de
  dire « toutes les arêtes » ;
- on abandonne `.edges()` → les scripts fillet/chamfer du corpus deviennent unresolved,
  les ids `result` changent, la garantie bit-identical est **rompue**.

`schemaVersion` inchangé. Pas de genre nouveau → pas de piège `+` / `Pos *`.

Les scripts B nouveaux ont des ids nouveaux (attendu). Si le lowering produit un
deuxième texte, ce texte n'entre dans `build123d-ast-identity/1.0` que s'il est analysé
à son tour. Sinon l'identité pointe vers le dialecte, et l'exécutable n'a pas d'analyse
propre — trou de traçabilité.

### 4.5 Coût d'implémentation

Deux chantiers, pas un.

**Frontend (Lezer, même fichier possible) :**

- keywords fermés sur `fillet` / `chamfer` (`along=`, `geom=`, `extreme=`) ou nouveaux
  callees (`select_faces`, `select_edges`) ;
- éventuellement `parseEnumMember` pour `Axis.Z` / `GeomType.LINE`, ou littéraux chaîne
  dans une table ;
- `fillet` à 1 positionnel solide + `radius=` (forme lockée aujourd'hui) si on unifie «
  toutes les arêtes » et « arêtes filtrées » ;
- pas de marcheur de chaînes, pas de `subscript`.

C'est **moins** de Lezer qu'A.

**Exécution (nouveau, lourd) :**

Le contrat actuel — mêmes octets admis, `compile` + `exec` dans un namespace vide — ne
peut pas exécuter `along=` ni `select_faces`. Trois mécanismes possibles, tous hors de
l'analyseur :

| Mécanisme                                                                          | Autorité                                                                             | Impact                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| B1. Lowering avant l'image : l'admission projette un `sourceText` build123d dérivé | viole « never rewritten » ; l'admission devrait hasher **les deux** textes           | change `technical-compilation` + MRTR execute     |
| B2. Prelude versionné injecté dans le namespace child                              | le profil d'exécution atteste le prelude ; le script agent n'est plus auto-suffisant | change `execute-build123d-child.py` + image + pin |
| B3. Cible de compilation distincte (`build123d-dialect` → `build123d-source`)      | fidèle à « compilation traçable » ; deux profils                                     | nouveau profil catalogue, double analyse          |

B3 est le seul qui sépare clairement « langage agent » et « langage d'exécution » sans
mentir sur les octets. Il est aussi le plus cher (catalogue, double frontend ou un
backend de lowering pur, MRTR, relecture).

D4 : B2/B3 avec noms nouveaux touchent `ALLOWED_BUILD123D_NAMES`. B1 peut générer
uniquement du vocabulaire déjà D4-admis (`fillet`, `edges`, `filter_by`, `GeomType`) —
le script agent, lui, resterait illégal D4 s'il invente `select_faces`, sauf
élargissement.

Worker image : B2 change l'image (rebuild, labels, gate
`verify-build123d-microsandbox-worker`). B1/B3 peuvent garder l'image si le texte
exécuté est du build123d 0.11.1.

FEA : `select_faces(..., extreme="max")` peut devenir le contrat de désignation, abaissé
soit vers une face topologique (CalculiX NSET — **non** supporté par le provider actuel,
qui veut des boîtes) soit vers une AABB dérivée du `center()` / `BoundBox` de la face.
Le deuxième chemin évite de changer CalculiX ; il rapproche B de C côté physique.

### 4.6 Expérience agent

Friction **nouvelle** : l'agent formé sur build123d (tutoriels, gist, PyPI) écrira
`.edges().filter_by(...)` et recevra `python-dynamic-attribute`. Il doit apprendre un
dialecte Casys. C'est l'inverse de « No Verb Overlap » si `fillet` natif et
`fillet(...,
along=)` coexistent avec des sémantiques différentes.

Friction **réduite** sur le déterminisme : l'agent n'a pas à se souvenir que `[-1]` sans
`sort_by` est interdit ; le keyword `extreme=` porte l'intention.

Messages : B peut émettre des kinds dédiés (`build123d-fillet-selector-unknown-axis`) au
lieu d'un attribut dynamique. Meilleur AX, à condition que le vocabulaire soit minuscule
et sans alias (`along` XOR `direction` XOR `axis` — un seul).

### 4.7 Vision « agent libre de langage, compilation traçable »

B est la seule option qui **incarne** cette vision côté CAD : l'agent écrit une
intention fermée ; le serveur possède le lowering ; le texte exécuté est une projection
attestée. Elle **contredit** le contrat _actuel_ « the source text is never regenerated
or rewritten » sauf à introduire explicitement une deuxième source.

« Libre de langage » n'est pas « libre de grammaire » : B est un dialecte plus petit que
build123d, pas un Python ouvert. La liberté visée est celle de ne pas coller à l'AST
OCCT. La traçabilité exige que le lowering soit une pièce d'autorité (profil, empreinte,
tests de bit-stabilité), pas un pretty-print opportuniste dans l'exécuteur.

---

## 5. Option C — statu quo étendu (primitives composées)

### 5.1 Forme

Aucune grammaire nouvelle. L'agent obtient un congé / une face sélectifs en
**concevant** autrement :

- congé global déjà qualifié : `fillet(solid.edges(), radius=r)` ;
- congé « sélectif » : décomposer le solide en plusieurs solides dont **toutes** les
  arêtes doivent être congéées, fillet de chacun, `+` / `Compound` pour réassembler ;
- arêtes à ne pas congéer = elles n'existent que sur un solide non passé à `fillet` ;
- faces FEA = dalles AABB déjà en production (`centeredBoxZFaceSelectionBoxes`),
  éventuellement généralisées à d'autres primitives dont le BoundBox est connu
  statiquement.

Pas de `.faces()`, pas de `filter_by`, pas de genre nouveau, pas de D4, pas de worker.

### 5.2 Sûreté

Surface d'attributs : **inchangée**. Le verrou `MemberExpression` reste la ligne de
défense. Aucun enum à importer. Aucun risque de qualifier un `getattr` déguisé.

Risque déplacé vers le **modèle** :

- L'union de solides filletés séparément n'est pas le fillet d'un sous-ensemble d'arêtes
  d'un solide unique. Les arêtes de couture (`+` / `fuse`) peuvent apparaître,
  disparaître, ou recevoir un congé non voulu.
- `Compound(children=[...])` ne fuse pas : les pièces restent disjointes. Un fillet «
  sélectif » par Compound n'est pas un solides manifold unique. La FEA sur un Compound
  n'est pas la FEA sur un Solid.
- L'agent peut être tenté de « tricher » avec des scripts D4-admis (`filter_by`,
  `BuildPart`) que le frontend laissera unresolved — donc non admets. La sûreté
  d'admission tient. La sûreté de _design_ dépend de l'agent.

### 5.3 Déterminisme

Le fillet global reste une opération d'ensemble, déterministe à image constante,
indépendante de l'ordre OCCT.

La décomposition + union **dépend** des booléens OCCT. C'est le même noyau dont l'ordre
d'exploration est non contractuel, plus les changements d'algorithme de fuse/cut entre
versions. C n'évite pas OCCT ; elle l'utilise sur une autre face (booléens plutôt que
sélecteurs).

La désignation FEA par AABB est déterministe **si** le solide est une primitive alignée
dont le centre et les dimensions sont des paramètres du script. Elle cesse de l'être (ou
devient ambiguë) dès qu'une rotation, un booléen ou un fillet déplace la face hors de la
dalle, ou qu'une deuxième face entre dans la dalle. Le test
`centered-box face selections reject dimensions or margins that can
overlap`
(`fea-provider-smoke-inputs_test.ts:38-48`) montre que même cette stratégie a besoin de
garde-fous géométriques.

Incertitude : personne n'a, dans cette étude, comparé le BRep d'un
`fillet(edges().filter_by(LINE))` à celui d'une décomposition + fillet + fuse sur le
même intent. Ce sont des solides potentiellement **non équivalents**.

### 5.4 Identité AST

Bit-identical préservé au sens fort : **zéro** changement d'analyseur, de schéma, de
corpus, de messages. Les scripts plus longs de l'agent sont de nouveaux sources, donc de
nouveaux ids — c'est déjà le cas pour tout nouveau CAD.

Pas de genre nouveau, pas de piège `+` / `Pos *`.

### 5.5 Coût d'implémentation

Zéro mécanisme Lezer, zéro D4, zéro worker, zéro catalogue. Coût éventuel :
documentation agent / skill (`guide-industrial-project` ou une page Diátaxis) décrivant
les recettes de décomposition et les limites AABB. Ce n'est pas un changement de
frontend.

Coût caché : chaque produit un peu moins trivial (boîte percée, congés d'une seule arête
d'un Wedge, face cylindrique chargée) force soit un redécoupage CAD, soit un
élargissement _ad hoc_ des boîtes FEA. Ce coût se paie à chaque projet, pas une fois
dans l'analyseur.

### 5.6 Expérience agent

Friction **maximale** sur l'intent « congé ces arêtes-là ». L'agent doit inventer une
construction équivalente, souvent plus longue, parfois impossible sans changer la
topologie (une seule arête d'un cube : découper le cube pour isoler l'arête détruit le
cube).

Friction **nulle** sur l'outillage : tout ce qui est qualifié aujourd'hui le reste ; les
messages d'échec restent ceux qu'il connaît (`python-dynamic-attribute`,
`build123d-call-not-qualified` pour `Axis`).

Pour la FEA d'une Box axis-alignée, C est déjà l'expérience réelle et elle fonctionne.
Pour une face quelconque après booléens, C demande à l'agent de calculer une dalle qui
n'intersecte qu'une face — ce que le provider 0.4.0 exige déjà (« rejects a box that
intersects only part of a face », commentaire `fea-provider-smoke-inputs.ts:21-23`).
C'est de la géométrie inverse, pas de la désignation.

### 5.7 Vision « agent libre de langage, compilation traçable »

C n'avance pas cette vision. L'agent n'est pas plus libre : il est contraint deux fois
(sous-ensemble fermé + astuces de modelage). Il n'y a pas de compilation d'intention,
seulement de la composition déjà qualifiée.

C est compatible avec le contrat _actuel_ au sens le plus strict : octets = langage
d'exécution = langage d'agent. Elle reporte le problème de sélection sur le design, là
où l'orchestrateur a dit que l'humain ne doit pas écrire les payloads — donc sur
l'agent, sans nouveau vocabulaire pour exprimer l'intent.

---

## 6. Lecture transversale (sans classement)

Même axes, faits seulement.

| Axe                                                               | A — chaînes énumérées                                                   | B — vocabulaire dédié                                           | C — statu quo étendu                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Surface MemberExpression                                          | fente bornée (chaîne + enums)                                           | fente minimale (enums ou chaînes)                               | aucune nouvelle                                              |
| Exécution des octets admis                                        | oui, Python natif                                                       | non, sauf lowering / prelude / 2ᵉ cible                         | oui                                                          |
| D4                                                                | inchangé                                                                | probablement touché si nouveaux noms                            | inchangé                                                     |
| Genre                                                             | `edge-list` / `face-list` (A1 interne ou A2 first-class)                | inchangé                                                        | inchangé                                                     |
| Identité corpus 1.2/1.3                                           | préservable (A1, parseur étendu sans nouveaux symboles)                 | préservable si `.edges()` vide est conservé                     | préservée par construction                                   |
| Déterminisme ensemble (fillet de toutes les LINE)                 | oui, à ensemble OCCT constant                                           | oui, si le lowering choisit filter et non index                 | oui pour fillet global ; non garanti pour décomposition+fuse |
| Déterminisme singleton (`[-1]`, `extreme=max`)                    | auditable, pas prouvé (ties → ordre OCCT)                               | même limite, centralisée dans le lowering                       | n/a (AABB, autre contrat)                                    |
| Couverture du golden FEA `filter_by(Axis.Z).group_by(Axis.X)[-1]` | hors grammaire A telle qu'énoncée                                       | exprimable par keywords dédiés _si_ on les ajoute               | contournable seulement par autre géométrie                   |
| Pont FEA actuel (dalles AABB)                                     | non branché ; A prépare une face-list                                   | branchable si lowering → AABB ou si CalculiX gagne un NSET topo | déjà en production pour Box centrée                          |
| Coût Lezer                                                        | élevé (marcheur de chaîne, subscript, enums, genres, fermeture `+`/`*`) | moyen (keywords / nouveaux callees)                             | zéro                                                         |
| Coût exécuteur / admission / image                                | zéro                                                                    | élevé (B1/B2/B3)                                                | zéro                                                         |
| Friction agent build123d-natif                                    | basse dans le motif, haute hors motif                                   | haute (dialecte Casys)                                          | très haute sur l'intent sélectif                             |
| Vision lowering traçable                                          | n'en crée pas                                                           | seule à en créer vraiment                                       | n'en crée pas                                                |
| Conformité « source never rewritten »                             | oui                                                                     | non (B1) / partielle (B2) / oui au prix d'une 2ᵉ source (B3)    | oui                                                          |

---

## 7. Questions pour l'orchestrateur (pas des réponses)

1. **Le contrat d'octets est-il intangible ?** Si oui, B1 est hors jeu et B2/B3
   deviennent le seul chemin déclaratif. Si non, B devient une vraie compilation CAD, à
   concevoir comme telle (profil, double empreinte, MRTR).

2. **Le congé sélectif est-il une opération d'ensemble (`filter_by(GeomType.LINE)` sur
   toutes les LINE) ou une désignation d'arêtes individuelles (`sort_by` + indice) ?**
   Les deux n'ont pas le même budget déterministe. A peut autoriser le premier et
   refuser le second dans une première vague.

3. **A1 ou A2 ?** A1 évite de toucher `+` / `Pos *` et préserve les diagnostics de
   `.edges()` nu. A2 est le prérequis propre pour nommer une face FEA dans le même
   système de genres.

4. **`group_by` et le golden FEA sont-ils dans le chantier, ou un lot ultérieur ?** A
   telle qu'énoncée ne les couvre pas. Les rouvrir, c'est encore une fente
   MemberExpression + `GroupBy[-1]` (indice sur une liste de groupes, pas sur des
   shapes).

5. **La FEA doit-elle rester AABB**, ou vise-t-on une désignation topologique qui
   n'existe pas encore côté CalculiX 0.4.0 ? Sans changement provider, A/B « faces » ne
   débouchent pas sur un NSET plus fidèle que C.

6. **Un bump d'analyseur qui change les unresolved de scripts déjà testés comme «
   attribut dynamique » est-il acceptable** (hors corpus bit-identical vide) ? A2 le
   fera. A1 et B (sans retirer `.edges()` vide) non.

7. **Faut-il confirmer `filter_by(Axis)` sur le tag 0.11.1** (tri ou non) avant toute
   grammaire qui autoriserait `filter_by(Axis.Z)[-1]` ? Cette étude n'a pas exécuté le
   worker.

Cette étude s'arrête ici. Pas de lot, pas de version, pas d'option retenue.
