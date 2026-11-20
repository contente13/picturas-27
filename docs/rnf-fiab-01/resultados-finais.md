# RNF-FIAB-01 — Resultados finais (Fase 4)

Mesmo protocolo da baseline ([protocolo-baseline.md](protocolo-baseline.md)): mesmo corpus,
pipeline, stack isolado, cenários, 10 repetições por variante e critérios
([especificacao-e-decisao.md](especificacao-e-decisao.md) §4). Versão medida: ramo
`rnf-fiab-01`, base `674709b` + alterações da Fase 3 ([implementacao.md](implementacao.md)),
ainda por versionar. Dados brutos: [`evidencias/final/`](evidencias/final/) (campanha),
[`evidencias/m11-baseline/`](evidencias/m11-baseline/) e
[`evidencias/m11-final/`](evidencias/m11-final/) (M11),
[`evidencias/final-regression/`](evidencias/final-regression/) (regressão).

**Conclusão: o RNF-FIAB-01 é cumprido.** Nas 90 execuções com falha recuperável (R1–R4, R6a–e)
todos os lotes foram consolidados com os 10 trabalhos corretos, sem duplicados, sem reaplicações
e sem consolidações prematuras. A retoma demorou no máximo 3 ms. Os originais e as quotas nunca
foram alterados. Os erros permanentes terminam de forma controlada e são notificados uma vez. Sem
falhas, a versão corrigida é 22 % mais rápida do que a original.

## 1. Identificação

| Campo | Valor |
| --- | --- |
| Commit / ramo | `674709b` / `rnf-fiab-01` + alterações da Fase 3 por versionar (lista em `evidencias/final/campaign.json`, escrito no início de R1–R8b; R0 correu 4 min antes com as mesmas imagens) |
| Runtime | podman 4.9.3 rootless, Docker Compose v5.1.1, kernel 7.0.0-43, 18 CPUs; stack `picturas` do utilizador parado |
| Imagens | `picturas-fiab-*` construídas da árvore de trabalho (IDs em `campaign.json`); para M11, imagens `localhost/rnf-fiab-01-baseline-*:674709b` construídas de uma *worktree* de `674709b` |
| Corpus | o mesmo da baseline (manifesto verificado no início de cada execução) |
| Execução | campanha: 2026-11-15 12:16–12:45 UTC; M11: 12:48–12:53 UTC; regressão e piloto de confirmação: 12:53–13:00 UTC |
| `T_obs` | 120 s (`10 × mediana R0 = 3,5 s`) |

## 2. Antes e depois, por cenário

Lotes OK = consolidado **e** 10 trabalhos com o hash de referência **e** sem duplicados.

| Cenário | Baseline: lotes OK · corretos · dup · reapl. · prem. | Final: lotes OK · corretos · dup · reapl. · prem. | M9 retoma (final, máx.) |
| --- | --- | --- | --- |
| R0 | 10/10 · 100/100 · 0 · 0 · 0 | 10/10 · 100/100 · 0 · 0 · 0 | — |
| R1 kill worker, `after_receive` | 0/10 · 42/100 · 0 · 0 · 0 | **10/10 · 100/100** · 0 · 0 · 0 | < 1 ms |
| R2 kill worker, `during_write` | 0/10 · 37/100 · 0 · 0 · 0 | **10/10 · 100/100** · 0 · 0 · 0 | < 1 ms |
| R3 kill worker, `after_output_before_reply` | 0/10 · 42/100 · 0 · 0 · 0 | **10/10 · 100/100** · 0 · 0 · 0 | < 1 ms |
| R4 kill worker, `after_reply_before_ack` | 0/10 · 32/100 · 0 · 0 · 0 | **10/10 · 100/100** · 0 · 0 · 0 | < 1 ms |
| R5a 3 cópias, passo final | 0/10 · 100/100 · **20** · 0 · 0 | **10/10 · 100/100 · 0** · 0 · 0 | — |
| R5b 3 cópias, passo intermédio | 0/10 · 80/100 · **8** · **16** · 0 | **10/10 · 100/100 · 0 · 0** · 0 | — |
| R5c cópia depois da consolidação | 10/10 · 100/100 · 0 · 0 · 0 | 10/10 · 100/100 · 0 · 0 · 0 | — |
| R6a kill projects, `after_receive` | 0/10 · 56/100 · 0 · 0 · 0 | **10/10 · 100/100** · 0 · 0 · 0 | 3 ms |
| R6b kill projects, `after_process_delete` | 0/10 · 69/100 · 0 · 0 · **3** | **10/10 · 100/100** · 0 · 0 · **0** | 2 ms |
| R6c kill projects, `before_next_publish` | 0/10 · 64/100 · 0 · 0 · 0 | **10/10 · 100/100** · 0 · 0 · 0 | 2 ms |
| R6d kill projects, `after_result_persist` | 7/10 · 97/100 · 0 · 0 · **1** | **10/10 · 100/100** · 0 · 0 · **0** | 3 ms |
| R6e kill projects, `before_commit` | 0/10 · 100/100 · 0 · 0 · 0 | **10/10 · 100/100** · 0 · 0 · 0 | 3 ms |
| R7 resposta de execução cancelada | 0/10 · 56/100 · 0 · **44** · 0 | **10/10 · 100/100 · 0 · 0** · 0 | — |
| R8a media inválida (11 media) | consolidado 0/10 · 43/100 válidos | consolidado **10/10** · **100/100 válidos** · inválida `FAILED` | — |
| R8b parâmetro inválido | consolidado 0/10 · 0/100 · worker morto | 0/10 consolidados (todos `FAILED`, mantém-se a consolidação anterior) · worker vivo | — |

