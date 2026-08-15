> **Status: ACCEPTED DIRECTION — the family roadmap.** Engineering plan for the
> closed-language compilation of build123d 0.11.1 (see
> [closed-language compilation](../explanations/closed-language-compilation.md)):
> inventory triage 146/69/258, closed Python-CAD host core, generated tables,
> determinism classes, six delivery families F1–F6 (12 % → 100 % of the writing
> surface), corpus metric. Families supersede the idiom-by-idiom "Next AST lock" method.

# Plan d’ingénierie — compilation totale de build123d 0.11.1

Date : 2026-08-15. Directive produit : build123d est un langage FINI, on peut le
compiler à 100 %. La stratégie des micro-lots idiome-par-idiome (1.4.0 / 1.5.0 / Next
AST lock) est remplacée par la compilation totale comme cible.

Ce document est un plan d’ingénierie, pas un brief de session. Il ne modifie aucun
source du dépôt. Aucune sonde d’exécution n’a été lancée.

## 0. Cadre — ce que « 100 % » veut dire

Le frontend (`build123d-qualified-lezer` **1.5.0**) n’exécute pas Python et n’importe
pas build123d. Il applique D4 puis prouvé un sous-ensemble AST. Ce que D4 admet et que
le frontend ne peut pas prouvér reste un `unresolvedConstruct` explicite
(`src/adapters/analyzers/qualified-build123d-source-analyzer.ts`).

L’admission (`technical-compilation/1.0`) refuse `ready-for-review` dès qu’un unresolved
est présent. L’exécuteur isolé relit **les mêmes octets** et les `exec` tels quels
(`images/build123d-microsandbox-worker/execute-build123d-child.py:106-119`). Aucune
réécriture de source.

**Équation du langage fini :**

```
build123d 0.11.1 fini  ×  Python-CAD fini  =  langage compilable à 100 %
```

- **build123d fini** = catégorie (1) de l’inventaire (146 noms d’écriture)
  - fermeture des types (2) dans le système de genres (y compris les **méthodes** de ces
    types, absentes des 473 noms de module).
- **Python-CAD fini** = la liste close de constructs Python du §B.
- **100 % opérable** = le corpus du §F compile avec `unresolvedConstructs === []` et
  `policy.status === "passed"`. Ce n’est **pas** « 473/473 noms de dir(build123d) ».

Image pannée, vérité d’API : `build123d==0.11.1`, `cadquery-ocp-novtk==7.9.3.1.1` /
`OCP.__version__ == "7.9.3.1"`, `PYTHONHASHSEED=0`
(`images/build123d-microsandbox-worker/Dockerfile:7-17,46`).

Inventaire source : 473 noms publics extraits de cette image
(`build123d-api-inventory.json`, `version: "0.11.1"`). Répartition brute : 224 `class`,
100 `function`, 43 `enum`, 106 `value`.

---

## A. Tri de l’inventaire (473 noms)

Règle de tri, appliquee nom par nom contre l’inventaire (pas contre D4, pas contre la
table 1.5.0).

Le 100 % a viser = (1) + fermeture de (2). La catégorie (3) n entre pas dans le
numerateur. Les fonctions math (sin/cos/sqrt) sont en (3) comme fuite de module ; le
noyau Python-CAD du §B les admet via `from math`.

### A.1 Comptes

| Catégorie            |    Noms | class | function | enum | value | % des 473 |
| -------------------- | ------: | ----: | -------: | ---: | ----: | --------: |
| (1) Écriture CAD     | **146** |    77 |       34 |   24 |    11 |    30,9 % |
| (2) Types / retours  |  **69** |    28 |       16 |    0 |    25 |    14,6 % |
| (3) Hors-périmètre   | **258** |   119 |       50 |   19 |    70 |    54,5 % |
| **Total’inventaire** | **473** |   224 |      100 |   43 |   106 |     100 % |

Couverture actuelle 1.5.0 dans (1) : 17 constructeurs/ops de `QUALIFIED_BUILD123D_CALLS`
présents dans l’inventaire (Box Cylinder Cone Sphere Torus Wedge Rectangle Circle
Ellipse RegularPolygon Pos Rot Compound scale fillet chamfer extrude) + la constante
`pi` (via from math import pi). **18 / 146 = 12 %** de la surface (1).

`Ellipsoid` est dans la table 1.5.0 et dans D4, **absent** de l’inventaire 0.11.1. Ce
n’est pas une primitive de l’image pannée.

### A.2 Catégorie (1) — 146 noms, sous-familles

Listes nominatives, toutes présentes dans l’inventaire (vérifié).

**Primitives 3D (10)** — `Box` `Cylinder` `Cone` `Sphere` `Torus` `Wedge`
`ConvexPolyhedron` `Hole` `CounterBoreHole` `CounterSinkHole`.

**Sketches 2D (13)** — `Rectangle` `RectangleRounded` `Circle` `Ellipse`
`RegularPolygon` `Polygon` `Trapezoid` `Triangle` `SlotArc` `SlotCenterPoint`
`SlotCenterToCenter` `SlotOverall` `Text`.

**Courbes 1D (29)** — `Line` `Polyline` `PolarLine` `FilletPolyline` `Bezier` `BSpline`
`Spline` `Helix` `Airfoil` `CenterArc` `RadiusArc` `SagittaArc` `TangentArc`
`ThreePointArc` `JernArc` `DoubleTangentArc` `IntersectingLine` `EllipticalCenterArc`
`EllipticalStartArc` `HyperbolicCenterArc` `ParabolicCenterArc` `PointArcTangentArc`
`PointArcTangentLine` `ArcArcTangentArc` `ArcArcTangentLine` `BlendCurve`
`ConstrainedArcs` `ConstrainedLines` `ConvexHull`.

