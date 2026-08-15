> **Status: COUNTER-STUDY of a REJECTED design.** Same disposition as the design it
> attacks — kept for its factual audit of admission, MRTR and evidence-level mechanics.
> See [closed-language compilation](../explanations/closed-language-compilation.md).

# Contre-étude adversariale — admission CAD à deux niveaux

Relecture de
[`cad-admission-two-level-evidence.md`](cad-admission-two-level-evidence.md). Pas de
verdict. Shell lecture seule. Aucune sonde d'exécution.

Méthode : (1) fact-check des affirmations contre le code, (2) faire échouer le design en
production sur les six axes demandés, (3) tableau risque × mitigation, (4) conditions de
non-livraison. Le verdict appartient à l'orchestrateur.

---

## 0. Ce que le design a juste (pour ne pas tout relitiger)

| Affirmation                                                             | Jugement             | Preuve                                                                                                                                |
| ----------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Un unresolved suffit à bloquer le sceau aujourd'hui                     | **VRAI**             | diagnostic `:1218-1223` ; statut `unresolved` `:1252` ; draft store `:147-150` ; sealer `:1157, 1279, 1509` ; execute `:210, 226-227` |
| Champ additif sur `technical-compilation/1.0` casse hash ou réouverture | **VRAI**             | `exactRecord` `:21-41` ; `sha256Fingerprint` de l'objet entier                                                                        |
| Recycler `ready-for-review` pour un script non compris serait mentir    | **VRAI**             | commentaire d'admission `:81-85`                                                                                                      |
| On ne peut pas binder un _construct_ unresolved                         | **VRAI**             | `sourceSymbolId` doit nommer un symbole existant (`technical-compilation.ts:1127-1132`)                                               |
| Proof-case n'accepte pas le sceau isolé                                 | **VRAI**             | `cad-model` + `geometry-capture` (`verify-seal-proof-case-run-executor.ts:869, 880`)                                                  |
| D4 + deny-all ferment la _portée_ I/O                                   | **VRAI** (périmètre) | allowlist d'import, `FORBIDDEN_NAMES`, dunders                                                                                        |
| Analyzer crée toujours le symbole `result`                              | **VRAI**             | `:503-546` même si `build123d-result-not-qualified`                                                                                   |

Le gel du document 1.0 et le refus de mentir sur `ready-for-review` tiennent. Le reste
du design **échoue** dès qu'on le lit comme un contrat de signature éclairée, d'identité
dans le temps, et de non-régression d'implémentation.

---

## 1. SIGNATURE ÉCLAIRÉE — le signataire signe un booléen sur un JSON

### 1.1 Ce que l'humain voit réellement

L'élicitation MRTR n'est **pas** un formulaire de paramètres. C'est un message unique +
une case `confirmed` :

```2234:2247:src/tools/project-control.ts
message:
  `The agent proposes to ${disposition} “${decision.title}”. Proposal: ${proposal.summary}. Exact parameters: ${parameters}…
