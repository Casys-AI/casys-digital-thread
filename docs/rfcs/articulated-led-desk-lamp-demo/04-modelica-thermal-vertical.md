# RFC 04 — Verticale thermique Modelica admise : tete LED scalaire

Statut : spec d'implementation · Audience : agent implementer · Portee : demonstrateur
`articulated-led-desk-lamp-demo`

## Resultat vise

Ajouter une verticale **generique** d'observation puis d'evaluation de sorties Modelica
admises. Le premier utilisateur est une tete LED isolee, representee par un modele
thermique scalaire; il ne cree ni une grammaire LED, ni un kit image, ni une equation
serveur. Le profil existant `modelica-closed-subset-v2` / `2.0.0` reste l'autorite
d'execution : source scalaire fermee -> admission -> OMC/DASSL microVM ->
`evidence.json` et `result.csv` -> observations `final` / `max_abs`.

Le nouveau resultat L4 est une evaluation SysON explicite de certaines de ces
observations. Le resultat L5 est une decision humaine sur l'exact L4 et ses limites. Une
sortie OMC reussie reste L3 documentaire. Une valeur, une equation, un seuil, une unite,
une puissance, une brillance, un materiau ou une densite ne sont pas fournis par cette
RFC : ils doivent venir de la fiche humaine revue et de ses sources.

Ce RFC n'implemente ni modal, ni FEA thermique, ni modelica general, ni import MSL, ni
circuit SPICE. Modal reste seulement un futur candidat de capacite partagee.

## Invariants non negociables

1. La source est un unique `.mo` UTF-8 ferme, capturee puis admise par
   `compile.seal-admission@1`; l'agent ne fournit jamais `modelicaText` a l'execution.
2. `simulate.run-admitted-modelica@1` reste le seul moteur de cette verticale. Il
   reouvre les octets scelles et choisit profil, image digeste, OMC/DASSL, wrapper,
   scenario annote, chemins et limites cote serveur.
3. La fiche humaine n'est ni une enveloppe OMC ni un emplacement pour des arguments de
   solveur. Elle source et explique les quantites/modeles, puis lie des symboles source
   a des elements SysML exacts.
4. Toute comparaison L4 est faite par SysON sur une requirement et une observation
   exactes; OMC, le parseur CSV et l'agent ne produisent jamais `pass` ou `fail`.
5. Chaque decision L5 signe l'evaluation L4 exacte et son scope. Elle ne vaut pas pour
   un nouveau modele, une nouvelle admission, un autre scenario ou une autre revision.
6. Absence/ambiguite de fiche, source, binding, unite, requirement, evidence ou lineage
   = `unresolved`/`unavailable` selon le contrat existant; jamais une inference
   thermique implicite.

## Objet partage : fiche thermique humaine

Creer un document immuable, hors code source executable, par exemple
`modelica-thermal-method-sheet/1.0`. Ce nom est descriptif : le schema doit accepter des
modeles scalaires qui ne sont pas LED, afin de reutiliser l'evaluation pour une autre
discipline Modelica compatible.

| Champ ferme                         | Semantique et garde                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `project`, `subject`, `basis` | Identites exactes du projet, sujet et Thread; jamais un label de lampe comme cle machine.                                                                                                                                                 |
| `scope`, `limitations`              | Question bornee, hypothese de tete isolee, exclusions et consequence envisagee, textes visibles au review.                                                                                                                                |
| `sources[]`                         | Pour chaque hypothese/quantite : type de source, identite ou reference stable, auteur/autorite, date si connue, extrait ou justification. Une valeur sans source reste une hypothese explicitement attribuee a un humain.                 |
| `model`                             | Nom de module et empreinte de la capture source; aucun texte `.mo`, chemin, commande ou image.                                                                                                                                            |
| `parameters[]`                      | `modelSymbolId` issu de l'analyse v2, role, SysML `AttributeUsage` exact et justification/source reference. Les valeurs restent dans la source admise et/ou SysML selon le contrat de compilation existant; la fiche ne les duplique pas. |
| `outputs[]`                         | `modelSymbolId`, role de mesure (`final` ou `max_abs`), quantity/meaning, unite declaree par la source, requirement SysML exacte et limitation. Une sortie ne peut apparaitre qu'une fois par role.                                       |
| `bindings`                          | Preuves explicites de `parameterizes` pour chaque parametre et de l'ancre SysML pour chaque sortie/requirement; les IDs, pas les noms affiches, sont joints.                                                                              |
| `review`                            | Auteur humain de la methode, date, identite de la decision MRTR de seal; aucun booleen auto-approbateur.                                                                                                                                  |

