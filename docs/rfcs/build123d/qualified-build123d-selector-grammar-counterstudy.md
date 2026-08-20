Audience: both · Diátaxis: none · Kind: RFC
Status: study
This page is a session brief or study, not the product contract.
Living page: [closed-language compilation](../../explanations/product/closed-language-compilation.md)

> **Status: COUNTER-STUDY — decision superseded.** Same disposition as the study it
> attacks: kept for its factual audit (D4 vs frontend tables, determinism uncertainties,
> the 12-motif friction table), while the sets-only admission decision it informed was
> superseded by the closed-language compilation direction. See
> [closed-language compilation](../../explanations/product/closed-language-compilation.md).

# Contre-étude adversariale — sélecteurs build123d

Relecture de
[`qualified-build123d-selector-grammar-study.md`](qualified-build123d-selector-grammar-study.md).
Pas de verdict. Shell lecture seule. Aucune sonde d'exécution.

Méthode : (1) fact-check des affirmations contre le code, (2) faire échouer A, B et C en
production, (3) tableau risque × coût × valeur.

---

## 1. Fact-check (VRAI / FAUX / NUANCE)

### 1.1 État des lieux — plutôt solide, citations parfois lâches

| Affirmation de l'étude                                                                                                                     | Jugement                                       | Preuve                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseEmptyEdgesSelector` n'est appelé que depuis fillet / chamfer ; ArgList vide ; `PropertyName` `"edges"` ; renvoie le genre de l'objet | **VRAI**                                       | `qualified-build123d-source-analyzer.ts:999-1006`, `:1071-1078`, `:1103-1139`                                                                                                                                                                                                                                                                                                   |
| Fillet / chamfer exigent ensuite `geometry === "solid"` et produisent un `solid`                                                           | **VRAI**                                       | `:1011-1022`, `:1083-1094`                                                                                                                                                                                                                                                                                                                                                      |
| Si fillet réussit, `addExpressionUnresolved` n'est pas appelé — d'où l'absence de `python-dynamic-attribute`                               | **VRAI**                                       | succès → `parseShapeExpression` retourne ; unresolved seulement si `undefined` (`:400-405`, `:458-460`)                                                                                                                                                                                                                                                                         |
| `addExpressionUnresolved` étiquette **chaque** `MemberExpression` et **chaque** `CallExpression`                                           | **VRAI**                                       | `:1459-1481`                                                                                                                                                                                                                                                                                                                                                                    |
| Lezer unifie attribut et indice dans `MemberExpression`                                                                                    | **VRAI**                                       | `node_modules/@lezer/python/src/python.grammar:189-201`                                                                                                                                                                                                                                                                                                                         |
| `Axis` / `GeomType` / `SortBy` / `Select` sont dans D4 et absents de `QUALIFIED_BUILD123D_CALLS`                                           | **VRAI** (citation partielle **FAUSSE**)       | D4 : `Axis` est en `:367`, pas dans le bloc « Enumerations » `:392-413` cité. `GeomType` `:397`, `Select` `:398`, `SortBy` `:402`. Table d'appels `:84-102`. Import → `build123d-call-not-qualified` `:251-258`                                                                                                                                                                 |
| D4 = `tokenize` + `checkImports` + `checkResultAssignment` seulement                                                                       | **NUANCE**                                     | aussi plafond 64 KiB et 8000 tokens (`geometry-script-validation.ts:1181-1191`, `:129-130`, `:519-522`)                                                                                                                                                                                                                                                                         |
| D4 admet lambdas, chaînes, enums, indices                                                                                                  | **VRAI**                                       | `lambda` n'est pas dans `FORBIDDEN_NAMES` ; `[]` et `.` sont dans `ALLOWED_OPS` `:424-454` ; test `faces()[0].type` `:719-725`                                                                                                                                                                                                                                                  |
| `from build123d import *` est rejeté D4                                                                                                    | **VRAI**                                       | en-tête `:26`, golden FEA `:139` est donc hors D4 **et** hors frontend                                                                                                                                                                                                                                                                                                          |
| `GeometryKind` interne, hors `build123d-ast-identity/1.0`                                                                                  | **VRAI**                                       | `:105`, `:1597-1610`                                                                                                                                                                                                                                                                                                                                                            |
| `+` / `-` conservent le genre si les deux côtés matchent ; `Pos *` préserve le genre                                                       | **VRAI**                                       | `:714-723`, `:763-771`                                                                                                                                                                                                                                                                                                                                                          |
| Admission : unresolved ⇒ pas `ready-for-review`                                                                                            | **VRAI** (verbe « refuse » **NUANCE**)         | diagnostic `source.unresolved-construct` `:1218-1223` ; statut `unresolved` si diagnostics `:1252`, pas `rejected`. L'exécuteur, lui, exige `ready-for-review` (`design-execute-build123d-run-executor.ts:210`, `:226`)                                                                                                                                                         |
| Projection d'admission recopie `sourceText`                                                                                                | **VRAI**                                       | `technical-compilation.ts:386-390`                                                                                                                                                                                                                                                                                                                                              |
| « The source text is never regenerated or rewritten » s'applique au frontend qualifié                                                      | **NUANCE**                                     | la citation est le chemin **historique** MCP preview (`analysis-authority-pipeline.md:155-171`, analyseur `PythonCadSourceAnalyzer`). L'isolé ne réécrit pas non plus (`execute-build123d-child.py:106-114`), mais ce n'est pas le même contrat documenté                                                                                                                       |
| Worker pin `build123d==0.11.1` / OCP `7.9.3.1` / `PYTHONHASHSEED=0`                                                                        | **VRAI**                                       | `images/build123d-microsandbox-worker/Dockerfile:7-17,46`                                                                                                                                                                                                                                                                                                                       |
| FEA actuelle = dalles AABB, pas de faces topologiques                                                                                      | **VRAI**                                       | `fea-provider-smoke-inputs.ts:17-56` ; le bracket aussi (`examples/bracket/solve-case.json:5-8`)                                                                                                                                                                                                                                                                                |
| `filter_by(Axis)` sur `dev` filtre sans tri, contrairement à la docstring                                                                  | **VRAI sur `dev`**, **non vérifié sur 0.11.1** | l'étude le marquait déjà ; toujours pas de sonde. Affirmer quoi que ce soit sur le tag worker reste une **incertitude ouverte**                                                                                                                                                                                                                                                 |
| Fillet / chamfer d'un **ensemble** est commutatif / l'ordre n'importe pas                                                                  | **NUANCE / trop fort**                         | l'AST ne l'exécute pas. OCCT `MakeFillet` est un build unique, mais arêtes trop courtes, rayons incompatibles, et **découpage** d'arêtes après booléen changent le _résultat_, pas seulement l'ordre. Le test `fillet((block - bore).edges(), radius=1)` (`qualified-build123d-source-analyzer_test.ts:275`) **qualifie l'AST**, il ne prouve pas que le worker produit un STEP |
| Le worker « exécuterait sans difficulté » `fillet(base.edges().filter_by(Axis.Z), …)`                                                      | **NUANCE**                                     | vrai pour l'import `Axis` côté bibliothèque ; **non exécuté**. Le chemin isolé n'y arrive pas (admission `unresolved`). Le chemin MCP historique, D4-admis, le pourrait                                                                                                                                                                                                         |
| Lots 1.4 / 1.5 / 1.6 n'ouvrent pas les sélecteurs                                                                                          | **NUANCE**                                     | 1.4.0 §2 les exclut. 1.6.0 = liaisons `Pos`/`Rot`. **1.5.0 n'est défini nulle part** dans le dépôt                                                                                                                                                                                                                                                                              |

