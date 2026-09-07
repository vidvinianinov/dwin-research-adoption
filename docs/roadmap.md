# Goal chain

This roadmap is dependency-ordered. A later goal does not bypass the exit criteria of an earlier one.

## North-star outcome

A user can take a version-pinned AI research claim, compare it with a real agent setup, run a declared baseline/intervention evaluation, and accept or reject a reversible change without silently promoting unverified content into durable memory.

## G0 — Safe public boundary

**Status:** complete

Exit criteria:

- one public MCP entrypoint fronts the bounded capsules;
- personal sessions, finances, employer material, credentials, and absolute user paths are absent;
- license, security, privacy, support, terms, contracts, policies, and release evidence are present;
- the complete local verification suite passes.

## G1 — Public source and skill distribution

**Status:** complete

Depends on: G0

Exit criteria:

- the canonical public GitHub repository exists;
- all three skills install from a fresh GitHub download;
- skills.sh can discover the repository and skill names;
- install instructions reference the verified publisher identity.

## G2 — Reproducible executable distribution

**Status:** complete

Depends on: G0

Exit criteria:

- version `0.1.0` is published to npm;
- a clean temporary installation starts the MCP and lists the expected basic tool surface;
- `io.github.vidvinianinov/dwin-research-adoption` is published to the official MCP Registry;
- the Registry record resolves to the exact npm version and public repository.

## G3 — Proof-quality launch artifact

**Status:** in progress

Depends on: G1 and G2

Exit criteria:

- a 60-second demo reproduces paper discovery, evidence recovery, a setup-gap candidate, and a no-silent-mutation boundary;
- the demo command and fixture work from a clean environment;
- a tagged GitHub release links the package, receipt, demo, limitations, and rollback instructions;
- at least one negative or unchanged evaluation outcome is shown alongside positive behavior.

Current evidence:

- tagged release `v0.1.0`, npm distribution, Registry metadata, and clean-install demo are live;
- the current demo proves discovery, deterministic routing, and no silent durable mutation;
- evidence recovery, a setup-gap candidate, and an explicit negative or unchanged adoption evaluation remain to be added before G3 is complete.

## G4 — External activation evidence

**Status:** queued

Depends on: G3

Exit criteria:

- five external design partners complete a first research-to-adoption run;
- median time to first reviewable result is measured;
- failures and abandoned runs are retained rather than counted as successes;
- three recurring user problems are supported by observed evidence, not feature requests alone.

## G5 — Product efficacy benchmark

**Status:** queued

Depends on: G4

Exit criteria:

- a versioned task suite covers research retrieval, evidence grounding, setup reconciliation, evaluation, rejection, and memory approval;
- baseline and intervention use fixed model, tool, task, and evaluator conditions;
- task success, citation coverage, latency, tokens, tool calls, human intervention, and failure rate are reported;
- every public improvement claim is reproducible or explicitly labeled unverified.

## G6 — Paid problem validation

**Status:** queued

Depends on: G4 and G5

Exit criteria:

- three paid, bounded setup audits are delivered;
- at least one audit converts into a research-adoption sprint;
- delivery time, client reuse, measurable outcome, and support burden are known;
- the same valuable problem recurs across at least three qualified users before it becomes a product feature.

## G7 — Hosted and team pilot

**Status:** conditional

Depends on: G6

Build only when paid evidence requires scheduled or collaborative operation.

Exit criteria:

- a hardened Streamable HTTP MCP has authentication, tenant isolation, quotas, audit logs, deletion/export controls, and operational monitoring;
- public contracts remain compatible with the local edition or differences are explicit;
- a skills-only OpenAI Plugin has completed review preparation;
- a combined MCP + skills Plugin is submitted only after the production endpoint and domain are verified.

## G8 — Defensible enterprise product

**Status:** conditional

Depends on: G7 and retained team usage

Candidate scope:

- private research and repository connectors;
- organization policy and human approval workflows;
- maintained evaluation corpora and longitudinal outcome analytics;
- SSO/SCIM, role-based access, deployment controls, and SLA-backed operations.

Exit criteria are defined from retained customer evidence rather than a speculative feature checklist.

## Operating rule

The next goal is always the earliest incomplete goal whose dependencies are satisfied. New MCPs or skills enter the roadmap only when they remove an evidenced blocker in that chain.
