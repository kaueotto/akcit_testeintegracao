# Dados de teste para POST /pedidos

Como não conheço o contrato da API, assumi um schema típico de pedido. Ajuste os nomes dos campos conforme a sua especificação.

**Schema assumido:**

```json
{
  "clienteId": 1,
  "itens": [
    { "produtoId": 10, "quantidade": 2, "precoUnitario": 49.90 }
  ],
  "formaPagamento": "CARTAO_CREDITO",
  "enderecoEntrega": {
    "cep": "01310-100",
    "logradouro": "Av. Paulista",
    "numero": "1000",
    "cidade": "São Paulo",
    "uf": "SP"
  },
  "observacoes": "Entregar pela manhã"
}
```

## 1. Cenários válidos (esperado: 201 Created)

### 1.1 Pedido mínimo válido
```json
{
  "clienteId": 1,
  "itens": [{ "produtoId": 10, "quantidade": 1 }],
  "formaPagamento": "PIX"
}
```

### 1.2 Pedido completo
```json
{
  "clienteId": 1,
  "itens": [
    { "produtoId": 10, "quantidade": 2, "precoUnitario": 49.90 },
    { "produtoId": 11, "quantidade": 1, "precoUnitario": 120.00 }
  ],
  "formaPagamento": "CARTAO_CREDITO",
  "enderecoEntrega": {
    "cep": "01310-100",
    "logradouro": "Av. Paulista",
    "numero": "1000",
    "cidade": "São Paulo",
    "uf": "SP"
  },
  "observacoes": "Entregar pela manhã"
}
```

### 1.3 Múltiplos itens (10 itens)
Itens com `produtoId` de 10 a 19, `quantidade` 1 cada.

### 1.4 Valores limite válidos
```json
{ "clienteId": 1, "itens": [{ "produtoId": 10, "quantidade": 1 }], "formaPagamento": "BOLETO" }
```
```json
{ "clienteId": 1, "itens": [{ "produtoId": 10, "quantidade": 999 }], "formaPagamento": "BOLETO" }
```
(ajuste 999 para o máximo permitido pela regra de negócio)

### 1.5 Observações no tamanho máximo
`observacoes` com exatamente 255 caracteres (ou o limite definido).

### 1.6 Caracteres especiais e Unicode
```json
{
  "clienteId": 1,
  "itens": [{ "produtoId": 10, "quantidade": 1 }],
  "formaPagamento": "PIX",
  "observacoes": "Ação: entregar na portaria – João & Maria (apto 12) 🚚"
}
```

## 2. Cenários inválidos (esperado: 400 Bad Request / 422)

| # | Cenário | Payload (resumo) | Esperado |
|---|---------|------------------|----------|
| 2.1 | Body vazio | `{}` | 400 |
| 2.2 | Sem body | (nenhum) | 400 |
| 2.3 | JSON malformado | `{ "clienteId": 1, ` | 400 |
| 2.4 | Sem `clienteId` | `{ "itens": [...], "formaPagamento": "PIX" }` | 400 |
| 2.5 | `clienteId` string | `"clienteId": "abc"` | 400 |
| 2.6 | `clienteId` negativo | `"clienteId": -1` | 400 |
| 2.7 | `clienteId` zero | `"clienteId": 0` | 400 |
| 2.8 | `itens` ausente | sem o campo `itens` | 400 |
| 2.9 | `itens` vazio | `"itens": []` | 400/422 |
| 2.10 | `itens` nulo | `"itens": null` | 400 |
| 2.11 | `itens` não é array | `"itens": "abc"` | 400 |
| 2.12 | Quantidade zero | `"quantidade": 0` | 400/422 |
| 2.13 | Quantidade negativa | `"quantidade": -5` | 400/422 |
| 2.14 | Quantidade decimal | `"quantidade": 1.5` | 400 |
| 2.15 | Quantidade string | `"quantidade": "dois"` | 400 |
| 2.16 | Quantidade acima do máximo | `"quantidade": 1000000` | 422 |
| 2.17 | `produtoId` ausente | item sem `produtoId` | 400 |
| 2.18 | Preço negativo | `"precoUnitario": -10.00` | 400/422 |
| 2.19 | Preço com muitas casas | `"precoUnitario": 10.12345` | 400/422 |
| 2.20 | Forma de pagamento inválida | `"formaPagamento": "MOEDA_FALSA"` | 400 |
| 2.21 | Forma de pagamento nula | `"formaPagamento": null` | 400 |
| 2.22 | CEP inválido | `"cep": "123"` | 400 |
| 2.23 | UF inválida | `"uf": "XX"` | 400 |
| 2.24 | Observações acima do limite | 256+ caracteres | 400 |
| 2.25 | Item duplicado (mesmo `produtoId` repetido) | dois itens com `produtoId: 10` | 400/422 ou consolidação (conferir regra) |

