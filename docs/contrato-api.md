# API contract: Orders ↔ Inventory

Two REST/JSON services. The **Orders** service is the integration's consumer and the **Inventory** service is its provider.

```
Cliente ──HTTP──▶ Pedidos (:3000) ──HTTP──▶ Estoque (:3001)
```

## Inventory service (provider)

| Method | Route | Request body | Responses |
|---|---|---|---|
| GET | `/produtos/{id}` | — | `200 {id, nome, preco, quantidade}` · `404 {erro}` |
| POST | `/reservas` | `{produtoId: string, quantidade: int > 0}` | `201 {id, produtoId, quantidade}` (decrements stock) · `400 {erro}` invalid body · `404 {erro}` product does not exist · `409 {erro, disponivel}` insufficient stock |
| DELETE | `/reservas/{id}` | — | `204` (returns the quantity to stock) · `404 {erro}` |

## Orders service (consumer)

| Method | Route | Request body | Responses |
|---|---|---|---|
| POST | `/pedidos` | `{cliente: string, itens: [{produtoId: string, quantidade: int > 0}]}` | `201 Pedido` · `400` invalid body/JSON · `409` insufficient stock · `422` product does not exist · `502` invalid response from Inventory · `503` Inventory unavailable (network error, timeout, 5xx) |
| GET | `/pedidos/{id}` | — | `200 Pedido` · `404` |
| DELETE | `/pedidos/{id}` | — | `200 Pedido` with `status: "CANCELADO"` · `404` · `409` already cancelled · `503` Inventory unavailable |

`Pedido = {id, cliente, itens: [{produtoId, quantidade, precoUnitario}], total, status: "CONFIRMADO" | "CANCELADO", reservas: [idReserva]}`

Every error comes back as `{ "erro": "<mensagem>" }`.

## Integration rules

1. For each item, Orders calls `GET /produtos/{id}` (to get the price) and then `POST /reservas`.
2. If **any** item fails (404, 409, network error, timeout, 5xx or invalid response), Orders **compensates** by calling `DELETE /reservas/{id}` for every reservation already made in that request. This is a simplified saga.
3. `total = Σ(precoUnitario × quantidade)`, rounded to 2 decimal places.
4. The timeout for calls to Inventory is configurable (default 2000 ms).
5. Cancelling an order releases all its reservations. When the Inventory service answers `404` for a reservation that was already released, cancellation counts it as a success (idempotent), so a cancellation that failed with `503` can be retried.
