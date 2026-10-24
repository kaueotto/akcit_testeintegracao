'use strict';

// Cenários gerados pelo Prompt 1 v2 (respostas-llm/01-cenarios-v2.md), automatizados com os
// dois serviços REAIS se comunicando via HTTP. Cada teste verifica os DOIS lados da integração.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { subirAmbiente } = require('../helpers');

// Catálogo proposto pela própria LLM na resposta (premissas de dados).
const catalogoLlm = () => [
  { id: 'P1', nome: 'Caneta', preco: 3.5, quantidade: 10 },
  { id: 'P2', nome: 'Caderno', preco: 12.9, quantidade: 5 },
  { id: 'P3', nome: 'Mochila', preco: 99.99, quantidade: 2 },
  { id: 'P4', nome: 'Clipe', preco: 0.1, quantidade: 100 },
  { id: 'P5', nome: 'Etiqueta', preco: 19.999, quantidade: 10 },
];

describe('Prompt 1: cenários de integração Pedidos → Estoque', () => {
  let amb;
  beforeEach(async () => (amb = await subirAmbiente({ produtos: catalogoLlm() })));
  afterEach(() => amb.fechar());

  it('CT-01: caminho feliz com 1 item reserva no estoque', async () => {
    const { status, dados } = await amb.criarPedido({ cliente: 'Ana', itens: [{ produtoId: 'P1', quantidade: 3 }] });

    assert.equal(status, 201);
    assert.equal(dados.status, 'CONFIRMADO');
    assert.equal(dados.cliente, 'Ana');
    assert.deepEqual(dados.itens, [{ produtoId: 'P1', quantidade: 3, precoUnitario: 3.5 }]);
    assert.equal(dados.total, 10.5);
    assert.equal(dados.reservas.length, 1);
    assert.equal(await amb.estoqueDe('P1'), 7);
  });

  it('CT-02: pedido com múltiplos itens de produtos distintos', async () => {
    const { status, dados } = await amb.criarPedido({
      cliente: 'Bruno',
      itens: [
        { produtoId: 'P1', quantidade: 2 },
        { produtoId: 'P2', quantidade: 1 },
        { produtoId: 'P3', quantidade: 2 },
      ],
    });

    assert.equal(status, 201);
    assert.deepEqual(dados.itens.map((i) => i.precoUnitario), [3.5, 12.9, 99.99]);
    assert.equal(dados.total, 219.88);
    assert.equal(new Set(dados.reservas).size, 3);
    assert.deepEqual([await amb.estoqueDe('P1'), await amb.estoqueDe('P2'), await amb.estoqueDe('P3')], [8, 4, 0]);
  });

  it('CT-03: total arredondado a 2 casas, sem erro de ponto flutuante', async () => {
    const { status, dados } = await amb.criarPedido({
      cliente: 'Carla',
      itens: [
        { produtoId: 'P4', quantidade: 3 },
        { produtoId: 'P5', quantidade: 3 },
      ],
    });

    assert.equal(status, 201);
    assert.equal(dados.total, 60.3); // 0.30 + 59.997 = 60.297 → 60.30
    assert.deepEqual([await amb.estoqueDe('P4'), await amb.estoqueDe('P5')], [97, 7]);
  });

  it('CT-04: estoque insuficiente em pedido de 1 item não altera o estoque', async () => {
    const { status, dados } = await amb.criarPedido({ cliente: 'Davi', itens: [{ produtoId: 'P1', quantidade: 11 }] });

    assert.equal(status, 409);
    assert.ok(dados.erro);
    assert.equal(await amb.estoqueDe('P1'), 10);
  });

  it('CT-05: falha no 2º item compensa a reserva do 1º', async () => {
    const { status } = await amb.criarPedido({
      cliente: 'Eva',
      itens: [
        { produtoId: 'P1', quantidade: 4 },
        { produtoId: 'P2', quantidade: 6 },
      ],
    });

    assert.equal(status, 409);
    assert.equal(await amb.estoqueDe('P1'), 10, 'reserva de P1 deveria ter sido devolvida');
    assert.equal(await amb.estoqueDe('P2'), 5);
  });

  it('CT-06: produto inexistente no 3º item compensa as 2 reservas anteriores', async () => {
    const { status, dados } = await amb.criarPedido({
      cliente: 'Fábio',
      itens: [
        { produtoId: 'P1', quantidade: 2 },
        { produtoId: 'P2', quantidade: 2 },
        { produtoId: 'P999', quantidade: 1 },
      ],
    });

    assert.equal(status, 422);
    assert.ok(dados.erro);
    assert.deepEqual([await amb.estoqueDe('P1'), await amb.estoqueDe('P2')], [10, 5]);
  });

  it('CT-07: mesmo produto repetido excedendo o estoque é compensado', async () => {
    const { status } = await amb.criarPedido({
      cliente: 'Gil',
      itens: [
        { produtoId: 'P2', quantidade: 3 },
        { produtoId: 'P2', quantidade: 3 },
      ],
    });

    assert.equal(status, 409);
    assert.equal(await amb.estoqueDe('P2'), 5);
  });

  it('CT-08: corpo inválido não chega a afetar o estoque', async () => {
    const quantidadeZero = await amb.criarPedido({ cliente: 'Hana', itens: [{ produtoId: 'P1', quantidade: 0 }] });
    const jsonMalformado = await amb.criarPedido('{"cliente":');

    assert.equal(quantidadeZero.status, 400);
    assert.equal(jsonMalformado.status, 400);
    assert.ok(quantidadeZero.dados.erro && jsonMalformado.dados.erro);
    assert.equal(await amb.estoqueDe('P1'), 10);
  });

  it('CT-09: cancelamento de pedido confirmado devolve o estoque', async () => {
    const { dados: pedido } = await amb.criarPedido({
      cliente: 'Iris',
      itens: [
        { produtoId: 'P1', quantidade: 4 },
        { produtoId: 'P2', quantidade: 2 },
      ],
    });
    assert.deepEqual([await amb.estoqueDe('P1'), await amb.estoqueDe('P2')], [6, 3]);

    const cancelado = await amb.cancelarPedido(pedido.id);
    assert.equal(cancelado.status, 200);
    assert.equal(cancelado.dados.status, 'CANCELADO');
    assert.deepEqual(cancelado.dados.reservas, pedido.reservas);

    const consultado = await amb.consultarPedido(pedido.id);
    assert.equal(consultado.dados.status, 'CANCELADO');
    assert.deepEqual([await amb.estoqueDe('P1'), await amb.estoqueDe('P2')], [10, 5]);
  });

  it('CT-10: segundo cancelamento é rejeitado e não devolve estoque em dobro', async () => {
    const { dados: pedido } = await amb.criarPedido({ cliente: 'João', itens: [{ produtoId: 'P1', quantidade: 5 }] });

    assert.equal((await amb.cancelarPedido(pedido.id)).status, 200);
    const segundo = await amb.cancelarPedido(pedido.id);

    assert.equal(segundo.status, 409);
    assert.equal((await amb.consultarPedido(pedido.id)).dados.status, 'CANCELADO');
    assert.equal(await amb.estoqueDe('P1'), 10, 'estoque deve ser restaurado uma única vez');
  });

  it('CT-11: ciclo de vida completo reutiliza o estoque liberado', async () => {
    const a = await amb.criarPedido({ cliente: 'Lia', itens: [{ produtoId: 'P3', quantidade: 2 }] });
    assert.equal(a.status, 201);
    assert.equal(a.dados.total, 199.98);
    assert.equal(await amb.estoqueDe('P3'), 0);

    assert.deepEqual((await amb.consultarPedido(a.dados.id)).dados, a.dados);

    const semEstoque = await amb.criarPedido({ cliente: 'Davi', itens: [{ produtoId: 'P3', quantidade: 1 }] });
    assert.equal(semEstoque.status, 409);
    assert.equal(await amb.estoqueDe('P3'), 0);

    assert.equal((await amb.cancelarPedido(a.dados.id)).status, 200);
    assert.equal(await amb.estoqueDe('P3'), 2);

    const b = await amb.criarPedido({ cliente: 'Davi', itens: [{ produtoId: 'P3', quantidade: 1 }] });
    assert.equal(b.status, 201);
    assert.equal(b.dados.total, 99.99);
    assert.equal(await amb.estoqueDe('P3'), 1);

    assert.equal((await amb.consultarPedido('inexistente-123')).status, 404);
  });

  it('CT-12: esgotamento sequencial; cancelar A não afeta a reserva de B', async () => {
    const a = await amb.criarPedido({ cliente: 'Mara', itens: [{ produtoId: 'P1', quantidade: 6 }] });
    assert.equal(await amb.estoqueDe('P1'), 4);
    const b = await amb.criarPedido({ cliente: 'Nico', itens: [{ produtoId: 'P1', quantidade: 4 }] });
    assert.equal(await amb.estoqueDe('P1'), 0);
    assert.equal((await amb.criarPedido({ cliente: 'Olga', itens: [{ produtoId: 'P1', quantidade: 1 }] })).status, 409);

    await amb.cancelarPedido(a.dados.id);
    assert.equal(await amb.estoqueDe('P1'), 6);

    const c = await amb.criarPedido({ cliente: 'Olga', itens: [{ produtoId: 'P1', quantidade: 5 }] });
    assert.equal(c.status, 201);
    assert.equal(await amb.estoqueDe('P1'), 1);
    assert.equal((await amb.consultarPedido(b.dados.id)).dados.status, 'CONFIRMADO');
  });

  // Ideia aproveitada do Prompt 1 v1 (CT-040/041): a v2 deixou concorrência explicitamente "sem cobertura".
  it('CT-v1-040: pedidos simultâneos disputando o estoque nunca causam overselling', async () => {
    const tentativas = Array.from({ length: 5 }, (_, i) =>
      amb.criarPedido({ cliente: `Cliente ${i}`, itens: [{ produtoId: 'P3', quantidade: 1 }] }),
    );
    const status = (await Promise.all(tentativas)).map((r) => r.status);

    assert.equal(status.filter((s) => s === 201).length, 2);
    assert.equal(status.filter((s) => s === 409).length, 3);
    assert.equal(await amb.estoqueDe('P3'), 0);
  });
});
