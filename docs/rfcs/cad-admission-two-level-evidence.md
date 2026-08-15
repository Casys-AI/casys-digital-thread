> **Status: REJECTED.** This design explored a permanent two-level admission
> ("semantically-proven" vs "execution-attested"). The product owner ruled it out the
> same day: we compile closed languages completely — an "attested but not understood"
> mode is never the target (at most transitional). Kept as a documented negative
> decision; the contract analysis of admission internals retains reference value. See
> [closed-language compilation](../explanations/closed-language-compilation.md).

# Design : admission CAD à deux niveaux d'évidence

Statut : **design** — pas une spec d'implémentation d'un lot unique. Shell lecture
seule. Aucun hash existant n'est recalculé ici.

Critère produit : _est-ce que ça permet à l'agent d'utiliser build123d comme s'il
n'était pas contraint ?_

Doctrine déjà actée : les closed-subsets sont des briques d'amorçage, pas la cible. La
cible est la liberté de langage + la traçabilité par compilation et attestation.
Personne ne ment : le thread dit ce qui est compris et ce qui est seulement attesté.

---

## 0. Décision en une page

| Question                                           | Décision                                                                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Champ additif sur `technical-compilation/1.0` ?    | **Non.** `exactRecord` est fermé ; un champ nouveau casse la réouverture et, s'il est injecté par défaut, change le fingerprint.                                             |
| Nouveau status 1.0 (`ready-for-attested-review`) ? | **Non.** `ready-for-review` resterait le seul statut scellable aujourd'hui ; élargir ce mot serait mentir. `unresolved` reste le signal honnête du compilateur.              |
| Contrat compilation 1.1 ?                          | **Inutile pour le niveau.** Le document 1.0 contient déjà symboles compris + `unresolvedConstructs`. Le niveau est une **décision d'admission**, pas un fait de compilation. |
| `compile.seal-admission@2` ?                       | **Non.** Même verbe. Le niveau est classé par le serveur, pas choisi par l'agent.                                                                                            |
| Extension de `@1` ?                                | **Oui**, par **dispatch sur `schemaVersion`** : grammaire 1.0 inchangée (chemin prouvé) ; grammaire `technical-compilation-admission/1.1` pour l'attesté.                    |
| `design.execute-build123d@2` ?                     | **Non.** Même acte d'exécution. `@1` accepte les deux admissions ; l'admission d'exécution passe en 1.1 seulement pour les runs attestés.                                    |
| D4 ?                                               | **Inchangé** dans ce chantier. Mur de sécurité suffisant avec la microVM deny-all. `&` / `\|` sont un trou de _vivacité_, pas de sécurité — lot séparé.                      |
| Seals déjà publiés                                 | **Bit-identical.** Validateurs 1.0 gelés. Aucun rewrite.                                                                                                                     |

```text
script D4-admis
        |
        v
source-analysis/1.0     symboles compris + unresolvedConstructs exacts
        |
        v
technical-compilation/1.0     status = ready-for-review | unresolved | rejected
        |                     (sémantique inchangée)
        v
classification serveur (dérivée, pas un champ agent)
        |
        +-- zero diagnostic ---------> admission/1.0  evidence = semantically-proven
        |                              compile.seal-admission@1 (grammaire actuelle)
        |
        +-- seulement unresolved-construct
        |   et/ou binding.missing ---> admission/1.1  evidence = execution-attested
        |                              compile.seal-admission@1 (nouvelle grammaire)
        |
        +-- reject-class ------------> pas de sceau
```

---

## 1. But / non-buts

### But

Un script build123d **libre** (borné par D4 seulement) peut être :

1. analysé **partiellement** (ce que le frontend qualifié comprend déjà) ;
2. scellé comme admission, avec le **niveau** et la **liste exacte** de ce qui n'est pas
   compris sous les yeux du signataire ;
3. exécuté dans la microVM pinnée ; le STEP hashé atteste les effets ;
4. consommé par execute → seal-isolated-geometry **sans** exiger zéro unresolved.

Le chemin prouvé (closed-subset, bindings riches, identité AST) reste **le même contrat,
les mêmes hashes, la même opération `@1`**.

### Non-buts

- Élargir le frontend qualifié (1.4 / 1.5 / 1.6). Autre chantier.
- Toucher D4, sauf trou de _sécurité_ démontré. Autre lot pour `&` / `|`.
- Promouvoir un STEP isolé en géométrie canonique (`cad-model`,
  `design.write-geometry@1`).
- Faire de `ready-for-review` un synonyme d'« assez bon pour exécuter ».
- Laisser l'agent choisir le niveau (`@1` vs `@2`, ou un paramètre libre).
- Réécrire une admission, un draft ou un capture déjà publié.

---

## 2. Étude d'impact (code réel)

### 2.1 `technical-compilation/1.0` — le mur et le fingerprint

