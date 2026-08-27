# Compliance evidence cases: a multi-jurisdiction product boundary

Audience: both · Diátaxis: explanation · Kind: contract

> **Diátaxis category: explanation. Status: target architecture, not an implemented
> regulatory engine.** This page explains how Casys could organise compliance evidence
> around the existing digital thread. It is not legal advice, a certification service,
> or a claim that the current Workbench can determine regulatory compliance.

An engineering result and a regulatory conclusion are different objects. A CAD export,
simulation, test report, or requirement evaluation can become evidence in a compliance
case, but none of them determines by itself which law applies, whether a means of
compliance is acceptable, or whether an authority will approve an application.

The product opportunity is therefore not to build an automatic certifier. It is to make
the chain from an official source to a reviewed submission legible and reproducible:

```mermaid
flowchart LR
  S["Versioned official sources"] --> A["Applicability decisions"]
  A --> O["Obligations and evidence requests"]
  O --> E["Immutable engineering evidence"]
  E --> R["Human assessment and approval"]
  R --> D["Prepared submission dossier"]
  D --> X["External authority or conformity body"]
```

Casys may own the trace and workflow up to the prepared dossier. The manufacturer,
operator, applicant, competent authority, notified body, or certification authority
retains the legal decision and signature that belongs to it.

## A compliance case is an overlay on the digital thread

The existing `ThreadSnapshot` is the neutral record of what was produced, consumed,
observed, evaluated, and linked. The existing `EngineeringProjectSnapshot` records
intent, work, decisions, approvals, blockers, and exact evidence references. Those are
useful ingredients, but the repository does not yet implement the regulatory concepts
described below.

A future compliance case should reference immutable thread evidence rather than copy or
reinterpret it. The same mass observation, firmware baseline, or test report may support
several obligations and several jurisdictions without changing the underlying
engineering record. A regulatory assessment can then be revised independently when a
source, intended operation, or authority position changes.

The target relationship is:

```text
official source version
  -> reviewed applicability decision
  -> obligation or accepted-means reference
  -> evidence request
  -> exact ThreadSnapshot evidence reference
  -> human assessment
  -> externally signed or acknowledged artifact
```

This preserves the existing rule that calculation is an oracle for its own result, not
the product authority. A successful CalculiX or Modelica run is a candidate proof. It is
not an accepted regulatory means of compliance until the responsible party and, where
required, the external authority or conformity body have accepted that use.

## Jurisdiction packs keep legal meaning explicit

The European Union UAS framework should be an initial content pack, not assumptions
embedded in application code. A future jurisdiction pack should identify at least:

- jurisdiction, source issuer and, when different, the competent regulator or
  market-surveillance authority;
- instrument identifier and direct official source URL;
- source kind and legal status;
- publication, effective, amendment, and supersession dates;
- language, edition, and stable citation or clause identifier;
- digest of any locally retained source bytes that may legally be stored;
- licence and redistribution constraints;
- relationships to amendments, accepted means, forms, and national overlays.

The source kind must remain visible throughout the case:

| Source kind                      | Meaning in the product                                                        | Product rule                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Law or regulation                | Binding obligation within its scope and effective period                      | Never rewrite it as guidance or silently merge amendments.                                          |
| AMC or other accepted means      | One recognised way to demonstrate compliance                                  | Do not present it as the only legally possible means when alternatives are allowed.                 |
| Harmonised or technical standard | Technical method that may provide a presumption or agreed means of compliance | Keep exact edition and clause references; do not claim legal force beyond the governing instrument. |
| Guidance, FAQ, template, or form | Procedural explanation or expected submission shape                           | Never promote it to a binding obligation.                                                           |