Contraintes : records fermes, listes sans doublon, empreintes SHA-256, references
existantes et relecture canonique. Le schema ne deduit jamais la temperature depuis un
nom de variable, une unite depuis un label, ni la puissance depuis la brillance. Une
fiche ne fait pas une admission : elle est un artefact source de revue que le seal
recroise avec la capture/analyse et le Thread courant.

## Chaine L1 a L5

```text
fiche humaine sourcee + source Modelica scalaire fermee + SysML exact
  -> analyse v2 et bindings `parameterizes`
  -> compile.seal-admission@1 (L2 admission)
  -> review/run `simulate.run-admitted-modelica@1` (L3 evidence/replay)
  -> evaluate admitted Modelica observations against SysON (L4)
  -> decision humaine explicite sur ce L4 (L5)
```

La fiche et l'admission sont deux objets : une modification de fiche ou de source
necessite un nouveau review/decision; une execution ne retro-ecrit pas la fiche.

### Bindings SysML requis

Le compilateur v2 existant exige deja un `parameterizes` unique par symbole parameter.
La verticale ajoute une verification de projection, pas une autre heuristique :

- chaque parametre de la fiche doit correspondre exactement a un symbole parameter de
  `SourceAnalysisBundle`, a un `AttributeUsage` SysML et au binding unique deja admis;
- chaque sortie candidate L4 doit correspondre exactement a un symbole `output Real` de
  la source admise, a l'un de ses deux roles d'observation publies (`final` ou
  `max_abs`), et a une `RequirementUsage`/metric SysML extraite;
- la requirement doit annoncer une comparaison que l'evaluateur SysON existant sait
  porter. La compatibilite d'unite est une propriete prouvee par la politique d'unites,
  pas une promesse de `Real` Modelica;
- un parametre electrique ou une sortie de brillance peut etre lie si et seulement si sa
  relation causale est explicitement posee dans la fiche et dans le manifeste d'impact
  de RFC 06. L'agent ne relie pas deux symboles par ressemblance de noms.

## Evaluation L4 generique

Ajouter une capacite code-owned, proposee sous le nom
`verify.evaluate-admitted-modelica-observations@1`. Son nom et son schema restent
generiques : ils evaluent des observations deja normalisees de l'admitted v2, pas un
"oracle LED".

### Entrees server-owned

Le review accepte seulement l'identite de projet et, si le produit le requiert, une
fiche scellee/artefact de methode exacte. Le serveur reouvre et recroise :

1. Thread tip exact, sujet, admission fraiche `compile.seal-admission@1` et source;
2. run `simulate.run-admitted-modelica@1` termine, son ROP/decision MRTR, capture,
   `evidence.json`, `result.csv`, receipt microVM et observations publiees;
3. fiche humaine, source analysis, bindings SysML, requirements et unit policy;
4. profil d'evaluation enregistre, en version fermee, qui admet seulement `final` et
   `max_abs` de sorties scalar `Real` de l'admitted v2.

Le caller ne passe ni valeur, ni unite, ni outputName, ni feature, ni limite, ni
provider, ni outil SysON, ni args. Le serveur derive toute projection de la fiche
scellee et des artefacts rouverts, puis expose la proposition MRTR lisible. Une nouvelle
MRTR est obligatoire pour L4; elle ne reutilise ni l'admission ni la MRTR d'execution.

### Projection et capture

Pour chaque paire declaree `(output symbol, observation role, requirement metric)` :

1. verifier qu'une unique observation est produite par l'exact run et l'exact evidence
   capture, avec l'unite declaree dans la source admise;
