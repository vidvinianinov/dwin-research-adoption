---
name: review-evidence-and-memory
description: Audit source-bound evidence, candidate graphs, adoption receipts, and durable DWIN memory with provenance, confidence, expiry, and explicit approval. Use when reviewing a research adoption result or deciding what deserves long-term memory; not for semantic answer caching or saving unverified paper claims.
---

# Review Evidence And Memory

Use DWIN MCP tools when they are connected. In a skills-only installation, audit the evidence supplied in the current context and return either a candidate record or explicit missing gates; do not claim persistence or promotion.

1. Call `evidence_status` and `memory_status` when available. Do not infer current evidence from a prior task or cached answer.
2. Search with a small bounded `evidence_search` query. Use `evidence_reopen` with live verification for material claims; changed, missing, or unavailable sources are historical evidence only.
3. Treat `MENTIONS`, `REFERENCES`, dimension links, embedding neighbors, and graph proximity as candidate relations. None proves truth, resolution, or semantic equivalence.
4. Inspect the adoption record's exact paper version, evidence spans, protocol, execution receipt, evaluator, decision, and limitations. Require an accepted execution receipt, a passed declared gate, and a still-`proposed` adoption decision before creating a memory candidate. `deferred` and `rejected` records are non-promotable.
5. Call `memory_propose` first when available; otherwise return the candidate without persistence. Present its claim, scope, confidence, provenance, expiry, and limitations.
6. Call `memory_promote` only after explicit approval in the current task and only when the tool is available. Corrections append a new claim with `supersedes_claim_id`; never rewrite history.
7. Run `memory_validate` after promotion or when evidence, expiry, or supersession may have changed.

Never store secrets, employer material, raw model output, unverified paper claims, private document bodies, or semantic answer-cache entries. Follow [references/memory-policy.md](references/memory-policy.md).