Le compilateur est pur, sans provider (`src/domain/analysis/technical-compilation.ts`).

**Diagnostic → statut** (`:1218-1253`) :

```text
pour chaque unresolvedConstruct  →  source.unresolved-construct
pour chaque symbole required non lié →  binding.missing
reject-class (profile / analyzer / policy) → rejected
sinon si diagnostics.length > 0 → unresolved
sinon → ready-for-review
```

Un seul construct non compris suffit. Ce n'est pas `rejected` : c'est `unresolved`. Le
verbe « refuse » vit **en aval**, pas ici.

**Fingerprint.** `compileTechnicalSources` (`:427`) et
`fingerprintTechnicalCompilationDocument` (`:552-555`) hashent l'objet document
**entier** via `sha256Fingerprint` → `deterministicJson`
(`src/domain/kernel/deterministic-json.ts:31-41`). Toute clé ajoutée, même à `undefined`
filtré, change le digest dès qu'elle est présente.

**Réouverture fermée.** `validateTechnicalCompilationDocument` (`:439-449`) passe le
document dans `exactRecord` avec exactement :

`schemaVersion, basis, basisFingerprint, inputManifest, status, diagnostics, projections`.

`exactRecord` (`src/domain/kernel/case-validation.ts:21-41`) rejette toute clé en trop
**et** toute clé manquante. Un champ additif « compatible » sur 1.0 est donc
**impossible** :

- requis sur 1.0 → les seals existants ne rouvrent plus ;
- injecté par défaut à la validation → le fingerprint de **tous** les documents
  existants change (non négociable) ;
- optionnel hors `exactRecord` → rupture du style de contrat.

**Conséquence.** Le document 1.0 est **gelé**. Il n'a pas besoin du niveau : il porte
déjà l'analyse partielle.

| Ce que le 1.0 dit déjà                      | Où                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Octets exacts                               | `inputManifest.sources[].sourceText` + fingerprint source           |
| Symboles compris                            | `analysis.symbols` (`source-analysis/1.0`)                          |
| Unresolved exacts (id, kind, message, span) | `analysis.unresolvedConstructs` (`source-analysis.ts:109-115, 131`) |
| Complétude compilateur                      | `status` + `diagnostics`                                            |

Le frontend crée toujours le symbole `result` (kind `artifact`), même quand le RHS n'est
pas un solide qualifié (`qualified-build123d-source-analyzer.ts:418-464`). Les
affectations numériques module-level restent des `parameter`. Un script libre n'est donc
pas « sans analyse » : il est **partiellement** compris. C'est exactement le matériau de
l'attesté.

D4 échoué → `policy.status === "rejected"`
(`qualified-build123d-source-analyzer.ts:221-224, 1819-1829`) → diagnostic
`source.policy-rejected` → compilation `rejected` → **aucun** niveau ne scelle. Le mur
de sécurité ne passe pas dans l'attesté.

### 2.2 `compile.seal-admission@1` et la grammaire MRTR

L'admission 1.0 (`technical-compilation-proposal.ts`) est explicite :

```81:85:src/domain/analysis/technical-compilation-proposal.ts
* `ready-for-review` is deliberately the only accepted status. An unresolved
* or rejected compiler result cannot be transformed into an admission merely
* by asking for a decision.
```

`compilation.status` est un littéral `"ready-for-review"` (`:117-120`, `:434-438`,
`:531-535`). La séquence MRTR est canonique : mêmes clés, labels, ordre, valeurs
(`:445-472`). Ajouter un paramètre **requis** casse chaque MRTR `@1` déjà signé
(longueur + ordre).

Le preview **ne persiste pas** un unresolved
(`preview-project-technical-compilation.ts:277-282`). Le draft store refuse tout statut
autre que `ready-for-review` (`file-technical-compilation-draft-store.ts:147-150`).
L'exécuteur revérifie document **et** chaque projection à `ready-for-review`
(`compile-seal-admission-run-executor.ts:1157, 1279, 1509`).

`proposal-validation.ts:100-104` réutilise le même parseur : pas de seconde grammaire.

Le registry décrit aujourd'hui « exact ready-for-review compilation draft »
(`registry.ts:219-235`).

**Paramètres que le signataire doit voir pour l'attesté** (en plus de l'identité 1.0
déjà signée : draft, basis, sources, bindings, profils, sha256) :

| Clé                                        | Rôle                                  |
| ------------------------------------------ | ------------------------------------- |
| `compile.admission.schemaVersion`          | `technical-compilation-admission/1.1` |
| `compile.admission.evidenceLevel`          | `execution-attested` (enum fermé)     |
| `compile.admission.compilation.status`     | `unresolved` (honnête)                |
| `compile.admission.unresolved.count`       | entier, y compris 0 interdit ici      |
| `compile.admission.unresolved.kinds.count` | nombre de kinds uniques               |
| `compile.admission.unresolved.kinds.{i}`   | kind exact, ordre lexicographique     |

