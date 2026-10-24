'use strict';

// Sobe os serviços manualmente para exploração (ex.: com curl ou Postman).
//   node src/main.js estoque   -> http://localhost:3001
//   node src/main.js pedidos   -> http://localhost:3000 (usa ESTOQUE_URL, padrão http://localhost:3001)
const { criarServicoEstoque } = require('./inventory-service');
const { criarServicoPedidos } = require('./order-service');

const produtosExemplo = [
  { id: 'P1', nome: 'Teclado', preco: 150.5, quantidade: 10 },
  { id: 'P2', nome: 'Mouse', preco: 80, quantidade: 5 },
  { id: 'P3', nome: 'Monitor', preco: 1200, quantidade: 0 },
];

const servico = process.argv[2];
if (servico === 'estoque') {
  criarServicoEstoque({ produtos: produtosExemplo }).listen(3001, () =>
    console.log('Estoque ouvindo em http://localhost:3001'),
  );
} else if (servico === 'pedidos') {
  const estoqueUrl = process.env.ESTOQUE_URL ?? 'http://localhost:3001';
  criarServicoPedidos({ estoqueUrl }).listen(3000, () =>
    console.log(`Pedidos ouvindo em http://localhost:3000 (estoque: ${estoqueUrl})`),
  );
} else {
  console.error('Uso: node src/main.js <estoque|pedidos>');
  process.exit(1);
}