2. appliquer uniquement une transformation de la politique d'unites deja enregistree, ou
   refuser/ecrire `unresolved` si aucune compatibilite prouvee n'existe;
3. appeler `syson_constraint_evaluate` avec les identites exactes, capturer la requete
   canonique et la reponse structuree immuable; SysON demeure le comparateur;
4. publier une evaluation par requirement avec etat literal `pass`, `fail`, `unresolved`
   ou `error`, plus violation nommee seulement en cas de `fail`;
5. attacher chaque evaluation a la capture Modelica, `evidence.json`, `result.csv`,
   fiche, requirement et methode par empreintes et `ThreadProvenanceLink`.

L'evaluateur ne corrige pas les inputs, ne relance pas OMC, ne modifie pas SysML et ne
decide pas L5. Un `fail` est evidence publiable; une sortie absente ou une unite non
admise ne devient pas un faux `fail` ou `pass`.

### L5

Introduire une operation humaine de closeout, par exemple
`decide.accept-admitted-modelica-evaluation@1` / `decide.reject-...`, seulement apres
validation du registre de noms et de la grammaire MRTR. Elle accepte : project, exact
Thread basis, exact evaluation capture et consequence declaree. Elle reouvre le L4 et la
fiche, marque la decision/human action avec limites et ne fait aucun appel moteur. Un
`pass` L4 n'est jamais implicitement L5.

## Lots atomiques pour implementation rapide

Chaque lot est un commit boundary. Les tests listes sont locaux au lot; aucun lot ne
pretend que la verticale est livree avant le gate global final.