**Placements / frames (7)** — `Pos` `Rot` `Location` `Rotation` `Plane` `Axis` `Vector`.
**Patterns (4)** — `Locations` `GridLocations` `HexLocations` `PolarLocations`.
**Builders (4)** — `BuildPart` `BuildSketch` `BuildLine` `Builder`. **Combinateurs
ecrits (4)** — `Compound` `Part` `Sketch` `Curve`. **Joints (6)** — `Joint` `BallJoint`
`CylindricalJoint` `LinearJoint` `RevoluteJoint` `RigidJoint`.

**Opérations (24)** — `add` `fillet` `chamfer` `extrude` `revolve` `loft` `sweep`
`scale` `mirror` `offset` `split` `project` `thicken` `section` `draft` `make_face`
`make_hull` `make_brake_formed` `full_round` `trace` `pack` `new_edges` `polar`
`project_workplane`.

**Sélecteurs libres / pending builder (10)** — `edges` `faces` `wires` `vertices`
`solids` `edge` `face` `wire` `vertex` `solid`. Signatures inventaire :
`(self, select: Select = ALL) -> ShapeList[T]` ou singleton. En algébrique ce sont des
méthodes ; en builder aussi des noms libres. Les deux formes sont de l écriture.

**Enums d écriture (24)** — `Align` `AngularDirection` `CenterOf` `GeomType` `Kind`
`Keep` `LengthMode` `Mode` `PositionMode` `Select` `Side` `SortBy` `Until` `Transition`
`Sagitta` `FontStyle` `TextAlign` `FrameMethod` `ApproxOption` `ContinuityLevel`
`Tangency` `Unit` `Extrinsic` `Intrinsic`.

**Constantes d écriture (11)** — `pi` `MM` `CM` `M` `IN` `FT` `MC` `THOU` `DEG2RAD`
`RAD2DEG` `inf`.

### A.3 Catégorie (2) — 69 noms, fermeture de genres

On ne les instancie pas comme primitives. On les recoit. Le systeme de genres du §C doit
les nommer, sinon les chaînes `solid.faces().sort_by(Axis.Z)[-1]` n ont pas de type.

**Topologie / collections (9 classes)** — `Shape` `Solid` `Shell` `Face` `Edge` `Wire`
`Vertex` `ShapeList` `GroupBy`.

**Geometrie / contextes internes (19 classes)** — `BoundBox` `OrientedBoundBox` `Matrix`
`Vec2` `GeomEncoder` `LocationEncoder` `LocationList` `WorkplaneList` `AxisMeta`
`PlaneMeta` `SkipClean` `Voronoi` `BasePartObject` `BaseSketchObject` `BaseCurveObject`
`BaseLineObject` `BaseEdgeObject` `DraftAngleError` `NotAllLocationLikeError`.

**Helpers de requete (16 fonctions)** — `bounding_box` `find_max_dimension`
`edges_to_wires` `sort_wires_by_build_order` `all_location_like` `flatten_sequence`
`tuplify` `to_align_offset` `topo_distance_to` `topo_explore_common_vertex`
`topo_explore_connected_edges` `topo_explore_connected_faces` `isclose_b` `delta`
`unique` `unit_conversion_scale`.

**Alias de signatures (25 values)** — `AddType` `Align2D` `Align3D` `ChamferFilletType`
`ColorLike` `MirrorType` `OffsetType` `PathDescriptor` `PathSegment` `PointLike`
`ProjectType` `RotationLike` `ShapeT` `SplitType` `SweepType` `VectorLike` `B` `T` `T2`
`GEOM_KEY_DIGITS` `TOL` `TOLERANCE` `TOL_DIGITS` `UNITS_PER_METER` `CLASS_REGISTRY`.

`Color` / `RGB` / `ColorAndLabel` sont du display → catégorie (3).

### A.4 Catégorie (3) — 258 noms, hors-périmètre motivé

| Motif                 | Exemples                                                                                                       | Pourquoi                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| I/O                   | `export_*` `import_*` `ExportDXF` `ExportSVG` `Mesher` `os` `sys` `Path` `webbrowser` `requests`               | Deja interdit D4. Le worker exporte sous chemins serveur. |
| OCC/OCP fuite         | `BRep*` `Geom_*` `gp_*` `TopoDS_*` `XCAF*` `STEP*` `HLR*`                                                      | Binding C++. Un agent n ecrit pas `gp_Trsf`.              |
| Viewer / mise en plan | `Drawing` `TechnicalDrawing` `DimensionLine` `Arrow` `Draft` (classe ; la fonction `draft` est en (1)) `Color` | Sortie graphique, pas solide canonique.                   |

| Modules internes | `build_common` `objects_*` `opérations_*` `topology` `geometry`
`joints` `math` `np` | Pas des constructeurs. | | Typage / stdlib | `ABC` `Any`
`Callable` `ClassVar` `dataclass` `cast` `datetime` | Fuites d inspect. | | Math
reexportée | `sin` `cos` `tan` `sqrt` `atan2` `degrees` `radians` | Le §B les admet via
`from math import`. | | Enums OCC / dessin | `LineType` `PageSize` `MeshType` `TopAbs_*`
`Enum` `IntEnum` | Pas de l écriture solide. |

**Phantoms D4** (dans D4, absents de l’inventaire 0.11.1) : `Ellipsoid` `subtract`
`intersect` `shell` `Mirror` `Scale` `Offset2D` `LinearLocations` `RotationMode` `Arc`
(10). D4 a 72 noms (`geometry-script-validation.ts:331-414`).

### A.5 Trou structurel : les 473 noms ne sont pas la surface de méthodes

`filter_by`, `sort_by`, `group_by`, `.part`, `Plane.XY`, `Axis.Z`, `Align.MIN`,
`.moved`, `.locate` n apparaissent pas dans l’inventaire module. Ce sont des attributs /
méthodes des types (2).

