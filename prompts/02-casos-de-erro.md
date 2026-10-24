# Prompt type 2: Error and communication-failure cases

**Prompting technique:** zero-shot in v1. In v2 it becomes **few-shot** (two examples in the expected format) combined with **guided reasoning**: the model must list the communication points and go through a failure taxonomy before generating the cases.

**Goal:** get negative cases that are specific to *integration*, such as connection refused, timeout, 5xx, responses that break the contract, and partial failures followed by compensation. Input validation cases are out of scope here.

---

## v1: naive (zero-shot, no context)

```text
Liste casos de erro para testar a integração entre um serviço de pedidos e um serviço de estoque.
```

LLM response: [respostas-llm/02-erros-v1.md](../respostas-llm/02-erros-v1.md)

---

## v2: refined (few-shot + guided reasoning + test double)

> `{{CONTRATO}}` is replaced with the full content of [docs/contrato-api.md](../docs/contrato-api.md).

```text
Você vai me ajudar a projetar testes de integração NEGATIVOS (falhas) para a comunicação entre dois serviços.
<contrato>
{{CONTRATO}}
</contrato>

Nos testes, o serviço de Estoque pode ser substituído por um STUB HTTP controlável: um servidor HTTP real que eu programo para responder o que eu quiser, inclusive atrasar, derrubar a conexão, devolver JSON malformado ou responder diferente na 1ª e na 2ª chamada.

## Raciocine antes de responder
Primeiro, liste cada ponto de comunicação (cada chamada HTTP que Pedidos faz ao Estoque). Para cada um, considere sistematicamente estas categorias de falha:
(a) erro de rede/conexão recusada, (b) timeout, (c) 5xx, (d) 4xx previsto no contrato, (e) resposta fora do contrato (status inesperado, JSON malformado, campo ausente/tipo errado), (f) falha PARCIAL — a falha acontece depois que outras chamadas já tiveram sucesso.
Depois, gere os casos de teste.

## Exemplos do formato esperado
ERR-01
- Ponto de comunicação: GET /produtos/{id}
- Categoria: (a) conexão recusada
- Configuração do stub: Estoque desligado (porta sem servidor)
- Requisição: POST /pedidos {"cliente":"Ana","itens":[{"produtoId":"P1","quantidade":1}]}
- Esperado: 503 {"erro": ...}; nenhum pedido criado
- Verificação de compensação: não se aplica (nenhuma reserva feita)

ERR-02
- Ponto de comunicação: POST /reservas (2º item)
- Categoria: (f) falha parcial — 409 no 2º item
- Configuração do stub: GET /produtos/* → 200; POST /reservas → 201 na 1ª chamada, 409 na 2ª
- Requisição: POST /pedidos com itens P1 e P2
- Esperado: 409
- Verificação de compensação: o stub deve receber DELETE /reservas/{id da 1ª reserva}

## Tarefa
Gere de 8 a 12 casos NOVOS (não repita os exemplos), no mesmo formato. Inclua pelo menos um caso de cancelamento de pedido (DELETE /pedidos/{id}). Ao final, indique quais comportamentos o contrato NÃO define claramente (ambiguidades) e que eu deveria confirmar com o time.
```

LLM response: [respostas-llm/02-erros-v2.md](../respostas-llm/02-erros-v2.md)

Automated tests derived from it: [tests/integracao/02-erros.test.js](../tests/integracao/02-erros.test.js)
