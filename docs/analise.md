# Analysis: how each prompt type affected the test cases

All prompts were run on **Claude Sonnet 5.5** in a clean session. The model saw only the prompt text, with no access to the code. The raw responses are in [`respostas-llm/`](../respostas-llm/), unedited.

## Summary in numbers

| Prompt | Version | Cases generated | Invented elements (endpoints/fields/rules) | Usable as they came | Became automated tests | Defects found |
|---|---|---|---|---|---|---|
| 1. Integration scenarios | v1, zero-shot | 38 | 4 invented endpoints, plus payment, retry, circuit breaker, TTL, auth | 0 (wrong endpoints); ~16 usable after adapting | 1 (the concurrency idea) | 0 |
| | v2, role + context + format | 12 | 0 | 12 | 12 | 0 |
| 2. Error cases | v1, zero-shot | 61 (bullets) | Messaging, TLS, 429, 401/403 | 0 (no data or expected result) | 0 | 0 |
| | v2, few-shot + guided reasoning | 12 + 17 ambiguities | 0 | 12 | 12 | **1** |
| 3. Contract and data | v1, zero-shot | 49 | **Whole schema invented** (`clienteId`, `formaPagamento`, address…) | 0 | 0 | 0 |
| | v2, persona + techniques + JSON | 20 | 0 | 20 | 20 | 0 |
| | v3, adjusted after v2 | 25 | 0 | 25 | 25 | **2** |

Final suite: **72 automated tests**. The first run gave 69 passing and 3 failing, and the 3 failures were real defects ([evidence](evidencias/execucao-1-antes-das-correcoes.txt)). After the fixes, 72 out of 72 pass ([evidence](evidencias/execucao-2-depois-das-correcoes.txt)).

---

## 1. How each prompt type influenced quality and diversity

### Without context (all three v1s): a lot of diversity, little usefulness

The three zero-shot prompts produced the **most** cases (38, 61 and 49), spread over many categories: security, messaging, observability, concurrency. On diversity alone they "win". The problem is that the model knew nothing about the system, so it **filled the gaps by making things up**:

- Prompt 1 v1 assumed `GET /estoque/{sku}`, `POST /estoque/reservas/{id}/confirmar`, a payment step and a reservation TTL. None of these exist.
- Prompt 3 v1 invented an entire request body (`clienteId: number`, `formaPagamento`, `enderecoEntrega`). It is honest about it ("Como não conheço o contrato da API, assumi um schema típico", i.e. "since I don't know the API contract, I assumed a typical schema"), but not one payload works against the real API.
- The expected results are **ambiguous** ("400/422", "409/422", "201 or 400"), which can't be turned into an assertion.

v1 still has value as a **brainstorm**. Both v1 responses brought up **concurrency over the last unit in stock**, which v2 deliberately left out. That idea became test `CT-v1-040`.

### Prompt 1 v2 (role + contract + constraints + format): precision and checkable state

Adding the contract and the rule "check both sides of the integration" changed the *nature* of the cases. In v2, every scenario checks the Orders response **and** the stock in the Inventory service (`GET /produtos/{id}`), which is exactly what separates an integration test from an API test of a single service. Further gains:

- **Concrete data and calculations** (`7.00 + 12.90 + 199.98 = 219.88`), turned into assertions without any interpretation.
- **Long lifecycle scenarios** (create → query → fail for lack of stock → cancel → reuse the released stock), which no v1 produced.
- The "list the uncovered risks" request worked as **self-criticism**: the model itself pointed out concurrency, failure in the compensation step and persistence.

The cost was **lower diversity**: 12 cases, all functional and sequential. That is expected, since I constrained the scope myself ("don't include network/timeout failures").

### Prompt 2 v2 (few-shot + guided reasoning): systematic coverage and finding a defect

This was the most productive prompt. Each element contributed:

- **Few-shot (2 examples):** fixed a format where every case states the communication point, the failure category, the stub setup and the **compensation check**. Every case came back in that format, which made automation almost mechanical.
- **Guided reasoning (list the points × failure taxonomy):** the model built a coverage matrix and **found a 4th communication point** that I hadn't separated out, namely `DELETE /reservas` *during compensation*, as opposed to the one during cancellation. That produced ERR-12 (a failure inside the compensation itself).
- **Describing the stub's capabilities** (delaying, dropping the connection, answering differently on the 1st and 2nd call) made realistic partial-failure cases possible (ERR-09, ERR-10, ERR-13/14).
- The request to "point out ambiguities" returned **17 questions for the team**, such as whether the timeout applies per call or to the whole operation, and what happens to an orphaned reservation after a timeout on `POST /reservas`. That is valuable requirements analysis, not just testing.

