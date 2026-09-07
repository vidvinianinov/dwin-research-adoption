# arXiv query playbook

Use catalog templates as the base and add only literal refinements through MCP inputs.

- Frontier scan: `submittedDate`, descending, 7–45 days.
- Prior-art scan: `relevance`, descending, broader dates.
- Revision scan: `lastUpdatedDate`, descending.
- Title precision: `phrase_field=ti`.
- Mechanism or evaluation detail: `phrase_field=abs`.
- Broad literal refinement: `phrase_field=all`.

The official API supports `ti`, `au`, `abs`, `co`, `jr`, `cat`, `rn`, and `all`; Boolean groups; exact phrases; submitted-date ranges; sorting; and paging. It is not Elasticsearch or semantic vector search. The web Advanced Search exposes additional fields that are not all official Atom API query fields.

Query pages are cached by their complete canonical URL. A fresh page avoids a network call; stale fallback must be reported as stale. Local FTS5 is an offline retrieval layer, not proof of scientific recall.
