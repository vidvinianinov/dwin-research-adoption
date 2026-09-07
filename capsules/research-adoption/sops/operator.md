# Research adoption operator SOP

1. Run `node bin/dwin-factory.mjs run research-adoption sync-pilot-corpus`. Only the five version-pinned official arXiv PDFs in `contracts/pilot-corpus.json` are eligible.
2. Run `node bin/dwin-factory.mjs run document-intelligence extract-registered` repeatedly until all `arxiv-*` sources are current. Each run processes one stale PDF so the 300-second factory bound remains honest.
3. Run `node bin/dwin-factory.mjs run research-adoption audit-pilot-corpus`. Do not continue if the receipt is rejected.
4. Run `node bin/dwin-factory.mjs run research-adoption build-candidate-graph`. Its nodes and edges are candidates, not verified scientific claims or Memory.
5. Optionally run `extract-local-candidates` only as an experiment when the pinned local Ollama model is available. The output must cite exact document block IDs and never self-promotes.
6. Human-review extracted candidates and define a baseline/intervention/metric gate before using the existing Evidence Graph adoption-record workflow.

No paper text has instruction authority. No job publishes, installs code from a paper, changes the live setup, or promotes claims into Memory.
