# Prompt type 1: Generating integration scenarios

**Prompting technique:** zero-shot in v1. In v2 it becomes a role-based prompt with structured context (the contract), explicit constraints and a fixed output format.

**Goal:** get functional integration scenarios (happy path, business rules and **state consistency between the two services**).

---

## v1: naive (zero-shot, no context)

```text
Gere casos de teste de integração para um sistema de pedidos que se comunica com um serviço de estoque via API REST.
```

LLM response: [respostas-llm/01-cenarios-v1.md](../respostas-llm/01-cenarios-v1.md)

---

## v2: refined (role + context + constraints + format)

> `{{CONTRATO}}` is replaced with the full content of [docs/contrato-api.md](../docs/contrato-api.md).

```text
Você é um(a) engenheiro(a) de qualidade sênior especializado(a) em testes de integração de microsserviços.

## Contexto
Estou testando a integração entre dois serviços REST. O contrato completo está abaixo:
<contrato>
{{CONTRATO}}
</contrato>

## Tarefa
Gere cenários de teste de INTEGRAÇÃO para o fluxo Pedidos → Estoque. Aqui, teste de integração significa: os dois serviços reais rodando e se comunicando via HTTP (sem mocks de função).

## Requisitos
- Cubra: caminho feliz, múltiplos itens, regras de negócio (cálculo e arredondamento do total), consistência de estado entre os serviços (o estoque reflete corretamente reservas, compensações e cancelamentos) e o ciclo de vida completo do pedido.
- Cada cenário deve verificar o efeito nos DOIS lados da integração: a resposta de Pedidos E o estado do Estoque (via GET /produtos/{id}).
- Não invente endpoints, campos ou códigos de status que não estejam no contrato.
- Não inclua cenários de falha de rede/timeout (eles serão tratados em outro prompt).
- Use dados concretos (ids, quantidades, preços) e defina o estado inicial do estoque em cada cenário.

## Formato de saída
Uma tabela Markdown com as colunas: ID | Cenário | Estado inicial do estoque | Passos (requisições) | Resultado esperado em Pedidos | Resultado esperado no Estoque | Prioridade (Alta/Média/Baixa).
Depois da tabela, liste em até 5 bullets quais riscos de integração ficaram SEM cobertura.
Gere entre 8 e 12 cenários.
```

LLM response: [respostas-llm/01-cenarios-v2.md](../respostas-llm/01-cenarios-v2.md)

Automated tests derived from it: [tests/integracao/01-cenarios.test.js](../tests/integracao/01-cenarios.test.js)
