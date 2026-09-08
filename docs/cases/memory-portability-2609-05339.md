# Launch case: can local agent Memory survive an upgrade?

This case starts from version 1 of [arXiv:2609.05339](https://arxiv.org/abs/2609.05339), submitted on 4 September 2026. The paper studies portability across raw history, retrieval, model-written notes, and a fixed-schema graph. Its external content is treated as untrusted candidate evidence; this case does not reproduce the paper's experiment.

## What the local pipeline actually ran

1. Research Radar found the paper through the `ai-memory-systems` template plus the literal refinements `memory portability`, `model upgrade`, and `embedding migration`.
2. Document Intelligence parsed the pinned PDF locally with Docling 2.126.0: 18 pages, 186 blocks, exact page/block provenance, and an accepted integrity receipt.
3. Evidence Graph indexed both the parsed paper and 144 production setup components. The optional local multilingual E5 sidecar produced 549 generation-bound vectors; BM25 remains the default.
4. Setup Intelligence compared seven paper-derived capabilities with the public product. It classified four implementation candidates as observed and three as gaps.
5. A versioned baseline/intervention evaluation compared naive BM25 top-5 with typed multi-indicator reconciliation over the same setup generation.
6. The adoption decision was `deferred`. A Memory proposal was attempted only to verify the gate and was rejected before mutation.

## Result

| Check | Observed result |
| --- | --- |
| Capability status agreement | 7/7 |
| Known false positives, naive BM25 | 22 |
| Known false positives, typed reconciliation | 0 |
| Implemented candidates | provenance, embedding identity, fixed-schema Memory, approval gate |
| Gap candidates | protected raw-source retention, migration evaluation, token measurement |
| Memory after the run | 0 candidates, 0 claims |
| Adoption decision | deferred |

This is a positive result for the reconciliation mechanism and a negative result for immediate adoption. It is not evidence that the paper's measured gains transfer to this product, and it is not evidence of productivity or token savings.

## Why keyword + embedding + graph are all present

- FTS5/BM25 supplies inspectable lexical matches and remains the default retrieval path.
- A pinned multilingual embedding model improves candidate recall across wording and languages; its cache key binds text hash, model revision, role, preprocessing, runtime, and architecture.
- The graph connects sources, chunks, typed setup components, capabilities, citations, protocols, receipts, and decisions.
- Exact source reopen, evaluator receipts, and human approval remain authoritative. Similarity is never treated as proof.

Machine-readable results are in [`evidence/cases/arxiv-2609-05339v1.json`](../../evidence/cases/arxiv-2609-05339v1.json).
