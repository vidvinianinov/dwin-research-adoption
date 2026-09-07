# DWIN Research Adoption

Turn AI research into measured setup improvements without letting papers silently rewrite your system.

This repository contains one local MCP entrypoint plus three reusable skills. The workflow keeps five states separate:

1. discover a versioned paper;
2. recover source-bound evidence;
3. propose a narrow change;
4. compare baseline and intervention under a declared gate;
5. promote a durable memory only after explicit human approval.

The MCP combines six bounded capsules: Research Radar, Document Intelligence, Evidence Graph, Research Adoption, Memory Graph, and Factory Health. It does not include personal session history, financial data, employer artifacts, or private source corpora.

## Install the MCP

After the npm release:

```bash
npx -y dwin-research-adoption@0.1.0
```

Generic MCP client configuration:

```json
{
  "mcpServers": {
    "dwin-research-adoption": {
      "command": "npx",
      "args": ["-y", "dwin-research-adoption@0.1.0"]
    }
  }
}
```

No API key is required. The default data directory is private application data; override it with `DWIN_FACTORY_DATA` when isolation is needed. Network access is deny-by-default. Only official arXiv endpoints and an optional loopback local-model endpoint are allowlisted by the bundled policy.

The default `basic` profile exposes the end-to-end workflow without diagnostic tool noise. Set `DWIN_TOOL_PROFILE=full` to expose advanced category scans, watches, embedding experiments, and the pinned demonstration corpus.

## Install the skills

After the GitHub release:

```bash
npx skills add vidvinianinov/dwin-research-adoption
```

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

`npm run demo` uses a sanitized offline arXiv fixture. It discovers the unified tools, routes an AI-memory problem, compiles an inspectable query, performs a fixture-backed search, and emits a deterministic demo summary. `npm run audit:release` inspects the exact npm file list for secrets, personal paths, employer terms, symlinks, and metadata drift.

## Product boundary

The default retrieval path is lexical and source-cited. Optional embeddings are local, pinned, hash-cached, and experimental; they do not confer truth or authority. Parsed PDFs and external abstracts are untrusted inputs. Graph edges are candidate relationships. Only evaluator receipts plus a current human approval can authorize durable memory.

The local stdio package is Apache-2.0. A future hosted service may add managed scheduling, organization policy, collaborative approvals, and hosted evaluation while preserving the public contracts.

## Security and privacy

See [SECURITY.md](SECURITY.md), [Privacy](docs/privacy.md), and [Terms](docs/terms.md). Report vulnerabilities privately rather than opening a public issue.

MCP Registry name: `io.github.vidvinianinov/dwin-research-adoption`
