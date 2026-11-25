# RNF-FIAB-01 — Tolerância a falhas no processamento de imagens (medição independente)

> Secção da Pessoa 2: medição externa, por injeção de falhas sem alterar a aplicação, da versão
> base e da versão corrigida pela Pessoa 1. O diagnóstico detalhado, a especificação e a decisão
> são da Pessoa 1 e estão no `main`, em `docs/rnf-fiab-01/` (`diagnostico.md`,
> `especificacao-e-decisao.md`, `implementacao.md`, `resultados-finais.md`). Aqui usam-se os
> mesmos identificadores: fragilidades W (workers), X (watermark), P (`projects`), K
> (cancelamento/undo), métricas M1–M12 e decisões de desenho D1–D8.

**Conclusão: a medição independente confirma que o RNF-FIAB-01 é cumprido.** Na versão base,
nenhum dos 100 lotes com falha recuperável (R1–R4, R6a–c, R7a–b) terminou corretamente (186
trabalhos perdidos, 10 lotes nunca consolidados e 88 saídas com efeito reaplicado). Na versão
corrigida, os mesmos 100 lotes terminaram todos corretos, sem perdas, duplicados nem
reaplicações, e os 10 lotes com erro permanente (R8) terminaram de forma controlada, com cada
trabalho marcado `FAILED` e notificado uma vez. Sem falhas, o lote é 35 % mais rápido.
Uma repetição parcial (R0, R1, R6a, R7b) sobre o `main` integrado (`35fdd36`) confirmou o
mesmo comportamento: 40/40 lotes corretos (§8).

## 1. Diagnóstico

No processamento de imagens, o `projects` envia **uma mensagem por (imagem, etapa)** para a fila
da ferramenta. A ferramenta responde na `project_queue`, e o `projects` regista o resultado ou
envia a etapa seguinte. O rascunho anterior desta secção numerava as fragilidades D1–D8; foi
revisto pela Pessoa 1 (`docs/rnf-fiab-01/diagnostico.md` §8) e passa a usar a numeração de `diagnostico.md`.
As linhas citadas são de `df5d0bc`.

| ID (antes) | Fragilidade | Evidência no código base | Confirmado na medição |
| --- | --- | --- | --- |
| **W1** (D1) | Os workers confirmam a mensagem ao recebê-la (`auto_ack=True`) **e** não limitam o *prefetch*: as mensagens já entregues ao worker morrem com ele (perda colateral) | `Tools/utils/rabbit_mq.py` | R1–R4: 1 a 5 imagens perdidas por repetição (R1: só o alvo; R2–R4: o alvo e as que estavam em *prefetch*) |
| **W2, W3** (D2) | A saída é escrita diretamente no destino, e a partir da 2.ª etapa a etapa lê e escreve **o mesmo ficheiro** | `Tools/utils/img_handler.py`; `projects/routes/projects.js` | R2/R3 perdem o trabalho antes de o ficheiro truncado ser usado (W1 domina); a reaplicação aparece em R7 (K3) |
| **W4** (D7) | Publicação sem confirmação do broker e mensagens não persistentes | `Tools/utils/rabbit_mq.py` | R4: com `auto_ack` a janela "resposta publicada, antes do ACK" não existe, mas perde-se o que estava no *prefetch* |
| **W5** (D3) | As respostas de erro trocam `messageId`/`correlationId` e passam argumentos desalinhados: `send_msg` lança uma exceção dentro do próprio `except` | `Tools/utils/tool_msg.py`; `Tools/brightness/brightness.py` | R8: o `brightness` termina com `TypeError` no 1.º pedido, reinicia, perde os outros 9 e nada chega ao utilizador |
| W6 (D7) | Mensagens não persistentes perdem-se numa reinicialização do broker | idem | Não medido (falha do broker fora dos cenários) |
| W7 | Com ACK manual, um efeito longo no fio da ligação bloqueia os *heartbeats* | — | Requisito da correção, não defeito da base |
| X1–X3 | Watermark: reentrega com marca dupla, segunda resposta, `error.description` | imagem externa | Fora do âmbito (imagem pré-construída, não instrumentada) |
| **P1** (D4) | O `projects` confirma a resposta antes de a tratar (callback `async` não aguardado) | `projects/utils/rabbit_mq.js` | R6a–c: a resposta em tratamento perde-se com o processo |
| P2 / P3 (D6) | Respostas duplicadas: sequenciais são ignoradas (correto); concorrentes podem criar cadeias e resultados duplicados | `projects/routes/projects.js` | R5a/R5b só produzem cópias **sequenciais** (P2): ignoradas na base, 0 duplicados. P3 só é coberto pela campanha da Pessoa 1 |
| **P4–P7** (D5) | Avanço de etapa não atómico: o `Process` atual é apagado antes de o sucessor ser criado e publicado, e o resultado final é gravado depois do *upload* | `projects/routes/projects.js:208`, `:514` | R6a (P4): 30 perdidos; R6b (P7): 39 perdidos |
| P8 | Consolidação prematura (outro trabalho conta `remaining == 0` antes de o resultado estar gravado) | idem | Não observado nesta campanha (0 consolidações com resultados em falta) |
| **P9** | Morte entre o último `Result.create` e `commitRunIfActive` | idem | R6c: todos os resultados gravados e o lote nunca consolida (10/10) |
| P10–P12 | Erro de um trabalho consolida com resultados em falta; *preview* com o mesmo token; exceção transitória no callback | idem | Não injetados nesta campanha |
| **K3** (D8) | O cancelamento não interrompe os workers, e a nova execução reutiliza os mesmos caminhos de ficheiro | `projects/routes/projects.js` | R7a/R7b: 49 e 39 saídas da execução nova com a rotação aplicada duas vezes |
| K4 | *Undo* com execução em curso não incrementa `activeToken` | idem | Não injetado (medido na regressão da Pessoa 1) |