Sans un **second extract** (méthodes publiques des types (2)), le 100 % est un mensonge
: `examples/bracket/bracket.py:12` est illisible. Ce second inventaire est un livrable
du §C.

### A.6 Drift D4 vs inventaire

| Sens                                        | Noms                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dans D4, absent de 0.11.1                   | 10 phantoms ci-dessus                                                                                                                                                                       |
| Dans (1), absent de D4 (extrait)            | `Locations` `Hole` `CounterBoreHole` `CounterSinkHole` `split` `Text` `RectangleRounded` `Trapezoid` `Triangle` `Slot*` `Helix` `Keep` `Side` `Builder` `Curve` `Joint*` `new_edges` `pack` |
| Dans la table 1.5.0, absent de l’inventaire | `Ellipsoid`                                                                                                                                                                                 |

Consequence : élargir le frontend sans synchroniser D4 laisse une partie de (1) rejetee
avant Lezer. Chaque famille qui a besoin d un nom hors allowlist embarque un commit D4
dedie (§G, §E).

---

## B. Noyau Python-CAD fermé

D4 ne restreint pas les constructions de langage (`geometry-script-validation.ts:69-75`)
: `for`, `with`, `lambda`, comprehensions, attributs, indices passent le tokenizer. Le
frontend 1.5.0 les étiquette (`addTopLevelUnresolved` / `addExpressionUnresolved`,
`:1732-1793`). Le 100 % est vrai seulement si chaque construct ci-dessous a une règle de
fermeture. Tout le reste de Python reste unresolved nomme.

| #  | Construct                           | Règle de fermeture                                                                                                                                        | Risque                                                                 |
| -- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| B1 | `from build123d import Name [as a]` | Name dans allowlist D4 synchro (1)+(2 utiles). Alias local unique.                                                                                        | Deux alias du même import → `build123d-import-ambiguous` (déjà 1.5.0). |
| B2 | `from build123d import *`           | Equivalent a lier l **allowlist D4**, pas `module.__all__` (473). Noms hors table : unresolved a l usage, pas a l import.                                 | Sans B2 le corpus officiel et bracket.py restent a 0 %. Voir §G.       |
| B3 | `from math import {allowlist}`      | Scalaires pi/e/tau déjà 1.5.0. Appels sin/cos/sqrt : arity 1 (2 pour atan2/pow), argument scalaire, retour scalaire. Pas de symbole math dans l identite. | `from math import (pi)` parenthese : 1.5.0 non parse ; a ouvrir.       |

| B4 | Affectation simple `n = expr` | Unique, module-level ou locale au with builder,
pas de shadow d import. Genre herite. | Reaffectation → `python-reassignment`. Dans un
builder, `Box()` nu est une instruction (B15). | | B5 | Depaquetage `a, b = 1, 2` | RHS
= tuple/liste de scalaires fermes, même cardinal. Cas `bracket.py:5-6`. | RHS de shapes
→ unresolved. | | B6 | Appel `f(pos, kw=)` | Callee dans table générée ou methode d un
genre (2). Arity/keywords issus de la signature inventaire. Pas de splat. Appels
imbriqués : marcheur recursif unique (déjà `fillet(fillet(Box(),1),2)`). | Keyword hors
signature → `*-argument-not-qualified`. `dir=` est D4-interdit aujourd’hui (§G). |

| B7 | Opérateurs `+ - * / // % **` | Scalaires : arithmetique fermee. Shapes : `+`/`-`
same-kind ; `*` placement x shape (1.4) ; `&`/`|` same-kind après D4. `/` entre shapes :
non. | `+` sur `shape-list` : interdire. | | B8 | `&` et `|` | Same-kind
solid/sketch/curve. 1.5.0 parse déjà BitOp `&` ; D4 jette le token. `|` = fuse
algébrique (synonyme de `+`). | Commit D4 dedie chacun. |

| B9 | Comparaisons | Uniquement dans lambda-predicat (B14) ou garde de comprehension,
operandes scalaires / `.length` `.area` `.volume`. | Comparer deux solids → unresolved.
| | B10 | Litteraux | Decimaux finis (D4). True/False/None. Chaines sans prefixe f/b/r :
Text.txt et Airfoil seulement. | `font_path=` reste I/O. | | B11 | Listes / tuples |
Homogenes : scalaires, Location, ou shapes de même genre. Compound(children=[...]) déjà
1.5.0 (noms). Ouvrir expressions inline. | Liste heterogene solid+sketch →
kind-mismatch. |

| B12 | `for` borne | Deux formes : `for i in range(n)` avec n entier statique <= 64 ;
`for loc in <pattern>` (Locations/Grid/Hex/Polar). Corps = affectations / appels / with
imbrique. Pas de for sur edges() (explorateur OCC). | `while` reste interdit. range sans
borne statique → unresolved. | | B13 | Comprehensions bornees |
`[placement * shape for i in range(n)]` ou `for loc in pattern`. Une clause for. |
Double for, async, walrus (déjà D4-rejete) → unresolved. |

| B14 | lambda predicat étroit | Seulement argument de filter_by / sort_by / group_by.
Forme `lambda e: <prop> <cmp> <scalaire>` avec prop in {.length .area .volume
.is_inner}. Un argument, pas de defaut. | Appel arbitraire, capture mutable →
unresolved. | | B15 | `with` builder | `with BuildPart(*workplanes, mode=) as name:`
(idem BuildSketch/BuildLine). Corps = suite du noyau, y compris `Box()` nu (pending
add). `with Locations(...)` imbrique. Sortie : name.part / name.sketch / name.line. |
Stateful. Select.LAST/NEW seulement dans un builder. |

