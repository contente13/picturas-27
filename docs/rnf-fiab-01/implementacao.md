# RNF-FIAB-01 — Implementação (Fase 3)

Implementação da decisão C ([especificacao-e-decisao.md](especificacao-e-decisao.md) §5–§6),
por incrementos, sobre o ramo `rnf-fiab-01` (base `674709b`). Cada incremento indica as
janelas do [diagnóstico](diagnostico.md) que fecha, os ficheiros alterados e os testes que o
verificam. A validação com o protocolo completo é a Fase 4.

## Resumo

| Incremento | Decisões | Janelas | Ficheiros principais |
| --- | --- | --- | --- |
| 1. Workers: ACK só após resposta confirmada | D1 | W1–W5, W7, R8 | `Tools/utils/rabbit_mq.py`, `tool_msg.py`, `img_handler.py`, `fault_hooks.py` |
| 2. Saídas estáveis por execução e passo | D5 | W2, W3, X1, X2, K3 | `projects/utils/runJobs.js`, `projects/routes/projects.js` (`POST /process`) |
| 3. Mensageria do `projects` | D2 | P1, P6, P12 | `projects/utils/rabbit_mq.js`, `projects/utils/project_msg.js` |
| 4. Estado idempotente, *outbox*, reconciliação | D3, D4 | P3–P9, R5 | `projects/utils/runJobs.js`, `projects/models/{process,result}.js` |
| 5. Consolidação única e falhas permanentes | D6 | P8, P10, R8 | `runJobs.tryCommit`, `projects/controllers/project.js` |
| 6. Cancelamento, *undo* e respostas antigas | D7 | K1–K4, R7 | `runJobs.handleReply`, `projects/routes/projects.js` (`DELETE …/tool/:tool`) |

## 1. Workers (`Tools/utils`, D1)

Todas as ferramentas de imagem partilham `Tools/utils`; nenhuma ferramenta individual foi
alterada.

- **ACK manual e *prefetch* 1** (`rabbit_mq.py`). `auto_ack=False`, `basic_qos(prefetch_count=1)`.
  O pedido é confirmado com `basic_ack` **depois** de o *handler* terminar e de a resposta ter
  sido confirmada pelo broker. Se o worker morrer antes, o broker reentrega o pedido quando o
  worker volta a ligar-se. Com *prefetch* 1, um worker que morre já não leva consigo mensagens em
  *buffer* (as perdas colaterais de R1–R4 e R8a na baseline).
- **Resposta persistente e confirmada.** Canal em `confirm_delivery()`, `delivery_mode=2`,
  `mandatory=True`. `send_rabbit_msg` só regressa depois da confirmação; uma recusa levanta
  `PublishError`, o pedido recebe `basic_nack(requeue=True)` e é reentregue.
- **Heartbeat durante o efeito (W7).** O *handler* corre num fio próprio; publicações e ACK
  correm no fio da ligação (`add_callback_threadsafe`). A ligação continua a responder a
  *heartbeats* durante efeitos longos (IA).
- **Limite de entregas** (`tool_msg.py`). Cada entrega de um `messageId` é registada no volume
  partilhado (`/app/images/.attempts/<sha256(messageId)>`, um byte por entrega com `O_APPEND`)
  logo depois da receção e antes do efeito. À 4.ª entrega (`RNF_FIAB_01_MAX_DELIVERIES=3`) o
  pedido é respondido com o erro permanente `attempts_exhausted` sem executar o efeito, e é
  confirmado. Uma entrada que mata o worker deixa de causar reentregas infinitas.
- **Um pedido tem sempre uma resposta.** Uma exceção fora do `try` da ferramenta (R8b: o
  parâmetro inválido rebentava o processo) passa a dar uma resposta de erro `unexpected_error`
  e o worker continua.
- **Respostas de erro corrigidas (W5).** A chamada posicional usada por todas as ferramentas
  (`…, None, código, mensagem, uri`) caía nos argumentos errados e levantava exceção. `send_msg`
  aceita agora essa forma. A resposta de erro passa a ter `correlationId` = pedido e
  `messageId` = resposta, como as respostas de sucesso (e como o vídeo e o watermark já faziam).