Impacto nos stakeholders:
- **Utilizador:** o lote fica "a processar" para sempre ou termina com imagens corrompidas sem
  explicação, e tem de repetir o trabalho.
- **Operação:** um worker que reinicia perde o trabalho em curso e o que tinha em *prefetch*,
  sem alarme; um parâmetro inválido derruba o worker.
- **Equipa de desenvolvimento:** sem garantias de entrega, qualquer reinício (deploy, falta de
  memória) perde trabalho.

## 2. Classificação

ISO/IEC 25010:2011 — **Fiabilidade**, subcaracterísticas **tolerância a falhas** e
**recuperabilidade**.

## 3. Quantificação

Métricas e metas da Pessoa 1 (`especificacao-e-decisao.md` §4), fechadas com base na baseline.
Lote de medição: 10 imagens PNG 320×240 determinísticas e o pipeline
`brightness 1.3 → rotate 90 → border 8 px`.

| ID | Métrica | Como é medida aqui (`fiab.py`) | Meta | Mínimo |
| --- | --- | --- | --- | --- |
| M1 | Trabalhos recuperáveis concluídos corretamente | lote consolidado no token da execução **e** 10 saídas com SHA-256 igual ao golden | 100 % | 100 % |
| M2 | Trabalhos perdidos | ficheiros sem `Result` no token da execução, no fim da janela + verificação tardia | 0 | 0 |
| M3 | Resultados duplicados publicados | ficheiros com mais de um `Result` no token da execução | 0 | 0 |
| M4 | Reaplicações indevidas | saídas cujo SHA-256 difere do golden (fora de R7) | 0 | 0 |
| M5 | Originais alterados | originais cujo SHA-256 difere do corpus | 0 | 0 |
| M6 | Cobranças adicionais | variação das operações diárias restantes antes/depois do ensaio | 0 | 0 |
| M7 | Sobrescrita por tentativa antiga | R7: saídas da execução nova que diferem do golden | 0 | 0 |
| M8 | Consolidação prematura | ensaios consolidados com algum ficheiro em falta | 0 | 0 |
| M9 | Tempo de retoma | do arranque do processo reiniciado (primeiro evento `start` do shim) até à reentrega da mensagem interrompida | ≤ 5 s | ≤ 15 s |
| M10 | Tempo até à conclusão | da falha até ao lote consolidado ser visível na API | reportado | reportado |
| M11 | Sobrecarga sem falhas | variação da mediana da duração do R0 | ≤ 5 % | ≤ 10 % |
| M12 | Fim controlado de erro permanente | R8: os 10 trabalhos `FAILED`, ≤ `MAX_DELIVERIES` (3) entregas por mensagem, uma notificação `[JOB-FAILED]` por trabalho | 100 % | 100 % |