| B16 | Attributs et indices | Grammaire générée : obj.method(...), Enum.MEMBER,
Plane.XY / Axis.Z / Align.MIN, builder.part. Indice [n] / [-1] seulement sur ShapeList
ou GroupBy après sort_by/group_by. | Indice sur liste non triee → compile AVEC classe
order-dependent (§D), plus d interdiction. | | B17 | `result` | Unique, module-level
(D4). Genre solid ou part ou BuildPart dont .part est un solid (a confirmer contre
export_step 0.11.1 — non sonde). Un sketch / une edge-list n’est jamais un result. |
`result = bracket` vs `result = bracket.part` : golden FEA utilise .part ; bracket.py
passe le builder. Trancher en F4 par sonde d image. |

Hors noyau, inchangé : `def` `class` `if`/`else` `try` `while` `raise` `yield` `async`
`:=` `import module` dunders, f-strings, splat.

`dir` en position identifiant reste interdit (introspection). `dir=` comme nom de
keyword d `extrude` est une admission D4 separee (§G) : le tokenizer doit distinguer
`dir(` de `dir=`.

`with` / `as` sont des NAME déjà tokenises : **pas** d admission D4 pour B15.

---

## C. Système de genres + tables générées

### C.1 Lattice (dérivé des signatures inventaire, pas inventé)

Le 1.5.0 n’a que `"solid" | "sketch"` (`qualified-build123d-source-analyzer.ts:117`). L
étude sélecteurs a etabli que changer cette union **ne casse pas**
`build123d-ast-identity/1.0` : le digest hashe `canonicalAst` (kind + children/text),
pas le genre (`:1915-1927` ; étude §1.3).

Genres internes a ouvrir :

- `scalar` `bool` `string` — litteraux, params, pi, sin(x), Text.txt
- `enum[E]` — Align.MIN, GeomType.LINE, Mode.ADD
- `vector` `location` `location-list` `plane` `axis`
- `solid` — Solid/Part/prims 3D/extrude->Part
- `sketch` — Sketch/Face/prims 2D/make_face
- `curve` — Curve/Edge/Wire/prims 1D
- `vertex` `shell`
- `shape-list[T]` — .edges()->shape-list[curve] ; .faces()->shape-list[sketch]
- `group-by[T]` — .group_by(Axis.X) ; [i] -> shape-list[T]
- `builder-part` `builder-sketch` `builder-line`
- `compound` `joint`

Règles d opérateurs (fermeture, a générér puis relire) :

- `+` `-` `&` `|` : same-kind in {solid, sketch, curve} uniquement. **Pas** sur
  shape-list (étude §1.3 : edges+edges serait une fausse preuve).
- `*` : location * (solid|sketch|curve) preserve le genre de droite ; location *
  location → location (déjà 1.4.0).
- `shape-list[T][n]` → T ; `group-by[T][n]` → shape-list[T].
- `builder-part.part` → solid. `result` accepte solid | compound | builder-part (ce
  dernier si la sonde F4 confirme export_step).

### C.2 Architecture de génération

Aujourd hui `QUALIFIED_BUILD123D_CALLS` est une Map de 18 entrées ecrite a la main, et
`role` n’est pas lu pour decider le genre (étude §1.2). C est le plafond des micro-lots.

```
image pannée 0.11.1
        |  extract (inspect)     CI only, même digest d image
        v
inventory.json   + methods.json
  473 noms+sigs    méthodes des types (2)
        |
        v
scripts/generate-build123d-api-tables.ts   (commite, déterministe)
        |
        v
src/adapters/analyzers/generated/build123d-0.11.1-tables.ts
        |
        v
analyzer 2.x  lit les tables, ne les recopie pas
```

Le `.ts` généré contient : calls (name → kind, positional, keywords[], returnGenre,
determinism), enums (name → members[]), methods (type → {name, args, returnGenre,
determinism}), Plane.XY|XZ|... et Axis.X|Y|Z. Data only : pas de logique, pas d import
analyzer.

**Contrat CI :**

1. Rejouer l extract sur l’image pannée (job isole, même Dockerfile).
2. diff bit-a-bit avec `build123d-api-inventory.json` vendored.
3. Regénérér les tables ; `git diff --exit-code` sur le `.ts` généré.
4. Tests analyzer + corpus (§F).

**Spec extract (a commiter) :** `import build123d as b` ;
`assert b.__version__ == "0.11.1"`. Pour chaque nom public : kind, inspect.signature,
enum **members**. Pour chaque type (2) : méthodes publiques hors `_` et hors I/O
(export_*, save, write). Sortie JSON canonicalisee (cles triees).

### C.3 Pourquoi identity 1.0 suffit

`astStableId` hashe (`:1908-1921`) : schemaVersion `build123d-ast-identity/1.0`,
sourceId, prefix, discriminator, ast: canonicalAst(node). canonicalAst =
`{ kind, text }` ou `{ kind, children }` (`:1924-1927`). Ni le genre, ni la table, ni la
classe de déterminisme n entrent dans le digest.

| Changement                                                              | Casse 1.0 ?                                                                                                | Action                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Ajouter des genres internes                                             | Non                                                                                                        | Autorise.                                                                                                 |
| Generer les tables                                                      | Non, SI les formes déjà qualifiees collectent parameterReferences / shapeReferences dans le **même ordre** | Garde-fou : test bit-identical 1.5.0 (`_test.ts:1860`) promu invariant permanent.                         |
| Mettre le genre ou le hash de table dans astStableId                    | Oui : **tous** les ids, y compris corpus 1.2                                                               | Interdit. Seul motif chiffre d un identity/2.0. Cout : re-sceller tout symbole publie. Benefice : zero.   |
| Introduire un symbole `edges` sur fillet(base.edges(), r) déjà qualifie | Oui pour ces bundles                                                                                       | Interdit. .edges() vide sous fillet/chamfer reste un detail de parseur (étude : genre interne seulement). |

