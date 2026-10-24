'use strict';

// Teste data-driven: lê DIRETAMENTE o JSON produzido pela LLM no Prompt 3 (v2 e v3)
// e executa cada caso contra os dois serviços reais.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { produtosPadrao, subirAmbiente } = require('../helpers');

const versoes = [
  { arquivo: '03-dados-v2.json', produtos: produtosPadrao },
  {
    arquivo: '03-dados-v3.json',
    produtos: () => [
      ...produtosPadrao(),
      { id: 'P4', nome: 'Clipe', preco: 0.1, quantidade: 100 },
      { id: 'P5', nome: 'Parafuso', preco: 1.005, quantidade: 10 },
    ],
  },
];

for (const { arquivo, produtos } of versoes) {
  const casos = JSON.parse(fs.readFileSync(path.join(__dirname, '../../respostas-llm', arquivo), 'utf8'));

  describe(`Prompt 3: contrato de POST /pedidos (${arquivo}, ${casos.length} casos)`, () => {
    for (const caso of casos) {
      it(`${caso.id} [${caso.tecnica}] ${caso.descricao}`, async () => {
        const amb = await subirAmbiente({ produtos: produtos() });
        try {
          const { status, dados } = await amb.criarPedido(caso.corpo === null ? 'null' : caso.corpo);

          assert.equal(status, caso.statusEsperado, `status (resposta: ${JSON.stringify(dados)})`);
          if (status === 201) {
            assert.equal(dados.status, 'CONFIRMADO');
            assert.equal(dados.total, caso.totalEsperado, 'total');
          } else {
            assert.ok(dados?.erro, 'erros devem seguir o formato { erro }');
          }
          for (const [produtoId, quantidade] of Object.entries(caso.estoqueEsperado ?? {})) {
            assert.equal(await amb.estoqueDe(produtoId), quantidade, `estoque de ${produtoId}`);
          }
        } finally {
          await amb.fechar();
        }
      });
    }
  });
}