As metas de M1–M8 e M12 resultam do próprio requisito (nenhum trabalho perdido ou duplicado). As
de M9 e M11 são as propostas pela Pessoa 1: uma retoma abaixo de 5 s não é percetível num lote
interativo, e 5 % é o custo aceitável de durabilidade num lote que dura menos de 1 s.

## 4. Método e ambiente

- **Ferramenta:** `benchmarks/fault-tolerance/fiab.py` (ver `README.md`), com o stack isolado
  `picturas-fiab` em `https://localhost:8443` e as falhas injetadas por shims montados só no
  ambiente de teste (`compose.fiab.yaml`). **Não há alterações ao código da aplicação** em
  nenhuma das versões. É uma medição independente da da Pessoa 1, que usa hooks no código
  (`RNF_FIAB_01_HOOKS`) e outro harness (`tests/rnf-fiab-01/`).
- **Momento da falha:** comprovado pelo trace do shim (`events-*.jsonl`); o ponto de falha foi
  atingido em todos os ensaios com falha armada das duas campanhas.
- **Correção:** SHA-256 das saídas face ao golden (congelado do primeiro R0 da baseline,
  `runs/golden.json`), número de `Result` por ficheiro, originais, `Process` não terminais,
  estado dos trabalhos e quota.
- **Protocolo:** 13 cenários × 10 repetições por versão, janela de 120 s após `POST /process` e
  verificação tardia de 30 s sempre que há falha armada ou o lote não termina. Utilizador e
  projeto novos por ensaio; filas purgadas entre ensaios.

| Campo | Baseline | Final |
| --- | --- | --- |
| Versão | `df5d0bc` (`main`, worktree limpa) | `56e7410` do ramo `rnf-fiab-01` (código = `cab1b35`, worktree limpa). O ramo foi integrado no `main` num único commit (`5d084ce`) e apagado; o histórico está na tag `rnf-fiab-01-verificacao` |
| Campanha | `runs/baseline-df5d0bc/` (15–17 nov 2026) | `runs/final-cab1b35/` (17 nov 2026, 22:49–00:20) |
| Máquina | Docker Desktop 29.8.2 sobre WSL2 (kernel 6.18.58.1), 16 CPUs, 15 GiB; Compose 5.5.1 | a mesma |
| Corpus, golden, protocolo | `runs/corpus/manifest.json`, `runs/golden.json`, `protocol.json` | os mesmos |
| Stack normal `picturas` | parado | parado |

Desvios e notas do processo:
- **Ensaios interrompidos.** O computador desligou-se duas vezes durante a baseline, a meio do
  R3-05 e do R3-07. Esses dois ensaios não chegaram a ter registo (`trial.json`), foram movidos
  para `runs/interrupted/` e repetidos depois de recriar o stack. Nenhum ensaio com registo foi
  repetido ou substituído.
- **Alterações ao `fiab.py` durante a baseline, só de análise:** passou a ler o estado dos
  `Process` (`state`), a excluir os estados terminais (`COMPLETED`, `FAILED`) dos pendentes e a
  calcular os campos de M12 (`failed_jobs`, `error_notifications`, `permanent_error_handled`).
  Não mudam o procedimento dos ensaios, e o `summarize` recalcula tudo a partir dos traces
  arquivados.
- **Shims adaptados à versão corrigida** (o `README.md` tem a tabela completa). O Luís passou o
  efeito e a publicação para outros fios (D1) e o avanço de etapa para `utils/runJobs.js` (D4).
  O shim Python passou a guardar o pedido em curso por processo em vez de por fio. O shim Node
  passou a envolver `mongoStore().transition` e `upsertResult`. **Equivalência do instrumento:**
  antes da campanha final, os shims novos correram sobre a base (`runs/equiv-shims-df5d0bc/`,
  R0, R1, R4, R5a, R6a e R7a, 2 repetições cada). Todas as falhas dispararam e o resultado
  certo/errado coincidiu com o da baseline em todos os cenários.
