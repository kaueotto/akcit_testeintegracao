'use strict';

// Casos negativos gerados pelo Prompt 2 v2 (respostas-llm/02-erros-v2.md). O Estoque é substituído
// por um STUB HTTP real, programado para falhar de formas específicas; o serviço de Pedidos é o real.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { criarServicoPedidos } = require('../../src/order-service');
const { requisitar, subirComStub, stubProduto } = require('../helpers');

const umItem = { cliente: 'Ana', itens: [{ produtoId: 'P1', quantidade: 1 }] };
const itens = (...ids) => ({ cliente: 'Ana', itens: ids.map((produtoId) => ({ produtoId, quantidade: 1 })) });
const reserva = (id, corpo) => ({ status: 201, corpo: { id, ...corpo } });

describe('Prompt 2: falhas na comunicação Pedidos → Estoque', () => {
  let amb;
  afterEach(() => amb?.fechar());

  // ERR-01 e ERR-02 são os exemplos (few-shot) do próprio prompt.
  it('ERR-01 (exemplo): Estoque desligado → 503', async () => {
    const portaFechada = http.createServer();
    await new Promise((r) => portaFechada.listen(0, '127.0.0.1', r));
    const estoqueUrl = `http://127.0.0.1:${portaFechada.address().port}`;
    await new Promise((r) => portaFechada.close(r));

    const pedidos = criarServicoPedidos({ estoqueUrl, timeoutMs: 300 });
    await new Promise((r) => pedidos.listen(0, '127.0.0.1', r));
    amb = { fechar: () => new Promise((r) => pedidos.close(r)) };

    const { status, dados } = await requisitar(`http://127.0.0.1:${pedidos.address().port}/pedidos`, 'POST', umItem);
    assert.equal(status, 503);
    assert.ok(dados.erro);
  });

  it('ERR-02 (exemplo): 409 no 2º item compensa a 1ª reserva', async () => {
    amb = await subirComStub(({ metodo, caminho, corpo }, n) => {
      if (metodo === 'GET') return stubProduto(caminho);
      if (metodo === 'POST') return n === 1 ? reserva('R1', corpo) : { status: 409, corpo: { erro: 'x', disponivel: 0 } };
      return { status: 204 };
    });

    assert.equal((await amb.criarPedido(itens('P1', 'P2'))).status, 409);
    assert.deepEqual(amb.deletesRecebidos(), ['/reservas/R1']);
  });

  it('ERR-03: timeout no GET /produtos → 503 sem esperar a resposta lenta', async () => {
    amb = await subirComStub(({ caminho }) => ({ ...stubProduto(caminho), atrasoMs: 1000 }), { timeoutMs: 300 });

    const inicio = Date.now();
    const { status } = await amb.criarPedido(umItem);

    assert.equal(status, 503);
    assert.ok(Date.now() - inicio < 900, 'deveria respeitar o timeout de 300 ms');
    assert.ok(!amb.chamadas.some((c) => c.metodo !== 'GET'), 'não deveria reservar nem compensar');
  });

  it('ERR-04: 500 no GET /produtos → 503 (não 500 nem 502)', async () => {
    amb = await subirComStub(() => ({ status: 500, corpo: { erro: 'falha interna' } }));

    const { status, dados } = await amb.criarPedido(umItem);
    assert.equal(status, 503);
    assert.ok(dados.erro);
    assert.equal(amb.chamadas.length, 1);
  });

  it('ERR-05: JSON truncado no GET /produtos → 502', async () => {
    amb = await subirComStub(() => ({ status: 200, bruto: '{"id":"P1","nome":"Caneta","preco":3.5,"quant' }));

    assert.equal((await amb.criarPedido(umItem)).status, 502);
    assert.ok(!amb.chamadas.some((c) => c.metodo === 'POST'));
  });

  for (const [sub, produto] of [
    ['06a sem preco', { id: 'P1', nome: 'Caneta', quantidade: 10 }],
    ['06b preco string', { id: 'P1', nome: 'Caneta', preco: 'abc', quantidade: 10 }],
  ]) {
    it(`ERR-${sub}: produto fora do contrato → 502 e nenhuma reserva`, async () => {
      amb = await subirComStub(() => ({ status: 200, corpo: produto }));

      assert.equal((await amb.criarPedido(umItem)).status, 502);
      assert.ok(!amb.chamadas.some((c) => c.metodo === 'POST'));
    });
  }

  it('ERR-07: 404 no GET /produtos → 422', async () => {
    amb = await subirComStub(() => ({ status: 404, corpo: { erro: 'produto não encontrado' } }));

    const { status } = await amb.criarPedido({ cliente: 'Ana', itens: [{ produtoId: 'NAOEXISTE', quantidade: 1 }] });
    assert.equal(status, 422);
    assert.ok(!amb.chamadas.some((c) => c.metodo === 'POST'));
  });

  it('ERR-08: conexão derrubada no POST /reservas → 503 sem DELETE inventado', async () => {
    amb = await subirComStub(({ metodo, caminho }) => (metodo === 'GET' ? stubProduto(caminho) : { derrubar: true }));

    assert.equal((await amb.criarPedido(umItem)).status, 503);
    assert.deepEqual(amb.deletesRecebidos(), []);
  });

  it('ERR-09: timeout na reserva do 2º item → 503 e compensa só a 1ª reserva', async () => {
    amb = await subirComStub(
      ({ metodo, caminho, corpo }, n) => {
        if (metodo === 'GET') return stubProduto(caminho);
        if (metodo === 'POST') return n === 1 ? reserva('R1', corpo) : { ...reserva('R2', corpo), atrasoMs: 1000 };
        return { status: 204 };
      },
      { timeoutMs: 300 },
    );

    assert.equal((await amb.criarPedido(itens('P1', 'P2'))).status, 503);
    assert.deepEqual(amb.deletesRecebidos(), ['/reservas/R1']);
  });

  it('ERR-10: 3ª reserva sem campo id → 502 e compensa R1 e R2', async () => {
    amb = await subirComStub(({ metodo, caminho, corpo }, n) => {
      if (metodo === 'GET') return stubProduto(caminho);
      if (metodo === 'POST') return n < 3 ? reserva(`R${n}`, corpo) : { status: 201, corpo };
      return { status: 204 };
    });

    assert.equal((await amb.criarPedido(itens('P1', 'P2', 'P3'))).status, 502);
    assert.deepEqual(amb.deletesRecebidos().sort(), ['/reservas/R1', '/reservas/R2']);
  });

  it('ERR-11: 404 na reserva do 2º item (corrida) → 422 e compensa R1', async () => {
    amb = await subirComStub(({ metodo, caminho, corpo }, n) => {
      if (metodo === 'GET') return stubProduto(caminho);
      if (metodo === 'POST') return n === 1 ? reserva('R1', corpo) : { status: 404, corpo: { erro: 'produto inexistente' } };
      return { status: 204 };
    });

    assert.equal((await amb.criarPedido(itens('P1', 'P2'))).status, 422);
    assert.deepEqual(amb.deletesRecebidos(), ['/reservas/R1']);
  });

  it('ERR-12: falha na própria compensação não mascara o erro original nem interrompe as demais', async () => {
    amb = await subirComStub(({ metodo, caminho, corpo }, n) => {
      if (metodo === 'GET') return stubProduto(caminho);
      if (metodo === 'POST') return n < 3 ? reserva(`R${n}`, corpo) : { status: 409, corpo: { erro: 'insuficiente', disponivel: 0 } };
      return caminho === '/reservas/R1' ? { status: 500, corpo: { erro: 'falha' } } : { status: 204 };
    });

    const { status, dados } = await amb.criarPedido(itens('P1', 'P2', 'P3'));
    assert.equal(status, 409);
    assert.ok(dados.erro);
    assert.deepEqual(amb.deletesRecebidos().sort(), ['/reservas/R1', '/reservas/R2']);
  });

  it('ERR-13 + ERR-14: cancelamento parcial com 503 e retentativa idempotente', async () => {
    let deletes = 0;
    amb = await subirComStub(({ metodo, caminho, corpo }, n) => {
      if (metodo === 'GET') return stubProduto(caminho);
      if (metodo === 'POST') return reserva(`R${n}`, corpo);
      deletes++;
      if (deletes === 1) return { status: 204 }; // 1º cancelamento: R1 liberada
      if (deletes === 2) return { status: 503, corpo: { erro: 'indisponível' } }; // ...R2 falha
      if (deletes === 3) return { status: 404, corpo: { erro: 'reserva não encontrada' } }; // retry: R1 já liberada
      return { status: 204 }; // retry: R2 liberada
    });
    const { dados: pedido } = await amb.criarPedido(itens('P1', 'P2'));

    // ERR-13
    assert.equal((await amb.cancelarPedido(pedido.id)).status, 503);
    assert.equal((await amb.consultarPedido(pedido.id)).dados.status, 'CONFIRMADO');

    // ERR-14
    const retry = await amb.cancelarPedido(pedido.id);
    assert.equal(retry.status, 200);
    assert.equal(retry.dados.status, 'CANCELADO');
    assert.deepEqual(amb.deletesRecebidos(), ['/reservas/R1', '/reservas/R2', '/reservas/R1', '/reservas/R2']);

    const chamadasAntes = amb.chamadas.length;
    assert.equal((await amb.cancelarPedido(pedido.id)).status, 409);
    assert.equal(amb.chamadas.length, chamadasAntes, 'já cancelado não deve chamar o Estoque');
  });
});