### 1.2 Trou structurel que l'étude sous-estime

L'exemple **canonique du dépôt** n'est pas `filter_by(GeomType.LINE)` ni
`sort_by(Axis.Z)[-1]`. C'est :

```python
edge = bracket.edges().filter_by(Axis.Y).group_by(Axis.X)[1].group_by(Axis.Z)[-1]
fillet(edge, fillet_mm)
```

(`examples/bracket/bracket.py:12-13`). Deux `group_by`, un indice **médian** `[1]` (pas
un extrême), mode `BuildPart`, `import *`. Hors D4 nommé, hors frontend, hors grammaire
A telle qu'écrite, hors keywords B illustrés. L'étude le mentionne comme « hors A » ;
elle n'en fait pas le **cas de production** contre lequel mesurer A/B/C.

---

## 2. Faire échouer A en production

### 2.1 Changement d'ordre OCCT / image : le STEP scellé et le script

Ce que l'étude dit : à **image constante**, reproductible ; le risque est
inter-versions. C'est incomplet.

L'image **est** dans le MRTR d'exécution (`build123d-execution-proposal.ts:141-143`,
`fixed-build123d-execution-profile-catalog.ts:122-130`). Rejouer **la même** admission
signe le **même** `imageDigest`. Un bump OCCT n'est pas une réexécution silencieuse du
même MRTR : le catalogue change, le fingerprint de profil change, il faut un nouvel
execute.

