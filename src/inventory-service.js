'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { lerJson, criarHandler } = require('./http-utils');

// Serviço de Estoque: expõe produtos e controla reservas de quantidade.
function criarServicoEstoque({ produtos = [] } = {}) {
  const catalogo = new Map(produtos.map((p) => [p.id, { ...p }]));
  const reservas = new Map();

  async function rotear(req, partes) {
    const [recurso, id] = partes;

    if (req.method === 'GET' && recurso === 'produtos' && partes.length === 2) {
      const produto = catalogo.get(id);
      if (!produto) return [404, { erro: `Produto ${id} não encontrado` }];
      return [200, produto];
    }

    if (req.method === 'POST' && recurso === 'reservas' && partes.length === 1) {
      const { produtoId, quantidade } = (await lerJson(req)) ?? {};
      if (typeof produtoId !== 'string' || !Number.isInteger(quantidade) || quantidade <= 0) {
        return [400, { erro: 'produtoId (string) e quantidade (inteiro > 0) são obrigatórios' }];
      }
      const produto = catalogo.get(produtoId);
      if (!produto) return [404, { erro: `Produto ${produtoId} não encontrado` }];
      if (produto.quantidade < quantidade) {
        return [409, { erro: 'Estoque insuficiente', disponivel: produto.quantidade }];
      }
      produto.quantidade -= quantidade;
      const reserva = { id: randomUUID(), produtoId, quantidade };
      reservas.set(reserva.id, reserva);
      return [201, reserva];
    }

    if (req.method === 'DELETE' && recurso === 'reservas' && partes.length === 2) {
      const reserva = reservas.get(id);
      if (!reserva) return [404, { erro: `Reserva ${id} não encontrada` }];
      catalogo.get(reserva.produtoId).quantidade += reserva.quantidade;
      reservas.delete(id);
      return [204];
    }

    return null;
  }

  return http.createServer(criarHandler(rotear));
}

module.exports = { criarServicoEstoque };
