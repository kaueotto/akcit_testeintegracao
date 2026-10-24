# Casos de erro: integração Serviço de Pedidos x Serviço de Estoque

## 1. Falhas de comunicação
- Estoque indisponível (conexão recusada / serviço fora do ar) ao criar pedido.
- Timeout na consulta ou reserva de estoque.
- Timeout após o estoque ter processado a reserva (resposta perdida): o pedido não sabe se reservou.
- Erro de DNS / falha de rede intermitente.
- Falha de TLS / certificado inválido ou expirado.
- Circuit breaker aberto: o pedido deve falhar rápido com mensagem adequada.
- Retry esgotado: verificar número máximo de tentativas e backoff.

## 2. Respostas de erro do estoque
- HTTP 500 / 502 / 503 / 504 do estoque.
- HTTP 429 (rate limit): o pedido deve respeitar Retry-After.
- HTTP 404: produto/SKU inexistente.
- HTTP 400/422: payload inválido (quantidade zero, negativa, não numérica).
- HTTP 401/403: token expirado, ausente ou sem permissão entre serviços.
- Resposta com JSON malformado, campos faltando, tipos errados ou campos extras inesperados.
- Resposta vazia ou com Content-Type incorreto.
- Mudança incompatível de contrato (versão da API, campo renomeado).

## 3. Regras de negócio de estoque
- Estoque insuficiente (quantidade pedida > disponível).
- Estoque exatamente igual à quantidade pedida (limite).
- Estoque zerado.
- Pedido com vários itens, onde apenas um item não tem estoque (falha parcial): aceitar parcialmente ou rejeitar tudo, conforme regra.
- Produto inativo/descontinuado.
- Item duplicado no mesmo pedido.
- Quantidade muito grande (overflow, limites máximos).

## 4. Concorrência
- Dois pedidos simultâneos disputando a última unidade (overselling).
- Muitos pedidos concorrentes no mesmo SKU (condição de corrida, deadlock, lock otimista falhando).
- Reserva e cancelamento simultâneos do mesmo pedido.
- Atualização de estoque (reposição/ajuste) durante a criação do pedido.

## 5. Idempotência e duplicidade
- Mesma requisição de reserva reenviada (retry): não pode baixar estoque duas vezes.
- Mesmo evento/mensagem entregue duas vezes (at-least-once).
- Mesma chave de idempotência com payload diferente.
- Cliente que clica duas vezes em "finalizar pedido".

## 6. Consistência e transações distribuídas (saga)
- Reserva feita, mas falha ao gravar o pedido: compensação deve liberar o estoque.
- Pedido gravado, mas falha ao reservar: pedido deve ser cancelado ou ficar pendente.
- Falha na compensação (liberação de estoque falha): reprocessamento e alerta.
- Cancelamento de pedido não devolve o estoque.
- Devolução / cancelamento parcial devolvendo quantidade errada.
- Reserva expirada (TTL) antes do pagamento ser confirmado.
- Confirmação de pedido após a reserva ter expirado.
- Divergência entre o estoque reservado e o estoque do pedido (reconciliação).

## 7. Mensageria / eventos (se assíncrono)
- Mensagem perdida ou não consumida.
- Mensagens fora de ordem (cancelamento chega antes da criação).
- Mensagem inválida / veneno: vai para a DLQ.
- Broker indisponível; falha ao publicar evento (padrão outbox).
- Consumidor lento ou parado, com acúmulo de fila.
- Reprocessamento de mensagens antigas (replay).

## 8. Dados e validação
- SKU com formato inválido, vazio, nulo ou com caracteres especiais.
- IDs inexistentes ou de outro tenant/cliente.
- Diferença de unidade de medida ou de precisão decimal.
- Fuso horário e formato de data inconsistentes (validade de reserva).
- Payload muito grande ou requisição acima do limite.
- Injeção (SQL, JSON) em campos repassados.

## 9. Segurança
- Chamada sem autenticação entre serviços.
- Token de outro escopo ou expirado durante a operação.
- Tentativa de alterar estoque de forma direta, sem passar pelo pedido.
- Vazamento de dados sensíveis em mensagens de erro ou logs.

## 10. Resiliência e observabilidade
- Propagação de correlation-id / trace-id nos erros.
- Mensagens de erro claras ao cliente final (sem expor detalhes internos).
- Logs e métricas registrados em cada falha.
- Degradação graciosa: o que o pedido faz quando o estoque está lento (fila, status "pendente").
- Recuperação após o estoque voltar (reprocessamento de pedidos pendentes).
- Falha do banco de dados em um dos serviços durante a operação.
- Reinício de um serviço no meio de uma transação.

## 11. Priorização sugerida
1. Estoque insuficiente e overselling (concorrência).
2. Timeout com resposta perdida e idempotência.
3. Compensação em falha parcial (saga).
4. Estoque indisponível / circuit breaker.
5. Contrato inválido e autenticação.
