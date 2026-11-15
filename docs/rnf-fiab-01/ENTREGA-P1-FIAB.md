# Entrega P1 → P2 — RNF-FIAB-01

Respostas ao pedido da Pessoa 2. O detalhe completo está em `docs/rnf-fiab-01/` no ramo
`rnf-fiab-01`; aqui ficam as respostas diretas e as ligações.

> **Nota importante.** Não encontrei `benchmarks/fault-tolerance/` (nem `fiab.py`, `faultshim/`
> ou `RELATORIO-RNF-FIAB-01.md`) neste repositório nem em `origin/main` (verificado depois de
> `git fetch`, 2026-11-15). Por isso **não consegui rever o teu D1–D8**. Deixo abaixo o meu
> diagnóstico com as janelas numeradas, para cruzares com o teu. Se fizeres push dos teus
> ficheiros, faço a revisão linha a linha.
>
> Atenção também à numeração: no meu trabalho, **D1–D8 são as decisões de desenho** (§6 de
> `especificacao-e-decisao.md`). O diagnóstico usa W1–W7 (workers), X1–X3 (watermark),
> P1–P12 (`projects`) e K1–K5 (cancelamento/undo). Na tabela do diagnóstico abaixo uso os meus
> identificadores.

## Estado

- **Alterei código antes da tua baseline?** Não no `main`: está intacto em `df5d0bc`. Tudo foi
  feito no ramo local `rnf-fiab-01` (10 commits, **sem push**), por esta ordem:
  1. Fases 0–2 (`0df5368`…`674709b`): só hooks de injeção, inertes por omissão, e a minha
     própria baseline. Não alteram o comportamento.
  2. Fase 3 (`75010f4`…`221ae5d`): a correção.
  3. Fase 4 (`188520a`…`cab1b35`): validação.

  A minha baseline correu sobre `df5d0bc` + hooks inertes (`674709b`), não sobre `0523102`.
  Entre os dois commits não há alterações ao processamento de imagens (workers, `process_msg`,
  RabbitMQ). Há só alterações ao caminho de **upload** (`b8c8ba4`: `imageStorageService`,
  `projects/utils/{mediaUpload,temporaryUpload}.js`). Ver as Limitações, sobre uploads presos
  no `img_storage`.
- **Ramo/commit da versão final:** `rnf-fiab-01` @ `cab1b35`. A versão medida na Fase 4 é este
  código, mas a campanha regista `674709b` + lista de ficheiros alterados, porque correu antes do
  commit.

## Diagnóstico

O teu D1–D8 não está disponível (ver nota). O meu diagnóstico completo, com ficheiro e linha,
está em `docs/rnf-fiab-01/diagnostico.md`. Resumo das janelas e de como as fechei:

| Janela | Problema na versão original | Onde | Fechada por |
| --- | --- | --- | --- |
| W1 | Workers com `auto_ack=True`: o pedido é removido antes de ser processado; se o worker morre, perde-se | `Tools/utils/rabbit_mq.py` | ACK manual depois da resposta confirmada |
| W1′ | Mensagens em *prefetch* (também já confirmadas) morrem com o worker: perdas colaterais | idem | `prefetch_count=1` |
| W2/W3 | Escrita *in-place* (`out/<nome>` é entrada e saída nos passos ≥ 1): uma repetição reaplica o efeito, e uma escrita parcial fica com o nome final | `projects/routes/projects.js`, `img_handler.py` | Saídas por execução/passo + escrita atómica |
| W4/W6 | Respostas não persistentes e sem *publisher confirms* | `rabbit_mq.py` | `delivery_mode=2` + `confirm_delivery` |
| W5 | Resposta de erro: chamada posicional rebenta (`raise`), e `messageId`/`correlationId` vêm trocados. O erro nunca chega ao utilizador | `Tools/utils/tool_msg.py` + todas as ferramentas | `send_msg` aceita a forma posicional; `correlationId` = pedido |
| W7 | Efeito no fio da ligação bloqueia *heartbeats* | `rabbit_mq.py` | Fio de trabalho + `add_callback_threadsafe` |
| R8b | Exceção fora do `try` da ferramenta mata o worker | `brightness.py` (e outras) | Resposta de erro genérica em `tool_msg.py` |
| P1 | `projects` confirma a resposta antes do *callback* assíncrono terminar | `projects/utils/rabbit_mq.js` | ACK depois do tratamento |
| P3–P6 | `Process` apagado antes de persistir; sucessor publicado sem confirmação | `process_msg` | Documento de trabalho com estado + *outbox* |
| P8 | Consolidação prematura (contagem de `Process` restantes) | `process_msg` | Consolidação só com todos os trabalhos terminais |
| P9 | Resultados todos gravados, mas a consolidação nunca acontece se o `projects` morre antes | `process_msg` | Reconciliação no arranque e a cada 10 s |
| P10 | `Result` sem índice único: respostas repetidas publicam duplicados | `models/result.js` | `run_key` único + *upsert* |
| K3 | Tentativa de uma execução cancelada escreve no mesmo ficheiro da execução nova | idem W2 | Saídas por execução |
| K4 | *Undo* não invalida a execução em curso | `DELETE …/tool/:tool` | `activeToken` incrementado e resultados apagados, como no cancelamento |

