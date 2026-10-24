## Premissas de dados

Catálogo usado nos cenários (reiniciado/semeado antes de cada cenário, salvo indicação):

| produtoId | nome | preco | quantidade inicial |
|---|---|---|---|
| P1 | Caneta | 3.50 | 10 |
| P2 | Caderno | 12.90 | 5 |
| P3 | Mochila | 99.99 | 2 |
| P4 | Clipe | 0.10 | 100 |
| P5 | Etiqueta | 19.999 | 10 |

"Estoque" = GET /produtos/{id}. Em todos os cenários, o estado do Estoque é lido antes e depois das operações.

## Cenários

| ID | Cenário | Estado inicial do estoque | Passos (requisições) | Resultado esperado em Pedidos | Resultado esperado no Estoque | Prioridade |
|---|---|---|---|---|---|---|
| CT-01 | Caminho feliz com 1 item | P1: 10 | 1. GET /produtos/P1 (baseline)<br>2. POST /pedidos {cliente:"Ana", itens:[{produtoId:"P1", quantidade:3}]}<br>3. GET /produtos/P1 | 201; status "CONFIRMADO"; itens=[{P1, 3, precoUnitario 3.5}]; total 10.5; reservas com 1 id; id e cliente "Ana" preenchidos | P1.quantidade = 7 (preco e nome inalterados) | Alta |
| CT-02 | Pedido com múltiplos itens (produtos distintos) | P1: 10, P2: 5, P3: 2 | 1. POST /pedidos {cliente:"Bruno", itens:[{P1,2},{P2,1},{P3,2}]}<br>2. GET /produtos/P1, P2, P3 | 201; CONFIRMADO; 3 itens com precoUnitario 3.5 / 12.9 / 99.99; total = 7.00+12.90+199.98 = 219.88; reservas com 3 ids distintos | P1=8, P2=4, P3=0 | Alta |
| CT-03 | Arredondamento do total a 2 casas | P4: 100, P5: 10 | 1. POST /pedidos {cliente:"Carla", itens:[{P4,3},{P5,3}]}<br>2. GET /produtos/P4, P5 | 201; precoUnitario P4=0.1, P5=19.999; total = 0.30 + 59.997 = 60.297 → 60.3 (sem erro de ponto flutuante como 60.29700000000001) | P4=97, P5=7 | Alta |
| CT-04 | Estoque insuficiente em pedido de 1 item | P1: 10 | 1. POST /pedidos {cliente:"Davi", itens:[{P1,11}]}<br>2. GET /produtos/P1 | 409 com {erro:"..."}; nenhum pedido criado | P1 = 10 (inalterado; nenhuma reserva persistida) | Alta |
| CT-05 | Falha no 2º item por estoque insuficiente: compensação do 1º item | P1: 10, P2: 5 | 1. POST /pedidos {cliente:"Eva", itens:[{P1,4},{P2,6}]}<br>2. GET /produtos/P1, P2 | 409; formato {erro}; nenhum pedido confirmado | P1 = 10 (reserva de 4 devolvida via DELETE /reservas/{id}); P2 = 5 | Alta |
| CT-06 | Falha no 3º item por produto inexistente: compensação de 2 reservas | P1: 10, P2: 5 | 1. POST /pedidos {cliente:"Fábio", itens:[{P1,2},{P2,2},{produtoId:"P999", quantidade:1}]}<br>2. GET /produtos/P1, P2<br>3. GET /produtos/P999 | 422 com {erro}; nenhum pedido criado | P1 = 10, P2 = 5 (ambas compensadas); GET /produtos/P999 retorna 404 | Alta |
| CT-07 | Mesmo produto repetido em itens distintos excedendo o estoque | P2: 5 | 1. POST /pedidos {cliente:"Gil", itens:[{P2,3},{P2,3}]}<br>2. GET /produtos/P2 | 409 (1ª reserva de 3 ok, 2ª falha por disponível=2); pedido não criado | P2 = 5 (reserva do 1º item compensada) | Média |
| CT-08 | Corpo inválido não afeta o Estoque | P1: 10 | 1. POST /pedidos {cliente:"Hana", itens:[{P1,0}]}<br>2. POST /pedidos com JSON malformado (`{"cliente":`)<br>3. GET /produtos/P1 | Ambas: 400 com {erro}; nenhum pedido criado | P1 = 10 (nenhuma chamada de reserva efetivada) | Média |
| CT-09 | Cancelamento de pedido confirmado devolve o estoque | P1: 10, P2: 5 | 1. POST /pedidos {cliente:"Iris", itens:[{P1,4},{P2,2}]} → guarda id<br>2. GET /produtos/P1, P2 (P1=6, P2=3)<br>3. DELETE /pedidos/{id}<br>4. GET /pedidos/{id}<br>5. GET /produtos/P1, P2 | Passo 3: 200 com status "CANCELADO", mesmos itens/total/reservas; passo 4: 200 com status "CANCELADO" | Após passo 2: P1=6, P2=3; após passo 5: P1=10, P2=5 (todas as reservas liberadas) | Alta |
| CT-10 | Segundo cancelamento do mesmo pedido não devolve estoque em duplicidade | P1: 10 | 1. POST /pedidos {cliente:"João", itens:[{P1,5}]}<br>2. DELETE /pedidos/{id} (1º)<br>3. DELETE /pedidos/{id} (2º)<br>4. GET /produtos/P1 | 1º DELETE: 200 CANCELADO; 2º DELETE: 409 com {erro}; GET /pedidos/{id} segue CANCELADO | P1 = 10 (não 15): estoque restaurado uma única vez | Alta |
| CT-11 | Ciclo de vida completo: criar, consultar, cancelar, reutilizar o estoque liberado | P3: 2 | 1. POST /pedidos {cliente:"Lia", itens:[{P3,2}]} → id A<br>2. GET /pedidos/A<br>3. POST /pedidos {cliente:"Davi", itens:[{P3,1}]} → deve falhar<br>4. DELETE /pedidos/A<br>5. POST /pedidos {cliente:"Davi", itens:[{P3,1}]} → id B<br>6. GET /produtos/P3 após cada passo<br>7. GET /pedidos/inexistente-123 | 1: 201 CONFIRMADO, total 199.98; 2: 200 igual ao retorno do POST; 3: 409; 4: 200 CANCELADO; 5: 201 CONFIRMADO total 99.99; 7: 404 com {erro} | P3: após 1 = 0; após 3 = 0 (inalterado); após 4 = 2; após 5 = 1 | Alta |
| CT-12 | Esgotamento sequencial do estoque e consistência entre pedidos | P1: 10 | 1. POST /pedidos {Mara, [{P1,6}]} → A<br>2. POST /pedidos {Nico, [{P1,4}]} → B<br>3. POST /pedidos {Olga, [{P1,1}]}<br>4. DELETE /pedidos/A<br>5. POST /pedidos {Olga, [{P1,5}]} → C<br>6. GET /produtos/P1 após cada passo | 1: 201; 2: 201; 3: 409; 4: 200 CANCELADO; 5: 201 CONFIRMADO; B permanece CONFIRMADO (GET /pedidos/B) | P1: após 1 = 4; após 2 = 0; após 3 = 0; após 4 = 6; após 5 = 1 (cancelar A não afeta a reserva de B) | Média |

## Riscos de integração sem cobertura

- **Concorrência:** pedidos simultâneos disputando o mesmo estoque (overselling, corrida entre reserva e compensação) não são testados; todos os cenários são sequenciais.
- **Falhas parciais de infraestrutura/protocolo:** 502 (resposta inválida do Estoque), 5xx do Estoque durante a saga e falha na própria compensação (DELETE /reservas/{id} falhando) exigem injeção de falhas e ficam de fora.
- **Cancelamento idempotente com 404 em reserva já liberada** (regra 5), incluindo o cancelamento parcial que falha com 503 e é repetido, depende de manipular o Estoque diretamente e não foi coberto.
- **Validação de entrada mais ampla:** itens vazio, cliente ausente/vazio, quantidade não inteira ou negativa, produtoId não string e valores extremos (quantidades muito grandes) foram cobertos só parcialmente (apenas quantidade 0 e JSON malformado).
- **Persistência e durabilidade:** o estado dos pedidos/reservas após reinício de qualquer serviço, e a consistência entre os ids de reserva guardados em Pedidos e as reservas reais do Estoque (não há endpoint de consulta de reservas no contrato), não são verificados.