- **Correções de relógio do WSL.** O WSL ajusta o relógio do sistema durante a campanha (o
  `systemd-resolved` regista "Clock change detected"). Isso produziu 3 valores negativos: a
  duração do R5a-09 final (−0,39 s), a do R5a-02 do piloto de equivalência e um tempo de retoma
  do R4-05 da baseline. Os traces dos contentores mostram que esses lotes duraram o normal (cerca
  de 0,5 s). Estes valores foram excluídos das estatísticas de tempo, sem alterar nenhuma
  conclusão. Depois das campanhas, o `fiab.py` passou a medir a duração com `time.monotonic()`.
- Até 20 nov 2026 o campo `baseline_commit` de `protocol.json` dizia `0523102`, de quando o
  protocolo foi escrito, e o R5a estava descrito como "concurrent", embora as cópias sejam
  sequenciais. Só estes dois textos mudaram. A versão medida é a registada no `environment.json`
  de cada campanha.
- **Dados brutos.** A pasta `runs/` não está no Git. Todas as campanhas da Pessoa 2 (corpus,
  golden, baseline, final, piloto de equivalência, confirmação no `main`, ensaios interrompidos e
  invalidados, com traces e logs) estão em `arquivo-p2-fiab.tar.gz` (3,6 MB), SHA-256
  `bf799cce4e74f8e06e3ba7f7005caf5dc38497baabc28c4a924b3596c7f69460`, partilhado com a equipa
  fora do Git.

## 5. Medição inicial (baseline, `df5d0bc`)

| Cenário | Falha (alvo: 5.º trabalho de `rotate`) | Lotes corretos | Consolidados | Perdidos | Dup. | Reapl. |
| --- | --- | --- | --- | --- | --- | --- |
| R0 | nenhuma | 10/10 | 10/10 | 0 | 0 | 0 |
| R1 | worker morre ao receber (W1) | 0/10 | 0/10 | 10 | 0 | 0 |
| R2 | worker morre a meio da escrita (W2) | 0/10 | 0/10 | 27 | 0 | 0 |
| R3 | worker morre depois de escrever, antes de responder (W3) | 0/10 | 0/10 | 20 | 0 | 0 |
| R4 | worker morre 1 s depois de responder (W4) | 0/10 | 0/10 | 50 | 0 | 0 |
| R5a | resposta entregue duas vezes seguidas (P2) | 10/10 | 10/10 | 0 | 0 | 0 |
| R5b | segunda cópia 2 s depois (P2, cópia tardia) | 10/10 | 10/10 | 0 | 0 | 0 |
| R6a | `projects` morre ao avançar a etapa (P1, P4) | 0/10 | 0/10 | 30 | 0 | 0 |
| R6b | `projects` morre antes de gravar o resultado final (P1, P7) | 0/10 | 0/10 | 39 | 0 | 0 |
| R6c | `projects` morre antes de consolidar (P9) | 0/10 | 0/10 | 0 | 0 | 0 |
| R7a | tentativa antiga retida antes de responder; cancelar e reiniciar (K2) | 0/10 | 9/10 | 10 | 0 | **49** |
| R7b | tentativa antiga retida antes de escrever; cancelar e reiniciar (K3) | 0/10 | 10/10 | 0 | 0 | **39** |
| R8 | parâmetro inválido em `brightness` (W5) | — | 0/10 | 100 não terminais | 0 | 0 |

Observações dos logs e traces:
- **R1–R4:** o pedido interrompido nunca é reentregue (1 entrega por mensagem). Em R2–R4 o
  worker leva consigo também as mensagens em *prefetch*: perdem-se 1 (R1), 2–3 (R2), 2 (R3) e
  5 (R4) imagens por repetição, sempre o mesmo número dentro de cada cenário. O
  lote nunca consolida e os `Process` ficam pendentes para sempre (o "a processar" eterno).
- **R5:** as cópias sequenciais são ignoradas porque a primeira apaga o `Process`. É
  comportamento correto (P2), não defeito; a Pessoa 1 mostra o defeito P3 com cópias concorrentes.