Donc : **pas de divergence silencieuse sous le même sceau**.
`design.seal-isolated-geometry@1` re-lit le STEP déjà publié et vérifie `sha256` +
`byteCount` (`design-seal-isolated-geometry-run-executor.ts:3-8`). Il ne ré-exécute pas.
L'ancien sceau reste attaché à l'ancien digest.

La faille réelle est **ailleurs** :

1. **Même source, nouvelle image, nouvel execute, nouvel humain pressé.** Le script n'a
   pas bougé. L'analyse AST est bit-identical. Le STEP hash change. Rien dans
   l'admission de _compilation_ (profil `build123d-closed-subset-v1` `1.0.0`,
   `fixed-technical-compilation-profile-catalog-provider.ts:32-42`) ne pinne l'image. Un
   reviewer qui lit « même source qualifiée » peut signer un execute dont le BRep a
   changé de _sens_ (autre arête, autre face) et pas seulement de triangulation.
2. **Consommateurs qui joignent par source et non par STEP.** Sensitivity, FEA `@3`, un
   second execute « pour régénérer ». Le sceau isolé n'est **pas** une géométrie
   canonique (`AGENTS.md` / lookalikes). Si un flux prend « le dernier STEP de ce script
   », `[-1]` a pu viser autre chose. Aucun label `unverified` n'apparaît : les deux
   executes sont `passed`.
3. **Intra-image, clés ex æquo.** `sort_by` = `sorted()` stable sur `center()`. Deux
   faces de même Z : `[-1]` = dernière dans l'ordre `TopExp`. Sur une image pinnée c'est
   reproductible. Ce n'est pas une désignation géométrique. Un _autre_ booléen en amont
   (même image) qui permute l'explorateur change `[-1]` **sans bump d'image**. L'étude
   parle trop d'« inter-versions » et pas assez du **booléen précédent**.

`PYTHONHASHSEED=0` ne stabilise pas `TopExp`. Il ne protège pas A.

### 2.2 `[-1]` est un piège de reproductibilité — oui, et `[1]` l'est plus

`[-1]` après `sort_by(Axis.Z)` est un extrême. Il échoue en silence quand :

- la clé n'est pas unique (ties → ordre explorateur) ;
- OCCT **découpe** la face / l'arête (un `Box - Cylinder` casse les arêtes du dessus en
  plusieurs `LINE` ; le « max Z » peut devenir un fragment) ;
- `center()` d'une face non plane (après fillet) n'est plus le centroïde visuel que
  l'agent croit viser.

`[n]` littéral quelconque, autorisé par la grammaire A, est pire : `[0]` est le min,
`[2]` n'a aucun sens géométrique. Le bracket du dépôt utilise `group_by(Axis.X)[1]` —
**le groupe du milieu**, dont l'index dépend du _nombre_ de groupes. Ajouter un nervure
déplace `[1]` sans que le script change. A telle qu'écrite n'a même pas `group_by`, donc
elle ne peut pas reproduire le cas ; si on l'ajoute plus tard pour « finir A », on
importe ce piège.

Indice **sans** `sort_by` : l'étude propose de le refuser. Tant que cette règle n'est
pas dans le parseur, un implémenteur pressé qualifiera `filter_by(Axis.Z)[-1]`. Sur
`dev` ce n'est **pas** un extrême (pas de tri). Sur 0.11.1 : inconnu. Qualifier les deux
comportements sous la même forme est une faille de contrat.

### 2.3 La grammaire de chaînes explose si on la prend au mot

L'étude écrit une grammaire à étages optionnels puis laisse ouverts l'ordre, les
répétitions, et `[n]` (`étude §3.5`). Produit :

