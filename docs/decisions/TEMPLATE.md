# ADR-NNNN: <short imperative title>

- **Status:** Proposed | Accepted | Rejected | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD
- **Deciders:** <who owns / who reviewed>
- **Issue:** #NNNN
- **Supersedes / Obsoletes:** <prior decisions or issues, if any>

---

## Context and problem statement

<The forces at play, in a few sentences. State the question being decided. Cite code/specs with paths so a reviewer can verify claims, not take them on trust.>

## Decision drivers

- <driver / constraint>
- <driver / constraint>

## Considered options

- **A — <name>.**
- **B — <name>.**
- **C — <name>.**

## Decision outcome

**Chosen: Option <X>**, because <justification tied to the drivers>.

<Any contingency, and the mandated implementation order if the decision is conditional.>

## Consequences

**Good** — <positive outcomes>
**Bad / cost** — <costs, new obligations, debt>
**Neutral** — <unchanged / out of scope>

## Compliance

<How we verify the decision is actually honored: specific tests, migration gates, lint/grep checks, review criteria. A decision with no compliance check is a suggestion.>

## Pros and cons of the options

- **A:** + <pro> − <con>
- **B:** + <pro> − <con>

## References

- <specs, plans, code paths, issues>

---

<!--
Convention for docs/decisions/:
- One file per decision, named `YYYY-MM-DD-<kebab-title>.md`; ADR numbers are assigned in the H1.
- Every factual claim about the codebase cites a `path:line` so reviewers can check it.
- Status is kept current; a reversed decision is marked Superseded and links its replacement.
-->