On **ne** déplie **pas** chaque construct dans le MRTR : le document 1.0 déjà
fingerprinté les contient tous. Le signataire voit le niveau, le compte, et les kinds.
Le détail (span, message) se relit dans le draft. Plafond proposé : 64 kinds uniques ;
au-delà, le preview refuse (script hors contrôle de revue humaine).

### 2.3 `design.execute-build123d@1` puis `design.seal-isolated-geometry@1`

**Execute suppose zéro unresolved.** Triple mur :

1. Admission d'exécution 1.0 : `compilation.document.status` et `projection.status`
   littéraux `"ready-for-review"` (`build123d-execution-proposal.ts:110-115, 524-542`).
2. Rejeu : `document.status !== "ready-for-review"` refuse
   (`design-execute-build123d-run-executor.ts:210`).
3. Projection : `status !== "ready-for-review"` **ou** `diagnostics.length !== 0`
   (`:226-227`).
4. Review : mêmes gardes (`prepare-project-build123d-execution-review.ts:337, 390-391`).

Le profil d'exécution s'appelle `build123d-closed-subset-v1`
(`build123d-execution-proposal.ts:47-51`) mais c'est l'identité d'**isolation** (image,
limits, validateur STEP), pas la grammaire frontend. L'attesté réutilise le même profil,
la même image pinnée, le même deny-all. Le nom du profil n'est pas renommé dans ce
chantier (changement de fingerprint de profil = nouveaux execute, pas les anciens).

La capture `build123d-execution-capture/1.0` embarque l'admission d'exécution entière
(`build123d-execution-evidence.ts:83`). Élargir l'admission 1.0 casserait les captures
existantes. Les runs attestés prennent `build123d-execution-admission/1.1`.

**Seal-isolated-geometry ne re-vérifie pas les unresolved.** Il relit capture + draft +
STEP publié, rehash `sha256` + `byteCount`
(`design-seal-isolated-geometry-run-executor.ts:3-8, 579-610`). `sysmlBindings` est
**toujours** le littéral `"unresolved"` (`:126,
673-675`) — même pour un script prouvé.
Le sceau isolé n'est déjà pas une preuve sémantique SysML.

Il n'accorde ni `cad-model`, ni `thread-assets`, ni autorité FEA
(`analysis-authority-pipeline.md:431-436`, `registry.ts:279-299`).

Pour que le signataire du _deuxième_ MRTR (execute, puis seal) voie le niveau : le
porter sur l'admission d'exécution 1.1 (copie du niveau d'admission de compilation). Le
sceau isolé 1.0 peut rester si le consommateur rouvre la capture d'exécution ; un
`isolated-geometry-seal-capture/1.1` avec `evidenceLevel` est préférable pour ne pas
forcer cette réouverture.

### 2.4 Consommateurs exigeants

#### Sensibilité — le garde vit ici

`analyze.seal-sensitivity-study@1` (`analyze-seal-sensitivity-study-run-executor.ts`) :

| Garde                                                                       | Ligne      | Exige                        |
| --------------------------------------------------------------------------- | ---------- | ---------------------------- |
| `producer.tool === "compile.seal-admission@1"`                              | `:532-537` | une admission de compilation |
| exactement une source Build123d                                             | `:548-551` |                              |
| un unique `symbols[]` `kind === "parameter"` au `semanticKey` **avec span** | `:554-560` | **paramètre compris**        |
| binding numérique module-level = `baseValue`                                | `:562-570` |                              |

Même garde côté `analyze-run-fea-sensitivity-run-executor.ts:729`.

`cadSource` 2.0 nomme l'artefact d'admission + sha256
(`sensitivity-study-v2.ts:8-9, 88-92`). Pas le STEP.

Un script libre **peut** alimenter une sensibilité si, et seulement si, le frontend a
compris ce paramètre (affectation numérique simple). Sinon refus honnête : pas de
paramètre compris. On n'assouplit pas ce garde. On ajoute le motif
`evidence.parameter-not-understood` pour l'AX.

#### Bindings `represents` / `parameterizes`

Pas de garde aval dédié aujourd'hui : la relation est un enum d'admission
(`technical-compilation.ts:51-54`). Le compilateur n'accepte un binding que vers un
**symbole existant** (`:1127-1132`). On ne peut pas binder un unresolved construct.

- `parameterizes` ⇒ le symbole est déjà un `parameter` compris.
- `represents` sur `result` est possible en attesté (le symbole `result` existe
  toujours) : c'est une **revendication documentaire**, pas une preuve de forme. Un
  consommateur qui lit `represents` comme « le solide compris _est_ cette PartDef » doit
  exiger `semantically-proven` **ou** l'absence du kind
  `build123d-result-not-qualified`.

`requiredBindingSymbolKinds: ["artifact", "parameter"]`
(`fixed-technical-compilation-profile-catalog-provider.ts:42`) produit `binding.missing`
si ces symboles existent sans binding. En attesté, `binding.missing` **ne bloque pas**
le sceau (complétude, pas sécurité).

#### `verify.seal-proof-case@1` — écart avec le souhait produit

Le code **n'accepte pas** un sceau isolé. Il exige :

- artefact `kind === "cad-model"` (`verify-seal-proof-case-run-executor.ts:869`) ;
- URI `casys://geometry-capture/` (`:880`) ;
- bundle `geometry-capture` 2.0 ou 2.1 (`:918-937`) ;
- `partDefinitions[].elementId` = cible (`:956-974`) ;
- fichier STEP dans cette part, digest = MRTR (`:986-1018`).

C'est le chemin **historique** `design.write-geometry@1`, pas
`design.seal-isolated-geometry@1`. Le pipeline le dit déjà : le sceau isolé « does not
grant Product or FEA authority ».

**Le mode libre débloque execute + seal-isolated-geometry. Il ne débloque pas le
proof-case tant que ce consommateur n'accepte pas un STEP isolé attesté.** C'est un
chantier consommateur distinct, pas un mensonge de ce design.

FEA `@2` / `@3` consomment un proof-case déjà scellé + STEP par artefact. Ils n'ont pas
besoin du frontend CAD. Ils ont besoin que le proof-case existe.

### 2.5 D4 — seul mur de sécurité, et il suffit

D4 (`geometry-script-validation.ts`) : tokenize + `checkImports` +
`checkResultAssignment` + plafonds 64 KiB / 8 000 tokens (`:1180-1191`, `:129-130`).
Appelé **avant** Lezer (`qualified-build123d-source-analyzer.ts:221`).

Il borne ce que le script peut **atteindre** (imports, I/O, dunders, exec/eval/open,
réflexion). La microVM borne ce qu'il peut **consommer** (CPU, RAM, PIDs, deny-all
réseau). L'en-tête le dit (`:56-75, 97-100`) : ce n'est pas un sandbox, c'est un garde.

