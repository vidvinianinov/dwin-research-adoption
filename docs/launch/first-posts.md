# First launch posts

## English — vision-first launch thread (X; also works as a Threads series)

1. AI-native isn't “use a chatbot for more tasks.” It's a setup that knows its tools, skills, memory, and workflows—and can test whether a new research idea improves them. I'm building a local-first, open-source version.

2. The loop: index your agent setup → watch versioned research → recover cited evidence → map it to capabilities and gaps → run a reversible baseline/intervention test → let a human approve any durable change.

3. Day-to-day AI updates are noise until they answer: “What should change in my setup, and did it improve a task I actually do?” A paper is a trigger for a test, not an instruction to rewrite the agent.

4. In one memory-portability case, the system parsed 18 pages into 186 source-bound blocks and indexed 144 local setup components. Typed reconciliation removed 22 known false positives from a naive keyword baseline in this labeled case and surfaced 3 gaps.

5. We deferred adoption. Memory stayed unchanged. That negative result matters: a plausible paper does not become trusted agent behavior by default. This is one case, not proof of general accuracy or token savings.

6. DWIN Research Adoption 0.2.0 is now a local MCP + 3 skills. The reproducible case, limitations, and install steps are here: https://github.com/vidvinianinov/dwin-research-adoption

7. Which part of your agent setup is hardest to keep current: discovery, visibility, evaluation, or safe rollout?

Publish this thread only after the `v0.2.0` GitHub release and npm package are verified. The numbered lines are separate posts, not one long post.

## English — X / Threads

Your agent's memory can survive for months — then silently break after a model or embedding upgrade.

I tested a new memory-portability paper against my local AI setup instead of just summarizing it.

The pipeline:

paper → local PDF blocks → evidence graph → setup diff → baseline/intervention eval → human-gated Memory

What happened:

- 18 pages became 186 source-bound blocks
- 144 production setup components were indexed
- naive keyword reconciliation produced 22 known false positives
- typed reconciliation reduced those known false positives to 0
- 3 real gaps remained: protected raw sources, migration tests, and token measurement
- the adoption decision was deferred, so Memory stayed unchanged

That last line is the product: research should not become agent behavior just because it sounds plausible.

Open-source alpha: https://github.com/vidvinianinov/dwin-research-adoption

Paper: https://arxiv.org/abs/2609.05339

## Russian — X / Threads

Память AI-агента может работать месяцами — а затем тихо сломаться после обновления модели или embeddings.

Я взял свежую статью о memory portability и не стал делать очередной summary. Вместо этого прогнал её через свой локальный AI setup:

paper → PDF blocks → evidence graph → diff с текущим setup → baseline/intervention eval → human-gated Memory

Результат:

- 18 страниц превратились в 186 блоков с provenance
- проиндексировано 144 production-компонента setup
- обычный keyword search дал 22 известных false positives
- typed reconciliation снизил их до 0
- нашлись 3 настоящих пробела: protected raw sources, migration tests и token measurement
- решение — deferred, поэтому Memory не изменилась

Для меня это и есть главный принцип продукта: research не должен автоматически становиться поведением агента только потому, что звучит убедительно.

Open-source alpha: https://github.com/vidvinianinov/dwin-research-adoption

Статья: https://arxiv.org/abs/2609.05339