## Âmbito

- **Workers incluídos:** todos os que usam `Tools/utils`: as 8 ferramentas PIL e as 7 de IA
  recebem a correção sem alterações individuais.
  - Medidos com o protocolo completo: `border`, `brightness`, `rotate`.
  - Verificados na regressão: `contrast`, `saturation`, `resize`, `binarization`, `cut`.
  - **IA não testada**: modelos pesados; o código partilhado é o mesmo.
- **Workers excluídos e porquê:**
  - `watermark`: imagem externa pré-construída, que não se pode alterar. Fica sem
    *confirms*/limite de entregas no worker, mas o lado do `projects` protege-o (saídas por
    passo, respostas idempotentes).
  - `video_tool`: fora do âmbito (já confirma no fim); só regressão.
- **Falha do broker incluída?** **Não como cenário medido.** A perda de dados persistidos pelo
  RabbitMQ está excluída. Ainda assim, a implementação cobre o reinício do broker:
  - mensagens persistentes e *confirms*;
  - workers e `projects` voltam a ligar-se;
  - foi corrigido um worker que terminava com erro de DNS quando o broker era recriado;
  - o reinício foi observado acidentalmente nos pilotos.
- **`projects` (R6) incluído?** **Sim.** Cinco pontos de falha (R6a–e), 10 repetições cada.

## Especificação

(Formal em `especificacao-e-decisao.md` §1–§3.)

- **Trabalho recuperável =** a aplicação do pipeline de imagem a uma imagem de uma execução de
  processamento, cuja falha é transitória: o worker ou o `projects` morrem ou reiniciam, ou o
  broker recusa/não confirma uma publicação. Exclui erros permanentes de entrada ou efeito
  (ficheiro que não é imagem, parâmetros inválidos).
- **Identidade do trabalho =** `(projeto, token da execução, img_id)`. Cada passo `k` tem o pedido
  determinístico `request-<projeto>-<token>-<img_id>-<k>`. Índices únicos:
  `processes(project_id, token, img_id)`, `processes.msg_id` (só documentos com `state`) e
  `results.run_key = <projeto>:<token>:<img_id>:<file_name>`.
- **Exclusões =**
  - perda do disco do RabbitMQ ou do MongoDB, e partições longas;
  - falhas permanentes do `img_storage`/SeaweedFS;
  - alteração do watermark externo;
  - vídeo e *previews* (só regressão);
  - perda de notificações da `ws_queue`.
- **Erro permanente:**
  - **N.º máximo de tentativas** = 3 entregas por passo no worker (`RNF_FIAB_01_MAX_DELIVERIES`).
    À 4.ª entrega, a resposta é o erro `attempts_exhausted`, sem executar o efeito. Erros de
    entrada ou efeito não têm nova tentativa.
  - **No `projects`:** 5 falhas a tratar a mesma resposta levam ao erro `handling_failed`.
  - **Como fica visível ao utilizador:**
    - **uma** mensagem de erro na `ws_queue` por media falhada (`status: "error"`, `errorCode`,
      `errorMsg` com o código e a mensagem do worker);
    - `processes.state = "FAILED"` e `processes.error = {code, message, step}`;
    - log `[JOB-FAILED] … notified=1`.
  - **Lote:** consolida com as media concluídas (decisão D6). Se todas falharem, não consolida
    e mantém a consolidação anterior.

## Métricas acordadas

Definidas na Fase 1 (`especificacao-e-decisao.md` §4), mantidas depois da baseline, com os
ajustes de medição justificados em `resultados-baseline.md` §4.

