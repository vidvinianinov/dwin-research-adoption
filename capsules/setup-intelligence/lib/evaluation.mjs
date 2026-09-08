import { performance } from "node:perf_hooks";
import { CAPABILITIES } from "./store.mjs";

const excluded = locator => {
  const value = locator.toLowerCase();
  return value.includes("/fixtures/") || value.includes("/test/") || value.includes("/tests/") || value.includes("/docs/") || value.includes("/capsules/setup-intelligence/");
};

export function evaluateReconciliation(store, testCase) {
  const started = performance.now(), capabilities = Object.keys(testCase.expected), baseline = new Map();
  for (const id of capabilities) baseline.set(id, store.search({ query: CAPABILITIES[id].join(" "), context_id: testCase.case_id, limit: 5, preview_chars: 0 }).results);
  const intervention = store.reconcile({ claim: testCase.claim, capabilities, limit_per_capability: 5 });
  const outcomes = capabilities.map(id => {
    const typed = intervention.capabilities.find(item => item.id === id), raw = baseline.get(id), baselineFalse = raw.filter(item => excluded(item.locator)).length, interventionFalse = typed.matches.filter(item => excluded(item.locator)).length;
    return { capability_id: id, expected_status: testCase.expected[id], observed_status: typed.status, status_matches: typed.status === testCase.expected[id], baseline_candidates: raw.length, baseline_known_false_positives: baselineFalse, intervention_candidates: typed.matches.length, intervention_known_false_positives: interventionFalse, evidence_locators: typed.matches.map(item => item.locator) };
  });
  const metrics = { capability_status_accuracy: outcomes.filter(item => item.status_matches).length / outcomes.length, baseline_known_false_positives: outcomes.reduce((sum, item) => sum + item.baseline_known_false_positives, 0), intervention_known_false_positives: outcomes.reduce((sum, item) => sum + item.intervention_known_false_positives, 0), model_tokens: null, tool_calls: capabilities.length + 1, duration_ms: Math.round(performance.now() - started) };
  const passed = metrics.capability_status_accuracy === 1 && metrics.baseline_known_false_positives > 0 && metrics.intervention_known_false_positives === 0;
  return { schema_version: "dwin.setup-reconciliation-eval/v1", case_id: testCase.case_id, paper: testCase.paper, setup_generation: intervention.setup_generation, arms: { baseline: "untyped-bm25-top5", intervention: "typed-multi-indicator-reconciliation-v1" }, outcomes, metrics, passed, boundaries: { paper_reproduced: false, memory_changed: false, setup_changed: false, scientific_verification: false, decision: "deferred" } };
}
