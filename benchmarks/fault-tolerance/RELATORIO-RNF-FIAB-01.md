# RNF-FIAB-01 — Tolerância a falhas no processamento de imagens (rascunho da secção)

> Rascunho da Pessoa 2. As secções marcadas **[POR PREENCHER]** dependem da baseline ou do
> trabalho da Pessoa 1. As afirmações marcadas como *hipótese* resultam da leitura do código e
> ainda não foram confirmadas por medição.

## 1. Diagnóstico

Base analisada: `052310226c51fa57a17101c7bd1ad795674aac95` (repositório oficial, a mesma base
do RNF-EFIC-01). No processamento de imagens, o `projects` envia **uma mensagem por (imagem,
etapa)** para a fila da ferramenta. A ferramenta responde na `project_queue`, e o `projects`
regista o resultado ou envia a etapa seguinte. Identificaram-se as fragilidades seguintes.

| ID | Fragilidade | Evidência no código base | Consequência |
| --- | --- | --- | --- |
| D1 | Os workers confirmam a mensagem ao recebê-la (`auto_ack=True`) | `Tools/utils/rabbit_mq.py:40` | Se o worker cair entre a receção e a resposta, a mensagem já foi retirada da fila e o trabalho perde-se (R1–R3) |
| D2 | A saída é escrita diretamente no destino, e a partir da 2.ª etapa a etapa lê e escreve **o mesmo ficheiro** | `Tools/utils/img_handler.py:16`; `projects/routes/projects.js:495-496` | Uma queda a meio deixa um ficheiro truncado (R2), e repetir uma etapa reaplica o efeito sobre a saída anterior (R3, R5) |
| D3 | As respostas de erro trocam `messageId`/`correlationId` e as ferramentas passam os argumentos desalinhados, pelo que `send_msg` lança uma exceção dentro do próprio `except` | `Tools/utils/tool_msg.py:61-67`; ex. `Tools/brightness/brightness.py:96-105` | *Hipótese:* um erro permanente faz o worker terminar em vez de responder, e o erro nunca chega ao utilizador (R8). Relacionado com T-07 do PL1-G4 |
| D4 | O `projects` confirma a resposta antes de a tratar: o callback é `async` mas não é aguardado | `projects/utils/rabbit_mq.js:48-50` | Se o `projects` cair durante o tratamento, a resposta perde-se (R6) |
| D5 | O avanço de etapa não é atómico: o `Process` atual é apagado antes de o sucessor ser criado e enviado | `projects/routes/projects.js:209`, `515`, `517` | Uma queda entre estes passos perde o trabalho sem deixar rasto (R6a) |
| D6 | Não há idempotência no tratamento das respostas: duas respostas com o mesmo `correlationId` podem ambas encontrar o `Process` | `projects/routes/projects.js:183-184` | *Hipótese:* respostas duplicadas criam cadeias e resultados duplicados (R5) |
| D7 | Publicação sem confirmação do broker e sem mensagens persistentes. O Node abre uma ligação por mensagem e fecha-a ao fim de 500 ms | `projects/utils/rabbit_mq.js:11-28`; `Tools/utils/rabbit_mq.py:25-28` | Mensagens podem perder-se numa falha do broker, mesmo com filas `durable` (`rabbitMQ/definitions.json`). Âmbito a decidir com a Pessoa 1 |
| D8 | O cancelamento invalida o token mas não interrompe os workers, e uma nova execução reutiliza os mesmos caminhos de ficheiro | `projects/routes/projects.js:240`, `1582-1599`, `2252+` | *Hipótese:* uma escrita antiga pode cair sobre a execução nova e corromper o resultado (R7b) |

Impacto nos stakeholders:
- **Utilizador:** um lote fica "a processar" para sempre ou falha sem explicação, e tem de
  repetir o trabalho (e, nas ferramentas avançadas, as operações diárias já foram cobradas).
- **Operação:** um worker que reinicia perde o trabalho em curso sem alarme, e é preciso
  intervenção manual.
- **Equipa de desenvolvimento:** sem garantias de entrega, qualquer reinício (deploy, falta de
  memória) perde trabalho.

## 2. Classificação

ISO/IEC 25010:2011 — **Fiabilidade**, subcaracterísticas **tolerância a falhas** e
**recuperabilidade**.

## 3. Quantificação

Lote de medição: 10 imagens PNG 320×240 determinísticas e o pipeline
`brightness 1.3 → rotate 90 → border 8 px`. As falhas são injetadas no 5.º trabalho de `rotate`
(cenários R1–R8, ver `README.md`), com 10 repetições por cenário e uma janela de 120 s + 30 s.