**Defect found (ERR-11):** the model reasoned about a *race condition*: the product exists in the `GET` but disappears before the `POST /reservas`, which then returns 404. The contract implies 422, but my implementation returned **502** because it only handled a 404 coming from the GET. The test failed and the code was fixed.

### Prompt 3 v2/v3 (persona + named techniques + JSON): data that the test consumes directly

- Naming the techniques (**equivalence partitioning and boundary values**) produced cases labelled by technique, covering 0, 1, the stock limit, limit+1, negative, decimal, string and `null`.
- **Fixing the initial state** let the model compute exact expected values (`150.5 × 2 + 80 × 3 = 541`).
- The **JSON output with a schema** removed manual work entirely. [`03-contrato-dados.test.js`](../tests/integracao/03-contrato-dados.test.js) reads the file the LLM generated and runs each case. Adding cases means generating a new JSON, with no code changes.

---

## 2. Prompt adjustments needed

| # | Problem observed | Adjustment | Effect |
|---|---|---|---|
| 1 | v1 invented endpoints, fields and rules | Include the **API contract** inside `<contrato>` tags and state "don't invent endpoints, fields or status codes" | Zero invented elements across all three v2s |
| 2 | Ambiguous expected results ("400/422") | "Use ONLY the contract's status codes" + concrete data + a fixed initial state | Every case had a single expected result |
| 3 | Generic cases that tested only one service | "Every scenario must check the effect on BOTH sides of the integration" | 100% of prompt 1 v2's scenarios check Orders + Inventory |
| 4 | Error cases mixed with validation cases, with no technique | Split into separate prompts (functional, failures, data) + a **failure taxonomy** (a–f) | Each prompt went deeper into its own topic |
| 5 | Unpredictable output format | **Few-shot** (prompt 2) and **JSON schema** (prompt 3) | Automation went from "interpreting text" to "translating/consuming" |
| 6 | **(v2 → v3)** The schema I wrote forced `estoqueEsperado: null` on errors, so the compensation check ended up only in free text | `estoqueEsperado` **mandatory in every case** | 25 out of 25 cases started checking stock, including compensation |
| 7 | **(v2 → v3)** Boundary values for `cliente` were missing, and the `total` only used "easy" prices | Missing partitions listed explicitly + products with prices `0.1` and `1.005` + floating-point cases requested | 5 new partitions and **2 defects found** in rounding |

Adjustments 6 and 7 are the most instructive. **The v2 problem came from my prompt, not from the model**: it followed my JSON schema faithfully. Iterating means reading the output critically and fixing the instruction.

**Defects found by v3 (CT-06, CT-07):** `Math.round(total * 100) / 100` fails because of binary floating point. `1.005 × 3` gives `3.0149999…` and was rounded to `3.01` instead of `3.02`. The fix ([`arredondar2Casas`](../src/order-service.js)) strips the binary error before applying half-up rounding.

---

## 3. Lessons (good practices)

1. **Context beats cleverness.** The single biggest jump in quality came from pasting the contract into the prompt. Without it, the LLM writes generic test fiction.
2. **One prompt per test type.** Scenarios, failures and data are different tasks. When one prompt tries to cover everything, every topic gets covered shallowly.
3. **Ask for the shape that the next step consumes.** A Markdown table for human review, a fixed list format for stubs, and JSON for data-driven tests.
4. **Ask the model to criticise itself.** "What was left uncovered?" and "What is ambiguous in the contract?" were the sections with the most insight.
5. **Use v1 as a brainstorm, not as a result.** The broad output found concurrency, which the precise prompt left out. Combining both gives breadth plus precision.
6. **Run everything you generate.** In this round, every test failure was a defect in the system and none was a wrong expected value from the LLM. Still, nothing guarantees that, so the generated cases go through review and execution.
7. **The LLM is a copilot, not an oracle.** Choosing the scope, spotting the flaw in my own schema (v2 → v3) and deciding the correct behaviour in each ambiguity stayed with me.