| Métrica | Alvo | Mínimo | Justificação | Resultado final |
|---|---|---|---|---|
| M1 Recuperáveis concluídos corretamente (hash de píxeis = referência, execução consolidada) | 100 % | 100 % | Enunciado do requisito | 900/900 trabalhos, 90/90 lotes |
| M2 Trabalhos perdidos | 0 | 0 | idem; conta também perdas colaterais (*prefetch*) | 0 |
| M3 Resultados duplicados publicados | 0 | 0 | idem | 0 |
| M4 Reaplicações (hash ≠ referência) | 0 | 0 | Repetir um passo não pode reaplicar o efeito | 0 |
| M5 Originais alterados | 0 | 0 | Integridade das fontes | 0 |
| M6 Cobranças adicionais | 0 | 0 | A recuperação nunca reinvoca a quota | 0 (verificado também com efeitos de vídeo cobrados) |
| M7 Sobrescrita por tentativa antiga | 0 | 0 | Cancelamento/nova execução (R7) | 0 |
| M8 Consolidação prematura | 0 | 0 | Só com todos os trabalhos terminais; falhados (D6) descontados | 0 |
| M9 Tempo de retoma (de `READY` à nova receção da mensagem interrompida) | ≤ 5 s | ≤ 15 s | Reentrega imediata pelo broker; exclui o arranque do contentor | máx. 3 ms |
| M10 Tempo até à conclusão | reportado | reportado | Inclui o arranque do contentor | mediana 0,8–1,2 s; máx. 31 s (anomalia do `img_storage`) |
| M11 Sobrecarga sem falhas (mediana R0) | ≤ 5 % | ≤ 10 % | 5 % ≈ 34 ms, da ordem da variação → A/B na mesma sessão, 30 repetições por versão | −22 % (0,451 → 0,352 s) |
| M12 Fim controlado de erro permanente | 100 % | 100 % | Sem ciclo, ≤ 3 entregas, uma notificação por trabalho | 20/20 |

`T_obs = max(10 × mediana R0, 120 s)`. Corpus: 10 PNG determinísticos (seed 20261114) e um
ficheiro não-imagem. Pipeline: border → brightness → rotate. 10 repetições por variante (R5a/b/c,
R6a–e, R8a/b), 160 execuções.

## Decisão arquitetural

(Texto completo em `especificacao-e-decisao.md` §5–§7.)

- **Alternativas consideradas:**
  - **A — reentrega pelo broker:** ACK manual depois da resposta confirmada; ACK no `projects`
    depois do tratamento; mensagens persistentes. Não cobre o estado entre persistir e publicar
    (P4–P6, P9) nem duplicados.
  - **B — recuperação por estado persistido com *lease*:** um varrimento republica etapas
    expiradas. O tempo de retoma fica limitado pelo *lease*, que tem de ser maior do que o pior
    efeito de IA (falha M9), e precisa de *fencing*.
  - **C — A + estado persistido idempotente** com *outbox* e reconciliação.
- **Decisão:** **C**. É a única que fecha todas as janelas do âmbito sem sacrificar o tempo de
  retoma. As filas *classic* e as definições existentes mantêm-se (sem recriar filas), e o
  formato JSON das mensagens não muda.
- **Consequências:**
  - **Positivas:** todos os critérios cumpridos. Sem falhas fica **mais rápido** (−22 %), porque
    o `projects` deixou de abrir uma ligação AMQP por mensagem. Os erros permanentes passam a
    chegar ao utilizador. O *undo* passa a ser seguro com uma execução em curso.
  - **Negativas:** mais código no orquestrador (`runJobs.js`). Assume uma única réplica do
    `projects`. Ficam dois modelos de `Process` (trabalhos com estado para imagens; o antigo para
    vídeo, *previews* e extração de frames). O watermark continua sem limite de entregas.
  - **Outros RNF:** nenhuma alteração a quotas/subscrições ou ao HTTP. As saídas por
    execução/passo ocupam mais disco local até à execução seguinte, que limpa as anteriores.
    Os registos de tentativas ocupam 1 byte por entrega.

## Implementação

- **Ficheiros alterados** (código, `git diff --stat main..rnf-fiab-01`):
  - **Workers:** `Tools/utils/{rabbit_mq,tool_msg,img_handler}.py` e `fault_hooks.py` (novo,
    hooks de teste inertes). Nenhuma ferramenta individual mudou.
  - **`projects`:**
    - `utils/runJobs.js` (novo);
    - `utils/{rabbit_mq,project_msg,processBatch}.js`;
    - `utils/faultHooks.js` (novo, hooks de teste inertes);
    - `models/{process,result}.js`;
    - `controllers/{process,project}.js`;
    - `routes/projects.js`.
  - **Testes:**
    - `projects/tests/{run-jobs,fault-hooks}.test.js` (novos) e `process-batch.test.js`;
    - `tests/rnf-fiab-01/` (harness, corpus, regressão, testes Python).
  - **Documentação:** `AGENTS.md` (secção *Known pitfalls*).