| Lot | Depend  | Changement exact et placement DDD/hexa                                                                                                                                       | Acceptance du commit                                                                                                                        |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | —       | Ecrire fixtures de fiche **sans chiffres ni source inventee** dans `src/testing/`; ajouter les cas valid/duplicate/missing-source/missing-binding.                           | Les fixtures expriment seulement placeholders humains explicites; aucun moteur/operation touche.                                            |
| T02 | T01     | `src/domain/modelica/thermal-method-sheet.ts`: schema ferme, canonical JSON, fingerprint, erreurs typées.                                                                    | Unit tests refusent cle inconnue, doublon, source absente, ID non exact et texte source `.mo`.                                              |
| T03 | T02     | Port out `src/application/ports/out/modelica/thermal-method-sheet-reader.ts`; adapter file/CAS dans `src/adapters/modelica/thermal-method-sheet/`.                           | Save/read/reopen recalcule la meme empreinte et ne retourne jamais un path editable.                                                        |
| T04 | T02     | Proposer/seal domain et MRTR grammar dans `src/domain/modelica/thermal-method-sheet-proposal.ts`; ajout des descripteurs/validation dans `src/orchestration/operations/`.    | Les decision parameters sont fermes, round-trip canoniques, sans source bytes/provider/args.                                                |
| T05 | T03,T04 | Use case de review/seal dans `src/application/use-cases/modelica/thermal-method-sheet/`; executor/adaptateur Thread dans `src/adapters/modelica/thermal-method-sheet/`.      | Relecture exacte de fiche, capture source et SysML; mismatch/ambiguite refuse; aucune execution OMC.                                        |
| T06 | T05     | Outil project-control et composition `server.ts` uniquement pour review + `verify.seal-modelica-thermal-method-sheet@1` si le nom final est confirme.                        | L'outil ne demande que les identites autorisees et renvoie une MRTR lisible; registry rejects extras.                                       |
| T07 | T05     | Extend le compilateur/review existant, sans le dupliquer : `src/domain/compile/admission/technical-compilation*.ts` et `src/application/use-cases/compile/admission/`.       | Un parametre fiche doit recroiser le `parameterizes` v2 unique; output/requrement sont exacts ou gaps nommes.                               |
| T08 | T07     | Premier **stop humain** : faire approuver la fiche LED, toutes ses sources, le scope, les inputs et les criteres. Produire source + SysML par les surfaces existantes.       | Pas de code d'execution ni de test "pass" avec valeurs fictives tant que cette base n'existe pas.                                           |
| T09 | T08     | Exerciser le chemin existant capture -> preview -> `compile.seal-admission@1`; corriger seulement les gaps de binding reels.                                                 | L'admission scelle une source v2 analysee; aucun fallback kit/recorded/texte caller.                                                        |
| T10 | T09     | Exerciser le review et run existants dans `src/application/use-cases/modelica/admitted/` / `src/adapters/modelica/admitted/`, sans branche LED.                              | Evidence + CSV + receipt + deux observations par output et replay sans OMC sont persistants.                                                |
| T11 | T02     | Domaine generique `src/domain/modelica/evaluation/admitted-observation-evaluation.ts`: method/profile, selection `final\|max_abs`, mapping metric, evidence/capture schemas. | Rejette output hors source v2, role absent, requirement dupliquee, unite sans policy et toute equation/valeur caller.                       |
| T12 | T11     | Ports in/out sous `src/application/ports/{in,out}/modelica/evaluation/`; reader des evidences admitted existantes, store CAS de capture.                                     | Ports ne parlent pas HTTP/SysON et ne possedent pas de Thread shape.                                                                        |
| T13 | T11,T12 | Use case `prepare-project-admitted-modelica-evaluation-review.ts`: derive la MRTR a partir du Thread, fiche et evidences exactes.                                            | `projectId` seulement ou identites strictement necessaires; no `feature`, `limit`, `unit`, `provider`, `tool`, `args`.                      |
| T14 | T13     | Profile fixe/evaluator dans `src/adapters/modelica/evaluation/`; reutiliser le parse/capture SysON, pas une comparaison locale.                                              | Une requete canonique et une capture immuable par dispatch; normalisation nommee ou literal unresolved.                                     |
| T15 | T14     | Executor + WAL type dans `src/adapters/modelica/evaluation/`; publication extension Thread.                                                                                  | Pre-call WAL, outcome ambigu non rejoue, capture reouverte avant retry, `pass/fail/unresolved/error` et violation semantiquement coherents. |
| T16 | T15     | Registry, tool, server composition et tests de denial.                                                                                                                       | L'operation est enregistrée, MRTR-gated, et impossible a appeler avec envelope SysON/OMC.                                                   |
| T17 | T16     | L5 proposal/executor human-only dans `src/domain/modelica/evaluation/` et `src/adapters/modelica/evaluation/`.                                                               | Decision lie exact evaluation/fiches/Thread, refuse evaluation stale ou non L4, ne reexecute rien.                                          |
| T18 | T17     | Documentation coverage/how-to et fixtures integration, uniquement apres evidence reelle.                                                                                     | La doc dit exactement L3/L4/L5 et conserve les etats litteraux/exclusions.                                                                  |

## Tests de forme obligatoires

- Chaque nouveau validateur : accepted, champ supplementaire, valeur non canonique,
  doublon, mismatch de fingerprint et relation ambiguë.
- Chaque review : projet/basis/sujet/producer falsifie, source ou requirement stale,
  output absent, binding manquant, unit policy absente et MRTR non canonique.
- Chaque executor : interruption avant/pendant/apres WAL, outcome SysON inconnu, capture
  perdue apres reponse, concurrent run, replay termine. Prouver zero nouvel appel
  OMC/SysON lorsque l'evidence/capture est complete.
- Chaque publication Thread : consumer/evidence/requirement/evaluation/violation ont
  exact fingerprint, producer run et freshness; `pass` ne se propage pas a une decision.

## Gate global unique (apres T18)

Le seul gate de livraison execute en fin : dans un environnement local reel, suivre une
fiche humaine approuvee de tete LED scalaire jusqu'a L5, interrompre une execution et
une evaluation a des points WAL distincts, redemarrer, puis prouver que les replays
reouvrent les artefacts sans nouveau OMC/SysON. Le gate requiert aussi les checks Deno
cibles plus `deno task check`. Sans fiche/inputs/criteres humains, il est **BLOCKED**,
pas remplace par une fixture qui invente une physique.