European standards are normally copyrighted and distributed under licence. Casys should
store their metadata, purchased-edition identity, clause references, mappings, and user
access rights. It must not ingest or redistribute full standard text without a licence
that permits it. For EU UAS, the Commission's
[official harmonised-standards page](https://single-market-economy.ec.europa.eu/single-market/goods/european-standards/harmonised-standards/unmanned-aircraft-systems_en)
is the authority for published references; it currently identifies EN 4709-002:2023 for
direct remote identification with explicit restrictions.

Packs should compose in layers instead of pretending that one global rule set exists:

```text
EU UAS base pack
  + Member State / NAA overlay
  + site and geographical-zone constraints
  + organisation and intended-operation facts
  = one reviewable case scope
```

Insurance, privacy, security, geographical zones, and submission procedures may differ
nationally. An unknown or conflicting overlay must produce an unresolved applicability
decision, not a guessed answer. Adding another jurisdiction should add another pack and
mapping; it should not fork the evidence model.

## EU UAS as the first sourced example

The primary-source baseline reviewed on 2026-08-02 is:

| Source                                                                                                                                         | Version or date         | Role                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| [Regulation (EU) 2019/947](https://eur-lex.europa.eu/eli/reg_impl/2019/947/2025-05-01/eng)                                                     | Consolidated 2025-05-01 | Operational categories and procedures                                            |
| [Delegated Regulation (EU) 2019/945](https://eur-lex.europa.eu/eli/reg_del/2019/945/2025-06-24/eng)                                            | Consolidated 2025-06-24 | Product requirements, classes, conformity assessment, and certification triggers |
| [EASA Easy Access Rules for UAS](https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-unmanned-aircraft-systems) | Revision 2026-06-30     | Consolidated rules plus EASA AMC and GM                                          |
| [ED Decision 2025/018/R](https://www.easa.europa.eu/en/document-library/agency-decisions/ed-decision-2025018r)                                 | 2025-09-29              | Latest SORA 2.5 AMC/GM package and corrigendum trail                             |

The EASA publication explicitly tells readers to check whether rules were adopted after
2026-06-30. A future pack updater should therefore discover source changes and open an
impact review. It must not mutate an active case from one version to another. Every case
should pin the exact regulatory and guidance editions used.

### Operational category is not product class

`open`, `specific`, and `certified` classify an intended **operation**. C0 through C6
class-identification labels describe a **product** intended for particular operational
routes. A CE marking or class label does not itself authorise a flight.

The current high-level routes are:

| Operation route | Principal conditions or entry point                                                                                                                        | External decision                                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open            | VLOS, no more than 120 m, no dangerous goods or dropping, and the applicable A1/A2/A3 limits; C0/C1 principally map to A1, C2 to A2 or A3, and C3/C4 to A3 | No prior operational authorisation, but registration, pilot competence, remote identification, insurance, and geographical-zone rules may still apply. See [EASA Open category](https://www.easa.europa.eu/en/domains/drones-air-mobility/operating-drone/open-category-low-risk-civil-drones). |
| Specific — STS  | Every condition of the standard scenario; C5 for STS-01 and C6 for STS-02                                                                                  | Operator declaration and NAA confirmation of receipt and completeness. See [EASA STS](https://www.easa.europa.eu/en/domains/drones-air-mobility/operating-drone/specific-category-civil-drones/standard-scenario-sts).                                                                          |
| Specific — PDRA | Operation fits a published predefined risk assessment                                                                                                      | Operational authorisation by the NAA.                                                                                                                                                                                                                                                           |
| Specific — SORA | Neither STS nor PDRA covers the proposed operation                                                                                                         | Risk assessment, evidence, and operations manual reviewed by the NAA. See [EASA SORA](https://www.easa.europa.eu/en/domains/drones-air-mobility/operating-drone/specific-category-civil-drones/specific-operations-risk-assessment-sora).                                                       |
| Specific — LUC  | Eligible legal entity demonstrates organisational maturity and receives explicit privileges                                                                | NAA grants and oversees only the stated privileges; a LUC is not a blanket authorisation. See [EASA LUC](https://www.easa.europa.eu/en/domains/drones-air-mobility/operating-drone/specific-category-civil-drones/light-uas-operator-certificate-luc).                                          |
| Certified       | Highest-risk operation or a certification trigger under Article 40 of Regulation 2019/945                                                                  | Type and airworthiness certification plus operator and personnel approvals as applicable. See [EASA Certified category](https://www.easa.europa.eu/en/domains/drones-air-mobility/operating-drone/certified-category-civil-drones).                                                             |

SORA 2.5 is the latest package incorporated into the June 2026 Easy Access Rules. ED
Decision 2025/018/R also leaves SORA 2.0 in force. A case must therefore record the
edition selected and accepted by the relevant NAA rather than interpreting "latest" as
permission to migrate an existing assessment.

EASA maintains separate
[Specific-category application forms](https://www.easa.europa.eu/en/domains/drones-air-mobility/operating-drone/specific-category-civil-drones/application-forms)
for operational authorisation, STS, cross-border operations, PDRA, SORA 2.5, and design
verification. A pack should version the form and its role independently from the law or
AMC that gives it meaning.

### Product conformity is its own evidence case

For a C0-C6 product, Regulation 2019/945 requires the manufacturer to establish and
maintain technical documentation, perform the applicable conformity assessment, issue
the EU declaration of conformity, apply CE and class markings, control series production
and changes, and retain relevant records for ten years.

The available procedures include internal production control under Module A where the
regulatory conditions are met, EU type examination followed by production control under
Modules B+C, and full quality assurance under Module H. EASA's
[placing-a-drone-on-the-market guidance](https://www.easa.europa.eu/en/document-library/general-publications/placing-drone-market-class-identification-label)
states that Module A is not available for C1, C2, or C3. Modules B+C and H involve a
notified body. The manufacturer's declaration and the notified body's assessment remain
external authorities; Casys can prepare and trace their inputs, not manufacture their
conclusions.

The same product may also fall under radio equipment, electromagnetic compatibility,
machinery, WEEE, RoHS, or other Union legislation. A UAS pack must model those as linked
applicability questions, not imply that Regulation 2019/945 is an exhaustive CE route.

## Capability and gap matrix

This matrix separates reusable Casys ingredients from target capabilities and external
authority. "Could" does not mean the regulatory feature exists today.

| Case requirement                                    | Expected evidence                                                                                                                                                   | Casys ingredient that could be reused                                                                              | Future capability or external dependency                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select Open, Specific, or Certified                 | Intended-operation description, MTOM, dimensions, altitude, VLOS/BVLOS, people and area exposure, payload, and a sourced rationale                                  | Project intent, reviewed decisions, SysON requirements, and immutable references                                   | Versioned applicability rules, national overlays, specialist review, and NAA confirmation where needed                                                                                                                                                                        |
| Demonstrate C0-C6 product conformity                | Compliance matrix, drawings, software/firmware baseline, instructions, calculations, analyses, tests, declaration, and markings                                     | SysON traceability, build123d geometry, Modelica and CalculiX results, ERPNext product records, and content hashes | Licensed standards, radio/EMC/noise/battery/environmental/flight testing, laboratory records, and notified-body workflow                                                                                                                                                      |
| Maintain production conformity                      | Approved BOM and configuration, serials/lots, inspections, changes, complaints, nonconformities, and recalls                                                        | ERPNext records plus immutable change and lineage references                                                       | Formal QMS, qualified signatures, retention policy, and market-surveillance interfaces                                                                                                                                                                                        |
| Prepare an Open operation                           | Product class and declaration, operator registration, pilot competence, remote ID, insurance, and geographical-zone check                                           | Project work items, exact evidence references, blockers, and human gates                                           | Authoritative NAA registries, credentials, national insurance rules, and current geozone/airspace data                                                                                                                                                                        |
| Prepare an STS declaration                          | C5/C6 evidence, operations manual, personnel competence, controlled-area controls, declaration, and NAA receipt                                                     | Project work items, decision receipts, activity feed, and ERPNext records                                          | NAA submission and acknowledgement plus real operational controls and logs                                                                                                                                                                                                    |
| Prepare PDRA or SORA                                | ConOps, ground and air risk, SAIL, mitigations, OSO compliance matrix, robustness, containment, evidence, and operations manual                                     | Cross-tool evidence graph with exact input/output identities and human review                                      | Validated SORA 2.5 workflow, GIS population and airspace data, flight tests, accepted means of compliance, and independent assurance                                                                                                                                          |
| Support a DVR application                           | Agreed verification basis and MoCs, configuration, compliance evidence, assumptions, and limitations                                                                | Immutable baselines, exact evidence references, and impact trace                                                   | Agreement and assessment by EASA; a DVR is not a type certificate. See [EASA DVR](https://www.easa.europa.eu/en/domains/drones-air-mobility/operating-drone/specific-category-civil-drones/design-verification-report).                                                       |
| Support certified and continuing-airworthiness work | Type design, certificate basis, conformity records, certificate of airworthiness, maintenance programme, modifications, defects, and continued-airworthiness status | Digital thread and ERP maintenance/configuration records                                                           | Part 21 and UAS airworthiness systems, approved organisations and personnel, EASA/NAA certification, oversight, and enforcement                                                                                                                                               |
| Address U-space and information security            | Geozone and service requirements, security-risk records, access control, operational service records, and incidents                                                 | Requirements, provenance, project work, and auditable decisions                                                    | Live U-space/USSP integration and specialist security controls; relevant information-security requirements apply from 2026-02-22. See [EASA U-space rules](https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-u-space-regulation-eu-2021664). |

## Authority states must be evidence-backed

A future compliance UI may use states such as `draft`, `reviewed`, `submitted`, and
`accepted`, but only if their authority is explicit:

- `draft` and internal review states belong to the project workflow;
- `submitted` requires an exact submission artifact and external receipt;
- `accepted`, `authorised`, `certified`, or `conformant` requires the signed
  declaration, authority decision, notified-body record, or other exact external source
  that grants that status;
- missing, expired, superseded, or incompatible evidence remains `unresolved`.

The cockpit must not make a final legal classification, sign for a manufacturer or
operator, choose a means of compliance without accountable review, submit on a person's
behalf without explicit authority, or issue an authorisation, class, LUC, DVR, type
certificate, or certificate of airworthiness.

## A safe first product slice

The narrow first implementation should be a future **EU UAS compliance evidence case**,
not a general-purpose regulatory reasoner:

1. register the four official source kinds and pin their versions;
2. capture a human-reviewed intended-operation profile;
3. prepare a sourced route recommendation while keeping the result non-authoritative;
4. turn selected obligations into evidence requests linked to exact thread artifacts;
5. show gaps, superseded sources, and design changes in the existing project/feed model;
6. export a review bundle whose claims, evidence, approvals, source versions, and
   external authority states remain distinguishable.

That slice validates the portable architecture. Supporting other jurisdictions is a
later extension point, not part of the first implementation. It should be possible to
add packs and overlays without changing what an engineering proof means or weakening the
boundary between preparation and authority.
