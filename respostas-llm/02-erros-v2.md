# Testes de integração negativos — Pedidos ↔ Estoque

## 1. Pontos de comunicação

| # | Chamada de Pedidos ao Estoque | Quando ocorre |
|---|---|---|
| PC1 | GET /produtos/{id} | Para cada item, antes de reservar (obter preço) |
| PC2 | POST /reservas | Para cada item, após o GET |
| PC3 | DELETE /reservas/{id} (compensação) | Em POST /pedidos, quando algum item falha após reservas já feitas |
| PC4 | DELETE /reservas/{id} (cancelamento) | Em DELETE /pedidos/{id}, para cada reserva do pedido |

## 2. Matriz de categorias (resumo da cobertura)

| Ponto | (a) rede | (b) timeout | (c) 5xx | (d) 4xx previsto | (e) fora do contrato | (f) parcial |
|---|---|---|---|---|---|---|
| PC1 | ERR-01 (exemplo) | ERR-03 | ERR-04 | ERR-07 | ERR-05, ERR-06 | — (ver ERR-10) |
| PC2 | ERR-08 | ERR-09 | — (ver ambiguidades) | ERR-11 (404); ERR-02 (409, exemplo) | ERR-10 | ERR-09, ERR-10, ERR-11 |
| PC3 | — | — | ERR-12 | — | — | ERR-12 |
| PC4 | — | — | ERR-13 | ERR-14 (404 idempotente) | — | ERR-13, ERR-14 |

Convenção: "stub" = Estoque simulado. Salvo indicação, itens P1, P2, P3 existem, com preço e estoque suficientes. "Nenhum pedido criado" = GET /pedidos/{id} não encontra pedido e não há pedido persistido para o cliente.

---

ERR-03
- Ponto de comunicação: GET /produtos/{id}
- Categoria: (b) timeout
- Configuração do stub: GET /produtos/P1 espera mais que o timeout configurado (ex.: timeout do Pedidos = 500 ms, stub atrasa 1500 ms) e só então responde 200 válido
- Requisição: POST /pedidos {"cliente":"Ana","itens":[{"produtoId":"P1","quantidade":1}]}
- Esperado: 503 {"erro": ...}; a resposta chega em aproximadamente o tempo do timeout (não espera os 1500 ms); nenhum pedido criado
- Verificação de compensação: não se aplica; o stub não deve receber nenhum POST /reservas nem DELETE

ERR-04
- Ponto de comunicação: GET /produtos/{id}
- Categoria: (c) 5xx
- Configuração do stub: GET /produtos/P1 → 500 {"erro":"falha interna"}
- Requisição: POST /pedidos {"cliente":"Ana","itens":[{"produtoId":"P1","quantidade":1}]}
- Esperado: 503 {"erro": ...} (não 500 nem 502); nenhum pedido criado
- Verificação de compensação: não se aplica; o stub não deve receber POST /reservas nem DELETE

ERR-05
- Ponto de comunicação: GET /produtos/{id}
- Categoria: (e) JSON malformado
- Configuração do stub: GET /produtos/P1 → 200 com Content-Type application/json e corpo truncado: `{"id":"P1","nome":"Caneta","preco":3.5,"quant`
- Requisição: POST /pedidos {"cliente":"Ana","itens":[{"produtoId":"P1","quantidade":1}]}
- Esperado: 502 {"erro": ...}; nenhum pedido criado
- Verificação de compensação: não se aplica; o stub não deve receber POST /reservas

ERR-06
- Ponto de comunicação: GET /produtos/{id}
- Categoria: (e) campo ausente / tipo errado (parametrizar em dois sub-casos: 06a sem `preco`; 06b `preco` como string "abc")
- Configuração do stub: GET /produtos/P1 → 200 {"id":"P1","nome":"Caneta","quantidade":10} (06a) ou {"id":"P1","nome":"Caneta","preco":"abc","quantidade":10} (06b)
- Requisição: POST /pedidos {"cliente":"Ana","itens":[{"produtoId":"P1","quantidade":1}]}
- Esperado: 502 {"erro": ...}; nenhum pedido criado; total nunca pode ser NaN/null em um pedido persistido
- Verificação de compensação: não se aplica; o stub não deve receber POST /reservas

ERR-07
- Ponto de comunicação: GET /produtos/{id}
- Categoria: (d) 404 previsto no contrato
- Configuração do stub: GET /produtos/NAOEXISTE → 404 {"erro":"produto não encontrado"}
- Requisição: POST /pedidos {"cliente":"Ana","itens":[{"produtoId":"NAOEXISTE","quantidade":1}]}
- Esperado: 422 {"erro": ...}; nenhum pedido criado
- Verificação de compensação: não se aplica; o stub não deve receber POST /reservas

