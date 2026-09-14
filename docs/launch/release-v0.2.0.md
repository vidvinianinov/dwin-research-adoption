# DWIN Research Adoption v0.2.0

This release adds a source-bound way to compare a version-pinned paper with a local agent setup. It finds reviewable setup-gap candidates; it does not silently modify the setup or promote paper text into Memory.

## What's included

- One local stdio MCP with seven bounded capsules and 38 tools in the default profile.
- Explicit setup registration and indexing for skills, MCP manifests, instructions, hooks, scripts, contracts, policies, evals, and evidence. No home-directory scan.
- Exact setup-evidence reopen, typed graph relationships, and gap-candidate reconciliation.
- Optional pinned local multilingual embeddings alongside default FTS5/BM25 retrieval.
- A local PDF-to-evidence path, with Docling provisioned separately rather than bundled.
- A bounded daily scheduler that writes receipts but never publishes posts or approves changes.

## Reproducible case

The [memory-portability case](https://github.com/vidvinianinov/dwin-research-adoption/blob/v0.2.0/docs/cases/memory-portability-2609-05339.md) uses [arXiv:2609.05339v1](https://arxiv.org/abs/2609.05339). It reports 18 parsed pages, 186 source-bound blocks, 144 indexed setup components, 22 known false positives for a naive keyword baseline versus 0 for typed reconciliation in this one labeled case, and three gap candidates. Adoption was deferred; Memory remained unchanged. The [machine-readable evidence](https://github.com/vidvinianinov/dwin-research-adoption/blob/v0.2.0/evidence/cases/arxiv-2609-05339v1.json) is included.

## Verify

```bash
git clone --branch v0.2.0 https://github.com/vidvinianinov/dwin-research-adoption.git
cd dwin-research-adoption
npm ci
npm run verify
```

The offline demo is a sanitized fixture. The real-paper case is a separate local result; it does not reproduce the paper's scientific experiment.

The [release receipt](https://github.com/vidvinianinov/dwin-research-adoption/blob/v0.2.0/evidence/release-receipt.json) records the package source-tree hash and local verification gates. The package is published as [`dwin-research-adoption@0.2.0`](https://www.npmjs.com/package/dwin-research-adoption/v/0.2.0) and registered as `io.github.vidvinianinov/dwin-research-adoption` in the official MCP Registry.

## Limits and rollback

This is local, single-user software. The current evidence does not establish general task-success improvement, token savings, or autonomous self-updating. Similarity and graph edges are candidates, not proof. Durable Memory requires an accepted evaluation and explicit human approval.

To roll back, pin the client configuration to `dwin-research-adoption@0.1.0` or remove its MCP entry. Neither action silently deletes local application data; inspect or export it before any explicit deletion.