- **R6c:** os 10 resultados ficam gravados, mas `committedToken` nunca avança.
- **R7:** a execução nova consolida, mas a escrita da tentativa antiga cai sobre os mesmos
  caminhos, e as saídas ficam com a rotação aplicada duas vezes (336×256 em vez de 256×336). No
  R7a, numa das 10 repetições o lote nem chegou a consolidar (10 imagens perdidas).
- **R8:** o `brightness` termina com `TypeError: must be real number, not str` dentro do
  tratamento de erro (W5), reinicia (2 arranques por ensaio) e perde as outras 9 mensagens. O
  erro nunca chega ao `projects` nem ao utilizador, e o lote fica pendente para sempre.

## 6. Decisão arquitetural e refactoring

Da Pessoa 1 (`especificacao-e-decisao.md` §5–§6, `implementacao.md`): foi escolhida a
**alternativa C**, que combina a reentrega pelo broker com estado persistido idempotente,
*outbox* e reconciliação. A reentrega pelo broker sozinha (A) não cobre P4–P6/P9, e a
recuperação só por *lease* (B) falharia M9.

| Decisão | O quê | Fragilidades |
| --- | --- | --- |
| D1 | Workers com ACK manual, `prefetch_count=1`, *publisher confirms* e mensagens persistentes; efeito num fio de trabalho e publicação/ACK no fio da ligação (`add_callback_threadsafe`); escrita atómica (`.tmp` + `os.replace`); respostas de erro corrigidas; limite de entregas | W1–W5, W7 |
| D2 | `projects` com uma ligação de confirmação reutilizada, ACK só depois do tratamento e `nack` em falha transitória | P1, P6, P12 |
| D3 | `messageId` determinístico; índices únicos e `upsertResult` por `run_key` | P3 |
| D4 | Transições condicionais de estado (`PENDING_DISPATCH → DISPATCHED → COMPLETED/FAILED`), *outbox* e reconciliador | P1, P4–P9 |
| D5 | Saídas por execução e etapa (`out/runs/<token>/<img>/<k>/<nome>`), entrada ≠ saída | W2, W3, K3 |
| D6 | Consolidação só com todos os trabalhos terminais; um lote só com falhas mantém o commit anterior | P8, P10, R8 |
| D7 | Respostas antigas descartadas; *undo* invalida a execução em curso | K1–K4 |
| D8 | Hooks de injeção da Pessoa 1, inertes por omissão | — |

Revisão do código pela Pessoa 2: a implementação em `cab1b35` corresponde às decisões. A única
consequência para a medição foi a adaptação dos shims descrita no §4.

## 7. Medição final e análise (`cab1b35`)

### Por cenário

| Cenário | Lotes corretos (base → final) | Perdidos | Dup. | Reapl. | Duração mediana final (s) | M10 mediana (máx.) (s) |
| --- | --- | --- | --- | --- | --- | --- |
| R0 | 10/10 → **10/10** | 0 → 0 | 0 → 0 | 0 → 0 | 0,53 | — |
| R1 | 0/10 → **10/10** | 10 → **0** | 0 → 0 | 0 → 0 | 1,06 | 0,82 (0,87) |
| R2 | 0/10 → **10/10** | 27 → **0** | 0 → 0 | 0 → 0 | 1,05 | 0,78 (0,80) |
| R3 | 0/10 → **10/10** | 20 → **0** | 0 → 0 | 0 → 0 | 1,05 | 0,79 (0,81) |
| R4 | 0/10 → **10/10** | 50 → **0** | 0 → 0 | 0 → 0 | 2,09 | 0,82 (0,83) |
| R5a | 10/10 → **10/10** | 0 → 0 | 0 → 0 | 0 → 0 | 0,52 | — |
| R5b | 10/10 → **10/10** | 0 → 0 | 0 → 0 | 0 → 0 | 2,61 | — |
| R6a | 0/10 → **10/10** | 30 → **0** | 0 → 0 | 0 → 0 | 1,61 | 1,42 (4,14) |
| R6b | 0/10 → **10/10** | 39 → **0** | 0 → 0 | 0 → 0 | 4,61 | 4,24 (4,31) |
| R6c | 0/10 → **10/10** | 0 → 0 (nunca consolidava) | 0 → 0 | 0 → 0 | 4,82 | 4,28 (4,30) |
| R7a | 0/10 → **10/10** | 10 → **0** | 0 → 0 | 49 → **0** | 1,07 | — |
| R7b | 0/10 → **10/10** | 0 → 0 | 0 → 0 | 39 → **0** | 1,11 | — |
| R8 | 0/10 → **10/10 controlados** | 100 pendentes → **100 `FAILED`** | 0 → 0 | 0 → 0 | — | — |