- **Escrita atómica** (`img_handler.py`). A imagem é gravada num ficheiro temporário único na
  mesma pasta, com a mesma extensão (o formato não muda), e renomeada com `os.replace`. Nunca
  existe um ficheiro parcial com o nome final. Cria a pasta de saída, se faltar. Não há `fsync`:
  a atomicidade protege contra a morte do processo; a queda da máquina está excluída (§8 da
  especificação).
- **Ligação ao broker.** `read_rabbit_msg` volta a ligar-se depois de perder a ligação (os
  pedidos não confirmados são reentregues pelo broker), e a ligação inicial é repetida também
  quando o nome do broker ainda não resolve (contentor a ser recriado). Antes desta correção, um
  worker terminava com `socket.gaierror` quando o RabbitMQ era recriado (observado na §10).

## 2. Saídas estáveis (D5)

- O passo `k` da imagem `i` na execução `t` escreve em
  `out/runs/<t>/<img_id>/<k>/<nome>` e o passo `k+1` lê essa saída. Entrada e saída nunca
  coincidem: repetir um passo reescreve o mesmo ficheiro com o mesmo conteúdo, em vez de aplicar
  o efeito duas vezes sobre o seu próprio resultado.
- Uma tentativa de uma execução antiga só escreve na pasta da sua execução.
- `POST /process` deixa de apagar a pasta `out/` inteira: remove as saídas antigas de primeiro
  nível e as pastas `runs/<t>` de outras execuções (os resultados já estão no armazenamento de
  objetos), e cria as pastas de saída antes de publicar.
- O nome do ficheiro do resultado (`file_name`) não muda.

## 3. Mensageria do `projects` (D2)

- `utils/rabbit_mq.js` passa à API de promessas do `amqplib`: uma ligação de publicação de
  longa duração com `createConfirmChannel`, mensagens `persistent`, e `publish()` que resolve
  na confirmação do broker. Antes abria e fechava uma ligação por mensagem (500 ms depois) sem
  confirmação.
- `send_msg_tool` devolve a promessa da publicação confirmada. As notificações para a `ws_queue`
  continuam *fire-and-forget* (falhas registadas no log), como antes.
- O consumidor da `project_queue` usa `prefetch(20)` e confirma a mensagem **depois** de o
  *callback* terminar; se o *callback* rejeitar (falha transitória), faz `nack(requeue)` 1 s
  depois. Antes confirmava logo após invocar o *callback* assíncrono (P1).
- Ambos voltam a ligar-se após um reinício do broker. No consumidor, cada tentativa de arranque
  encaminha todas as falhas para uma única função (`restartOnce`), que fecha a ligação e agenda
  **uma** nova tentativa 2 s depois:
  - fecho da ligação (reinício do broker);
  - fecho só do canal (erro de canal, p. ex. `406 PRECONDITION_FAILED`);
  - rejeição de uma chamada de configuração (`connect`, `createChannel`, `assertQueue`, …);
  - cancelamento do consumidor pelo broker (o `amqplib` entrega `msg == null`, p. ex. quando a
    fila é apagada), em que a ligação e o canal continuam abertos.
- O consumidor declara a fila e faz `bindQueue(project_queue, picturas, project_queue)`,
  idempotente, como o `video_tool`. Se a fila tiver sido apagada, volta a existir com o
  *binding* de `rabbitMQ/definitions.json`.
- Correções feitas depois da revisão da Pessoa 2 (ver
  [resultados-finais.md](resultados-finais.md) §9): antes, uma falha na configuração era
  tratada por dois caminhos (fecho do canal → fecho da ligação → reinício, e `catch` →
  reinício), e os consumidores duplicavam a cada falha; um cancelamento pelo broker era
  ignorado e o `projects` ficava sem consumidor até a ligação cair.

## 4. Estado idempotente, *outbox* e reconciliação (D3, D4)

Novo módulo `projects/utils/runJobs.js`, sem dependências de base de dados ou broker
(injetadas), testado em `projects/tests/run-jobs.test.js`.

- **Um trabalho = um documento.** Cada imagem de uma execução tem um único documento `Process`
  com `state` (`PENDING_DISPATCH` → `DISPATCHED` → `COMPLETED` | `FAILED`), o passo atual, um
  *snapshot* do pipeline de imagem e `out_uri`. O documento já não é apagado antes de o
  resultado estar persistido.
- **Identidade determinística.** O pedido do passo `k` é
  `request-<project>-<token>-<img_id>-<k>`. Índices únicos parciais (só documentos com `state`):
  `(project_id, token, img_id)` e `msg_id`.