| Axe                        | Cardinalité si on ouvre tout                         |
| -------------------------- | ---------------------------------------------------- |
| Tête                       | 2 (`edges` / `faces`)                                |
| `filter_by`                | 1 + 16 `GeomType` + 3 `Axis` = 20                    |
| `sort_by`                  | 1 + 3 `Axis` + 5 `SortBy` = 9                        |
| Indice                     | 1 + ∞ littéraux, ou ≥ 3 si on borne `{[0],[-1],[n]}` |
| Ordre filter/sort          | 2                                                    |
| Répétitions (`filter_by`²) | ×20 encore                                           |

Sans répétitions ni `n` libre : 2 × 20 × 9 × 3 × 2 ≈ **2 000** formes à tester,
documenter, et refuser une à une quand le suffixe déborde (fuite par préfixe,
`étude §3.2`). Avec `n` paramètre (`i = 1` ; `…[i]`) : le sélecteur n'est plus une
constante du programme, l'identité AST ne capture pas _quelle_ entité, seulement _qu'il
y a_ un indice.

A n'explose **pas** si l'orchestrateur impose une **liste close** de motifs (ex.
uniquement `edges().filter_by(GeomType|Axis)` ensemble, et `faces().sort_by(Axis)[-1]`
singleton). L'étude n'a pas fermé ça. Un implémenteur qui code le parseur récursif
décrit en §3.5 livre une combinatoire et un trou de couverture de tests.

### 2.4 A ne tient pas le but déclaré

But : congé sélectif + faces FEA.

- 4 arêtes verticales d'un boîtier parallelepipédique : `edges().filter_by(Axis.Z)` — A
  le fait.
- Congé de l'arête interne d'une équerre (le seul CAD commenté du repo) : **A ne le fait
  pas** (`group_by` × 2, `[1]`, builder).
- Face du dessus après `Rot` : `sort_by(Axis.Z)[-1]` vise le Z **monde**, pas le «
  dessus pièce ». A n'a pas `Axis` local lié à un `Pos`/`Rot` nommé (1.6.0).
- `faces().sort_by(Z)[-1].edges()` (chanfrein du rectangle supérieur seulement) : hors
  grammaire (sélecteur de sélecteur).

Livrer A « comme spécifié » et annoncer le congé sélectif / la FEA, c'est livrer deux
motifs de tutoriel et laisser le cas métier du dépôt en `python-dynamic-attribute`.

### 2.5 Sûreté : la fente MemberExpression grossit

Chaque helper (`parseEnumMember`, `parseSelectorIndex`, …) est une exception de plus au
verrou unique actuel (`:1103`, `:1460-1465`). Un oubli de « le nœud doit **être** la
chaîne, pas un préfixe » qualifie `solid.edges().filter_by(LINE).mapped(f)` ou un slice.
Les tests 1.3.0 ne couvrent pas ces suffixes. A1 (sélecteur seulement sous fillet)
limite la casse ; A2 + `+` / `Pos *` mal fermés produit des edge-lists assemblées —
l'étude le dit, c'est le vrai risque d'identité _sémantique_, pas d'id SHA.

---

## 3. Faire échouer B en production

### 3.1 Expressivité : les deux cas cités, puis le cas réel

**Congé des 4 arêtes verticales d'un boîtier** (`along=Axis.Z` → `filter_by(Axis.Z)`).
Ça marche **si** les arêtes sont des `LINE` parallèles à Z (tolérance `1e-5`). Ça rate
dès que :

- dépouille / draft (plus parallèle) ;
- l'arête a déjà un petit congé (devenue `CIRCLE`) ;
- le boîtier est `Rot`'é (Z monde ≠ Z pièce) ;
- on voulait les 4 verticales **extérieures** et pas les verticales d'un perçage
  débouchant (aussi `LINE` // Z).

`along=Z` est un **filtre d'orientation**, pas une désignation « paroi externe ». Le
vocabulaire illustré n'a pas `outer` / `inner` / `length=`.

**Face du dessus pour une charge FEA** (`extreme="max"`, `normal=Axis.Z`). Ça marche
pour une `Box` centrée — précisément le cas déjà couvert par les dalles AABB
(`fea-provider-smoke-inputs.ts`). B n'ajoute rien sur ce cas. Ça rate dès que :

- rebord + fond de poche : deux faces, même normale +Z ; `max` Z est le rebord, la
  charge veut souvent le fond ;
- nervures : N faces au même Z, ties → même fuite que `[-1]` ;
- après `Rot`, « dessus » n'est plus `Axis.Z` monde.

**L'équerre du dépôt.** `along=Axis.Y` congée **toutes** les arêtes // Y (intérieur,
extérieur, bords de plaque). Ce n'est pas `group_by(X)[1].group_by(Z)[-1]`. Pour
l'exprimer en B il faut inventer `at_x="middle", at_z="max"` — c'est `group_by` + indice
renommé, avec la même fragilité, plus un mot « middle » qui n'a pas de définition
géométrique stable.

