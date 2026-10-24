# Integration testing with GenAI: Orders ↔ Inventory

Experiment for the Unit III forum. I defined **3 prompt types** to support integration testing between two REST services, ran each one in a naive version (v1) and a refined version (v2/v3) on an LLM, and turned the generated cases into an **automated suite of 72 tests**. That suite **found 3 real defects** in the system.

## Scenario

```
Cliente ──HTTP──▶ Pedidos (:3000) ──HTTP──▶ Estoque (:3001)
                   │  for each item: GET /produtos/{id} → POST /reservas
                   └─ on failure: DELETE /reservas/{id} (compensation / saga)
```

The **Orders** service creates orders by reserving items in the **Inventory** service. If any item fails (missing stock, product not found, timeout, 5xx, invalid response), it undoes the reservations that were already made. The full contract is in [docs/contrato-api.md](docs/contrato-api.md).

## Prompt types

| # | Type | v1 technique | v2/v3 technique | Prompts | Raw responses | Tests |
|---|---|---|---|---|---|---|
| 1 | Integration scenarios | zero-shot | role + contract + constraints + table format | [prompts/01](prompts/01-cenarios-integracao.md) | [v1](respostas-llm/01-cenarios-v1.md) · [v2](respostas-llm/01-cenarios-v2.md) | [01-cenarios.test.js](tests/integracao/01-cenarios.test.js) |
| 2 | Error and communication-failure cases | zero-shot | **few-shot** + guided reasoning (failure taxonomy) + HTTP stub | [prompts/02](prompts/02-casos-de-erro.md) | [v1](respostas-llm/02-erros-v1.md) · [v2](respostas-llm/02-erros-v2.md) | [02-erros.test.js](tests/integracao/02-erros.test.js) |
| 3 | API contract + test data | zero-shot | persona + partitioning/boundary values + **JSON output** | [prompts/03](prompts/03-contrato-e-dados.md) | [v1](respostas-llm/03-dados-v1.md) · [v2](respostas-llm/03-dados-v2.json) · [v3](respostas-llm/03-dados-v3.json) | [03-contrato-dados.test.js](tests/integracao/03-contrato-dados.test.js) |

LLM used: **Claude Sonnet 5.5**, in a clean session where the model saw only the prompt text. The responses were saved without edits.

## Results

| | v1 (no context) | v2/v3 (refined) |
|---|---|---|
| Cases generated | 148 | 69 |
| Invented endpoints/fields | many (including a whole schema) | 0 |
| Ambiguous expected results ("400/422") | yes | no |
| Usable as they came | 0 | 69 |
| Defects found | 0 | **3** |

**Defects found by the generated tests** ([execution before the fixes](docs/evidencias/execucao-1-antes-das-correcoes.txt)):

1. **ERR-11 (prompt 2):** when `POST /reservas` returned 404 (product removed between the GET and the POST), Orders answered `502` instead of `422`.
2. **CT-06 and CT-07 (prompt 3 v3):** total rounding with `Math.round(x*100)/100` broke on binary floating point (`1.005 × 3` gave `3.01` instead of `3.02`).

The full analysis, covering how each prompt type affected quality and diversity and which adjustments were needed, is in **[docs/analise.md](docs/analise.md)**.

## How to run

Requires **Node.js 20+**. There are no dependencies to install.

```bash
npm test
```

Each test starts the real services (or a programmable HTTP stub in place of Inventory) on random ports and shuts them down at the end.

To explore the API by hand:

```bash
npm run start:estoque     # terminal 1
npm run start:pedidos     # terminal 2
curl -X POST localhost:3000/pedidos -H "Content-Type: application/json" \
  -d '{"cliente":"Ana","itens":[{"produtoId":"P1","quantidade":2}]}'
```

## Structure

```
src/                 system under test (Orders and Inventory services)
docs/contrato-api.md API contract (context used in the v2/v3 prompts)
prompts/             the prompts, v1 and v2/v3, with the reason for each adjustment
respostas-llm/       raw responses from the LLM
tests/integracao/    automated tests derived from the responses
docs/analise.md      comparison of prompt types and lessons learned
docs/evidencias/     test runs before and after the fixes
```
