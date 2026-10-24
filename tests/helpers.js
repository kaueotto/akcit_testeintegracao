'use strict';

const http = require('node:http');
const { criarServicoEstoque } = require('../src/inventory-service');
const { criarServicoPedidos } = require('../src/order-service');

const produtosPadrao = () => [
  { id: 'P1', nome: 'Teclado', preco: 150.5, quantidade: 10 },
  { id: 'P2', nome: 'Mouse', preco: 80, quantidade: 5 },
  { id: 'P3', nome: 'Monitor', preco: 1200, quantidade: 0 },
];

async function iniciar(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function encerrar(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

async function requisitar(url, metodo = 'GET', corpo) {
  const resposta = await fetch(url, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  return { status: resposta.status, dados: texto ? JSON.parse(texto) : undefined };
}

// Sobe Estoque e Pedidos REAIS, comunicando-se via HTTP.
async function subirAmbiente({ produtos = produtosPadrao(), timeoutMs } = {}) {
  const estoque = criarServicoEstoque({ produtos });
  const estoqueUrl = await iniciar(estoque);
  const pedidos = criarServicoPedidos({ estoqueUrl, timeoutMs });
  const pedidosUrl = await iniciar(pedidos);

  return {
    estoqueUrl,
    pedidosUrl,
    criarPedido: (corpo) => requisitar(`${pedidosUrl}/pedidos`, 'POST', corpo),
    consultarPedido: (id) => requisitar(`${pedidosUrl}/pedidos/${id}`),
    cancelarPedido: (id) => requisitar(`${pedidosUrl}/pedidos/${id}`, 'DELETE'),
    estoqueDe: async (produtoId) => (await requisitar(`${estoqueUrl}/produtos/${produtoId}`)).dados.quantidade,
    fechar: () => Promise.all([encerrar(pedidos), encerrar(estoque)]),
  };
}

// Stub HTTP do Estoque: um servidor real cujas respostas são programadas pelo teste.
// `responder(req, chamada)` recebe { metodo, caminho, corpo } e o nº da chamada daquela rota (1, 2, ...).
// Deve devolver { status, corpo?, bruto?, atrasoMs?, derrubar? }.
async function subirComStub(responder, { timeoutMs = 300 } = {}) {
  const chamadas = [];
  const contagem = new Map();

  const stub = http.createServer((req, res) => {
    let texto = '';
    req.on('data', (parte) => (texto += parte));
    req.on('end', async () => {
      const chamada = { metodo: req.method, caminho: req.url, corpo: texto ? JSON.parse(texto) : undefined };
      chamadas.push(chamada);
      const rota = `${req.method} ${req.url.replace(/^(\/[^/]+)\/[^/]+$/, '$1/:id')}`;
      contagem.set(rota, (contagem.get(rota) ?? 0) + 1);

      const r = await responder(chamada, contagem.get(rota));
      if (r.atrasoMs) await new Promise((resolve) => setTimeout(resolve, r.atrasoMs));
      if (r.derrubar) return req.socket.destroy();
      if (r.corpo === undefined && r.bruto === undefined) return res.writeHead(r.status).end();
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(r.bruto ?? JSON.stringify(r.corpo));
    });
  });

  const estoqueUrl = await iniciar(stub);
  const pedidos = criarServicoPedidos({ estoqueUrl, timeoutMs });
  const pedidosUrl = await iniciar(pedidos);

  return {
    chamadas,
    criarPedido: (corpo) => requisitar(`${pedidosUrl}/pedidos`, 'POST', corpo),
    consultarPedido: (id) => requisitar(`${pedidosUrl}/pedidos/${id}`),
    cancelarPedido: (id) => requisitar(`${pedidosUrl}/pedidos/${id}`, 'DELETE'),
    deletesRecebidos: () => chamadas.filter((c) => c.metodo === 'DELETE').map((c) => c.caminho),
    fechar: () => Promise.all([encerrar(pedidos), encerrar(stub)]),
  };
}

// Respostas "felizes" reutilizáveis para montar stubs.
const stubProduto = (caminho) => ({
  status: 200,
  corpo: { id: caminho.split('/').pop(), nome: 'Produto', preco: 10, quantidade: 100 },
});
let sequenciaReserva = 0;
const stubReserva = (corpo) => ({ status: 201, corpo: { id: `R${++sequenciaReserva}`, ...corpo } });

module.exports = { produtosPadrao, requisitar, subirAmbiente, subirComStub, stubProduto, stubReserva };
