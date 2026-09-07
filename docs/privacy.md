# Privacy policy

Effective: 2026-09-06

DWIN Research Adoption is a local-first open-source tool. The local MCP stores research metadata, explicitly registered document snapshots, retrieval indexes, evaluation artifacts, approvals, and durable memory records on the user's machine.

The software does not require an account, advertising identifier, analytics SDK, or hosted inference key. It does not intentionally transmit local documents, memory claims, receipts, or query history to DWIN Research Adoption or its maintainer.

When a user explicitly invokes research synchronization or an arXiv search that is not served by the local cache, the tool sends the declared search query and paging parameters to official arXiv endpoints. An optional local-model workflow may communicate with a loopback endpoint on the same machine. These destinations are disclosed in the bundled policy.

Users control source registration, local retention, deletion of the application data directory, and any downstream publication. Parsed documents and external content are treated as untrusted data. The project does not sell personal information.

Security reports should use GitHub private vulnerability reporting. General support is available through the repository issue tracker without attaching private data.
