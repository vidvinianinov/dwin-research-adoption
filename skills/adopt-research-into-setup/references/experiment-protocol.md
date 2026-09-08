# Adoption experiment protocol

Declare before execution:

- exact paper version and cited evidence spans;
- exact registered setup generation, component locators, and reopened source hashes;
- one problem and hypothesized mechanism;
- immutable baseline and one intervention;
- representative tasks plus unseen holdouts;
- task success, groundedness, regression, latency, tool-call, and token metrics;
- environment controls: model, reasoning, permissions, tools, seed when available;
- minimum improvement and maximum regression;
- stopping condition and rollback.

Record raw artifacts, configuration hashes, evaluator version, failures, and limitations. A failed or ambiguous gate yields `deferred` or `rejected`, not a tuned narrative. Do not reuse the holdout to tune the intervention.

For retrieval or reconciliation changes, record the candidate-source corpus and distinguish lexical matching, semantic candidate recall, graph connectivity, and exact-source verification. Never count documentation, fixtures, tests, or an analyzer's own capability vocabulary as proof that the target capability is implemented.