Bilan : B illustré couvre **l'intersection** de (solide encore axis-aligné) × (ensemble
d'arêtes // un axe) × (une face extrémale non ambiguë). C'est plus petit que le but.
Élargir B jusqu'au bracket reconstitue A sous des keywords, plus le lowering.

### 3.2 Qui maintient le mapping, et la dérive non signée

Trois mécanismes (`étude §4.5`). Dans les trois, le mapping `along=Z` → `filter_by`
**ou** `sort_by[-1]` est du code serveur.

| Si le mapping vit…              | Ce qui le signe aujourd'hui                        | Dérive                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1. Lowering TS avant l'image   | fingerprint du **dialecte**, pas du Python abaissé | changer `along` de « ensemble » à « extrême » ne change aucun id de source agent ; le STEP change ; l'analyse du dialecte reste bit-identical                                                                                |
| B2. Prelude dans l'image        | `imageDigest` du MRTR execute                      | bump d'image = nouveau MRTR (détecté). Changer le prelude **sans** changer le digest est une compromission d'image, hors sujet. Changer le prelude **avec** nouvel image : l'humain voit un digest, pas une spec de `along=` |
| B3. 2ᵉ cible `build123d-source` | les deux textes si on les hashe tous les deux      | honnête seulement si l'admission scelle dialecte **et** Python généré. L'étude le dit ; rien dans `technical-compilation/1.0` n'a aujourd'hui de champ « lowered source »                                                    |

Le contrat actuel hashe le `sourceText` agent (`technical-compilation.ts:386-390`) et
l'exécute tel quel (`execute-build123d-child.py:113-114`). B1/B2 font de ce hash un
**mensonge opérationnel** : ce qui tourne n'est pas ce qui est signé, sauf travail
d'autorité nouveau. Ce n'est pas une « option de parseur » ; c'est un changement de
modèle.

Dérive sémantique concrète, non signée si on ne hashe que le dialecte :

```text
v1  along=Z  →  edges().filter_by(Axis.Z)        # 4 arêtes, ensemble
v2  along=Z  →  edges().sort_by(Axis.Z)[-4:]     # autre chose, ou crash
```

Même script, même analyseur, même ids. STEP différent. C'est plus sournois que A : en A
le sélecteur est **dans** le texte signé.

`fillet(solid, radius=, along=)` entre en collision avec `fillet(solid, r)` natif (Next
AST lock, `:34-35`) et avec `fillet(edges, radius=)` déjà qualifié. Trois verbes pour «
congé ». Un agent (ou un bump de lowering) peut changer de forme sans que le reviewer le
voie dans le source.

### 3.3 Pont FEA

CalculiX 0.4.0 veut des boîtes, refuse une dalle qui n'englobe pas une face entière
(`fea-provider-smoke-inputs.ts:21-23`). Lowering `select_faces` → NSET topologique :
**n'existe pas**. Lowering → AABB du `BoundBox` de la face : B redevient C, avec une
étape de plus à dériver. La « valeur FEA » de B est nulle tant que le provider de faces
n'existe pas. L'étude le note en question §7.5 ; elle surpondère quand même B comme «
préparation FEA ».

---

## 4. Faire échouer C en production — friction chiffrée

Pas de corpus statistique dans le dépôt. Chiffres = **12 motifs mécaniques courants**,
plus les 2 artefacts du repo (bracket, golden FEA). Barème :

- **possible** : exprimable dans le subset 1.3.0 sans astuce
- **verbeux** : 1.3.0, ×3–10 plus long, encore lisible
- **grotesque** : 1.3.0 seulement via fausse géométrie (cylindre à la place d'un congé,
  sketch arrondi à la main)
- **impossible** : l'entité n'existe qu'après un booléen / n'est pas une primitive
  alignée, et le subset ne peut pas la nommer