- **R1–R4:** o pedido interrompido é reentregue uma vez (2 entregas no máximo) e refeito a partir
  da entrada da etapa, sem reaplicação. A duração do R4 inclui o segundo de espera do shim antes
  da queda.
- **R6:** a resposta não confirmada é reentregue ao `projects` reiniciado (ou a etapa
  `PENDING_DISPATCH` é republicada pela *outbox*), e o lote consolida. Em R6b e R6c, M10 (≈ 4,2 s)
  inclui o arranque do processo Node, a ligação ao MongoDB e ao RabbitMQ e a reentrega; não foi
  decomposto mais.
- **R7:** a tentativa antiga escreve no diretório da sua execução e a resposta é descartada pelo
  token: a execução nova não é afetada.
- **R8:** os 10 pedidos são entregues uma vez cada, os 10 trabalhos acabam `FAILED`, o `projects`
  regista 10 `[JOB-FAILED] … notified=1` (um por trabalho), o worker não reinicia (1 arranque, 0
  *tracebacks*) e o lote não consolida, mantendo o commit anterior (D6).
- A anomalia que a Pessoa 1 descreve em `resultados-finais.md` §4 (uploads para o
  `img_storage` presos 10–31 s depois de reiniciar um contentor, sob podman rootless) **não se
  reproduziu** nesta máquina: a maior duração da campanha final foi 4,95 s.

### Face às metas

| Métrica | Meta | Baseline | Final | Cumpre |
| --- | --- | --- | --- | --- |
| M1 Recuperáveis concluídos corretamente | 100 % | 20/110 lotes (só R5) | **110/110 lotes (1100/1100 trabalhos)** | Sim |
| M2 Trabalhos perdidos | 0 | 186 (+ 10 lotes R6c nunca consolidados) | **0** | Sim |
| M3 Duplicados publicados | 0 | 0 (cópias sequenciais) | **0** | Sim |
| M4 Reaplicações indevidas | 0 | 0 | **0** | Sim |
| M5 Originais alterados | 0 | 0 | **0** | Sim |
| M6 Cobranças adicionais | 0 | 0 | **0** | Sim (ver limitações) |
| M7 Sobrescrita por tentativa antiga | 0 | 88 saídas em 20/20 ensaios R7 | **0** | Sim |
| M8 Consolidação prematura | 0 | 0 | **0** | Sim |
| M9 Tempo de retoma | ≤ 5 s | não há retoma | **mediana 0,018 s (máx. 0,02 s)** em R1–R4 | Sim |
| M10 Tempo até à conclusão | reportado | não há conclusão | 0,78–0,82 s (R1–R4); 1,4–4,3 s (R6), máx. 4,3 s | — |
| M11 Sobrecarga sem falhas | ≤ 5 % | 0,829 s (IQR 0,794–0,857) | **0,535 s (IQR 0,526–0,581): −35 %** | Sim |
| M12 Fim controlado de erro permanente | 100 % | 0/10 (worker termina, nada notificado) | **10/10** (1 entrega, `FAILED`, 1 notificação por trabalho) | Sim |

Da falha até ao arranque do processo reiniciado passaram cerca de 0,3 s nos workers e 0,4–0,5 s
no `projects` (reinício do contentor; não conta para M9). M9 começa no arranque do processo,
não no registo do consumidor, por isso inclui a ligação ao broker. A Pessoa 1 mediu também a
partir do registo do consumidor (§8 de `resultados-finais.md`): cerca de 1 ms.

### Comparação com a medição da Pessoa 1

As duas medições são independentes (hooks no código e podman, contra shims externos e Docker
Desktop/WSL2) e chegam à mesma conclusão. Correspondência de cenários:

| Pessoa 2 (este relatório) | Pessoa 1 (`resultados-finais.md`) | Janela |
| --- | --- | --- |
| R0 | R0 | — |
| R1 `after_receive` | R1 `after_receive` | W1 |
| R2 `during_write` | R2 `during_write` | W2 |
| R3 `after_write` | R3 `after_output_before_reply` | W3 |
| R4 `after_publish` (+1 s) | R4 `after_reply_before_ack` | W4 |
| R5a cópia imediata (sequencial) | — (as R5a/b dela são concorrentes, P3) | P2 |
| R5b cópia 2 s depois | R5c cópia depois da consolidação | P2 |
| R6a base: depois de apagar o `Process`; final: depois de persistir `PENDING_DISPATCH` | R6b `after_process_delete` / R6c `before_next_publish` | P4 / P5–P6 |
| R6b antes de gravar o resultado final | (próxima de R6d `after_result_persist`) | P7 |
| R6c `before_commit` | R6e `before_commit` | P9 |
| R7a retenção antes de responder + cancelar/reiniciar | R7 (resposta de execução cancelada) | K2 |
| R7b retenção antes de escrever + cancelar/reiniciar | R7 | K3 |
| R8 parâmetro inválido | R8b parâmetro inválido | W5 |
| — | R5a/R5b (P3), R6a, R6d, R8a (media inválida), M8 forçado (P8) | só na Pessoa 1 |

M11 difere em valor (−35 % aqui, −22 % na Pessoa 1) mas tem o mesmo sinal e a mesma causa
provável: a ligação reutilizada do `projects` (D2), em vez de uma por mensagem fechada aos 500 ms.

### Efeitos noutros RNF

- **Desempenho:** sem falhas, a versão corrigida é mais rápida (M11). Com falhas, o custo é a
  reexecução de uma etapa e o reinício do serviço (M10).
- **RNF-EFIC-01 (uploads):** a correção não altera o caminho de upload. A medição do RNF-EFIC-01
  deve ser repetida sobre a versão integrada (ver §8).

### Limitações

- **P3 e P8 não são cobertos** por esta campanha: as cópias do shim são sequenciais e não há
  injeção de corrida. Ficam cobertos pela campanha da Pessoa 1.
- **M6 não discrimina:** as ferramentas PIL do pipeline não gastam operações diárias (Δ = 0 também
  no R0). A Pessoa 1 verificou as cobranças na regressão com efeitos de vídeo.
- **M11:** o IQR da baseline (0,064 s, 7,7 % da mediana) excede os 5 % a partir dos quais a regra
  da Pessoa 1 manda passar a 20 repetições. Não se repetiu, porque a diferença (−0,29 s) é mais de
  quatro vezes o IQR. Lotes de ~0,5 s são muito sensíveis ao ambiente.
- O watermark (X1–X3), a falha do broker (W6), a IA e o vídeo não foram injetados.
- Imagens sintéticas pequenas: exercitam a cadeia de processamento, não conteúdo fotográfico.

## 8. Preservação funcional

- Testes do harness: `test_fiab.py` (11 testes, incluindo o worker com fios de trabalho) e
  `faultshim/node/fault-shim.test.js` (4 testes), todos a passar.
- R0 e R5 da campanha final mostram o processamento normal e as respostas duplicadas com saídas
  iguais ao golden da base. R7 mostra o cancelamento e o reinício corretos.
- A regressão funcional de imagem e vídeo, cancelamento, *undo* (K4), quotas e permissões é da
  Pessoa 1: `docs/rnf-fiab-01/regressao-e-limitacoes.md`.

### Confirmação sobre o `main` integrado (`35fdd36`)

O ramo foi integrado no `main` (`5d084ce`) junto com o *refactor* de uploads `c7e597a` da
Pessoa 3. Depois disso o `main` recebeu ainda as correções do consumidor da `project_queue`
(`a6c0f18`). Para confirmar de forma independente, R0, R1, R6a e R7b correram com 10
repetições cada sobre `35fdd36`, na mesma máquina e com o mesmo golden
(`runs/main-35fdd36/`, 20 nov 2026).