**Décision :** identity scheme **1.0 inchangé**. Version d analyzer **2.0.0** des F1
(changement de strategie : tables + lattice). Profil d admission
`build123d-closed-subset-v1` jusqu a F6, qui introduit `build123d-closed-language/1.0`
quand la métrique corpus est le contrat.

Les scripts _nouveaux_ (`edge = ...`) ont le droit d exposer une `variable`. Cela ne
touche pas le corpus fige.

---

## D. Métadonnée de déterminisme

Directive : on compile **tout** ; l evidence porte la classe ; les consommateurs aval
(FEA, sceau, review humaine) decidant. Ceci **remplace** l interdiction des singletons
(`sort_by[-1]`) decidee avant le 15/08.

### D.1 Trois classes, pas un booléen

Issues du dossier sélecteurs (selector-study-dossier.md §2 ; étude §2.1 ; contre-étude
§1.2 : le cas canonique du depot est group_by x2 + [1] median).

| Classe            | Définition                                                                                                          | Constructs                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `commutative-set` | L opération porte sur un ensemble. L ordre OCC n’est pas une entrée.                                                | filter_by(GeomType/Axis) sans indice ; fillet/chamfer/offset d une shape-list entiere ; booleens + - & ` |
| `order-dependent` | Un indice ou un ordre de sections/chemin selectionne un habitant. A cles ex aequo, Timsort stable fuit l ordre OCC. | sort_by(...)[n] ; group_by(...)[n] (y compris [1] de bracket.py:12) ; loft(sections) ; sweep(path)       |
| `stateful`        | Le resultat depend de la memoire du builder (workplanes, Mode, Select.LAST/NEW, Locations empiles).                 | with BuildPart/Sketch/Line ; with Locations ; Box() nu ; Hole (Mode.SUBTRACT) ; edges(Select.LAST)       |

`filter_by` seul est commutative-set. `filter_by` + [n] sans sort_by/group_by est
order-dependent (si 0.11.1 ne trie pas — ecart doc/code non re-vérifié sur le tag, étude
§2.1 point 4 — l indice est un index d explorateur). On compile quand même ; on
étiquette.

### D.2 Où vit la classe (pas dans identity 1.0)

Sur chaque symbole variable/artifact dont l expression n’est pas commutative-set, champ
d analyse **hors digest** :

```
determinism: {
  class: commutative-set | order-dependent | stateful,
  reason: sort_by+index | group_by+index | builder-mode | ...,
  key?: Axis.Z | SortBy.AREA | ...,
  index?: number
}
```

Ce champ n entre pas dans canonicalAst. S il ne tient pas dans source-analysis/1.0 tel
quel, l emettre comme finding informational `source.determinism-class` qui **n empeche
pas** ready-for-review. L admission continue de ne bloquer que les unresolved. Le sceau
et la FEA lisent la classe. La FEA AABB actuelle ignore déjà les sélecteurs.

### D.3 Ce que le frontend exige encore (sûreté de preuve, pas d interdiction)

- Un indice [n] hors shape-list/group-by → unresolved nomme
  (`python-index-not-a-selector`), pas un passage silencieux.
- Select.LAST/NEW hors builder → unresolved (`build123d-select-requires-builder`).
- Lambda hors filter_by/sort_by/group_by → unresolved.
- Pas de « on refuse [-1] ». On annote.

---

## E. Familles de livraison (6, pas des micro-lots)

Fini le Next AST lock idiome-par-idiome. Six familles, chacune un changement de
mecanisme. Le mode builder et les patterns sont **dans** le plan.

Pourcentage = noms de (1) dont au moins une forme prouvée existe dans la table + le
parseur. Ce n’est pas le % corpus (§F). Les deux métriques sont affichees en CI.

Etat de depart : **18 / 146 = 12 %** (1.5.0).

### E.0 Transverse — des F1, pas une famille a part

- Script d extract + générateur + tables commitees + job CI.
- Lattice de genres interne.
- Champ determinism sur les constructs concernes.
- Analyzer 2.0.0 (F1) puis 2.1 ... 2.5.
- Identity 1.0, profil closed-subset-v1 jusqu a F6.
- Test bit-identical 1.2-1.5 vert a chaque famille.
- desk-lamp-dl04 (CM-01 retire) reste exprimable dans le sous-ensemble algébrique.

### F1 — Noyau algébrique fermé + tables (→ 42 %)

**Cible analyzer :** 2.0.0. **Noms (1) :** 62. Cumule **62 / 146 = 42 %**.

- Prims 3D algébriques (7) : Box Cylinder Cone Sphere Torus Wedge ConvexPolyhedron
- Sketches 2D sans Edge (11) : Rectangle RectangleRounded Circle Ellipse RegularPolygon
  Polygon Trapezoid Triangle SlotCenterPoint SlotCenterToCenter SlotOverall
- Placements (7) : Pos Rot Location Rotation Plane Axis Vector
- Combinateurs (3) : Compound Part Sketch
- Ops (13) : add fillet chamfer extrude revolve scale mirror offset split thicken
  section make_face polar
- Enums (10) : Align Mode Kind Until Keep Side Unit AngularDirection LengthMode
  PositionMode
- Constantes (11) : pi MM CM M IN FT MC THOU DEG2RAD RAD2DEG inf

**Mecanismes nouveaux :**

1. Tables générées remplacent QUALIFIED_BUILD123D_CALLS. Keywords revus (align=
   rotation= mode= amount= taper= both= until= radius= length=) deviennent des formes de
   signature.
2. Marcheur d appels imbriqués unique (déjà amorce en 1.5.0).
3. Placements nommés : `p = Pos(...)*Rot(...) ; p * shape` (ex-lock 1.6.0).
4. Plane.XY|XZ|YZ|YX|ZX|ZY et Axis.X|Y|Z comme membres de classe.
5. Math D4 : sin/cos/sqrt comme appels scalaires.
6. `&` / `|` des que G1/G2 sont merges (frontend a déjà `&`).
7. Polygon(points) : liste/tuple de tuples scalaires fermes.

Hors F1 : sélecteurs chaînes, with, patterns, courbes 1D, joints, import *. D4 de F1 :
G1 `&`, G2 `|`, G6 phantoms, G7-F1 noms manquants, G5 dir=.

### F2 — Sélecteurs + déterminisme (→ 55 %)

**Cible :** 2.1.0. **Noms (1) :** +19. Cumule **81 / 146 = 55 %**.

edges faces wires vertices solids edge face wire vertex solid new_edges

- enums GeomType Select SortBy CenterOf ContinuityLevel Tangency ApproxOption
  FrameMethod.

**Mecanismes nouveaux :**

1. Marcheur de chaînes MemberExpression gauche-associatif :

```
shape . (edges|faces|wires|vertices|solids) ( (Select)? )
      ( . filter_by ( enum | axis | lambda-étroit ) )*
      ( . sort_by   ( enum | axis | lambda-étroit ) )?
      ( . group_by  ( enum | axis ) )*
      ( [int] | [-int] )?
