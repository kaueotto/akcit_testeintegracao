'use strict';

class CorpoInvalidoError extends Error {}

function lerJson(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', (parte) => (dados += parte));
    req.on('end', () => {
      if (!dados) return resolve(undefined);
      try {
        resolve(JSON.parse(dados));
      } catch {
        reject(new CorpoInvalidoError('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function enviarJson(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

// Encapsula o roteamento e o tratamento de erros comuns aos dois serviços.
function criarHandler(rotear) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      const resultado = await rotear(req, partes);
      if (!resultado) return enviarJson(res, 404, { erro: 'Rota não encontrada' });
      const [status, corpo] = resultado;
      if (corpo === undefined) return res.writeHead(status).end();
      enviarJson(res, status, corpo);
    } catch (erro) {
      if (erro instanceof CorpoInvalidoError) return enviarJson(res, 400, { erro: erro.message });
      enviarJson(res, 500, { erro: 'Erro interno' });
    }
  };
}

module.exports = { CorpoInvalidoError, lerJson, enviarJson, criarHandler };