- **Contratos alterados:**
  - **Mensagens:** formato JSON igual em todas as filas.
    - Pedidos de imagem: `messageId` determinístico; `inputImageURI`/`outputImageURI` passam
      a `…/out/runs/<token>/<img_id>/<k>/<nome>`, com a entrada do passo `k` igual à saída do
      passo `k-1`.
    - Respostas de erro: `correlationId` = pedido e `messageId` = resposta (antes vinham
      trocados).
    - Todas as mensagens passam a ser persistentes.
  - **`rabbitMQ/definitions.json`:** **sem alterações** (sem DLQ nem TTL).
  - **Modelo `Process`:** campos opcionais `state` (`PENDING_DISPATCH` | `DISPATCHED` |
    `COMPLETED` | `FAILED`), `pipeline`, `out_uri`, `dispatch_at`, `handle_failures` e `error`,
    mais índices únicos parciais. Documentos sem `state` são o modelo antigo.
  - **Modelo `Result`:** campo opcional `run_key` com índice único parcial.
- **Variáveis de ambiente novas e valores:**
  - **Workers:**
    - `RNF_FIAB_01_MAX_DELIVERIES=3`;
    - `RNF_FIAB_01_ATTEMPTS_DIR=/app/images/.attempts`;
    - só no stack de ensaio: `RNF_FIAB_01_HOOKS=1`, `RNF_FIAB_01_SERVICE`, `RNF_FIAB_01_DIR`.
  - **`projects`:** constantes no código, não variáveis de ambiente:
    - `MAX_HANDLE_FAILURES=5`;
    - `REDISPATCH_AFTER_MS=5000`;
    - `RECONCILE_INTERVAL_MS=10000`;
    - `CONSUMER_PREFETCH=20`;
    - `NACK_DELAY_MS=1000`;
    - `SLOW_STEP_MS=1000`.

    Hooks de teste: `RNF_FIAB_01_HOOKS`, `RNF_FIAB_01_SERVICE` e `RNF_FIAB_01_DIR`.
  - **`docker-compose.yaml`:** sem alterações (os valores por omissão aplicam-se).
