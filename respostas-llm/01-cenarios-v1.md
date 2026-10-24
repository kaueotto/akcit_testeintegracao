# Casos de Teste de Integração: Sistema de Pedidos x Serviço de Estoque (REST)

## Premissas

- Serviço de Pedidos (SP) chama o Serviço de Estoque (SE) via HTTP/JSON.
- Endpoints assumidos do SE:
  - `GET /estoque/{sku}` consulta saldo
  - `POST /estoque/reservas` reserva itens (corpo: pedidoId, itens[sku, qtd])
  - `POST /estoque/reservas/{id}/confirmar` baixa definitiva
  - `DELETE /estoque/reservas/{id}` libera reserva (compensação)
- O SE é executado em ambiente de teste real (container) ou em mock/WireMock quando indicado.
- Prioridade: P0 (crítico), P1 (importante), P2 (complementar).

## 1. Caminho feliz

| ID | Cenário | Pré-condição | Passos | Resultado esperado | Prior. |
|----|---------|--------------|--------|--------------------|--------|
| CT-001 | Criar pedido com estoque suficiente | SKU-A com saldo 10 | Criar pedido com 3 un. de SKU-A | SE responde 201 na reserva; pedido fica `CONFIRMADO`; saldo disponível do SE = 7 | P0 |
| CT-002 | Pedido com múltiplos itens | SKU-A saldo 10, SKU-B saldo 5 | Criar pedido com 2 de A e 1 de B | Uma reserva com os dois itens; pedido `CONFIRMADO`; saldos 8 e 4 | P0 |
| CT-003 | Consulta de disponibilidade antes de pedir | SKU-A saldo 10 | `GET /estoque/SKU-A` via SP | SP exibe quantidade 10 corretamente (mapeamento do DTO) | P1 |
| CT-004 | Confirmação de pagamento baixa estoque | Pedido com reserva ativa | Confirmar pagamento | SP chama `confirmar`; reserva vira `BAIXADA`; pedido `PAGO` | P0 |
| CT-005 | Quantidade exatamente igual ao saldo | SKU-A saldo 5 | Pedir 5 un. | Sucesso; saldo = 0 | P1 |

## 2. Regras de negócio e estoque insuficiente

| ID | Cenário | Resultado esperado | Prior. |
|----|---------|--------------------|--------|
| CT-010 | Quantidade maior que o saldo | SE retorna 409/422; pedido `REJEITADO` com motivo "estoque insuficiente"; nenhum saldo alterado | P0 |
| CT-011 | SKU inexistente | SE retorna 404; SP retorna erro de validação ao cliente (4xx), sem criar pedido | P0 |
| CT-012 | Quantidade zero ou negativa | SP rejeita antes de chamar o SE (verificar que o SE não recebeu requisição) | P1 |
| CT-013 | Pedido parcialmente atendível (A ok, B sem saldo) | Reserva é atômica: nenhuma reserva persiste; saldo de A inalterado; pedido `REJEITADO` | P0 |
| CT-014 | SKU descontinuado/inativo | SE retorna erro de negócio; SP reflete mensagem apropriada | P2 |

## 3. Cancelamento e compensação

| ID | Cenário | Resultado esperado | Prior. |
|----|---------|--------------------|--------|
| CT-020 | Cancelar pedido antes do pagamento | SP chama `DELETE /reservas/{id}`; saldo restaurado; pedido `CANCELADO` | P0 |
| CT-021 | Cancelar pedido já pago/baixado | Fluxo de estorno/devolução ao estoque conforme regra; estado final consistente | P1 |
| CT-022 | Falha no pagamento após reserva | Reserva liberada automaticamente (compensação/saga) | P0 |
| CT-023 | Expiração da reserva (TTL) | Após o TTL, SE libera itens; SP detecta e marca pedido `EXPIRADO` | P1 |
| CT-024 | Cancelamento repetido (idempotência) | Segundo cancelamento não restaura estoque duas vezes; resposta 200/204 ou 404 tratada | P1 |

## 4. Falhas de comunicação e resiliência

| ID | Cenário | Como simular | Resultado esperado | Prior. |
|----|---------|--------------|--------------------|--------|
| CT-030 | SE indisponível (conexão recusada) | Derrubar container do SE | SP retorna erro controlado (503 ou pedido `PENDENTE`); sem exceção não tratada; sem pedido inconsistente | P0 |
| CT-031 | Timeout do SE | Mock com atraso > timeout | SP respeita timeout configurado; pedido não fica `CONFIRMADO` sem reserva | P0 |
| CT-032 | SE responde 500 | Mock retorna 500 | Retry conforme política (ex.: 3x com backoff); após esgotar, pedido falha de forma limpa | P0 |
| CT-033 | Falha transitória seguida de sucesso | Mock: 503, 503, 201 | Retry funciona; apenas **uma** reserva criada | P1 |
| CT-034 | Circuit breaker | Múltiplas falhas consecutivas | Circuito abre; chamadas seguintes falham rápido sem atingir o SE; fecha após recuperação | P2 |
| CT-035 | Resposta com corpo malformado/campos faltando | Mock retorna JSON inválido | SP trata erro de parsing; não assume sucesso | P1 |
| CT-036 | Timeout após o SE ter processado a reserva | SE grava a reserva, mas resposta é perdida | Retry não duplica reserva (idempotência por `pedidoId`/Idempotency-Key); ou reconciliação detecta | P0 |
| CT-037 | Status HTTP inesperado (302, 429) | Mock | 429 respeita `Retry-After`; demais tratados sem crash | P2 |