Em todas as 160 execuções: **originais alterados 0**, **cobranças adicionais 0**, **erros do
harness 0**, ponto de falha sempre atingido. R7: nenhum `Result` com o token antigo nas 10
repetições.

## 3. Critérios de aceitação

| Métrica | Meta (mínimo) | Baseline | Final | Cumpre |
| --- | --- | --- | --- | --- |
| M1 Recuperáveis concluídos corretamente | 100 % | 7/90 lotes (7,8 %) | **90/90 lotes, 900/900 trabalhos (100 %)** | Sim |
| M2 Trabalhos perdidos | 0 | 361 | **0** | Sim |
| M3 Duplicados publicados | 0 | 28 | **0** (60 cópias entregues em R5a/b, 20 em R5c) | Sim |
| M4 Reaplicações | 0 | 60 + 1 resultado vazio | **0** | Sim |
| M5 Originais alterados | 0 | 0 | **0** | Sim |
| M6 Cobranças adicionais | 0 | 0 | **0** (e 0 na regressão com efeitos de vídeo cobrados, §5) | Sim |
| M7 Sobrescrita por tentativa antiga | 0 | 10/10 repetições de R7 | **0/10** | Sim |
| M8 Consolidação prematura | 0 | 4 | **0** | Sim |
| M9 Tempo de retoma | ≤ 5 s (≤ 15 s) | não há retoma | **máx. 3 ms** (R1–R4 < 1 ms; R6 1–3 ms) | Sim |
| M10 Tempo até à conclusão | reportado | não há conclusão | mediana 0,79–0,87 s (R1–R4), 1,10–1,19 s (R6); máx. 31,2 s (§4) | — |
| M11 Sobrecarga sem falhas | ≤ 5 % (≤ 10 %) | — | **−22 %** (0,451 s → 0,352 s) | Sim |
| M12 Fim controlado de erro permanente | 100 % | 0/20 notificados, worker morto em R8b | **20/20 execuções**: cada trabalho falhado notificado uma vez (1 em R8a, 10 em R8b), 1 entrega por pedido, worker vivo | Sim |

M10 inclui o reinício do contentor (≈ 0,5 s para os workers, ≈ 1 s para o `projects`).

## 4. Anomalia observada: uploads para o `img_storage` presos

Em 6 das 90 execuções com falha da campanha (R1 rep 2, R3 rep 8, R4 rep 2, R6b rep 9, R6c reps 1
e 2), o lote foi consolidado corretamente, mas só 10 a 31 s depois da retoma. As restantes 84
repetições terminaram em ~1 s.

- **Onde está o tempo.** Depois da campanha foi acrescentado um registo `[JOB-SLOW]` às chamadas
  externas do tratamento de respostas (§6 de [implementacao.md](implementacao.md)). Em
  repetições de diagnóstico ([`evidencias/slow-debug-pilot/`](evidencias/slow-debug-pilot/)), e
  no piloto de confirmação ([`evidencias/final-confirm-pilot/`](evidencias/final-confirm-pilot/)),
  as repetições lentas mostram **todos os uploads do passo final para o `img_storage`** parados
  durante o mesmo intervalo (10 s; 45 s no piloto de confirmação) e a terminar juntos. A base de
  dados não registou operações lentas.