| Famille                                                         | Verdict pour un script libre en deny-all                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `from os/sys/socket/… import`                                   | rejeté (`forbidden_import`)                                                                                 |
| `import X` standalone                                           | rejeté                                                                                                      |
| `from build123d import export_step`                             | hors allowlist                                                                                              |
| dunders, `getattr` / `vars` / `type` / `exec` / `eval` / `open` | `FORBIDDEN_NAMES` + motif dunder (`:184-243, 684-687`)                                                      |
| `result` unique, module-level                                   | imposé — le worker exporte `result`                                                                         |
| boucles, compréhensions, lambdas, attributs, indices            | **admis** (vivacité voulue)                                                                                 |
| `&` / `\|`                                                      | `unrecognized_token` — **vivacité**, déjà noté dans `docs/rfcs/qualified-build123d-1.5.0.md:17-31`          |
| `FORBIDDEN_ATTRIBUTES`                                          | incomplet par construction (`:83-88`) ; un `.export(...)` non listé passerait D4 et mourrait au FS deny-all |

**Trou de sécurité démontré justifiant une retouche D4 dans _ce_ chantier : aucun.** Le
deny-all + allowlist d'import + interdiction d'I/O nommé ferment la portée. Un
élargissement `&` / `|` (et éventuellement `export` en attribut) est un **lot D4
séparé**, avec revue nom par nom, hors gradient d'évidence.

L'attesté n'ouvre donc **pas** une surface d'exécution plus large que ce que D4 +
microVM permettent déjà au chemin historique MCP (`project_geometry_preview`). Il ouvre
l'**admission isolée**.

### 2.6 Cockpit / MRTR — le niveau est invisible aujourd'hui

`ProjectReviewKind` = `brief | architecture | requirements | geometry`
(`review-decision-model.ts:23-26`). Le rail ne mappe que `model.write-architecture`,
`model.write-requirements`, `design.write-geometry` (`:109-115, 542-550`).

`compile.seal-admission`, `design.execute-build123d` et `design.seal-isolated-geometry`
n'ont **pas** de preview cockpit. La signature éclairée passe par l'élicitation MCP
(liste plate de paramètres + labels). Pour l'attesté, les **labels** de la grammaire 1.1
sont le premier afficheur. Le rail cockpit doit ensuite gagner un kind `compilation` (et
idéalement `isolated-geometry`) qui parse ces paramètres et affiche niveau + kinds, sans
3D.

---

## 3. Schéma des niveaux

Deux axes orthogonaux. On ne les fusionne pas.

```text
                  compris par le frontend
                  (status du document 1.0)
               ready-for-review    unresolved    rejected
              ┌─────────────────┬─────────────┬──────────┐
semantically  │ chemin actuel   │ impossible  │ impossible│
-proven       │ admission/1.0   │             │          │
              ├─────────────────┼─────────────┼──────────┤
execution-    │ (ne pas émettre │ CHEMIN      │ impossible│
attested      │  1.1 pour ça)   │ NOUVEAU     │          │
              └─────────────────┴─────────────┴──────────┘
```