## 5. Concorrência e consistência

| ID | Cenário | Resultado esperado | Prior. |
|----|---------|--------------------|--------|
| CT-040 | Dois pedidos simultâneos disputam o último item (saldo 1) | Exatamente um `CONFIRMADO`, outro `REJEITADO`; saldo nunca negativo | P0 |
| CT-041 | N pedidos concorrentes (ex.: 50) sobre saldo 20 de 1 un. cada | Exatamente 20 sucessos e 30 rejeições | P0 |
| CT-042 | Reenvio do mesmo pedido (duplo clique / retry do cliente) | Apenas uma reserva; mesma resposta devolvida | P0 |
| CT-043 | Atualização de estoque no SE durante a criação do pedido | Pedido usa o valor final consistente da reserva, não consulta desatualizada (evitar check-then-act) | P1 |

## 6. Contrato da API

| ID | Cenário | Resultado esperado | Prior. |
|----|---------|--------------------|--------|
| CT-050 | Validar request enviado pelo SP | Campos, tipos, headers (`Content-Type`, `Authorization`, `X-Correlation-Id`) conforme contrato (OpenAPI / Pact) | P0 |
| CT-051 | Validar response do SE | Schema respeitado; SP tolera campos extras (tolerant reader) | P1 |
| CT-052 | Mudança compatível de versão do SE (novo campo opcional) | SP continua funcionando | P2 |
| CT-053 | Verbo/URL corretos e versionamento (`/v1/`) | Chamadas ao endpoint esperado | P1 |

## 7. Segurança

| ID | Cenário | Resultado esperado | Prior. |
|----|---------|--------------------|--------|
| CT-060 | Token ausente/inválido para o SE | SE retorna 401; SP trata e registra erro; não vaza detalhes ao cliente | P1 |
| CT-061 | Token expirado | SP renova token e repete a chamada uma vez | P1 |
| CT-062 | Permissão insuficiente (403) | Erro tratado, sem retry inútil | P2 |
| CT-063 | Dados sensíveis em logs | Logs não contêm tokens nem dados pessoais do cliente | P2 |

## 8. Observabilidade e dados

| ID | Cenário | Resultado esperado | Prior. |
|----|---------|--------------------|--------|
| CT-070 | Propagação de correlation-id | Mesmo ID presente nos logs do SP e do SE | P2 |
| CT-071 | Consistência SP x SE ao final de cada fluxo | Para todo pedido `CONFIRMADO` existe reserva ativa; para `CANCELADO`/`REJEITADO` não existe | P0 |
| CT-072 | Job de reconciliação | Reservas órfãs (sem pedido) são identificadas e liberadas | P2 |

## 9. Exemplo automatizado (Java, JUnit 5 + WireMock)

```java
@Test
void deveRejeitarPedidoQuandoEstoqueInsuficiente() {
    wireMock.stubFor(post(urlEqualTo("/estoque/reservas"))
        .willReturn(aResponse()
            .withStatus(409)
            .withHeader("Content-Type", "application/json")
            .withBody("{\"erro\":\"ESTOQUE_INSUFICIENTE\",\"sku\":\"SKU-A\"}")));

    var resposta = pedidoClient.criar(new PedidoRequest("SKU-A", 99));

    assertEquals(422, resposta.statusCode());
    assertEquals("REJEITADO", pedidoRepository.buscar(resposta.id()).getStatus());
    wireMock.verify(1, postRequestedFor(urlEqualTo("/estoque/reservas")));
}

@Test
void naoDeveDuplicarReservaEmRetryAposTimeout() {
    wireMock.stubFor(post("/estoque/reservas")
        .inScenario("retry").whenScenarioStateIs(STARTED)
        .willReturn(aResponse().withFixedDelay(5000))
        .willSetStateTo("segunda"));
    wireMock.stubFor(post("/estoque/reservas")
        .inScenario("retry").whenScenarioStateIs("segunda")
        .willReturn(aResponse().withStatus(200).withBody("{\"reservaId\":\"R1\"}")));

    pedidoService.criar(pedidoValido());

    wireMock.verify(2, postRequestedFor(urlEqualTo("/estoque/reservas"))
        .withHeader("Idempotency-Key", matching(".+")));
}
```

## 10. Dados de teste e ambiente

- Massa: SKUs com saldos 0, 1, 5, 10, 1000; SKU inexistente; SKU inativo.
- Ambiente: Docker Compose (SP + SE + banco), ou Testcontainers; WireMock/Toxiproxy para injetar falhas e latência.
- Limpeza: reset do estoque e dos pedidos antes de cada teste (testes independentes e repetíveis).
- Ferramentas sugeridas: REST Assured, Pact (contrato), k6/JMeter (concorrência), Toxiproxy (caos de rede).

## 11. Critérios de aceite

- Todos os casos P0 passam.
- Nenhum cenário deixa saldo negativo ou reserva órfã.
- Estado de pedido e de estoque sempre consistentes após falhas.
