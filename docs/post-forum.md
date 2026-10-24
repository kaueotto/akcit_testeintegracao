Olá, pessoal!

Repositório: https://github.com/kaueotto/akcit_testeintegracao

**Cenário:** dois serviços REST, Pedidos e Estoque. Para cada item, Pedidos consulta o produto e cria uma reserva no Estoque. Se algum item falhar (falta de estoque, produto inexistente, timeout, 5xx), ele desfaz as reservas já feitas, numa saga simplificada. Escolhi esse cenário porque o risco está justamente na comunicação: falhas parciais e estado inconsistente entre os dois lados.

**Prompts:** defini 3 tipos e rodei cada um em versão ingênua (v1) e refinada (v2) no Claude Sonnet:

1. **Geração de cenários de integração:** zero-shot → papel + contrato da API + restrições + formato de tabela.
2. **Casos de erro na comunicação:** zero-shot → *few-shot* (2 exemplos) + raciocínio guiado por uma taxonomia de falhas (rede, timeout, 5xx, 4xx, resposta fora do contrato, falha parcial).
3. **Contrato + dados de teste:** zero-shot → persona + partição de equivalência/valor-limite + saída em **JSON** que o teste lê diretamente.

Os casos viraram uma suíte de **72 testes automatizados** (Node.js, sem dependências). Na primeira execução, **3 falharam, e as 3 falhas eram defeitos reais do sistema**, não erros da LLM.

**Como cada tipo de prompt influenciou qualidade e diversidade**

- **As v1 (sem contexto)** geraram mais casos (148 no total) e mais variados: segurança, mensageria, concorrência. Mas inventaram endpoints e até um schema inteiro (`clienteId`, `formaPagamento`...), e deram resultados ambíguos como "400/422". Nenhum caso foi aproveitável como veio. Ainda assim, serviram de brainstorm: foi de lá que saiu a ideia de testar **concorrência pela última unidade do estoque**, que a v2 não cobria.
- **Cenários (v2):** a regra "verifique os DOIS lados da integração" foi decisiva. Todo cenário passou a conferir a resposta de Pedidos **e** o estoque no outro serviço, que é o que diferencia teste de integração de teste de API isolado.
- **Erros (few-shot + raciocínio guiado):** foi o mais produtivo. Os exemplos fixaram um formato com configuração do stub e verificação de compensação. A taxonomia fez o modelo montar uma matriz de cobertura e achar um ponto de comunicação que eu não tinha separado: a falha **dentro da própria compensação**. Ele ainda levantou 17 ambiguidades do contrato, e um dos casos (404 na reserva por condição de corrida) **pegou um defeito**: meu serviço respondia 502 em vez de 422.
- **Dados em JSON:** com técnicas nomeadas e estado inicial fixo, os valores esperados vieram calculados corretamente. Como o teste consome o JSON direto, adicionar casos não exige código.

**Ajustes de prompt necessários**

1. **Colar o contrato da API no prompt** foi o ajuste de maior impacto: zerou as invenções.
2. "Use SOMENTE os status codes do contrato" + dados concretos eliminaram os resultados ambíguos.
3. Separar cenários, falhas e dados em **prompts diferentes** deu mais profundidade a cada um.
4. Pedir **"o que ficou sem cobertura?"** e **"o que é ambíguo no contrato?"** rendeu as melhores ideias.
5. A lição mais interessante foi a **v3 do prompt de dados**. Na v2, o schema JSON que **eu** escrevi forçava `estoqueEsperado: null` nos casos de erro, e a verificação de compensação acabou só no texto livre. O problema era meu prompt, não o modelo. Na v3 tornei o campo obrigatório, listei as partições que faltaram (cliente `""`, só espaços) e pedi casos de ponto flutuante. Resultado: os 25 casos passaram a verificar o estoque, e **2 deles pegaram um bug de arredondamento** (`1.005 × 3` dava 3,01 em vez de 3,02 por causa do ponto flutuante binário).