ERR-08
- Ponto de comunicação: POST /reservas (1º item)
- Categoria: (a) conexão derrubada (reset/fechamento abrupto do socket no meio da resposta)
- Configuração do stub: GET /produtos/P1 → 200 válido; POST /reservas → o stub aceita a requisição e destrói o socket sem enviar resposta
- Requisição: POST /pedidos {"cliente":"Ana","itens":[{"produtoId":"P1","quantidade":1}]}
- Esperado: 503 {"erro": ...}; nenhum pedido criado
- Verificação de compensação: a reserva pode ter sido criada no Estoque sem Pedidos saber (id desconhecido). Verificar o que Pedidos faz: o contrato não define (ver ambiguidade 4). Mínimo: o stub não recebe DELETE com id inventado

ERR-09
- Ponto de comunicação: POST /reservas (2º item)
- Categoria: (f) falha parcial — timeout no 2º item
- Configuração do stub: GET /produtos/* → 200; POST /reservas → 201 {"id":"R1","produtoId":"P1","quantidade":1} na 1ª chamada; na 2ª chamada atrasa além do timeout
- Requisição: POST /pedidos com itens P1 e P2
- Esperado: 503 {"erro": ...}; nenhum pedido criado
- Verificação de compensação: o stub deve receber exatamente um DELETE /reservas/R1 (e nenhum DELETE para a reserva do 2º item, que não tem id conhecido)

ERR-10
- Ponto de comunicação: POST /reservas (3º item)
- Categoria: (f) falha parcial + (e) resposta fora do contrato (201 sem campo `id`)
- Configuração do stub: GET /produtos/* → 200; POST /reservas → 201 com id R1 (1ª), 201 com id R2 (2ª), 201 {"produtoId":"P3","quantidade":1} sem `id` (3ª)
- Requisição: POST /pedidos com itens P1, P2 e P3
- Esperado: 502 {"erro": ...}; nenhum pedido criado
- Verificação de compensação: o stub deve receber DELETE /reservas/R1 e DELETE /reservas/R2 (ambos; ordem não importa, a menos que o time defina); nenhum DELETE para o 3º item

ERR-11
- Ponto de comunicação: POST /reservas (2º item)
- Categoria: (f) falha parcial + (d) 404 produto inexistente na reserva (corrida: GET /produtos achou o produto, mas POST /reservas devolve 404)
- Configuração do stub: GET /produtos/* → 200; POST /reservas → 201 id R1 (1ª chamada), 404 {"erro":"produto inexistente"} (2ª)
- Requisição: POST /pedidos com itens P1 e P2
- Esperado: 422 {"erro": ...}; nenhum pedido criado
- Verificação de compensação: o stub deve receber DELETE /reservas/R1

ERR-12
- Ponto de comunicação: DELETE /reservas/{id} (compensação, PC3)
- Categoria: (c) 5xx na própria compensação — falha parcial da saga
- Configuração do stub: GET /produtos/* → 200; POST /reservas → 201 R1 (1ª), 201 R2 (2ª), 409 {"erro":"insuficiente","disponivel":0} (3ª); DELETE /reservas/R1 → 500; DELETE /reservas/R2 → 204
- Requisição: POST /pedidos com itens P1, P2 e P3
- Esperado: o status do erro original (409) deve prevalecer sobre a falha da compensação (a confirmar, ver ambiguidade 5); corpo {"erro": ...}; nenhum pedido criado; o serviço não trava nem lança exceção não tratada
- Verificação de compensação: o stub deve receber DELETE tanto para R1 quanto para R2 (a falha em R1 não pode impedir a tentativa em R2); registrar/logar a reserva órfã R1

ERR-13
- Ponto de comunicação: DELETE /reservas/{id} (cancelamento, PC4)
- Categoria: (f) falha parcial — 503 na 2ª reserva do cancelamento
- Configuração do stub: criar antes um pedido CONFIRMADO com 2 reservas (R1, R2). Depois: DELETE /reservas/R1 → 204; DELETE /reservas/R2 → 503
- Requisição: DELETE /pedidos/{id}
- Esperado: 503 {"erro": ...}; o pedido não pode virar "CANCELADO" (GET /pedidos/{id} continua devolvendo CONFIRMADO)
- Verificação de compensação: o stub recebeu DELETE para R1 e R2 (R1 já liberada fica liberada; não há "re-reserva")

ERR-14
- Ponto de comunicação: DELETE /reservas/{id} (cancelamento, PC4)
- Categoria: (d) 404 em reserva já liberada — idempotência do retry após ERR-13
- Configuração do stub: continuação de ERR-13. Agora DELETE /reservas/R1 → 404 {"erro":"reserva não encontrada"} (já liberada); DELETE /reservas/R2 → 204
- Requisição: DELETE /pedidos/{id} (repetição)
- Esperado: 200 com status "CANCELADO" (404 do Estoque tratado como sucesso); em seguida, um novo DELETE /pedidos/{id} → 409 (já cancelado) sem chamar o Estoque
- Verificação de compensação: o stub recebeu DELETE para R1 e R2 na repetição; na terceira chamada (409) o stub não recebe nenhuma requisição

---

## 3. Ambiguidades do contrato para confirmar com o time

1. **Timeout total vs. por chamada.** O timeout de 2000 ms vale para cada chamada ao Estoque ou para a operação inteira? Um pedido com 10 itens (20 chamadas) pode levar até 40 s sem violar a regra.
2. **Retentativas.** Pedidos faz retry em erro de rede, timeout ou 5xx, ou falha de imediato? Isso muda o número de chamadas que o stub deve esperar.
3. **POST /reservas com 5xx ou 400.** O 503 vale para 5xx também em POST /reservas (provavelmente sim, pela regra geral). Mas um 400 devolvido pelo Estoque (corpo inválido, que não deveria ocorrer se Pedidos valida) vira o quê: 502, 400 ou 500? O contrato não diz. Status inesperados em geral (ex.: 418, 302, 200 em vez de 201) também não estão mapeados, só "resposta inválida" → 502.
4. **Reserva "fantasma" em timeout/queda de conexão no POST /reservas.** O Estoque pode ter criado a reserva e Pedidos nunca recebeu o id. Não há como compensar com DELETE. Qual é o comportamento esperado (aceitar o vazamento, reconciliação, chave de idempotência)?
5. **Falha durante a compensação.** Se DELETE /reservas/{id} falhar (5xx, timeout, rede) na saga, qual status Pedidos devolve: o do erro original (409/422/...) ou 503? Ele tenta de novo? Continua compensando as demais? Registra/loga reserva órfã? O contrato é omisso.
6. **Compensação e 404.** Na compensação, um 404 do DELETE é ignorado como no cancelamento (idempotente)? A regra 5 só cita o cancelamento.
7. **Ordem de processamento e fail-fast.** Os itens são processados sequencialmente na ordem da lista? Em falha, Pedidos para no primeiro erro? Se houver dois itens inválidos (ex.: 1º com 422 e 2º com 409), qual erro retorna? A ordem também define quais reservas existem na hora da falha.
8. **Itens duplicados no mesmo pedido** (mesmo produtoId duas vezes): são duas reservas separadas, ou são somados? Pode causar 409 só na 2ª reserva.
9. **Validação do corpo de Pedidos.** `itens` vazio, `cliente` vazio, `quantidade` 0, negativa, decimal ou string: é tudo 400? Isso acontece antes de qualquer chamada ao Estoque? (A coluna do contrato só fala "corpo/JSON inválido".)
10. **Cancelamento parcial.** Se o cancelamento falha com 503 depois de liberar parte das reservas, o pedido permanece CONFIRMADO (assumido nos testes), ou existe um estado intermediário? Pedidos persiste quais reservas já foram liberadas?
11. **Cancelamento com 5xx não-503 / resposta inválida do Estoque.** DELETE /pedidos só lista 503 como falha do Estoque; um corpo ou status inesperado no DELETE /reservas deve virar 502 (como no POST) ou 503?
12. **O que é "resposta inválida" (502) exatamente.** Campo extra é aceito? `preco` negativo ou zero? `quantidade` do produto negativa? `id` vazio? Status 200 com corpo vazio? Content-Type diferente de JSON?
13. **Dependência de `quantidade` do GET /produtos.** Pedidos usa a quantidade do GET para decidir (pré-checagem) ou só confia no 409 do POST /reservas? Isso afeta se o 409 pode vir sem nenhuma chamada a POST /reservas.
14. **409 sem campo `disponivel` ou com tipo errado.** Isso é 502 (fora do contrato) ou continua sendo 409? E o corpo do 409 de Pedidos repassa o `disponivel`?
15. **Concorrência.** Dois POST /pedidos simultâneos para o último item do estoque, ou dois DELETE /pedidos/{id} simultâneos para o mesmo pedido: resultado esperado (um 201 e um 409; um 200 e um 409)? Não há garantia descrita.
16. **Estado do pedido em caso de falha.** Pressupus que nenhum pedido é persistido quando o POST /pedidos falha. O contrato não diz se pedidos com falha ficam salvos com algum status (só existem CONFIRMADO e CANCELADO).
17. **Arredondamento.** Regra 3 pede 2 casas decimais, mas não o modo (half-up, bankers) nem o tratamento de preços com mais casas vindos do Estoque.