- **Transições por comparar-e-trocar.** Cada transição filtra por
  `(_id, msg_id = correlationId, state ∈ {PENDING_DISPATCH, DISPATCHED})`. De várias cópias da
  mesma resposta, só uma avança o trabalho; as outras são reconhecidas como duplicadas e
  confirmadas sem efeito.
- ***Outbox*.** O passo seguinte é gravado como `PENDING_DISPATCH` na mesma escrita que avança o
  trabalho, publicado com confirmação e marcado `DISPATCHED`. Se o `projects` morrer entre a
  escrita e a confirmação, o passo fica `PENDING_DISPATCH`.
- **Resultado único.** O resultado final é criado por *upsert* numa chave
  `run_key = <project>:<token>:<img_id>:<etapa>` com índice único parcial (a etapa, e não o nome do
  ficheiro, porque as ferramentas de texto acrescentam um contador ao nome). Uma cópia que
  chega depois encontra o resultado existente e apaga o objeto que acabou de carregar.
- **Reconciliação** no arranque (quando o MongoDB está acessível) e a cada 10 s: republica
  passos `PENDING_DISPATCH` de execuções ativas (no arranque todos; depois, os que têm mais de
  5 s) e consolida execuções cujos trabalhos estão todos terminados mas que não foram
  consolidadas (P9).
- **Falhas ao tratar uma resposta** (ex.: armazenamento indisponível): a mensagem é reposta na
  fila; à 5.ª falha o trabalho passa a `FAILED` (`handling_failed`) e é reportado.
- **Observabilidade** (acrescentada na Fase 4): `[JOB-SLOW]` quando um upload, a criação do
  resultado, a leitura do projeto, a contagem de pendentes ou a consolidação demoram ≥ 1 s.
- **Âmbito.** Este modelo aplica-se às imagens das execuções normais. *Previews*, vídeos e
  execuções com `extract_frames` continuam com os documentos antigos (um por passo, apagados no
  fim), mas beneficiam do ACK depois do tratamento e da consolidação única (exclusões da
  especificação §8). A contagem de pendentes considera os dois tipos de documento, por isso
  projetos mistos consolidam só quando imagens e vídeos terminaram. *Previews* deixam de
  contar como pendentes de uma execução (antes, um *preview* em curso com o mesmo token podia
  impedir a consolidação).

## 5. Consolidação única e falhas permanentes (D6)

- A execução é consolidada quando nenhum documento da execução está pendente **e** a execução
  ainda é a ativa. `commitRunIfActive` passa a filtrar também `committedToken ≠ token`: de
  várias tentativas concorrentes, só uma obtém o documento e é essa que notifica.
- Um trabalho com erro permanente passa a `FAILED` uma única vez e o utilizador recebe uma
  única notificação de erro com o código e a mensagem do worker (antes lia-se `error.msg`, que
  não existe). A execução consolida com os trabalhos concluídos (D6).
- Se **todos** os trabalhos falharem, a execução não é consolidada e mantém-se a anterior (não
  se publica um conjunto vazio de resultados). Decisão tomada na implementação, a confirmar.

## 6. Cancelamento, *undo* e respostas antigas (D7)

- Respostas cujo token já não é o ativo, ou cujo trabalho já não existe (cancelamento, *undo* ou
  nova execução apagam os trabalhos antigos), são confirmadas sem efeito.
- Se um trabalho for removido enquanto o seu resultado final estava a ser guardado, o
  resultado criado é apagado (não fica resultado órfão com o token antigo).
- O *undo* (`DELETE /:user/:project/tool/:tool`) passa a incrementar `activeToken`, como o
  cancelamento: uma execução em curso deixa de poder consolidar. Apaga também os resultados que
  essa execução já tinha guardado, como o cancelamento (acrescentado na Fase 4, depois de a
  regressão o detetar). Quotas não são tocadas.

## 7. Contratos