```

Option A de l étude, elargie a group_by (cas canonique du depot :
`group_by(Axis.X)[1].group_by(Axis.Z)[-1]`, bracket.py:12). 2. Genres shape-list[T] et
group-by[T] first-class pour les **nouvelles** affectations (`edge = ...`). Le fillet
global déjà qualifie ne gagne pas de symbole edges. 3. Métadonnée §D branchee sur toute
chaine qui contient un indice ou un group_by. 4. Formes methode solid.fillet /
solid.chamfer si la table des méthodes (2) les expose.

Hors F2 : Select.LAST hors builder (labellisé) ; slice [a:b] sauf corpus ; opérateurs de
selection documentes hors inventaire → unresolved nomme.

### F3 — Patterns + itération bornée (→ 59 %)

**Cible :** 2.2.0. **Noms (1) :** +5. Cumule **86 / 146 = 59 %**.

Locations GridLocations HexLocations PolarLocations pack.

Peu de noms, beaucoup d examples officiels. Le % (1) sous-estime le saut opérable — d ou
la métrique corpus.

**Mecanismes nouveaux :**

1. Constructeurs de patterns → genre location-list.
2. `for loc in pattern:` et comprehensions `[loc * shape for loc in pattern]`.
3. `for i in range(n)` borne (B12) : Pos(i * p, 0, 0) * Box(...).
4. pack(objects, padding) : liste homogene de solids.

LinearLocations est un phantom D4 : ne pas l ajouter.

### F4 — Mode builder (→ 64 %)

**Cible :** 2.3.0. **Noms (1) :** +7. Cumule **93 / 146 = 64 %**.

BuildPart BuildSketch BuildLine Builder Hole CounterBoreHole CounterSinkHole. Debloque
bracket.py, le golden FEA, et la majorite des examples officiels.

**Mecanismes nouveaux :**

1. Marcheur WithStatement Lezer : `with BuildPart(...) as name`.
2. Instructions nues : Box(...) dans un builder = add pending.
3. `with Locations(...)` / `with GridLocations(...)` imbrique (bracket.py:10-15).
4. Hole* : Mode.SUBTRACT par defaut. Hors builder → unresolved dedie.
5. Select.LAST/NEW uniquement ici (stateful).
6. Resultat : name.part / name.sketch / eventuellement name (sonde export_step).

D4 : with déjà admis (NAME). Locations Hole* = commit G7-F4. import * (G4) est un
pre-requis corpus, pas de mecanisme.

### F5 — Courbes, loft, sweep, 1D (→ 91 %)

**Cible :** 2.4.0. **Noms (1) :** +40. Cumule **133 / 146 = 91 %**.

29 courbes + Curve + SlotArc + loft sweep make_hull make_brake_formed full_round draft
trace project project_workplane.

**Mecanismes nouveaux :**

1. Genre curve first-class. BuildLine (F4) produit des curve. make_face(curve) → sketch
   (fermeture 1D vers 2D).
2. loft(sections) : liste ordonnee sketch|vertex — order-dependent.
3. sweep(section, path) : path est curve ; enum Transition.
4. Arcs a VectorLike : tuples scalaires fermes.
5. Airfoil(code: str) : string litterale ; tables NACA dans l’image.
6. full_round retourne un tuple : n ouvrir que si C3 l utilise ; sinon unresolved dedie,
   pas une qualification partielle.

### F6 — Assemblages, joints, texte, fermeture (→ 100 %)

**Cible :** 2.5.0 + profil `build123d-closed-language/1.0`. **Noms (1) :** +13. Cumule
**146 / 146 = 100 %**.

Joint BallJoint CylindricalJoint LinearJoint RevoluteJoint RigidJoint Text

- enums FontStyle TextAlign Extrinsic Intrinsic Sagitta Transition.

**Mecanismes nouveaux :**

1. Text(txt, font_size) : font_path= reste unresolved / D4-interdit.
2. Joints : genre joint, parent solid|compound|builder-part.
3. Compound(children=) F1 : F6 admet children inline (expressions).
4. Tout nom (1) restant : forme prouvée ou unresolved dedie, jamais python-dynamic-call
   générique.
5. Promotion closed-language/1.0 quand §F.3 est vert.

### E.1 Tableau récapitulatif

| Famille                      | Analyzer | Mecanisme dominant                          | Cumul (1) |
| ---------------------------- | -------- | ------------------------------------------- | --------: |
| 1.5.0 aujourd’hui            | 1.5.0    | 18 appels manuels, .edges() étroit          |  **12 %** |
| F1 Noyau algébrique + tables | 2.0.0    | tables, appels imbriqués, placements nommés |  **42 %** |
| F2 Sélecteurs + déterminisme | 2.1.0    | marcheur de chaînes, annotation §D          |  **55 %** |

| F3 Patterns + iteration | 2.2.0 | Locations*, for/range, comprehensions | **59 %** | |
F4 Mode builder | 2.3.0 | WithStatement, pending add, Hole* | **64 %** | | F5 Courbes /
loft / sweep | 2.4.0 | genre curve, sections ordonnées | **91 %** | | F6 Joints / texte
/ fermeture | 2.5.0 | joints, Text, profil language | **100 %** |

Les % (1) de F3/F4 sont bas en noms et hauts en corpus. On ne pilote pas la release sur
les noms seuls.

Ordre impose : F1 → F2 → F3 → F4 → F5 → F6. F4 a besoin de F2
(bracket.edges().filter_by) et de F3 (with Locations).

---

## F. Corpus de mesure

Le 100 % opérable n’est pas une table de noms. C est un ensemble de scripts qui
compilent sans unresolved.

### F.1 Composition

**C0 Fige 1.2-1.5** — scripts du test bit-identical (`_test.ts:1860` : box, fillet
global, chamfer, scale, minus, compound DL-04, rotCone) + placements 1.4 +
Ellipse/RegularPolygon/pi 1.5. Invariant : ids inchangés. Pas le numerateur du 100 %.

**C1 Repo** — `examples/bracket/bracket.py` (import *, BuildPart, Locations, group_by
x2, [1], Hole). Cas de production du depot. Aujourd hui : D4-rejete (import *) ET hors
frontend.

**C2 Golden FEA** — script de `scripts/gates/capture-fea-contract-golden.ts:133-141` :
import *, BuildPart, fillet(...filter_by(Axis.Z).group_by(Axis.X)[-1], 5), result =
part.part. Ce n’est pas le bracket (`:104`).

**C3 Officiel 0.11.1** — tree examples/ du tag gumyr/build123d qui a publie 0.11.1,
vendored lecture seule sous state/fixtures/build123d-0.11.1-examples/ (ou equivalent).
Exclure notebooks, viewers, scripts d I/O. Non liste fichier par fichier : le tree n’est
pas dans ce repo et aucune sonde reseau n’a ete faite. Premier livrable de F1 : vendor +
manifeste corpus.json.

**C4 Synthetique** — un script généré par nom (1) : la forme minimale que la table
declare prouvée. Filet, pas définition produit.

### F.2 Métrique CI

```
corpus_pass_rate =
  #{ scripts in C1 U C2 U C3 | D4 ok AND unresolved == [] AND policy == passed }
  / #{ scripts in C1 U C2 U C3_in-scope }
