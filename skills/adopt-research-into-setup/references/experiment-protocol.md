# Adoption experiment protocol

Declare before execution:

- exact paper version and cited evidence spans;
- one problem and hypothesized mechanism;
- immutable baseline and one intervention;
- representative tasks plus unseen holdouts;
- task success, groundedness, regression, latency, tool-call, and token metrics;
- environment controls: model, reasoning, permissions, tools, seed when available;
- minimum improvement and maximum regression;
- stopping condition and rollback.

Record raw artifacts, configuration hashes, evaluator version, failures, and limitations. A failed or ambiguous gate yields `deferred` or `rejected`, not a tuned narrative. Do not reuse the holdout to tune the intervention.
