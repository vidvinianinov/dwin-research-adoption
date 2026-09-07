# Memory operator SOP

1. Keep model and paper outputs outside active Memory.
2. Create an Evidence Graph adoption record that cites exact source bytes and an `ACCEPTED` baseline/intervention experiment receipt.
3. Call `memory_propose` with a future expiry, confidence, scope and rationale. This creates an immutable candidate only.
4. Reopen the evidence and review the claim. Call `memory_promote` only after the user explicitly approves it in the current task.
5. Correct memories by creating a new candidate and setting `supersedes_claim_id`; prior records remain auditable.
6. The daily validation reports expired or unavailable provenance without deleting history. Search excludes expired and superseded claims by default.