- **Quando.** Só em repetições com reinício de um contentor (R1–R4, R6). Nunca em R0, R5, R7 ou
  R8 (60 execuções, durações estáveis). Não se reproduziu com um teste direto (8 uploads
  concorrentes do `projects` para o `img_storage` enquanto se reiniciava um worker).
- **Efeito no requisito.** Nenhum na correção: o lote termina sempre e corretamente. M9 não é
  afetado (a retoma acontece antes do upload). M10 é reportado com o máximo de 31,2 s.
- **Causa.** Não identificada. Está fora do código alterado: o pedido HTTP do `projects` para o
  `img_storage` é o mesmo da versão original, e o `img_storage` e o SeaweedFS não foram
  alterados. Hipóteses: rede do podman rootless ao reiniciar contentores, ou o caminho de upload
  do `img_storage` (alterado recentemente por outro requisito, `b8c8ba4`). Fica como
  recomendação em [regressao-e-limitacoes.md](regressao-e-limitacoes.md).

## 5. M11 — sobrecarga sem falhas

A sensibilidade de M11 já tinha sido assinalada na baseline: 5 % são ~34 ms, da ordem da
variação entre repetições, e a baseline correu com o stack do utilizador ligado. Por isso, o
ajuste proposto em [resultados-baseline.md](resultados-baseline.md) §4.5 foi aplicado: R0 da
versão original e da versão corrigida, na mesma sessão, intercalados em blocos de 10 (A B A B A
B), com 30 repetições por versão e um lote de aquecimento não contado depois de cada troca
([`tests/rnf-fiab-01/m11_ab.sh`](../../tests/rnf-fiab-01/m11_ab.sh),
[`compose.ab-baseline.yaml`](../../tests/rnf-fiab-01/compose.ab-baseline.yaml)). Cada bloco
regista as imagens que estavam a correr (`campaign-rerun-*.json`).

| Versão | n | Mediana | Q1–Q3 | Mín.–máx. |
| --- | --- | --- | --- | --- |
| Original (`674709b`) | 30 | 0,451 s | 0,440–0,464 s | 0,421–0,487 s |
| Corrigida | 30 | **0,352 s** | 0,343–0,364 s | 0,323–0,406 s |

**Sobrecarga: −22 %.** Os intervalos interquartis não se sobrepõem. A correção acrescenta
*confirms*, ACK depois do tratamento e escritas condicionais, mas remove o maior custo da versão
original: o `projects` abria e fechava uma ligação AMQP por mensagem publicada. A campanha
principal deu uma mediana R0 de 0,350 s, coerente com a medição A/B. A baseline histórica
(0,677 s) não é comparável, porque correu com o stack do utilizador ligado.

## 6. Testes automáticos

| Suite | Resultado |
| --- | --- |
| `tests/rnf-fiab-01` (Python, host) | 17/17 |
| `projects/tests/*.test.js` (contentor, versão final) | 36/36 |
| Regressão ([regressao-e-limitacoes.md](regressao-e-limitacoes.md) §1) | 7/7 |

## 7. Alterações depois da campanha

Duas alterações ao `projects` foram feitas depois da campanha e antes da regressão:

1. Registo `[JOB-SLOW]` (só escreve quando uma chamada demora ≥ 1 s). Não muda comportamento.
2. O *undo* passa também a apagar os resultados já guardados pela execução que invalida, como o
   cancelamento (detetado pela regressão, §1 de
   [regressao-e-limitacoes.md](regressao-e-limitacoes.md)). Só altera `DELETE …/tool/:tool`,
   que os cenários R0–R8 não usam.

Para confirmar, a versão final correu um piloto de todos os cenários (1 repetição cada,
[`evidencias/final-confirm-pilot/`](evidencias/final-confirm-pilot/)): 15 lotes consolidados com
10/10 corretos, R8b como na campanha, 0 duplicados e retoma ≤ 3 ms. Houve uma ocorrência da
anomalia da §4 em R2 e R3 (46 s).

## 8. Verificação da versão integrada (`6d19557`)