**Classification serveur** (déterministe, aucun input agent) :

```text
si diagnostic reject-class
    (profile.not-found | source.analyzer-mismatch |
     source.analysis-policy-mismatch | source.profile-incompatible |
     source.policy-rejected)     →  non scellable
si diagnostics = ∅
                                 →  semantically-proven
                                    preview ready-for-review
                                    admission/1.0 (inchangée)
si chaque diagnostic ∈
    { source.unresolved-construct, binding.missing }
                                 →  execution-attested
                                    preview ready-for-attested-review
                                    admission/1.1
sinon                            →  non scellable
```

Le document 1.0 d'un script libre reste `status: "unresolved"`. L'admission 1.1 dit
`evidenceLevel: "execution-attested"`. Personne n'écrit `ready-for-review` sur un script
non compris.

**Vocabulaire preview (port, pas document)** — aujourd'hui le preview n'a que
`ready-for-review | unresolved | rejected`, et seul le premier bras a `draft` +
`decisionParameters` (`project-technical-compilation-preview.ts:38-48`). Il faut un bras
:

```text
status: "ready-for-attested-review"
evidenceLevel: "execution-attested"
draft + decisionParameters 1.1
document.status === "unresolved"   // le document ne ment pas
```

`unresolved` sans ce bras = pas scellable (rejet-class, ou kinds hors politique). Ne pas
recycler `unresolved` pour les deux.

---

## 4. Contrats touchés

### Gelés (bit-identical)

| Contrat                                       | Rôle                                                        |
| --------------------------------------------- | ----------------------------------------------------------- |
| `technical-compilation/1.0`                   | document compilateur                                        |
| `technical-compilation-input/1.0`             | entrée                                                      |
| `technical-compilation-admission/1.0`         | MRTR prouvé                                                 |
| `technical-compilation-admission-capture/1.0` | capture prouvée                                             |
| `build123d-execution-admission/1.0`           | execute prouvé                                              |
| `build123d-execution-capture/1.0`             | uniquement relue ; nouveaux runs attestés n'y écrivent plus |
| `isolated-geometry-seal-admission/1.0`        | sceaux isolés déjà publiés                                  |
| `isolated-geometry-seal-capture/1.0`          | idem                                                        |
| `source-analysis/1.0`                         | unresolved déjà first-class                                 |
| D4                                            | sauf lot sécurité ultérieur                                 |
| `build123d-closed-subset-v1` / identité AST   | frontend inchangé                                           |

### Nouveaux (additive)

| Contrat                                       | Contenu                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `technical-compilation-admission/1.1`         | 1.0 + `evidenceLevel` + inventaire kinds + `compilation.status: "unresolved"`              |
| `technical-compilation-admission-capture/1.1` | même enveloppe, `admission` 1.1, `document` toujours 1.0                                   |
| `build123d-execution-admission/1.1`           | 1.0 élargi : `compilation.*.status` ∈ {`ready-for-review`, `unresolved`} + `evidenceLevel` |
| `isolated-geometry-seal-capture/1.1`          | 1.0 + `evidenceLevel` recopié (affichage)                                                  |

Validateurs 1.0 **non modifiés**. Dispatch `schemaVersion` dans le parseur `@1` et dans
le reader de capture.

`ReopenedTechnicalCompilationAdmission.schemaVersion` devient une union 1.0 \| 1.1
(`technical-compilation-admission-reader.ts:24`).

---

## 5. Table consommateurs → niveau exigé

| Consommateur                                           | Niveau minimum                                                     | Garde actuelle                                | Changement                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------- |
| `compile.seal-admission@1` (1.0)                       | semantically-proven                                                | `status === ready-for-review`                 | **aucun**                                                                   |
| `compile.seal-admission@1` (1.1)                       | execution-attested                                                 | n'existe pas                                  | nouveau parseur ; refuse reject-class                                       |
| `design.execute-build123d@1`                           | execution-attested                                                 | ready-for-review + `diagnostics.length === 0` | accepte 1.1 attesté ; garde D4 déjà dans l'analyse ; image pinnée inchangée |
| `design.seal-isolated-geometry@1`                      | execution-attested                                                 | STEP + capture seulement                      | recopier `evidenceLevel` sur 1.1 ; pas de garde sémantique nouvelle         |
| `analyze.seal-sensitivity-study@1`                     | **parameter compris** (pas le niveau global)                       | symbole `parameter` unique + span + valeur    | garder ; mieux typer l'erreur ; 1.0 **ou** 1.1 si le paramètre est compris  |
| `analyze.run-fea-sensitivity@1`                        | idem                                                               | idem (`:729`)                                 | idem                                                                        |
| Binding `parameterizes`                                | parameter compris                                                  | symbole existant                              | déjà vrai                                                                   |
| Binding `represents` lu comme identité de solide       | semantically-proven **ou** pas de `build123d-result-not-qualified` | aucun                                         | **à déclarer** dans tout nouveau consommateur                               |
| Binding `represents` documentaire (`result` → PartDef) | execution-attested                                                 | symbole `result`                              | permis                                                                      |
| `verify.seal-proof-case@1`                             | STEP d'un `geometry-capture` 2.x                                   | `cad-model` + partDef                         | **pas débloqué** par ce chantier                                            |
| `verify.run-fea-static-proof@2` / `@3`                 | proof-case scellé                                                  | artefact proof                                | inchangé ; dépend du proof-case                                             |
| `design.write-geometry@1`                              | chemin sandbox historique                                          | D4 + preview MCP                              | hors isolé ; hors sujet                                                     |