| Métrica | Escala | Base | Alvo | Mínimo aceitável |
| --- | --- | --- | --- | --- |
| Trabalhos recuperáveis concluídos corretamente | % de ensaios R1–R7 em que o lote termina sem perdas, duplicados ou divergências face ao golden | **[POR PREENCHER]** | 100% | 100% |
| Trabalhos perdidos | n.º de ficheiros sem resultado no fim da janela + verificação tardia, por ensaio | **[POR PREENCHER]** | 0 | 0 |
| Resultados duplicados publicados | n.º de ficheiros com mais de um `Result` do token da execução | **[POR PREENCHER]** | 0 | 0 |
| Efeitos reaplicados / saídas corrompidas | n.º de saídas cujo SHA-256 difere do golden | **[POR PREENCHER]** | 0 | 0 |
| Originais alterados | n.º de originais cujo SHA-256 difere do corpus | **[POR PREENCHER]** | 0 | 0 |
| Cobranças adicionais | variação das operações diárias face ao R0 | **[POR PREENCHER]** | 0 | 0 |
| Tempo de retoma | s, desde o worker voltar a consumir até à reentrega da mensagem interrompida (mediana) | **[POR PREENCHER]** | ≤ 5 s | ≤ 15 s |
| Sobrecusto sem falhas | aumento da mediana da duração do R0 | — | ≤ 5% | ≤ 10% |
| Repetição em erro permanente (R8) | n.º máximo de entregas da mesma mensagem | **[POR PREENCHER]** | ≤ limite definido pela Pessoa 1 | idem |

Os valores-alvo são propostas do plano da equipa e ficam fechados com a Pessoa 1 **antes** do
refactoring, com base nos valores medidos na baseline. **[POR PREENCHER: justificação final.]**

## 4. Método e ambiente

- A ferramenta é `benchmarks/fault-tolerance/fiab.py`, com o stack isolado `picturas-fiab` e as
  falhas injetadas por shims carregados só no ambiente de teste. Não há alterações ao código da
  aplicação.
- O momento de cada falha é comprovado pelo trace do shim (`events-*.jsonl`), e não por atrasos
  aleatórios.
- A correção é verificada por SHA-256 das saídas face ao golden, pelo número de `Result` por
  ficheiro, pelos originais, pelos `Process` pendentes e pela quota.
- Ambiente: **[POR PREENCHER a partir de `runs/<campanha>/environment.json`]**.

## 5. Medição inicial (baseline)

**[POR PREENCHER: tabela por cenário de `summary.json`, mais a observação qualitativa dos logs.]**

Comportamento esperado na base (*hipóteses*, a confirmar):

| Cenário | Esperado na base |
| --- | --- |
| R0 | 10/10 concluídos, saídas iguais ao golden |
| R1, R2, R3 | 1 ficheiro perdido e lote nunca consolidado (D1) |
| R4 | Concluído: a resposta já tinha seguido antes da queda |
| R5a, R5b | Resultados duplicados ou efeito reaplicado (D6, D2) |
| R6a | Trabalho perdido e lote nunca consolidado (D4, D5) |
| R6b, R6c | Resultado ou consolidação perdidos (D4) |
| R7a | Resposta antiga ignorada pelo guard de token |
| R7b | Saída corrompida (D8, D2) |
| R8 | Worker termina em ciclo, erro não chega ao utilizador, lote pendurado (D3) |

## 6. Decisão arquitetural e refactoring

**[POR PREENCHER pela Pessoa 1:** alternativas consideradas (reentrega pelo broker com
confirmação manual, recuperação por estado persistido, combinação), decisão, consequências e
alterações efetuadas.**]**

## 7. Medição final e análise

**[POR PREENCHER:** a mesma campanha sobre a versão refatorada, a comparação com a base e com
os valores-alvo, os efeitos noutros RNF (desempenho do R0, RNF-EFIC-01) e as limitações.**]**

## 8. Preservação funcional

**[POR PREENCHER:** testes de regressão de imagem e vídeo, cancelamento e resultados tardios,
quotas e permissões.**]**

## 9. Apoio de IA

- **Claude Code (Claude Opus 5.5)**: leitura da base e diagnóstico D1–D8, escrita da
  ferramenta de injeção de falhas (`fiab.py`, shims, override) e dos seus testes unitários
  (`test_fiab.py`, 10 testes a passar), e deste rascunho.
- Validação pela equipa: **[POR PREENCHER:** revisão do código, piloto R0/R1 e confirmação das
  hipóteses com a baseline.**]**
