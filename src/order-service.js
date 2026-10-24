'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { lerJson, criarHandler } = require('./http-utils');

// Falha na comunicação com o Estoque. status = código que o serviço de Pedidos devolve ao cliente.
class ErroEstoque extends Error {
  constructor(status, mensagem, causa) {
    super(mensagem, { cause: causa });
    this.status = status;
  }
}

function validarPedido(corpo) {
  if (!corpo || typeof corpo !== 'object') return 'Corpo da requisição é obrigatório';
  if (typeof corpo.cliente !== 'string' || !corpo.cliente.trim()) return 'cliente é obrigatório';
  if (!Array.isArray(corpo.itens) || corpo.itens.length === 0) return 'itens deve ter ao menos um item';
  for (const item of corpo.itens) {
    if (!item || typeof item.produtoId !== 'string' || !item.produtoId) return 'produtoId é obrigatório';
    if (!Number.isInteger(item.quantidade) || item.quantidade <= 0) return 'quantidade deve ser inteiro > 0';
  }
  return null;
}

// Half-up para 2 casas. toPrecision(12) remove o erro binário da multiplicação
// (1.005 * 3 = 3.0149999...) e o deslocamento via notação "e2" evita um novo erro em * 100.
function arredondar2Casas(valor) {
  const limpo = Number(valor.toPrecision(12));
  return Math.round(Number(`${limpo}e2`)) / 100;
}

// Serviço de Pedidos: cria pedidos reservando itens no Estoque (com compensação em caso de falha).
function criarServicoPedidos({ estoqueUrl, timeoutMs = 2000 }) {
  const pedidos = new Map();

  async function chamarEstoque(metodo, caminho, corpo) {
    try {
      const resposta = await fetch(`${estoqueUrl}${caminho}`, {
        method: metodo,
        headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const texto = await resposta.text();
      if (resposta.status >= 500) throw new Error(`Estoque respondeu ${resposta.status}`);
      return { status: resposta.status, dados: texto ? JSON.parse(texto) : undefined };
    } catch (causa) {
      if (causa instanceof SyntaxError) {
        throw new ErroEstoque(502, 'Resposta inválida do serviço de estoque', causa);
      }
      throw new ErroEstoque(503, 'Serviço de estoque indisponível', causa);
    }
  }

  // Compensação: desfaz reservas já feitas. Melhor esforço — falhas aqui não mascaram o erro original.
  async function liberarReservas(ids) {
    for (const id of ids) {
      await chamarEstoque('DELETE', `/reservas/${encodeURIComponent(id)}`).catch(() => {});
    }
  }

  async function criarPedido(corpo) {
    const erroValidacao = validarPedido(corpo);
    if (erroValidacao) return [400, { erro: erroValidacao }];

    const itens = [];
    const reservas = [];
    try {
      for (const { produtoId, quantidade } of corpo.itens) {
        const produto = await chamarEstoque('GET', `/produtos/${encodeURIComponent(produtoId)}`);
        if (produto.status === 404) {
          await liberarReservas(reservas);
          return [422, { erro: `Produto ${produtoId} não encontrado` }];
        }
        if (produto.status !== 200 || typeof produto.dados?.preco !== 'number') {
          throw new ErroEstoque(502, 'Resposta inesperada do serviço de estoque');
        }

        const reserva = await chamarEstoque('POST', '/reservas', { produtoId, quantidade });
        // 404 aqui = produto removido entre o GET e o POST (corrida); mesmo tratamento do GET.
        if (reserva.status === 404) {
          await liberarReservas(reservas);
          return [422, { erro: `Produto ${produtoId} não encontrado` }];
        }
        if (reserva.status === 409) {
          await liberarReservas(reservas);
          return [409, { erro: `Estoque insuficiente para o produto ${produtoId}` }];
        }
        if (reserva.status !== 201 || !reserva.dados?.id) {
          throw new ErroEstoque(502, 'Resposta inesperada do serviço de estoque');
        }

        reservas.push(reserva.dados.id);
        itens.push({ produtoId, quantidade, precoUnitario: produto.dados.preco });
      }
    } catch (erro) {
      if (!(erro instanceof ErroEstoque)) throw erro;
      await liberarReservas(reservas);
      return [erro.status, { erro: erro.message }];
    }

    const total = itens.reduce((soma, i) => soma + i.precoUnitario * i.quantidade, 0);
    const pedido = {
      id: randomUUID(),
      cliente: corpo.cliente,
      itens,
      total: arredondar2Casas(total),
      status: 'CONFIRMADO',
      reservas,
    };
    pedidos.set(pedido.id, pedido);
    return [201, pedido];
  }

  async function cancelarPedido(pedido) {
    if (pedido.status === 'CANCELADO') return [409, { erro: 'Pedido já cancelado' }];
    try {
      for (const id of pedido.reservas) {
        const resposta = await chamarEstoque('DELETE', `/reservas/${encodeURIComponent(id)}`);
        // 404 = reserva já liberada numa tentativa anterior; tratamos como sucesso (idempotência).
        if (resposta.status !== 204 && resposta.status !== 404) {
          throw new ErroEstoque(502, 'Resposta inesperada do serviço de estoque');
        }
      }
    } catch (erro) {
      if (!(erro instanceof ErroEstoque)) throw erro;
      return [erro.status, { erro: erro.message }];
    }
    pedido.status = 'CANCELADO';
    return [200, pedido];
  }

  async function rotear(req, partes) {
    const [recurso, id] = partes;
    if (recurso !== 'pedidos') return null;

    if (req.method === 'POST' && partes.length === 1) return criarPedido(await lerJson(req));

    if (partes.length === 2 && (req.method === 'GET' || req.method === 'DELETE')) {
      const pedido = pedidos.get(id);
      if (!pedido) return [404, { erro: `Pedido ${id} não encontrado` }];
      return req.method === 'GET' ? [200, pedido] : cancelarPedido(pedido);
    }

    return null;
  }

  return http.createServer(criarHandler(rotear));
}

module.exports = { criarServicoPedidos };
