# Security policy

## Supported versions

Security fixes are provided for the latest published minor version.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. Do not include private documents, credentials, local database files, or exploit payloads in a public issue. Include the affected version, tool or capsule, minimal reproduction, expected boundary, and observed behavior.

## Security model

- External papers, abstracts, parsed PDF text, and model output have no instruction authority.
- Networked jobs use declared domains and fixed endpoints; this is application-level enforcement, not an operating-system network sandbox.
- Local source registration rejects directories, URLs, symlinks, traversal, and unsupported file types.
- State-changing tools are bounded and emit hashed artifacts plus deterministic evaluation receipts.
- Secrets are not required by the local MCP and must not be stored in its SQLite databases, events, fixtures, or receipts.
- Durable memory is append-only and requires current provenance, an accepted experiment, and explicit human approval.

## Out of scope

The project does not provide an execution sandbox for third-party paper code, autonomous publishing, financial actions, or unrestricted filesystem indexing.