Règle : **le consommateur déclare**. L'admission ne promet pas plus que son niveau. Un
1.0 historique **implique** `semantically-proven` (zéro unresolved, c'est le seul 1.0
scellable).

---

## 6. `@1` ou `@2`

**Décision : pas de `compile.seal-admission@2`.**

Raisons :

1. **No Verb Overlap.** Deux opérations « sceller une admission » forceraient l'agent à
   choisir le niveau. Le niveau est un _fait_ compilé.
2. Les consommateurs qui testent `producer.tool ===
   "compile.seal-admission@1"`
   (sensibilité `:534`) restent valides : « ceci est une admission de compilation ». Ils
   ajoutent le garde de _capacité_ (paramètre compris), pas un filtre de version.
3. Pattern maison `@2` = verticale d'autorité distincte (FEA `@2` vs `@3`). Ici c'est le
   même sealer, une grammaire plus large.
4. Les MRTR 1.0 déjà signés continuent de parser : le premier paramètre est déjà
   `compile.admission.schemaVersion`. Dispatch binaire.

**Décision : pas de `design.execute-build123d@2`.** Même acte : octets admis + image
pinnée + STEP. L'admission d'exécution 1.1 porte le niveau pour le deuxième signataire.

Alternative rejetée : `@2` uniquement attesté. Plus clair dans le registry, mais l'agent
devrait sélectionner `@2` pour un script libre et `@1` pour un script prouvé — c'est lui
faire porter la classification. Refusé.

---

## 7. Plan de migration additive

Ordre causal. Chaque palier est relâchable sans ouvrir le suivant.

### Palier 0 — gel (aucun comportement nouveau)

- Inventaire de tests d'identité : corpus 1.2/1.3/1.4, admissions fixtures,
  `existing qualified bundles stay bit-identical`.
- Interdit : modifier `statusFromDiagnostics`, `diagnoseSource`,
  `TECHNICAL_COMPILATION_SCHEMA`, la liste de clés `exactRecord` du document 1.0,
  `parameterSpecs` 1.0.

### Palier 1 — classification + preview (pas encore de sceau)

- Fonction pure `classifyCompilationEvidence(document)` à côté du compilateur (module
  1.0 non modifié).
- Preview : si attesté-éligible, persister un draft `unresolved` et émettre les
  `decisionParameters` 1.1.
- Draft store : accepter `unresolved` **seulement** si la classification =
  `execution-attested` et le fingerprint match.
- Tests : un script `fillet(...filter_by(Axis.Z)...)` (D4-admis, frontend unresolved) →
  draft + params 1.1 ; un script D4-rejeté → pas de draft ; un script closed-subset →
  **toujours** 1.0, mêmes clés, même ordre.

### Palier 2 — sealer `@1` dual-parse

- `parseTechnicalCompilationAdmissionParameters` : lire `schemaVersion` ; 1.0 = chemin
  actuel mot pour mot ; 1.1 = nouveau validate + specs.
- Exécuteur : si 1.1, remplacer les trois `status !==
  ready-for-review` par «
  classification == execution-attested et document.status == unresolved ». Si 1.0,
  **zéro** changement.
- Capture 1.1 + reader union. `producer.tool` reste `compile.seal-admission@1`.
- Registry : description élargie (« ready-for-review **or** attested-unresolved ») sans
  changer id/version.

### Palier 3 — execute + seal isolé

- Admission d'exécution 1.1 + dual-parse.
- `prepare-project-build123d-execution-review` et l'exécuteur : accepter
  document/projection `unresolved` si `evidenceLevel === execution-attested`. Interdire
  `diagnostics.length === 0` comme condition _nécessaire_.
- Copier `evidenceLevel` dans l'admission d'exécution signée (le humain qui autorise la
  microVM le voit).
- Seal isolé : 1.1 capture avec `evidenceLevel` ; 1.0 relue telle quelle.

### Palier 4 — cockpit / MRTR éclairé

