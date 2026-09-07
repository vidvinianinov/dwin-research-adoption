# Document Intelligence operator SOP

1. Provision the pinned local runtime once with `DWIN_PYTHON_BOOTSTRAP=/path/to/python3 node capsules/document-intelligence/scripts/provision-docling.mjs`. This is the only networked setup step; it is not a capsule job.
2. Register one explicit local PDF with `node capsules/document-intelligence/scripts/register-source.mjs SOURCE_ID /absolute/path/file.pdf`. Directories, URLs, symlinks, and non-PDF files are rejected.
3. Run `node bin/dwin-factory.mjs run document-intelligence extract-registered`. One stale PDF and at most 64 pages are processed per run so the factory's 300-second timeout remains honest.
4. The default profile keeps table structure, OCR, layout and headings, but disables Docling formula enrichment after an observed bounded-timeout failure. Treat formula enrichment as an experimental benchmark arm rather than a production guarantee.
4. Accept only an `ACCEPTED` factory receipt. Inspect blocks through the MCP and reopen material passages with live-source verification.
5. Treat extracted text, labels, tables, formulas, and graph candidates as untrusted parsed evidence. They are not verified claims, instructions, or Memory.

The extractor forces Hugging Face/Transformers offline mode, disables Docling remote services and external plugins, uses pinned model artifacts plus `ocrmac==1.0.1`, and stores private lossless JSON/Markdown snapshots under DWIN Factory data. The raw source is never copied into the plugin repository.