| Contrato | Produtor → consumidores | Alteração |
| --- | --- | --- |
| Pedido para ferramenta de imagem (`<tool>_queue`) | `projects` → workers de imagem, watermark | Formato igual. `messageId` determinístico para imagens de execuções normais; `inputImageURI`/`outputImageURI` com caminhos por execução e passo. Mensagem persistente. |
| Resposta (`project_queue`) | workers → `projects` | Formato igual. Respostas de erro com `correlationId` = pedido (já era assim no vídeo e no watermark). Mensagem persistente. |
| Notificações (`ws_queue`) | `projects` → `ws_gateway` | Iguais. Erros de trabalhos com o código e a mensagem do worker. |
| HTTP | — | Sem alterações. |
| Filas e *bindings* | `rabbitMQ/definitions.json` | Sem alterações (as filas não são recriadas). |
| MongoDB `processes` | interno | Campos novos opcionais (`state`, `pipeline`, `out_uri`, `dispatch_at`, `handle_failures`, `error`) e índices parciais. Documentos antigos sem `state` são tratados como antes. |
| MongoDB `results` | interno | Campo opcional `run_key` com índice único parcial. |

**Migração.** Não é preciso migrar dados. Uma execução em curso no momento da atualização tem
documentos antigos (sem `state`) e é tratada pelo caminho antigo até terminar ou ser cancelada.

## 8. Hooks de injeção e harness

Os nomes dos pontos de falha mantêm-se, para a Fase 4 usar exatamente os mesmos cenários. No
caminho novo do `projects` correspondem a:

| Ponto | Baseline | Fase 3 (trabalhos de imagem) |
| --- | --- | --- |
| `after_receive` | Depois de ler a resposta | Igual |
| `after_process_delete` | Depois de apagar o `Process` | Depois de persistir a transição do trabalho (avanço de passo ou `COMPLETED`) |
| `after_result_persist` | Depois de `Result.create` | Depois do *upsert* do `Result` |
| `before_commit` | Antes da consolidação | Antes de `commitRunIfActive` |
| `before_next_publish` | Antes de publicar o sucessor | Igual (sucessor já gravado como `PENDING_DISPATCH`) |

Nos workers, `during_write` escreve metade do ficheiro **temporário** da escrita atómica, e o
registo de tentativas é feito depois de `after_receive`.

No `projects`, a linha `READY` passa a ser escrita imediatamente antes de registar o
consumidor (antes era depois): com ACK depois do tratamento, as respostas reentregues chegam
antes de `consume()` terminar, e M9 (de `READY` à primeira receção da mensagem interrompida)
ficava indefinido.

Ajustes ao harness (não alteram as medições da baseline, onde os documentos não tinham `state`
e eram apagados no fim):

- Um documento conta como pendente se não tiver estado terminal (`state` ∉ {`COMPLETED`,
  `FAILED`}), excluindo *previews*. Acrescentado `verify.failed_jobs`.
- M8 (consolidação prematura) desconta os trabalhos `FAILED`: com D6, a execução consolida sem
  esperar por resultados que nunca vão existir.
- O excerto de logs inclui as linhas `[JOB-…]` e `[RECONCILE…]`. `error_notified` passa a
  reconhecer `[JOB-FAILED]`, escrito no ponto exato em que a notificação de erro é enviada, e
  `errors_notified` conta-as (M12: uma por trabalho falhado).

## 9. Testes

| Suite | Testes | Resultado |
| --- | --- | --- |
| `tests/rnf-fiab-01` (Python, host): hooks + `test_worker_messaging.py` (substitui e inverte `test_baseline_characterization.py`) | 17 | 17/17 |
| `projects/tests/run-jobs.test.js` (novo, host e contentor) | 16 | 16/16 |
| `projects/tests/rabbit-mq.test.js` (novo, host; `amqplib` simulado) | 3 | 3/3 (1/1 na versão da campanha; +2 em §9 de [resultados-finais.md](resultados-finais.md)) |
| `projects/tests/*.test.js` (suite completa, contentor `picturas-fiab-projects-1`) | 36 | 36/36 |

`test_worker_messaging.py` verifica: `auto_ack=False`, *prefetch* 1, *confirms*; resposta
persistente; resposta de erro posicional publicada com `correlationId` correto; ACK só depois
da publicação confirmada; `nack(requeue)` quando a publicação falha; exceção inesperada →
uma resposta de erro; limite de entregas sem executar o efeito; efeito fora do fio da ligação;
escrita atómica (sem temporários e sem perder o ficheiro anterior); `during_write` nunca expõe
o nome final; nova tentativa de ligação quando o nome do broker não resolve.