requestedSchema: {
  type: "object",
  properties: {
    confirmed: { type: "boolean", title: `Confirm decision ${disposition}` },
```

`parameters` = `deterministicJson(proposal.parameters)` (`:2209`). Pour une admission
1.0, c'est déjà ~24 + 11×sources + 6×bindings scalaires, presque tous des SHA-256. Le
host peut tronquer. Le schéma demandé est un booléen. **Personne ne « voit » les kinds
comme une revue.**

Le source **n'est pas** dans la grammaire MRTR : seulement `sourceSha256`
(`technical-compilation-proposal.ts:1012-1016`). Le détail (spans, messages) est dans le
draft. Le cockpit n'a **pas** de kind `compilation`
(`review-decision-model.ts:23-26, 109-115`). Le design le sait (§2.6) et place l'UI au
**palier 4**, après les sceaux attestés (paliers 2–3).

YOLO (`deno task start:yolo`) auto-confirme les MRTR positifs. Signature éclairée =
zéro. Déjà vrai pour le prouvé ; l'attesté agrandit la surface auto-signée.

### 1.2 Quarante unresolved, trois kinds = bruit

Le design refuse de déplier les constructs. Le signataire reçoit :

- `evidenceLevel = execution-attested`
- `unresolved.count = 40`
- `kinds = [build123d-result-not-qualified, python-dynamic-attribute, python-dynamic-call]`

Les kinds sont un vocabulaire d'implémenteur, sans légende, sans compte-par-kind, sans
extraits. Trente `python-dynamic-attribute` et un `build123d-result-not-qualified` se
ressemblent. Le plafond « 64 kinds uniques » n'est **jamais** le goulot : le frontend
n'en émet qu'une dizaine. Le goulot est l'absence de _quoi, où_.

Un script de 200 lignes tient sous D4 (64 KiB). L'humain autorise l'exécution microVM
sans voir une ligne.

### 1.3 Faire échouer

Livrer les paliers 2–3 « le thread dit la vérité » alors que la vérité est un JSON de
hashes + 3 tokens. Un opérateur pressé (ou YOLO) scelle n'importe quel script D4-admis.
Le gradient est honnête dans le CAS, **opaque à la signature**.

**Mitigation minimale si on livre quand même :** ne pas ouvrir le sceau 1.1 tant que
l'élicitation (ou le cockpit) n'affiche pas, hors JSON canonique : (a) le niveau en
clair, (b) le source ou un extrait borné, (c) kinds **avec compte et un span
représentatif**. Sinon la phrase « signature éclairée » est fausse.

---

## 2. GLISSEMENT — oui, et les noms mentent

### 2.1 L'agent n'a aucune raison de rester dans le sous-ensemble

Le critère produit _est_ « utiliser build123d comme s'il n'était pas contraint ». Le
closed-subset ne débloque plus execute ni le sceau isolé. Il ne débloque plus que :

- une sensibilité **si** un `parameter` compris existe ;
- une lecture « identité de solide » de `represents` (aucun consommateur actuel) ;
- éventuellement le proof-case, **plus tard**, palier 5.

Pour le chemin principal (géométrie apparaît), l'attesté **domine**. Ce n'est pas un
effet de bord : c'est la doctrine du design. Le gradient ne « s'effondre » pas par
accident ; il se **réordonne**.

### 2.2 Est-ce grave ?

Grave **si** les identités continuent de dire « prouvé » :

| Identité                                         | Après attesté                 | Mensonge                                                                 |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `compile.seal-admission@1`                       | scelle prouvé **et** libre    | un verbe, deux autorités                                                 |
| `producer.tool === "compile.seal-admission@1"`   | sensibilité, execute, readers | filtre trop large (`analyze-seal-sensitivity-study-run-executor.ts:534`) |
| Profil `build123d-closed-subset-v1`              | réutilisé pour le libre       | le nom est le sous-ensemble                                              |
| `sysmlBindings: "unresolved"` sur le sceau isolé | déjà vrai pour le prouvé      | pas nouveau, mais l'attesté le normalise                                 |

Le design refuse `@2` au nom de « No Verb Overlap », puis crée le chevauchement **dans**
`@1` (deux `schemaVersion`, deux gardes). C'est l'inverse du pattern maison FEA `@1` /
`@2` / `@3` : verticale distincte, verbe distinct.

Grave **aussi** si l'agent pose un `height = 10` inutilisé pour garder la sensibilité «
verte » pendant que la vraie géométrie est unresolved (§6). Le Thread montre alors un
paramètre compris qui ne commande rien.

Pas grave **si** le Thread rend les capacités riches _explicitement indisponibles_ sur
l'attesté (`unavailable`, pas une erreur générique au moment du solve). Le design le dit
pour le proof-case ; il ne le dit pas pour la sensibilité ni pour `represents`.

### 2.3 Faire échouer

Un agent compétent n'écrit plus jamais un `Box` qualifié. Tous les nouveaux seals sont
1.1. Le corpus prouvé devient historique. Les consommateurs qui n'ont testé que
`tool === compile.seal-admission@1` traitent l'attesté comme du prouvé jusqu'au premier
crash aval.

---

## 3. SÛRETÉ RÉSIDUELLE — D4 n'atteste pas un solide

### 3.1 Qui vérifie le STEP aujourd'hui

À l'execute : `OcctStepOutputValidator` (`occt-step-output-validator.ts:89-120`).

Il prouve :

1. contrat `geometry.step` / `step-ap214` ;
2. en-tête Part 21 AP214 ;
3. `ReadStepFile` `success === true` ;
4. **au moins un** triangle référencé, d'aire finie (`:336-367, 399-457`).

Il ne prouve **pas** : variety, étanchéité, auto-intersection, volume, genre, nombre de
solides, échelle, qualité de maillage FEA. Un sommet NaN ailleurs est ignoré dès
qu'**un** triangle est fini (`:445-446`).

Au seal isolé : rehash `sha256` + `byteCount` seulement
(`design-seal-isolated-geometry-run-executor.ts:579-610`). Pas de re-parse OCCT.

### 3.2 Ce qu'un script libre peut produire

D4 **admet** boucles, compréhensions, grands exposants
(`geometry-script-validation.ts:69-75`). `Box(1e9, 1e9, 1e9)` est un script _prouvé_
possible aujourd'hui. L'attesté ajoute les sélecteurs, fillets en chaîne, `filter_by`,
indices médians — plus de façons de produire un solide OCCT-accepté et FEA-inutilisable.

La microVM borne CPU/RAM/temps : une bombe qui explose = pas de STEP (fail-closed). Une
bombe qui **tient** dans les limits et laisse un triangle = STEP publié, hashé, scellé.
Le design appelle ça « attestation des effets ». C'est l'attestation d'un _fichier_, pas
d'un _solide manufacturable_.

`&` / `|` restent D4-rejetés (vivacité). Ça n'aide pas : `add` / `fillet` / boucles
suffisent.

### 3.3 Faire échouer

Execute + seal d'un script qui émet un STEP non-manifold / dégénéré sauf un triangle.
OCCT passe. Le Thread montre un sceau `execution-attested`. Un palier 5 naïf brancherait
ce STEP dans CalculiX. Le design dit que le proof-case n'est pas débloqué — vrai
aujourd'hui. Il dit aussi que D4+deny-all « suffisent ». **Faux pour la sémantique
géométrique.** Suffisant pour la _portée_. Insuffisant pour « ce STEP est un solide ».

Ce trou existe déjà sur le chemin prouvé (`Box` énorme). L'attesté l'élargit. Ce n'est
pas une raison de toucher D4 dans ce chantier ; c'est une raison de **ne pas** vendre
l'attestation comme une preuve de forme.

---

## 4. RÉTRO-COMPAT — les hashes 1.0 tiennent ; le _plan_ les met en danger

### 4.1 Ce qui est vraiment bit-identical

Si les validateurs 1.0 (`validateTechnicalCompilationDocument`,
`parseTechnicalCompilationAdmissionParameters` _tel quel_,
`validateBuild123dExecutionAdmission`, captures 1.0) ne sont **pas édités**, les objets
déjà publiés gardent leur digest. `sha256Fingerprint` est une fonction des octets
normalisés, pas du code voisin.

Les tests recomputent les hashes en live ; pas de golden admission dl04/dl05 trouvée
dans `state/fixtures` pour ce contrat. Le risque n'est pas un golden oublié, c'est une
**régression du parseur partagé**.

### 4.2 Le plan édite les mauvaises unités

Le design veut un dual-parse **dans** `parseTechnicalCompilationAdmissionParameters` et
les mêmes fichiers que le chemin 1.0 (`technical-compilation-proposal.ts`,
`compile-seal-admission-run-executor.ts`, `file-technical-compilation-draft-store.ts`,
`design-execute-build123d-run-executor.ts`).

Un changement de `MAX_PARAMETER_COUNT`, de la boucle anti-doublons, ou un `if (1.1)` mal
placé avant le return 1.0 casse les MRTR déjà signés au _rejeu_ (execute / sealer
relisent les paramètres).

Le draft store : accepter `unresolved` « seulement si classé attesté » est additif
**si** le branchement est étanche. Un `|| status ===
"unresolved"` nu persiste des
drafts non classés.

### 4.3 Trou de schéma que le design n'a pas vu

`build123d-execution-capture/1.0` et le draft 1.0 appellent
`validateBuild123dExecutionAdmission` sur l'admission embarquée
(`build123d-execution-evidence.ts:349`). `exactRecord` 1.0 refuse toute clé en trop.

Le design propose `build123d-execution-admission/1.1` (clés nouvelles) et dit que la
capture 1.0 est « uniquement relue ». Il **n'ouvre pas**
`build123d-execution-capture/1.1` ni `build123d-execution-draft/1.1`. Un execute attesté
ne peut donc **pas** persister son evidence 1.0 : la validation de l'enveloppe rejette
l'admission 1.1.

Soit on dual-parse l'admission _dans_ le validateur 1.0 (le design voulait le geler),
soit on versionne capture + draft. Palier 3 tel qu'écrit est **inimplémentable**.

### 4.4 Fichiers oubliés (même mur `ready-for-review`)

| Fichier                                    | Lignes               | Hors liste du design |
| ------------------------------------------ | -------------------- | -------------------- |
| `export-admitted-project-geometry.ts`      | `:302, 355-356`      | oui                  |
| `preview-project-technical-compilation.ts` | `:833, 908` (2ᵉ mur) | partiel              |
| `build123d-execution-evidence.ts`          | `:349`               | oui                  |

Oublier `export-admitted-*` est bénin (chemin sandbox historique). Oublier l'evidence
d'exécution est bloquant.

### 4.5 Analyzer déjà à 1.5.0

Le design s'appuie sur les RFC 1.4.0. Le code porte
`QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION = "1.5.0"`
(`qualified-build123d-source-analyzer.ts:80`). Pas un trou de hash (les admissions
existantes embarquent _leur_ version). C'est un signal que le frontend **bouge déjà** ;
le système à deux niveaux doit survivre au prochain bump, pas seulement à ce lot.

### 4.6 Faire échouer

Implémenter le dual-parse dans la fonction 1.0. Un test 1.0 passe en local, un MRTR
historique échoue au rejeu (`$parameters must contain
exactly N entries`). Ou : livrer
l'admission 1.1 et constater que aucun execute attesté ne peut écrire une capture.

---

## 5. IDENTITÉ — la signature atteste une _analyse_, pas un script

### 5.1 Ce qui est stable

Mêmes octets + même analyzer@version + même politique = même `analysisFingerprint` =
même document 1.0.

L'admission signe `analysisSha256` et `analyzerVersion`
(`technical-compilation-proposal.ts:1003-1026`). Le sealer refuse le drift de version
(`compile-seal-admission-run-executor.ts:1352-1469`). `source.analyzer-mismatch` est
reject-class (`:1194-1202`) : on ne scelle pas une vieille analyse contre un profil
neuf.

Execute **ne ré-analyse pas** : il rouvre le document embarqué.

Donc : **une admission déjà scellée ne change pas de niveau**. Le hash ne « monte » pas
rétroactivement.

### 5.2 Ce qui change au prochain frontend

Un bump 1.5 → 1.6 (le but même des closed-subsets comme amorçage) :

1. le catalogue de profils change (`analyzer.version`) → fingerprint de profil nouveau ;
2. re-preview des **mêmes** octets → nouveau bundle, nouveau document, nouvelle
   admission ;
3. un script hier `execution-attested` peut devenir `semantically-proven` (unresolved
   absorbés) ;
4. un frontend plus strict pourrait, à l'inverse, _ajouter_ des unresolved (descente).

La signature passée signifie : _j'ai attesté cette analyse de ces octets sous cet
analyzer@version_. Elle ne signifie pas : _ce script est attesté pour toujours_.

Le design ne l'écrit pas. Un consommateur qui joindrait sur `sourceSha256` seul
(interdit en doctrine `latest`, mais tentant) prendrait le mauvais niveau.

### 5.3 Faire échouer

Bumper le frontend, re-preview, sceller en 1.0 un script que l'humain avait signé en
1.1. Deux admissions coexistent. Un reader qui prend « l'admission de ce source » sans
fingerprint d'analyse mélange les niveaux. Ou : communiquer « le script est libre »
alors que le sceau est _cette_ analyse.

**Mitigation :** identité =
`(sourceFingerprint, analysisFingerprint,
analyzer@{id,version}, evidenceLevel)`. Toute
prose produit doit dire « analyse attestée », pas « script libre ».

---

## 6. Sensibilité et bindings — VRAI / FAUX cité

| Attaque                                                                              | Jugement                       | Preuve                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| L'agent bind un **construct** unresolved (`python-dynamic-attribute` #17)            | **FAUX**                       | `sourceSymbolId` ∈ `symbols[]` (`technical-compilation.ts:1127-1132`). Un construct n'est pas un symbole.                                      |
| L'agent pose `represents` sur `result` alors que le RHS n'est pas un solide qualifié | **VRAI**                       | `result` est toujours créé (`:503-546`) ; aucun garde relation↔kind ; `parseBinding` accepte n'importe quel `relation` de l'enum (`:997-1020`) |
| L'agent pose `parameterizes` sur un `variable` ou sur `result`                       | **VRAI**                       | même absence de garde kind↔relation                                                                                                            |
| La sensibilité exige un paramètre _compris_ (nom + span + littéral)                  | **VRAI**                       | `:554-570` + `locateModuleLevelNumericBinding` (`sensitivity-source-substitution.ts:51-93`) : expressions refusées                             |
| Ce paramètre doit _commander_ `result`                                               | **FAUX** (trou)                | aucun dataflow. `height = 10` inutilisé + géométrie 100 % unresolved passe le garde, produit deux STEP identiques, une dérivée nulle           |
| `producer.tool === "compile.seal-admission@1"` refuse l'attesté                      | **FAUX**                       | le design garde `@1` pour les deux niveaux ; le filtre (`:534`) accepte le 1.1                                                                 |
| `binding.missing` bloque l'attesté                                                   | **FAUX** (voulu par le design) | classification : `binding.missing` est attesté-éligible                                                                                        |

La frontière « compris requis » **n'est pas** contournable en bindant un unresolved.
Elle **est** contournable en bindant le `result` toujours présent, et en offrant à la
sensibilité un littéral décoratif.

Le design le note à demi pour `represents` (« revendication documentaire »). Il **ne**
le note **pas** pour la sensibilité sans dataflow. C'est le contournement actionnable.

---

## 7. Fact-check express d'autres affirmations du design

| Affirmation                                                          | Jugement                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| « Pas de `@2` = No Verb Overlap »                                    | **FAUX** comme AX. Le chevauchement est _dans_ `@1`                        |
| « Execute `@1` + admission 1.1 suffit, capture 1.0 relue seulement » | **FAUX** à l'implémentation. L'enveloppe 1.0 revalide l'admission (`:349`) |
| « D4 suffit »                                                        | **NUANCE**. Suffit pour la portée. Pas pour un solide                      |
| « Le signataire voit le niveau et les kinds »                        | **NUANCE**. Ils sont dans le JSON signé. Ils ne sont pas présentés         |
| « Frontend inchangé » comme invariant de _système_                   | **NUANCE**. Vrai pour ce lot. Faux dès 1.6 ; l'identité doit le prévoir    |
| Liste de fichiers complète                                           | **FAUX** : evidence d'exécution, export-admitted, 2ᵉ mur preview           |

---

## 8. Tableau risque × mitigation

| #   | Risque                                                            | Gravité | Vraisemblance                               | Mitigation                                                                                                                                      | Bloquant ?                                      |
| --- | ----------------------------------------------------------------- | ------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| R1  | Signature = booléen sur JSON ; paliers 2–3 avant UI               | haute   | certaine                                    | Surface d'élicitation / cockpit **avant** le premier sceau 1.1 : source, niveau, kinds+comptes+span                                             | **oui** si on revendique « éclairée »           |
| R2  | Tout le monde passe en libre ; `@1` et `closed-subset-v1` mentent | haute   | haute                                       | Noms honnêtes (`evidenceLevel` partout, profil pas « closed-subset » pour le libre) **ou** `@2` assumé ; capacités riches = `unavailable`       | **oui** si on garde les noms actuels sans badge |
| R3  | Paramètre-potiche pour la sensibilité                             | haute   | haute                                       | Exiger un dataflow `parameter → result` (dépendance `static-value-flow` déjà dans `source-analysis/1.0`) avant `analyze.seal-sensitivity-study` | **oui** pour la sensibilité sur 1.1             |
| R4  | `represents(result)` documentaire lu comme identité               | moyenne | moyenne                                     | Tout nouveau lecteur de `represents` exige proven **ou** absence de `build123d-result-not-qualified`                                            | non si aucun lecteur n'existe encore            |
| R5  | STEP pathologique (1 triangle) scellé                             | moyenne | déjà vrai en prouvé, plus probable en libre | Garder le proof-case fermé ; ne pas appeler le STEP « solide » ; option : seuil de volume / watertight _plus tard_, pas D4                      | **oui** si palier 5 sans garde forme            |
| R6  | Dual-parse 1.0 cassé au rejeu                                     | haute   | moyenne (même fichier)                      | Parseurs 1.0 **copiés-gelés**, pas patchés ; tests d'identité sur fixtures d'admission existantes                                               | **oui**                                         |
| R7  | Admission 1.1 inembarquable dans capture/draft 1.0                | haute   | certaine (code `:349`)                      | `build123d-execution-capture/1.1` + draft 1.1, **ou** dual-parse d'admission dans l'evidence                                                    | **oui** pour le palier 3                        |
| R8  | Niveau relu sur `sourceSha256` après bump analyzer                | moyenne | moyenne                                     | Joindre sur `analysisFingerprint` ; prose « analyse attestée »                                                                                  | non si la doctrine `latest` est respectée       |
| R9  | YOLO scelle du libre sans lecture                                 | moyenne | déjà vrai                                   | Hors sujet du contrat ; ne pas démo-qualifier l'attesté en yolo                                                                                 | non (préexistant)                               |
| R10 | Oubli d'`export-admitted-*` / 2ᵉ mur preview                      | basse   | haute                                       | Étendre la liste ; ne **pas** élargir l'export sandbox par accident                                                                             | non                                             |

---

## 9. Conditions de non-livraison

Ne pas livrer (ni fusionner un palier) si l'une est vraie :

1. **`statusFromDiagnostics` / `diagnoseSource` / clés `exactRecord` du document 1.0 ont
   bougé.** Hash existant en jeu.
2. **Le parseur 1.0 n'est plus bit-identique** (même fonction patchée, `parameterSpecs`
   1.0 modifié, ordre/labels changés).
3. **Un sceau 1.1 est possible sans afficher source + niveau + kinds comptés** hors dump
   JSON — tant qu'on parle de signature éclairée.
4. **`design.execute-build123d` accepte l'attesté mais écrit encore dans
   `build123d-execution-capture/1.0` sans dual-parse de l'admission.** Inimplémentable
   ou fail-closed silencieux.
5. **Un consommateur traite `compile.seal-admission@1` comme `semantically-proven`.**
   Sensibilité incluse, tant que R3 n'est pas fermé.
6. **La sensibilité 1.1 accepte un `parameter` sans incidence sur `result`.**
7. **Le proof-case ou un texte produit présente le STEP isolé attesté comme géométrie
   canonique / FEA-ready.**
8. **D4 a été élargi « en passant »** (`&`, `|`, `export`) dans le même lot que le
   gradient.
9. **Un badge, un profil ou un tool name dit `closed-subset` sur un sceau
   `execution-attested`.**
10. **Une admission historique 1.0 échoue à la réouverture** après le lot (test
    d'identité rouge).

---

## 10. Ce que l'orchestrateur doit trancher

Le design a le bon _nord_ (ne pas mentir sur `ready-for-review`, ne pas toucher le 1.0).
Il a trois trous qui ne sont pas de la prose :

1. **La signature n'est pas éclairée** avec la surface actuelle (`confirmed` + JSON).
   Les kinds uniques ne suffisent pas.
2. **Le palier 3 est incomplet** : capture/draft d'exécution 1.0 ne peuvent pas porter
   une admission 1.1.
3. **« Paramètre compris » ≠ « paramètre qui gouverne le solide ».** Sans dataflow, la
   sensibilité sur l'attesté est un théâtre.

Le glissement vers le libre est le _but_. Il n'est acceptable que si les identités et
les consommateurs cessent de parler comme si `@1` voulait encore dire « sous-ensemble
prouvé ».

Pas de verdict ici.