```

Affichee a cote de `surface1_rate = #{noms (1) avec forme prouvée} / 146`.

Labellisation obligatoire : D4 reject → d4_rejected ; frontend unresolved → unresolved +
histogramme des kind ; passed → corpus_pass.

Un script C3 qui utilise export_step / viewer reste d4_rejected. Apres G4 (import * =
allowlist), ces scripts I/O sont marques out-of-corpus dans le manifeste (motif : I/O),
retires du denominateur, pas deguises en pass.

### F.3 Seuils de release

| Jalon     | surface1_rate | corpus_pass_rate                         | Profil              |
| --------- | ------------: | ---------------------------------------- | ------------------- |
| F1 mergée |       >= 42 % | C0 = 100 % ; C3 algébriques en hausse    | closed-subset-v1    |
| F2+F3+F4  |       >= 64 % | C1 + C2 = 100 % ; C3 builder majoritaire | closed-subset-v1    |
| F5+F6     |       = 100 % | C1 U C2 U C3_in-scope = 100 %            | closed-language/1.0 |

100 % produit = derniere ligne. Avant, on publie des analyzer 2.x sous le profil subset,
sans pretendre le langage fini.

### F.4 Etat présent (qualitatif, corpus non execute ici)

| Script                       | D4                                                | Frontend 1.5.0                               |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------- |
| C0 (7 scripts bit-identical) | passe                                             | passe, ids figes                             |
| examples/bracket/bracket.py  | rejete (import * ; Locations/Hole hors allowlist) | WithStatement + chaînes + Hole non qualifies |
| Golden FEA                   | rejete (import *)                                 | idem + filter_by/group_by                    |
| C3 officiel                  | quasi tous import * + builder                     | 0 % attendu                                  |

---

## G. Admissions D4 — commits conscients, un par changement

D4 reste le mur de sécurité (portée : imports, I/O, dunders, result unique, 64 KiB /
8000 tokens). On n y touche que pour admettre un token ou un nom déjà requis par le
langage fini. Chaque ligne = un commit, message `fix(d4): ...`, revue humaine.