- **Pontos de injeção que mudaram** (os teus shims):

  | Ponto antigo | Agora | Nota para o shim |
  | --- | --- | --- |
  | `pika` `basic_consume` | Ainda usado (`rabbit_mq.py:131`), com `auto_ack=False`. O `on_message_callback` é um *wrapper* que lança a ferramenta num **fio separado** | Um shim que mate o processo dentro do *callback* da ferramenta corre noutro fio: usa `os._exit`/`SIGKILL`, não exceções |
  | `pika` `basic_publish` | Ainda usado (`rabbit_mq.py:61`), executado no fio da ligação via `add_callback_threadsafe`, com `properties` (`delivery_mode=2`) e `mandatory=True`. Com *confirms*, falha com `NackError`/`UnroutableError` | Matar entre a publicação e o ACK: o ACK é agora `basic_ack` (`rabbit_mq.py:99`), depois de o fio da ferramenta terminar; `basic_nack(requeue=True)` em `:101` |
  | `PIL.Image.Image.save` | `Img_Handler.store_img` (`Tools/utils/img_handler.py`) grava num **temporário** `<pasta>/.<nome>.<pid>.<hex>.tmp<ext>` (mesma pasta, mesma extensão, `format=` explícito) e faz `os.replace(tmp, final)` | "Durante a escrita" → `save` com caminho `*.tmp<ext>`. "Depois da saída e antes da resposta" → depois de `os.replace`. O nome final nunca existe parcial |
  | `controllers/process.js` `create` | **Só na criação** dos trabalhos (`POST /process`, via `dispatchProcessBatch`, `routes/projects.js:1648`) e no caminho antigo (vídeo/*preview*). O avanço de passo **já não cria** documentos: é `Process.findOneAndUpdate` em `mongoStore.transition` (`utils/runJobs.js:281`) | Para "falha ao persistir estado", usa a transição (ou o hook `after_process_delete`) |
  | `controllers/result.js` `create` | Para imagens: **`mongoStore.upsertResult`** (`runJobs.js:307`, `Result.findOneAndUpdate` com *upsert* em `run_key`). `Result.create` só no caminho antigo (vídeo, frames: `routes/projects.js:439,476`) | — |
  | `controllers/project.js` `commitRunIfActive` | Igual (assinatura mantida), chamado por `runJobs.tryCommit`. O filtro inclui agora `committedToken: {$ne: token}`, por isso só um chamador consolida | — |

  Alternativa aos shims: o código tem pontos de falha nomeados, desligados por omissão, ativos
  com `RNF_FIAB_01_HOOKS=1`. Nos workers: `after_receive`, `before_write`, `during_write`,
  `after_output_before_reply`, `after_reply_before_ack`. No `projects`: `after_receive`,
  `after_process_delete`, `after_result_persist`, `before_commit`, `before_next_publish`. Cada
  ponto escreve no log `RNF-FIAB-01 FAULT-POINT` e espera numa barreira
  (`protocolo-baseline.md` §4).
- **Como consultar o estado novo:**
  - **MongoDB:** base `project`, coleção `processes`, documentos com `state`.
    - `state = "FAILED"` → falhado; `error` → código e mensagem; `handle_failures` → falhas a
      tratar respostas.
    - `state = "PENDING_DISPATCH"` → passo gravado mas ainda não confirmado pelo broker (vai ser
      republicado).
    - `cur_pos`/`msg_id` → passo atual.
  - **Tentativas de um pedido:** tamanho em bytes de `image_data/.attempts/<sha256(messageId)>`.
  - **Execução:** `projects.activeToken` e `projects.committedToken`.
  - **Resultados:** `results` com `token` e `run_key`.
  - **Logs do `projects`:** `[JOB-FAILED]`, `[JOB-DUPLICATE]`, `[RECONCILE]`, `[JOB-SLOW]`,
    `[COMMIT]`.
  - **Notificação ao utilizador:** mensagens com `status: "error"` na `ws_queue`. Não há
    endpoint HTTP novo.

## Testes

- **Testes unitários novos:**
  - **`projects/tests/run-jobs.test.js`** (15 testes, *store* em memória): R0, cópias
    concorrentes R5a/R5b, sucessor não publicado R6b/c, repetição depois do resultado R6d,
    consolidação interrompida R6e, R7/K3, K4, D6 (R8a/R8b), falhas repetidas no tratamento,
    saídas de texto e *snapshot* do pipeline.
  - **`projects/tests/fault-hooks.test.js`** (3).
  - **`tests/rnf-fiab-01/test_worker_messaging.py`** (12):
    - ACK manual, *prefetch* 1 e *confirms*;
    - resposta persistente; erro posicional; `correlationId`;
    - ACK só depois da confirmação; `nack` quando a publicação falha;
    - exceção inesperada; limite de entregas; fio separado;
    - escrita atómica; `during_write`; nova tentativa com erro de DNS.
  - **`tests/rnf-fiab-01/test_fault_hooks.py`** (5).
- **Comandos:**
  ```bash
  cd tests/rnf-fiab-01 && .venv/bin/python -m pytest -q
  cd projects && node --test tests/run-jobs.test.js tests/process-batch.test.js tests/fault-hooks.test.js
  # suite completa do projects (precisa das dependências do contentor):
  podman exec picturas-fiab-projects-1 sh -c 'node --test tests/*.test.js'
  # campanha, regressão e M11 (stack isolado picturas-fiab):
  cd tests/rnf-fiab-01 && .venv/bin/python harness.py run --phase final --scenario all --reps 10
  .venv/bin/python regression.py
  ./m11_ab.sh
  ```
- **Resultado:**
  - Python 17/17; `projects` 36/36; regressão 7/7.
  - Campanha final 160/160 execuções sem erros do harness, todos os critérios cumpridos
    (`resultados-finais.md`).

## Limitações

- Uma única réplica do `projects` (como hoje).
- Vídeo, *previews* e extração de frames ficam no modelo antigo de `Process`. Têm ACK depois do
  tratamento e consolidação única, mas não têm *outbox*.
- Watermark externo sem *confirms* nem limite de entregas.
- `obj_ai`/`people_ai` geram nomes de ficheiro de texto com contador: uma repetição dá um segundo
  resultado de texto.
- Objetos órfãos no armazenamento se o `projects` morrer entre o upload e o `Result` (não
  publicados).
- Sem limpeza automática do registo de tentativas.
- Falha do broker e IA não medidas.
- **Anomalia fora do código alterado: uploads `projects` → `img_storage` presos 10–45 s** em
  algumas repetições com reinício de contentores (6/90 na campanha). O lote termina sempre
  correto e M9 não é afetado, mas M10 sim.
  - Pode estar ligada ao caminho de upload introduzido em `b8c8ba4`, que não existe no teu
    `0523102`.
  - Se a tua baseline correr em `0523102` e a versão final em `rnf-fiab-01`, os tempos de upload
    não são comparáveis.
- Medido numa só máquina (podman rootless), com o stack `picturas` parado.