| #  | Motif                                                       | C (1.3.0)                 | Pourquoi                                                                                                                                                                                                                 |
| -- | ----------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | Congé **global** d'une primitive                            | possible                  | déjà qualifié                                                                                                                                                                                                            |
| 2  | 4 verticales d'une `Box` alignée                            | verbeux                   | `extrude` d'un rectangle arrondi = 2 `Rectangle` + 4 `Pos*Circle` + `+` ; sans liaisons `Pos` (1.6.0) tout est inline                                                                                                    |
| 3  | Toutes les `LINE`, pas le perçage `CIRCLE`                  | grotesque / fail          | `fillet((box-bore).edges(), r)` est **qualifié** (`_test.ts:275`) et tente aussi les cercles ; trop grand `r` → échec worker, pas un unresolved                                                                          |
| 4  | Arête interne d'équerre (bracket.py)                        | grotesque                 | l'arête **naît** du `+` des deux `Box`. On ne peut pas la fillet en amont. Palliatif : `Cylinder` fusionné dans le coin (faux congé, G1 approximatif) ou tout reconstruire en 2D — `FilletPolyline` est D4, pas frontend |
| 5  | Chanfrein du seul rectangle supérieur                       | grotesque                 | pas de `.faces()[-1].edges()`. Palliatif : deux extrusions empilées, chanfrein « global » sur la plaque mince seulement                                                                                                  |
| 6  | Face +Z d'une `Box` centrée pour FEA                        | possible                  | AABB déjà en prod                                                                                                                                                                                                        |
| 7  | Même face après `Rot`                                       | grotesque / impossible    | la dalle AABB monde n'est plus une face ; pas de `sort_by` local                                                                                                                                                         |
| 8  | Fond de poche (rebord plus haut)                            | impossible en désignation | AABB du « dessus » attrape le rebord ; C n'a pas d'extrême local                                                                                                                                                         |
| 9  | `new_edges` après booléen (arêtes d'intersection seulement) | impossible                | pas de `new_edges` / `Select.NEW` ; fillet global les mélange aux anciennes                                                                                                                                              |
| 10 | Congé d'une seule arête d'un `Wedge` / pièce déjà booléenne | grotesque                 | découper le solide pour isoler l'arête détruit la pièce ; cylindre encore une fois                                                                                                                                       |
| 11 | 4 verticales d'un boîtier **avec dépouille**                | impossible                | plus des `LINE` // Z ; le sketch arrondi ne reproduit pas la dépouille + congé                                                                                                                                           |
| 12 | Désignation FEA d'une face cylindrique (portée)             | impossible en AABB propre | une dalle qui contient tout le cylindre contient d'autres faces ; le provider refuse les dalles partielles                                                                                                               |

Sur ces 12 : **2 possibles** (dont 1 déjà là : FEA box), **1 verbeux**, **4
grotesques**, **5 impossibles**.

Repo :

| Artefact                                  | C                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `examples/bracket/bracket.py`             | grotesque (faux cylindre) ou réécriture 2D hors subset                                  |
| Golden FEA `filter_by(Z).group_by(X)[-1]` | hors D4 (`import *`) ; l'intent « une arête verticale extrême en X » est grotesque en C |

**Lecture :** C ne « coûte que du design agent » que pour les congrès globaux et la FEA
de pavé aligné — déjà livrés. Pour le premier exemple pédagogique du dépôt, C est déjà
un impasse ou une imposture géométrique. Dire « coût zéro grammaire » est vrai. Dire que
l'agent peut « composer des primitives » jusqu'au congé sélectif est faux dès que
l'arête est un **produit** d'un booléen.

Effet production de C : l'agent envoie des `filter_by` D4-admis, le frontend les laisse
unresolved, l'admission reste `unresolved`, le projet n'a pas de géométrie isolée,
l'agent bascule sur un fillet **global** pour débloquer. C'est déjà le
pied-dans-la-porte du test `(block-bore).edges()` : on qualifie un congé trop large, le
worker peut échouer, ou produire un BRep que personne n'a demandé.

---

## 5. Ce que l'étude a trop gentiment laissé aux « questions §7 »

Ces questions ne sont pas des détails de planning. Ce sont des conditions de
**non-livraison** :

- Sans décision **ensemble vs singleton**, A/B qualifient des formes dont le
  déterminisme n'est pas de la même classe. Les mélanger sous un même `fillet` est un
  bug de contrat.
- Sans décision **octets intangibles**, B n'est pas une option de frontend ; c'est un
  autre produit (compilateur CAD).
- Sans `group_by` / indice de groupe, **personne** (A ni B tels quels) ne fait le
  bracket. Le chantier « hors lots » tel que cadré rate le seul CAD métier versionné
  ici.
- Sans pont CalculiX, la « préparation FEA » est du théâtre : A/B produisent une
  face-list que personne ne consomme ; C AABB reste le chemin réel.

---

## 6. Tableau risque × coût × valeur

Pas d'ordre. Les notes sont des constats, pas un classement.

|                           | **A — chaînes énumérées**                                                                                                                                                                                                                                                                                                                                                                | **B — vocabulaire dédié**                                                                                                                                                                                                                                                                                       | **C — statu quo étendu**                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risque production**     | **Haut** si `[n]` / ties / booléen amont : le _même_ script vise une autre entité ; le STEP hash change (détectable au sceau) mais l'analyse et le source ne crient pas. **Moyen** si on borne A aux opérations d'ensemble sans indice. Combinatoire et fente `MemberExpression` si le parseur est récursif. Image pinnée dans le MRTR execute : pas de divergence _sous le même sceau_. | **Très haut** sur l'autorité : ce qui s'exécute ≠ texte signé, sauf B3 complet. Mapping `along=` → sélecteur = dérive **invisible** dans les ids AST. Collision de trois formes de `fillet`. Expressivité trop courte ⇒ l'agent contourne via D4 + unresolved, ou le mapping s'enrichit sans revue.             | **Haut sur le BRep livré**, bas sur le parseur. L'agent « débloque » avec fillet global (déjà qualifié sur `(solid-solid).edges()`). Faux congés (cylindre) passent l'analyse, mentent à la FEA. Aucun nouveau risque d'attribut dynamique. |
| **Coût**                  | **Frontend lourd, exécuteur 0.** Un helper Lezer par étage, table d'enums séparée de `QUALIFIED_BUILD123D_CALLS`, fermeture `+`/`Pos *` si A2, batterie de tests ~O(formes). D4 / image / admission inchangés. Maintenance : chaque idiome build123d (`group_by`, `>`, lambda) redevient un ticket.                                                                                      | **Frontend moyen, système lourd.** Keywords + éventuellement `parseEnumMember`. Puis B1/B2/B3 : compilation, prelude, ou 2ᵉ source hashée — hors de l'analyseur, touche D4 et/ou l'image et/ou `technical-compilation/1.0`. Maintenance **permanente** du dictionnaire déclaratif (c'est un langage).           | **Implémentation 0, opérationnel récurrent.** Chaque projet paie la reconstruction. Skill / doc possible, pas un parseur. Coût caché : files d'admissions `unresolved` et de fillets globaux non voulus.                                    |
| **Valeur vs but déclaré** | **Partielle.** Livre `filter_by(GeomType\|Axis)` (ensembles) et éventuellement un extrême `sort_by[-1]`. Ne livre **pas** le bracket, **pas** `new_edges`, **pas** le chanfrein d'une face, **pas** la FEA CalculiX. Fidèle à l'idiome _dans le motif_. Traçabilité bonne : le sélecteur est dans les octets scellés.                                                                    | **Partielle et conditionnelle.** `along=Z` / `extreme=max` suffisent au pavé aligné — déjà fait par C+AABB. Devient précieuse seulement si on assume un lowering versionné **et** un consommateur de faces. Seule option qui _pourrait_ incarner « compilation traçable » ; aujourd'hui ce modèle n'existe pas. | **Nulle sur le but sélectif**, pleine sur la stabilité du contrat actuel. 2/12 motifs courants restent naturels ; 5/12 impossibles ; le CAD tutoriel du dépôt est grotesque. FEA box : déjà là.                                             |

**Lecture transversale (toujours sans choix) :** les trois options, _telles que
spécifiées_, ratent le même objet — désigner une entité qui n'est ni « toutes les LINE »
ni « l'extrême d'un axe monde ». A le rate par grammaire trop courte (ou explose si on
l'allonge). B le rate par vocabulaire trop court (ou dérive si on l'allonge). C le rate
par absence de nommage. Le déterminisme de `[-1]` / `[1]` est un problème **commun à A
et à tout lowering B qui s'en sert** ; C l'évite en ne désignant rien, au prix de ne pas
le faire.

L'orchestrateur tranche. Cette contre-étude ne le fait pas.