| Cenário | Falha atingida | Lotes corretos | Perdidos | Dup. | ≠ golden | Entregas máx. | Duração mediana (máx.) | M9 mediana (máx.) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R0 | — | 10/10 | 0 | 0 | 0 | 1 | 0,76 s (0,79) | — |
| R1 | 10/10 | 10/10 | 0 | 0 | 0 | 2 | 1,01 s (1,29) | 0,021 s (0,025) |
| R6a | 10/10 | 10/10 | 0 | 0 | 0 | — | 1,29 s (4,38) | — |
| R7b | 10/10 (retenção) | 10/10 | 0 | 0 | 0 | 1 | 1,04 s (1,16) | — |

Em todos os ensaios: 0 originais alterados, 0 `Process` pendentes e variação de operações 0.
**O comportamento medido em `cab1b35` mantém-se na versão integrada.**

- **Ensaios invalidados.** Na primeira tentativa, os contentores dos workers arrancaram com a
  pasta dos shims vazia: o Docker Desktop tinha acabado de iniciar e os *bind mounts* vieram
  vazios. Por isso o R1 correu sem falha, e o R0 sem traces dos workers. Esses 20 ensaios estão
  em `runs/invalid/main-35fdd36-no-worker-shims/` e não contam. Foram repetidos depois de
  recriar os contentores. Um ensaio R7b interrompido pelo fim da sessão de trabalho está em
  `runs/interrupted/`. O R6a da primeira tentativa é válido: a falha é no `projects`, cujo shim
  estava montado, e disparou em 10/10. Faltam-lhe apenas os traces dos workers, por isso não tem
  entregas máximas. Desde então, o `preflight` e o `run` verificam que os shims estão montados em
  todos os serviços instrumentados e param se não estiverem.
- **R0 mais lento do que na campanha final** (0,76 s contra 0,53 s), mas ainda 9 % abaixo da
  baseline (0,83 s). Não foi investigado. A versão integrada inclui também o *refactor* de
  uploads `c7e597a`, e 10 repetições de lotes de menos de 1 s são sensíveis ao estado da
  máquina. M11 continua a ser avaliado com a campanha final (§7).

### Revisão da verificação da Pessoa 1 (`6d19557`)

A Pessoa 1 correu este mesmo harness, sem alterações, sobre `6d19557` (90 ensaios, podman
rootless; `docs/rnf-fiab-01/resultados-finais.md` §8). Verificações da Pessoa 2:
- O arquivo `arquivo-integrado-6d19557.tar.gz` tem o SHA-256 indicado (`9680702932c1…b9276cb`).
- O harness usado tem o mesmo SHA-256 que o do `main` (`fiab.py` `fa6bd7a9…`). O golden e o
  manifesto do corpus são idênticos aos desta medição.
- Os resultados foram recalculados a partir dos `trial.json` do arquivo e coincidem com a tabela
  da §8 dela: 80/80 lotes recuperáveis corretos, 0 perdidos, 0 duplicados, 0 saídas diferentes do
  golden. No R8 há 100 trabalhos `FAILED` e 10 `[JOB-FAILED]` em cada um dos 10 logs.
- A medição dela é anterior a `a6c0f18`. A confirmação acima cobre essa correção.

## 9. Apoio de IA

- **Claude Code (Claude Opus 5.5)** apoiou:
  - a leitura da base e o diagnóstico inicial;
  - a escrita da ferramenta de injeção de falhas (`fiab.py`, shims, override) e dos seus testes;
  - a revisão do código da Pessoa 1 e a adaptação dos shims a esse código;
  - a condução das campanhas e a análise dos resultados;
  - a redação desta secção.
- **Validação pela equipa:**
  - a Pessoa 1 reviu o diagnóstico (`docs/rnf-fiab-01/diagnostico.md` §8) e confirmou a numeração W/X/P/K e
    M1–M12;
  - os resultados foram confrontados com a campanha independente da Pessoa 1;
  - a Pessoa 1 reviu este relatório e o harness, e pediu as correções feitas a 20 nov 2026:
    definição de M9, descrição do R5a e `baseline_commit` em `protocol.json`, referências ao
    ramo integrado e arquivo dos dados brutos;
  - a Pessoa 1 verificou a versão integrada com este harness, e a Pessoa 2 reviu essa
    verificação (§8).