| #  | Commit                    | Pourquoi                                                                                                                         | Ce que ca n ouvre pas             |
| -- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| G1 | Ajouter `&` a ALLOWED_OPS | Intersection algébrique. Frontend 1.5.0 parse déjà BitOp `&` ; aujourd’hui geometry-script-unrecognized-token (RFC 1.5.0 Ecart). | bitwise sur scalaires comme shape |
| G2 | Ajouter `                 | ` a ALLOWED_OPS                                                                                                                  | Fuse algébrique (solid `          |
| G3 | `with`                    | **Aucun commit.** with / as sont des NAME. D4 les admet déjà. Le travail est le marcheur WithStatement (F4).                     | —                                 |

| G4 | `from build123d import *` = expansion de l’allowlist | C1/C2/C3 s’écrivent avec
`*`. Sans G4 le corpus reste ~0 % après F4. Semantique : lier ALLOWED_BUILD123D_NAMES,
jamais **all** (473) ni I/O. | from math import * ; from os import * | | G5 | `dir` en
position keyword seulement | extrude(..., dir=vector) est forbidden_name (RFC 1.5.0).
Distinguer dir( interdit et dir= admis. | dir(obj), dir = ... |

| G6 | Purge des 10 phantoms | Ellipsoid subtract intersect shell Mirror Scale Offset2D
LinearLocations RotationMode Arc absents de 0.11.1. | Ne pas corriger l’image | | G7+ |
Allowlist +noms par famille | Un commit par famille (F1..F6) ajoutant seulement les noms
(1) encore absents. | Ajouter un nom (3). export_* jamais. |

Ordre : G6 avant G7-F1. G1/G2 des F1. G4 des que l on mesure C1/C3 (idealement avant
F4). G5 avec les kwargs extrude de F1. G3 : rien.

result unique, dunders, FORBIDDEN_ATTRIBUTES I/O, plafond taille : intouchables.

---

## H. Invariants

| Invariant                    | Règle                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus bit-identical 1.2-1.5 | Scripts `_test.ts:1860` gardent les memes symbol/dependency ids. Seule analyzer.version bouge. Test promu, retitre a chaque 2.x. Rouge = stop, on ne régénère pas les ids.                      |
| Identity scheme              | `build123d-ast-identity/1.0` inchangé. Pas de genre, pas de table, pas de déterminisme dans le digest. Un 2.0 n’est justifié que si l on casse volontairement tous les ids (§C.3) — non retenu. |
| D4 mur de sécurité           | Toute écriture hors allowlist / I/O / dunder / result mal placé = rejected, unresolvedConstructs: []. G1-G7 sont des élargissements énumérés.                                                   |

| Fail labellisé | D4-admis + non prouvé = unresolvedConstruct avec kind dedie. Interdit
: python-dynamic-call générique pour un nom (1) déjà en table. | | Source jamais
reecrite | Octets admis = octets exec. Pas de lowering.
execute-build123d-child.py:106-114. | | Image pannée | 0.11.1 / OCP 7.9.3.1 /
PYTHONHASHSEED=0. Bump = nouvel extract + nouvel execute. |

| Labels contractuels | unresolved rejected unavailable restent litteraux. Un corpus a
64 % ne s appelle pas langage fini. | | CM-01 / DL-04 | CM-01 retire. desk-lamp-dl04
reste exprimable dans F1 (script compound du corpus fige). | | deno.json check | Tout
nouveau module non-test (générateur, tables, types de genres) est liste. | | Analyzer id
| build123d-qualified-lezer inchangé. | | Pas de provider clone | Les serveurs d
ingenierie restent hors repo. |

---

## Risques (ordonnés)

1. **`import *` est l idiome reel du corpus.** Sans G4 (star = allowlist, pas **all**),
   C1+C2+C3 restent a 0 % après F4. Risque produit n.1.
2. **Les 473 noms ne portent pas les méthodes.** filter_by / sort_by / group_by / .part
   / Plane.XY sont hors inventaire module. Un extract méthodes manque ⇒ F2/F4 verts sur
   les noms et incapables de compiler bracket.py:12.
3. **Drift D4 / table 1.5.0 / image.** 10 phantoms dans D4 (dont Ellipsoid aussi dans la
   table 1.5.0). Compiler 100 % de D4 compilerait des noms inexistants et raterait
   Locations/Hole. L inventaire 0.11.1 est la verite.

4. **Déterminisme group_by[1] / sort_by[-1].** On compile (directive). A cles ex aequo,
   Timsort fuit l ordre OCC (étude §2.2). Le [1] de bracket.py est un groupe median, pas
   un extreme (contre-étude §1.2). Un bump OCCT sous nouvelle image change le STEP sans
   changer l AST. Mitigation déjà vraie : le sceau porte imageDigest ; l annotation §D
   rend la classe visible. Un test d unicite de cle n’est pas du frontend.
5. **export_step(BuildPart) vs .part.** bracket.py fait `result = bracket` ; le golden
   FEA fait `result = part.part`. L enfant isole passe result a export_step (`:119`).
   Sans sonde 0.11.1 F4 peut compiler un script que le worker refuse. Trancher en tete
   de F4.

6. (suivant) dir= vs builtin dir : F1 extrude(dir=) est mort-ne tant que G5 n’est pas
   merge.
7. (suivant) full_round / Text.font_path / Airfoil : frontieres I/O ou tuples de retour.
8. (suivant) Changer canonicalAst ou l ordre des references en branchant les tables sur
   le fillet global → casse le corpus bit-identical. Garde-fou : le test 1.5.0 tourne
   avant tout merge de famille.

---

## Décisions déjà prises par ce plan (ne pas les rouvrir en session)

1. Cible = compilation totale, plus de Next AST lock micro-lot.
2. 100 % = (1) 146 noms + fermeture (2) + noyau §B, mesure sur C1 U C2 U C3.
3. Identity **1.0**. Analyzer **2.x**. Profil language seulement a F6.
4. On compile les singletons ; on annote la classe de déterminisme.
5. Builder et patterns sont des familles, pas un plus tard.
6. `with` : pas un commit D4. `import *` : oui, allowlist only.
7. Tables générées depuis l’inventaire + méthodes, vérifiées en CI contre l’image
   pannée.
8. `Ellipsoid` n’est pas une primitive 0.11.1.

## Non-décisions (sondes requises, hors de cette session)

- export_step accepte-t-il un BuildPart en 0.11.1 ?
- filter_by(Axis) trie-t-il encore sur le tag 0.11.1 (ecart doc/code constate sur dev) ?
- Liste exacte des fichiers C3 après vendor du tag 0.11.1.
- full_round apparait-il dans C3 ? Sinon il reste labellisé en F5.

Ces quatre points sont des entrées de F1/F4, pas des raisons de revenir a des
micro-lots.
