# DWIN Research Adoption

Turn AI research into measured setup improvements without letting papers silently rewrite your system.

This repository contains one local MCP entrypoint plus three reusable skills. The workflow keeps five states separate:

1. discover a versioned paper;
2. recover source-bound evidence;
3. propose a narrow change;
4. compare baseline and intervention under a declared gate;
5. promote a durable memory only after explicit human approval.

The MCP combines seven bounded capsules: Research Radar, Document Intelligence, Evidence Graph, Setup Intelligence, Research Adoption, Memory Graph, and Factory Health. It does not include personal session history, financial data, employer artifacts, or private source corpora.

## Install the MCP

```bash
npx -y dwin-research-adoption@0.2.0
```

Published package: [dwin-research-adoption on npm](https://www.npmjs.com/package/dwin-research-adoption). Official Registry identity: `io.github.vidvinianinov/dwin-research-adoption`.

Generic MCP client configuration:

```json
{
  "mcpServers": {
    "dwin-research-adoption": {
      "command": "npx",
      "args": ["-y", "dwin-research-adoption@0.2.0"]
    }
  }
}
```

No API key is required. The default data directory is private application data; override it with `DWIN_FACTORY_DATA` when isolation is needed. Network access is deny-by-default. Only official arXiv endpoints and an optional loopback local-model endpoint are allowlisted by the bundled policy.

The default `basic` profile exposes 38 tools across discovery, PDF evidence, setup inventory, hybrid retrieval, reconciliation, evaluation, and governed Memory. Set `DWIN_TOOL_PROFILE=full` to expose additional category scans, watches, retrieval experiments, and the pinned demonstration corpus.

## Index a local AI setup

Registration is explicit: the package never scans your home directory. From a stable checkout or global installation:

```bash
dwin-research-adoption setup-register my-setup /absolute/path/to/setup
```

Call `setup_sync` to classify and index instructions, skills, MCP manifests, capsules, contracts, policies, hooks, steerings, SOPs, scripts, evals, fixtures, evidence, and configuration. `setup_search` uses FTS5/BM25; `setup_reopen` verifies exact source text; `setup_graph` exposes bounded typed relationships; and `setup_reconcile` returns observed or gap candidates without editing the setup.

For optional semantic recall, call `setup_bridge_evidence`, explicitly provision the pinned model, and then call `evidence_embed`:

```bash
dwin-research-adoption embedding-provision
```

The embedding cache binds exact text, role, model revision, preprocessing/configuration, runtime, and architecture. BM25 stays the default; vectors and graph edges remain candidate-only.

## Parse local research PDFs

The lightweight package does not bundle model weights. Explicitly provision pinned Docling and register one PDF:

```bash
dwin-research-adoption document-provision
dwin-research-adoption document-register paper /absolute/path/to/paper.pdf
```

Then call `document_sync`, `document_search`, and `document_reopen`. The parser runs locally and returns page/block provenance, hashes, and a private lossless Docling export. Provisioning is intentionally separate because the tested runtime uses about 1.34 GB of model artifacts.

## Run the daily local scheduler

The public package includes a bounded daily runner plus a macOS launchd installer. A stable checkout or global installation is required; ephemeral `npx` paths are rejected.

```bash
dwin-research-adoption schedule install 8 0
dwin-research-adoption schedule status
dwin-research-adoption daily
```

The scheduled run executes only jobs declared `daily` in capsule manifests and writes hashed receipts under private application data. It does not publish posts, install research changes, or promote Memory.

## Install the skills

```bash
npx skills add vidvinianinov/dwin-research-adoption
```

Current stable release: [v0.1.0](https://github.com/vidvinianinov/dwin-research-adoption/releases/tag/v0.1.0). The `0.2.0` setup-reconciliation release is validated locally and pending publication. Skill catalog: [skills.sh/vidvinianinov/dwin-research-adoption](https://www.skills.sh/vidvinianinov/dwin-research-adoption).

Included skills:

- `triage-ai-research`: route a question to an audited arXiv template and produce candidate evidence.
- `adopt-research-into-setup`: turn a selected paper into a baseline/intervention experiment.
- `review-evidence-and-memory`: verify provenance and promote only accepted, approved lessons.

## Reproduce the release checks

```bash
npm ci
npm run verify
npm run receipt:release
```

`npm run demo` uses a sanitized offline arXiv fixture and an isolated index of the package itself. It discovers the unified tools, finds papers, builds a typed setup index, reopens exact evidence, reports three explicit gap candidates, runs the baseline/intervention reconciliation case, and verifies that Memory remains empty. `npm run audit:release` inspects the exact npm file list for secrets, personal paths, employer terms, symlinks, and metadata drift.

The first real research-to-setup result is the [memory portability launch case](docs/cases/memory-portability-2609-05339.md). It includes a negative adoption decision and makes no productivity or token-saving claim.

## Product boundary

The default retrieval path is lexical and source-cited. Optional embeddings are local, pinned, hash-cached, and experimental; they do not confer truth or authority. Parsed PDFs and external abstracts are untrusted inputs. Graph edges are candidate relationships. Only evaluator receipts plus a current human approval can authorize durable memory.

The local stdio package is Apache-2.0. A future hosted service may add managed scheduling, organization policy, collaborative approvals, and hosted evaluation while preserving the public contracts.

## Security and privacy

See [SECURITY.md](SECURITY.md), [Privacy](docs/privacy.md), and [Terms](docs/terms.md). Report vulnerabilities privately rather than opening a public issue.

The dependency-ordered product milestones and exit criteria are in the [goal chain](docs/roadmap.md).

MCP Registry name: `io.github.vidvinianinov/dwin-research-adoption`