`run-jobs.test.js` cobre R0, R5a/R5b (cópias concorrentes), R6b/c (sucessor não publicado),
R6d (repetição depois de guardar o resultado), R6e (consolidação interrompida), R7/K3 (execução
substituída), K4 (trabalho removido durante a gravação), R8/R8b (D6), falhas repetidas no
tratamento, saídas de texto (incluindo uma etapa de texto reexecutada com outro nome de ficheiro)
e *snapshot* do pipeline. `rabbit-mq.test.js` verifica que o consumidor reinicia uma vez quando
fecha só o canal ou a ligação, quando a configuração falha com um erro de canal (fica um único
consumidor) e quando o broker cancela o consumidor.

## 10. Verificação preliminar com o stack de ensaio

Pilotos (1 repetição por variante, `T_obs = 30 s`, não contam para a Fase 4) em
[`evidencias/phase3-pilot/`](evidencias/phase3-pilot/), depois de reconstruir `projects` e os três
workers do pipeline com hooks:

| Cenário | Consolidado | Corretos | Duplicados | Reaplicados | Retoma (M9) | Duração do lote |
| --- | --- | --- | --- | --- | --- | --- |
| R0 | sim | 10/10 | 0 | 0 | — | 0,708 s |
| R1 / R2 / R3 / R4 | sim | 10/10 | 0 | 0 | 0,000–0,001 s | 1,44–1,55 s |
| R5a / R5b / R5c | sim | 10/10 | 0 | 0 | — | 0,58–0,64 s |
| R6a–R6e | sim | 10/10 | 0 | 0 | 0,002–0,006 s | 1,92–2,26 s |
| R7 | sim (execução nova) | 10/10 | 0 | 0 | — | 0,970 s |
| R8a | sim, com 1 trabalho `FAILED` (D6) | 10/10 válidas | 0 | 0 | — | 0,589 s |
| R8b | não (todos `FAILED`; mantém-se a consolidação anterior) | 0/10 | 0 | 0 | — | — |

Em todos: originais alterados 0, cobranças adicionais 0, consolidações prematuras 0. R7: nenhum
`Result` com o token antigo. R8a/R8b: cada trabalho falhado notificado uma vez (1 e 10), uma única
entrega por pedido, worker vivo no fim. A duração do lote em R1–R6 inclui o reinício do
contentor; M9 é o tempo entre o processo estar pronto e voltar a receber a mensagem
interrompida.

**Incidente durante os pilotos.** O primeiro conjunto de pilotos correu logo depois de
`podman compose up -d --build projects`, que recriou também o RabbitMQ e o MongoDB do stack de
ensaio (dependências). Resultado: um erro de armazenamento no R0, o R6b consolidado só ao fim de
22 s, o R6c sem consolidar em 30 s (consolidou ~55 s depois, quando os pedidos ao
`img_storage` deixaram de estar presos), e os três workers terminados com `socket.gaierror`
(corrigido, §1). Repetidos com o stack estável, R6b e R6c consolidaram em ~2 s em 6/6 repetições
([`evidencias/phase3-debug-pilot/`](evidencias/phase3-debug-pilot/)), e o conjunto completo foi
repetido com o resultado da tabela. Para a Fase 4, reconstruir serviços com `--no-deps`.

## 11. Limitações e riscos

- **Uma réplica do `projects`.** A reconciliação assume uma única instância (como hoje).
- **Objetos órfãos.** Se o `projects` morrer entre carregar o resultado e criar o `Result`, o
  objeto carregado fica órfão no armazenamento (não publicado). A repetição carrega outro.
- **Watermark externo.** Continua sem *confirms* nem limite de entregas (imagem pré-construída);
  beneficia das saídas por passo e do tratamento idempotente das respostas, mas uma falha deixa
  a etapa sem resposta e o lote sem consolidar: não é recuperável (especificação §7–§8).
- **Ferramentas de texto** (`text_ai`, `obj_ai`, `people_ai`) acrescentam um contador ao nome do
  ficheiro de texto. O `run_key` usa a etapa, por isso uma repetição não cria um segundo
  resultado; o objeto carregado pela cópia que perde é apagado.
- **Ligações por mensagem no `projects`.** As notificações partilham a ligação de publicação;
  se o broker estiver em baixo, são registadas e perdidas (exclusão: notificações `ws_queue`).
- Registo de tentativas e pastas `runs/` antigas não são limpos automaticamente além do que
  `POST /process` remove; ocupação pequena, registada.