Verificação feita pela Pessoa 1 com o *harness* independente da Pessoa 2
(`benchmarks/fault-tolerance/`, shims externos, sem hooks da aplicação), sobre o ramo
`rnf-fiab-01` já integrado com `main` (inclui o *refactor* de uploads `c7e597a`) e com as
correções `0a54f73` (resultado por etapa) e `9ca4de6` (reinício do consumidor). Não substitui a
avaliação independente: a Pessoa 2 deve rever estes dados ou repetir um subconjunto.

| Campo | Valor |
| --- | --- |
| Versão medida | `6d19557` (*worktree* destacada, `dirty_files: []`) |
| Golden | gerado nesta máquina a partir de um R0 de `df5d0bc` (código original); 10 saídas 256×336 |
| *Harness* | `fiab.py`, `protocol.json`, `compose.fiab.yaml` e shims iguais aos de `origin/main` (SHA-256 em `environment.json`) |
| Runtime | podman 4.9.3 rootless com `docker-compose` 5.1.1 (chamado através de um *shim* `docker` → `podman`), 18 CPUs, 30 GiB; stack `picturas` do utilizador parado; volumes `picturas-fiab_*` recriados antes da baseline |
| Execução | 2026-11-19, 09:47–10:57 UTC (70 min, 90 ensaios, nenhum repetido) |
| Dados | [`evidencias/integrado-6d19557/`](evidencias/integrado-6d19557/): `environment.json` (caminho local removido), `summary.json`, `trials.csv`, um `rep-NN.json` por ensaio, golden e manifesto do corpus. Traces e logs: `benchmarks/fault-tolerance/runs/arquivo-integrado-6d19557.tar.gz` (fora do Git), SHA-256 `9680702932c17a845da336c93b3f806b89dfcaa55c6e04836644da7b3b9276cb` |

| Cenário | Falha atingida | Lotes corretos | Perdidos | Dup. | ≠ golden | Entregas máx. | Duração mediana (máx.) | Falha → lote visível, mediana (máx.) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R0 | — | 10/10 | 0 | 0 | 0 | 1 | 1,00 s (1,04) | — |
| R1 | 10/10 | 10/10 | 0 | 0 | 0 | 2 | 1,54 s (1,56) | 1,10 s (1,12) |
| R4 | 10/10 | 10/10 | 0 | 0 | 0 | 2 | 2,60 s (2,65) | 1,10 s (1,14) |
| R6a | 10/10 | 10/10 | 0 | 0 | 0 | 2 | 2,12 s (2,43) | 1,77 s (2,08) |
| R6b | 10/10 | 10/10 | 0 | 0 | 0 | 1 | 2,09 s (2,35) | 1,48 s (1,73) |
| R6c | 10/10 | 10/10 | 0 | 0 | 0 | 1 | 1,33 s (1,35) | 0,78 s (0,84) |
| R7a | 10/10 (retenção) | 10/10 | 0 | 0 | 0 | 1 | 1,06 s (1,15) | — |
| R7b | 10/10 (retenção) | 10/10 | 0 | 0 | 0 | 1 | 1,03 s (1,14) | — |
| R8 | — | 10/10 controlados | — | 0 | — | 1 | — | — |

- Em todos os ensaios: 0 originais alterados, 0 consolidações prematuras, 0 `Process` pendentes
  e variação de operações diárias 0 (M6 não discrimina: o pipeline não usa ferramentas cobradas).
- R7a/R7b: em 10/10 a tentativa antiga ficou retida, a 1.ª etapa da nova execução terminou antes
  da libertação e a resposta antiga foi descartada (`JOB-DUPLICATE`/`RUN-GUARD` nos 20 logs).
- R8: 100 trabalhos `FAILED`, uma notificação `[JOB-FAILED]` por trabalho, 1 entrega por pedido;
  o lote não consolida (D6).
- **M9** (R1, R4): mediana 0,027–0,028 s (máx. 0,037 s) na definição do *harness* (arranque do
  processo → reentrega); mediana 0,001 s (máx. 0,003 s) desde o registo do consumidor.
- **Anomalia do ambiente.** No piloto anterior à campanha, o primeiro reinício do `rotate_tool`
  depois de `up` levou 10,0 s entre o arranque do processo e a ligação ao broker (o broker só
  aceitou a ligação TCP 10,1 s depois; nenhum erro no worker). Não se repetiu em 7 reinícios de
  diagnóstico nem nas 20 quedas de worker da campanha; o DNS e o TCP respondem em cerca de 1 ms
  logo após um reinício. O valor coincide com o `socket_timeout` do pika (10 s) e com duas
  esperas de 5 s do *resolver*; é coerente com a anomalia da §4 (podman rootless). A reentrega
  em si foi imediata (3 ms).
