# Setup Intelligence operator SOP

1. Register only one explicit repository, plugin, skill, or configuration root with `node capsules/setup-intelligence/scripts/register-root.mjs <alias> <absolute-path>`.
2. Run `setup_sync`; inspect its receipt and `setup_status` before searching.
3. Use `setup_search` and `setup_reopen` for exact lexical evidence. Use `setup_graph` only for bounded candidate relationships.
4. Run `setup_bridge_evidence` to expose a path-redacted private snapshot to Evidence Graph. Then run the separate `evidence_embed` job if the pinned local embedding model is available.
5. Use `setup_reconcile` to propose gaps. Do not edit configuration, install code, or promote Memory without a declared baseline/intervention evaluation and explicit approval.