## 3. Regras de negócio (esperado: 404 / 409 / 422)

| # | Cenário | Payload | Esperado |
|---|---------|---------|----------|
| 3.1 | Cliente inexistente | `"clienteId": 99999999` | 404 ou 422 |
| 3.2 | Cliente inativo/bloqueado | `clienteId` de cliente bloqueado | 403/422 |
| 3.3 | Produto inexistente | `"produtoId": 99999999` | 404 ou 422 |
| 3.4 | Produto inativo/descontinuado | produto desativado | 422 |
| 3.5 | Estoque insuficiente | `quantidade` maior que o estoque | 409/422 |
| 3.6 | Preço divergente do cadastro | `precoUnitario` diferente do preço atual | 422 (ou ignorar o valor enviado) |
| 3.7 | Pedido duplicado (mesma requisição repetida) | reenviar o mesmo payload / mesma `Idempotency-Key` | 409 ou retornar o mesmo pedido |

## 4. Segurança e robustez

| # | Cenário | Detalhe | Esperado |
|---|---------|---------|----------|
| 4.1 | Sem autenticação | sem header `Authorization` | 401 |
| 4.2 | Token inválido/expirado | `Authorization: Bearer invalido` | 401 |
| 4.3 | Sem permissão | token de usuário sem acesso | 403 |
| 4.4 | Content-Type incorreto | `text/plain` | 415 |
| 4.5 | SQL Injection | `"observacoes": "'; DROP TABLE pedidos; --"` | 201 (tratado como texto) ou 400, sem efeito colateral |
| 4.6 | XSS | `"observacoes": "<script>alert(1)</script>"` | armazenado escapado ou rejeitado |
| 4.7 | Campos extras desconhecidos | `"isAdmin": true`, `"id": 1` | ignorados ou 400 (sem mass assignment) |
| 4.8 | Payload muito grande | body de vários MB | 413 |
| 4.9 | Cliente tentando pedir para outro cliente | `clienteId` diferente do token | 403 |
| 4.10 | Muitas requisições seguidas | rajada de requisições | 429 (se houver rate limit) |
| 4.11 | Método incorreto | `GET`/`PUT` em `/pedidos` | 405 |

## 5. Massa de dados pré-requisito (seed)

```json
{
  "clientes": [
    { "id": 1, "nome": "Maria Silva", "ativo": true },
    { "id": 2, "nome": "João Souza", "ativo": false }
  ],
  "produtos": [
    { "id": 10, "nome": "Camiseta", "preco": 49.90, "estoque": 100, "ativo": true },
    { "id": 11, "nome": "Tênis", "preco": 120.00, "estoque": 5, "ativo": true },
    { "id": 12, "nome": "Boné (sem estoque)", "preco": 30.00, "estoque": 0, "ativo": true },
    { "id": 13, "nome": "Meia (descontinuada)", "preco": 9.90, "estoque": 50, "ativo": false }
  ]
}
```

## 6. Exemplo de cURL

```bash
curl -X POST http://localhost:8080/pedidos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "clienteId": 1,
    "itens": [{ "produtoId": 10, "quantidade": 2 }],
    "formaPagamento": "PIX"
  }'
```

## Observações

- Resposta esperada em sucesso: `201 Created`, header `Location` e body com `id`, `status` (ex.: `CRIADO`), `valorTotal` e `itens`.
- Confira `valorTotal` calculado (ex.: 2 x 49.90 = 99.80) com atenção a arredondamento.
- Se me enviar o contrato real (OpenAPI/DTO), refaço os dados com os campos, tipos e limites corretos.