- **M11 não avaliado** nesta verificação: só existe um R0 da baseline nesta máquina (usado para o
  golden). A medição válida de M11 continua a ser a da §5.

## 9. Correções ao consumidor do `projects` depois da revisão do Francisco

Na revisão do código integrado (`5d084ce`), o Francisco identificou um defeito em
`projects/utils/rabbit_mq.js` e confirmou-o com um RabbitMQ simulado. A Pessoa 1 reproduziu-o
com o RabbitMQ real e encontrou um segundo defeito no mesmo consumidor. Os dois estão corrigidos
(descrição em [implementacao.md](implementacao.md) §3).

| # | Defeito | Causa | Efeito |
| --- | --- | --- | --- |
| 1 | Consumidores duplicados após uma falha na configuração | Um erro de canal durante a configuração (p. ex. `assertQueue` com `406 PRECONDITION_FAILED`) era tratado por dois caminhos: fecho do canal → fecho da ligação → reinício, e rejeição da configuração → outro reinício. Introduzido pela correção `9ca4de6` (reinício quando só o canal fecha). | Cada falha duplicava os consumidores e as ligações. Cada mensagem continua a ir para um só consumidor, por isso não há resultados duplicados, mas o *prefetch* efetivo multiplica-se e as ligações acumulam-se. |
| 2 | Consumidor cancelado pelo broker não volta | O `amqplib` entrega `msg == null` quando o broker cancela o consumidor (p. ex. a fila foi apagada), e o código ignorava esse caso. O consumidor também não fazia `bindQueue`. | O `projects` ficava ligado mas sem consumidor até a ligação cair. Se a fila tinha sido apagada, as respostas dos workers ficavam sem rota e perdiam-se. |

**Verificação com o RabbitMQ real.** Stack isolado `picturas-fixtest` (só `rabbitmq`,
`projects_mongoDB` e `projects`, podman 4.9.3 rootless), 2026-11-20. Faltas induzidas pela API
de gestão do RabbitMQ. Scripts e saídas em
[`evidencias/consumidor-projects/`](evidencias/consumidor-projects/) (`RMQ_AUTH` com as
credenciais do `docker-compose.yaml`).

| Cenário | `5d084ce` (antes) | `c622f35` (defeito 1 corrigido) | Versão final |
| --- | --- | --- | --- |
| Setup com `406` repetido durante ~16 s (fila recriada com `x-max-length`, ligação fechada) e depois reposta: consumidores em `project_queue` | **128** (2⁷, em 128 ligações) | 1 | 1 |
| `project_queue` apagada com a ligação aberta: consumidor | — | **nunca volta** (30 s observados; fila inexistente) | volta em ≈ 4 s, com o *binding* `picturas`/`project_queue` |
| Mensagem publicada no exchange `picturas` depois disso | — | `routed: false` (perdida) | consumida e confirmada (`ready=0`, `unacked=0`) |

Os logs confirmam o mecanismo: em `5d084ce`, cada falha regista "connection closed" e "start
failed" (128 e 127 linhas); na versão final regista uma só linha "reconnecting" por falha.

**Testes automáticos.** `projects/tests/rabbit-mq.test.js` passa de 1 para 3 testes, um por
defeito, e cada teste novo falha sem a respetiva correção. No host, todas as suites de
`projects/tests` passam (30/30), exceto `media-upload.test.js`, que não arranca porque falta o
módulo `form-data` neste ambiente (já acontecia antes destas alterações).

**Âmbito.** As campanhas das §§2 e 8 mediram versões sem estas correções. Nenhum cenário R0–R8
passa por este código: nenhum reinicia o broker nem fecha o consumidor, e R6 mata o processo
`projects` inteiro, que arranca um consumidor novo. Por isso os resultados dessas campanhas
continuam válidos, mas não cobrem estas correções. Os workers (`Tools/utils`) também não fazem
`queue_bind`, e o tratamento de um cancelamento pelo broker no pika não foi verificado; ficam
registados em [regressao-e-limitacoes.md](regressao-e-limitacoes.md) §2.
