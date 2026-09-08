# First launch posts

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