- Kind `compilation` dans `review-decision-model.ts`.
- Parser browser-safe des params 1.0 et 1.1 (pas d'import domain).
- Affichage : badge de niveau, compte, kinds. Pas de 3D.
- Même badge sur l'inspecteur d'artefact Thread.

### Palier 5 — proof-case (hors gradient, mais sur le chemin produit)

Chantier **séparé** : second bras de `verify.seal-proof-case@1` qui accepte un
`isolated-geometry-seal-capture/1.1` + STEP publié rehashé, **ou** une opération de
promotion STEP dédiée. Tant que ce palier n'existe pas, le dossier et le cockpit doivent
dire `unavailable` / pas d'autorité FEA — jamais « le STEP isolé _est_ un proof-case ».

---

## 8. Fichiers

### Gelés (ne pas éditer sauf test d'identité)

- `src/domain/analysis/technical-compilation.ts` — surtout `statusFromDiagnostics`,
  `diagnoseSource`, clés du document.
- `src/domain/engineering/geometry-script-validation.ts`
- `src/adapters/analyzers/qualified-build123d-source-analyzer.ts` (sauf s'il faut
  exposer les kinds pour le MRTR — lecture seule suffit : ils sont déjà sur le bundle).

### À étendre

| Fichier                                                                           | Palier | Quoi                                                        |
| --------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `src/domain/analysis/compilation-evidence.ts` **(nouveau)**                       | 1      | `classifyCompilationEvidence`, types de niveau              |
| `src/domain/analysis/technical-compilation-proposal.ts`                           | 2      | dual-parse 1.0 / 1.1                                        |
| `src/domain/analysis/technical-compilation-proposal_test.ts`                      | 2      | 1.0 bit-identical + 1.1                                     |
| `src/orchestration/operations/proposal-validation.ts`                             | 2      | inchangé si le parseur dispatch                             |
| `src/orchestration/operations/registry.ts`                                        | 2      | prose seulement                                             |
| `src/application/ports/in/project-technical-compilation-preview.ts`               | 1      | bras `ready-for-attested-review`                            |
| `src/application/use-cases/preview-project-technical-compilation.ts`              | 1      | persister l'attesté                                         |
| `src/adapters/compilers/file-technical-compilation-draft-store.ts`                | 1      | draft unresolved classé                                     |
| `src/adapters/executors/compile-seal-admission-run-executor.ts`                   | 2      | sceau 1.1 + capture 1.1                                     |
| `src/application/ports/out/technical-compilation-admission-reader.ts`             | 2      | union de schéma                                             |
| `src/adapters/compilers/capture-backed-technical-compilation-admission-reader.ts` | 2      | dispatch                                                    |
| `src/domain/analysis/build123d-execution-proposal.ts`                             | 3      | admission 1.1                                               |
| `src/application/use-cases/prepare-project-build123d-execution-review.ts`         | 3      | accepte attesté                                             |
| `src/adapters/executors/design-execute-build123d-run-executor.ts`                 | 3      | lève le mur `diagnostics.length === 0` **seulement** si 1.1 |
| `src/domain/analysis/isolated-geometry-seal-proposal.ts`                          | 3      | paramètre niveau si 1.1                                     |
| `src/adapters/executors/design-seal-isolated-geometry-run-executor.ts`            | 3      | capture 1.1                                                 |
| `src/adapters/executors/analyze-seal-sensitivity-study-run-executor.ts`           | 3      | erreur typée ; accepter capture 1.1                         |
| `src/ui/src/project/review-decision-model.ts`                                     | 4      | kind `compilation`                                          |
| `src/ui/src/thread/geometry-decision-model.ts` (ou sibling compilation)           | 4      | parseur 1.1                                                 |
| `docs/reference/analysis-authority-pipeline.md`                                   | 2–3    | gradient, plus « only ready-for-review » (`:630`)           |
| `docs/reference/agent-workspace.md`                                               | 2      | lookalike : 1.0 ≠ 1.1                                       |
| `docs/reference/workspace-map.md`                                                 | 1      | nouveau module                                              |
| `deno.json` `check`                                                               | 1      | **chaque** nouveau module non-test                          |

`src/ui/dist/**` : rebuild + commit si palier 4.

---

## 9. Invariants de non-régression

1. **Admissions existantes bit-identical.** Rouvrir une capture
   `technical-compilation-admission-capture/1.0` avec les validateurs 1.0 produit le
   même `sha256Fingerprint` qu'à la publication. Aucun champ injecté. Test : fixtures
   actuelles + golden digests.
2. **Closed-subset inchangé.** Un script qui est `ready-for-review` aujourd'hui le
   reste. Preview émet **encore** admission/1.0, mêmes 24 + N paramètres, mêmes labels.
   Le chemin prouvé ne passe pas en 1.1 « pour uniformiser ».
3. **D4 inchangé** dans ce chantier. Un script D4-rejeté reste `policy.rejected` →
   compilation `rejected` → pas de draft.
4. **`statusFromDiagnostics` inchangé.** `source.unresolved-construct` produit toujours
   `unresolved`, jamais `ready-for-review`.
5. **Frontend qualifié inchangé.** Mêmes kinds, mêmes symbol ids, même
   `build123d-ast-identity/1.0`. L'attesté n'invente pas de symboles.
6. **MicroVM.** Même image digest, mêmes limits, même deny-all, même validateur AP214.
   L'attesté n'est pas un runtime plus permissif.
7. **Sensibilité.** Toujours un unique `parameter` compris. Un script libre sans ce
   symbole est refusé. Le label `unresolved` reste contractuel.
8. **Proof-case.** Continue d'exiger `geometry-capture` jusqu'au palier 5. Un sceau
   isolé n'est pas un `cad-model`.
9. **Pas de `latest`.** Toujours références content-addressed.
10. **AX.** L'agent n'envoie pas `evidenceLevel`. S'il l'envoie, le serveur ignore et
    reclasse. Fast-fail si les params 1.1 ne reproduisent pas la classification du
    document rouvert.

---

## 10. Grammaire MRTR 1.1 (forme)

Préfixe inchangé jusqu'à `compile.admission.compilation.sha256`. Puis, **à la place** du
seul `compilation.status = ready-for-review` :

```text
compile.admission.schemaVersion                  = technical-compilation-admission/1.1
compile.admission.evidenceLevel                  = execution-attested
compile.admission.compilation.status             = unresolved
compile.admission.unresolved.count               = <int ≥ 1>
compile.admission.unresolved.kinds.count         = <int ≥ 1>
compile.admission.unresolved.kinds.0             = build123d-result-not-qualified
compile.admission.unresolved.kinds.1             = python-dynamic-attribute
…
```

`operation` reste `compile.seal-admission@1`.

Le sealer 1.1 revérifie :

- `classify(document) === execution-attested` ;
- `unresolved.count === document` (somme des `unresolvedConstructs` de toutes les
  sources) ;
- `kinds` = ensemble trié des `construct.kind` ;
- fingerprints document / draft / basis identiques à 1.0.

Un 1.1 avec `evidenceLevel: semantically-proven` est **rejeté** (on n'émet pas 1.1 pour
ça). Un 1.0 avec un script unresolved est **rejeté** (grammaire actuelle). Pas de
troisième voie.

---

## 11. Réponses aux six questions d'impact

1. **Document 1.0 / fingerprint.** Le status `unresolved` bloque ready-for-review en
   `:1252`. Introduire le niveau **dans** 1.0 (champ ou status) change les hashes ou
   ment. **Ni champ additif, ni 1.1 de compilation.** Niveau sur l'admission 1.1. Seals
   existants : hash inchangé.
2. **MRTR / `@1` vs `@2`.** Le signataire voit `evidenceLevel`, `unresolved.count`,
   kinds exacts. **Extension `@1` par `schemaVersion`**, pas `@2`.
3. **Execute / seal isolé.** Execute suppose aujourd'hui zéro diagnostic
   (`:210, :226-227`). Il doit porter le niveau dans l'admission d'exécution 1.1. Seal
   isolé n'a jamais exigé zéro unresolved ; il doit _afficher_ le niveau.
4. **Consommateurs.** Table §5. Sensibilité = paramètre compris (`:554-570`). Proof-case
   = STEP de `geometry-capture`, **pas** encore le STEP isolé.
5. **D4.** Seul mur de portée. Suffisant avec deny-all. Rien à ajouter dans ce chantier.
   Vivacité `&` / `|` = lot D4 séparé.
6. **Cockpit.** Absent pour cette opération. Labels 1.1 d'abord ; kind `compilation`
   ensuite.

---

## 12. Ce que le critère produit autorise, concrètement

Après les paliers 1–3, l'agent peut :

```python
from build123d import Axis, Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges().filter_by(Axis.Z), radius=2)
```

- D4 : admis (imports allowlist, un `result`, pas d'I/O).
- Frontend : `unresolved` (`build123d-call-not-qualified`, `python-dynamic-attribute`,
  `build123d-result-not-qualified` — déjà décrit dans
  `docs/rfcs/qualified-build123d-selector-grammar-study.md:140-161`).
- Preview : `ready-for-attested-review`, pas `ready-for-review`.
- Humain : signe niveau + kinds.
- Execute : microVM, STEP hashé.
- Seal isolé : document Thread, `evidenceLevel: execution-attested`.

Il **ne peut pas** encore, sans palier 5 ou sans paramètre compris :

- une sensibilité sur une expression non numérique ;
- un proof-case FEA (toujours `geometry-capture`) ;
- prétendre que le solide est sémantiquement identifié.

C'est le gradient honnête. Le closed-subset reste la brique qui débloque les capacités
riches. Le langage libre débloque le chemin principal d'exécution et d'attestation.
