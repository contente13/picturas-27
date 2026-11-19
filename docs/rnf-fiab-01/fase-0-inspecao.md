# RNF-FIAB-01 — Fase 0: inspeção, ambiente e plano

Data: 2026-11-14. Base inspecionada: ramo `main`, commit
`df5d0bc2a53ba8fb677987e2e1d69e939017418a` (árvore limpa). **Nenhum ficheiro de código foi
alterado nesta fase**; só foram criados `docs/rnf-fiab-01/README.md` e este ficheiro.

## 1. O que foi lido

| Área                    | Ficheiros                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Documentação            | `README.md`, `AGENTS.md`, `benchmarks/uploads/README.md` (padrão de campanha já usado no repositório)                      |
| Configuração            | `docker-compose.yaml`, `.env.example` (só nomes de variáveis), `.gitignore`, `rabbitMQ/definitions.json`, `rabbitmq.conf`  |
| Workers (utilitários)   | `Tools/utils/rabbit_mq.py`, `tool_msg.py`, `img_handler.py`, `env.py`                                                      |
| Workers (callbacks)     | `brightness`, `resize`, `rotate`, `border`, `binarization`, `text_ai`, `expand_ai` (consumo), `Tools/video/video.py`       |
| Watermark externo       | Código Python dentro do contentor `picturas-watermark_tool_ms-1` (só leitura: `core/message_processor.py`, `result_message.py`) |
| Orquestrador            | `projects/utils/rabbit_mq.js`, `project_msg.js`, `processBatch.js`, `projects/routes/projects.js` (`process_msg`, `POST/DELETE /:user/:project/process`), `models/{process,result,project}.js`, `controllers/{process,result,project}.js`, `app.js` |
| Quotas                  | `users/routes/users.js` (`GET /:user/process/:n`, `POST /:user/process/refund/:n`)                                         |
| Testes existentes       | `projects/tests/*.test.js` (node:test), `tests/uploads/temporary-upload.test.js`, `Tools/video/tests/` (pytest), `benchmarks/uploads/` |

## 2. Ambiente de execução verificado

| Item                    | Valor observado                                                                                       | Consequência                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Runtime de contentores  | **Não há `docker`**. Há `podman 4.9.3` *rootless* (netavark, cgroup v2) e `docker-compose v5.1.1` como fornecedor externo de `podman compose` | Os comandos `docker compose …` do README/AGENTS são executados como `podman compose …`. Kill de worker: `podman kill -s KILL <ctr>`. |
| Stack existente         | Projeto Compose `picturas` **completo e em execução** (32 contentores, imagens construídas a 2026-11-14 20:23 UTC) com os volumes `picturas_*` | Não pode ser tocado. Os ensaios usam um projeto Compose isolado (proposta em §5). As portas fixas do `docker-compose.yaml` colidem com o stack existente. |
| Watermark               | `prcsousa/picturas-watermark-tool-ms:latest`, digest `sha256:534007b3…5835`, criado 2025-01-07        | Código externo: não pode ser alterado; só observado.                                                            |
| Host                    | Linux Mint 22.3, 18 CPU, 30 GiB RAM, ~664 GiB livres                                                  | Recursos suficientes para um segundo stack reduzido em paralelo.                                               |
| Node no host            | v18.19.1; `projects/node_modules` ausente                                                              | Testes de `projects` correm no contentor (`node:latest`), como o README indica.                               |
| Python no host          | 3.14.7, sem `pika`; `ffmpeg`/`ffprobe` ausentes                                                        | Testes Python dos workers correm num venv dedicado ou na imagem `python:3.11-slim` dos workers.               |

Comandos executados nesta fase (todos só de leitura): `git log/status`, `cat/sed/grep` sobre o
código, `podman --version`, `podman compose version`, `podman ps -a`, `podman volume ls`,
`podman images`, `podman info`, `podman image inspect` (watermark), `podman exec … grep/sed` no
contentor de watermark, `node/python3 --version`, `nproc`, `free`, `df`.

### Comandos de build/teste identificados

```bash
podman compose up -d --build <service>                     # reconstruir um serviço
podman compose run --rm --no-deps projects sh -c "node --test tests/*.test.js"
cd Tools/video && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q tests
node --test tests/uploads/                                 # teste de uploads (host)
```

Não existem testes para `Tools/utils` nem para os workers de imagem; os testes de `projects`
cobrem `processBatch`, `commitRunIfActive`, extração de frames, vídeo e upload, mas não
`process_msg`.

## 3. Achados preliminares (a aprofundar na Fase 1)

Estes pontos orientam o plano; a análise completa, com todas as janelas, vai para
`diagnostico.md`.

### Workers de imagem (`Tools/utils`)

1. **ACK na entrega.** `Tools/utils/rabbit_mq.py:40` consome com `auto_ack=True`: o broker
   esquece o pedido no momento da entrega. Qualquer morte do worker antes de responder (R1–R3)
   perde o trabalho sem possibilidade de reentrega. Abrange os 8 workers PIL e os 7 de IA.
2. **Publicação sem garantias.** `rabbit_mq.py:28` publica sem `delivery_mode=2` nem *publisher
   confirms*; a fila `project_queue` é durável mas a mensagem não é persistente.
3. **Sem `prefetch`** e ligação bloqueante com *heartbeat* por omissão; o ciclo
   `while True: read_msg(...)` reentra em `basic_consume` se `start_consuming` lançar.
4. **Caminho de erro partido.** Nos workers simples o `send_msg` de erro é chamado com
   argumentos posicionais desalinhados (ex.: `Tools/brightness/brightness.py:63-73`,
   `Tools/resize/resize.py:52,69`, `border`, `rotate`, `binarization`, `bg_remove_ai`): o código de
   erro cai em `type` e `og_img_uri` fica `None`, pelo que `tool_msg.py:62-63` **lança exceção
   em vez de responder**. Mesmo quando responde, `tool_msg.py:66-67` troca
   `messageId`/`correlationId` (já listado em `AGENTS.md`). Efeito provável: um erro permanente
   (R8) não chega ao orquestrador e o lote fica pendurado. A confirmar empiricamente na Fase 2.
5. **Saída in-place.** O orquestrador encadeia passos sobre o **mesmo ficheiro**: para o passo
   `k>0`, entrada e saída são ambas `out/<nome>` (`projects/routes/projects.js:494-495`).
   Reexecutar um passo cuja saída já foi escrita reaplica o efeito (ex.: borda duplicada). É o
   risco central de "reaplicação indevida" e de escrita parcial (R2/R3).

### Watermark externo

6. Usa ACK manual **depois** de publicar a resposta (`message_processor.py:46-98`), com
   `prefetch_count` configurável e uma *thread* por mensagem; sem *publisher confirms* e sem
   mensagens persistentes. Em caso de morte recebe reentrega (o que, com saída in-place, pode
   reaplicar a marca). O formato de erro (`error.description`) difere do lido pelo orquestrador
   (`error.msg`). Não é modificável: fica como limitação/compatibilidade a preservar.

### Orquestrador (`projects`)

7. **ACK antes do processamento.** `projects/utils/rabbit_mq.js:46-51` chama o *callback*
   assíncrono e faz `channel.ack` imediatamente, sem esperar pela promessa: uma queda de
   `projects` (R6) perde a resposta já confirmada.
8. **Publicação *fire-and-forget*.** `rabbit_mq.js:11-30` abre uma ligação por mensagem, sem
   confirmação nem persistência, fecha-a num `setTimeout` de 500 ms e faz `throw` dentro de
   *callbacks* (falha do broker derruba o processo). `dispatchProcessBatch` "espera" por
   `send`, mas `send_msg_tool` não devolve promessa.
9. **Estado não idempotente.** `process_msg` apaga o `Process` **antes** de tratar a resposta
   (`routes/projects.js:208`), cria `Result` sem chave única (`:420`) e cria o sucessor antes de
   publicar (`:514-516`). Não há índice único em `Process.msg_id` nem em
   `Result(project_id, token, img_id)`. Uma resposta duplicada cujo `Process` já foi apagado é
   ignorada; uma duplicada concorrente pode criar dois `Result` ou dois sucessores.
10. **Consolidação.** `remaining === 0` (contagem de `Process` por token) seguido de
    `commitRunIfActive` condicionado a `activeToken` (`controllers/project.js:94-100`). A
    proteção contra execuções antigas existe (token), mas a consolidação depende de contagens
    não atómicas.
11. **Cancelamento** (`DELETE /:user/:project/process`, `routes/projects.js:2142`) incrementa
    `activeToken`, apaga `Process` e `Result` do token cancelado e devolve operações
    avançadas. Respostas tardias são filtradas pelo token, mas `POST /process` volta a apagar
    `src/` e `out/` (`:1476-1488`) e reutiliza os mesmos nomes de ficheiro: uma resposta antiga
    pode escrever sobre a saída da execução nova (R7).
12. **Quotas.** A cobrança acontece **só no `POST /process`** (`users` `GET /:user/process/:n`)
    e só para ferramentas avançadas (IA) e efeitos de vídeo. Ferramentas PIL não cobram. Logo,
    repetições internas de workers não cobram hoje; o risco de cobrança dupla está em reenviar
    `POST /process` como mecanismo de recuperação, o que a solução deve evitar.

## 4. Âmbito proposto

- **Dentro:** trabalhos de imagem não-preview disparados por `POST /:user/:project/process`,
  executados pelos workers que usam `Tools/utils` (PIL e IA) e pelo watermark externo
  (só observado), e o seu tratamento em `projects` (`process_msg`, `Process`, `Result`,
  consolidação, cancelamento).
- **Preservar sem alterar semântica:** `video_tool` (já faz ACK no fim), *previews*,
  projetos mistos imagem+vídeo, extração de frames, quotas, contratos HTTP.
- **Fora (documentado como exclusão):** falha do broker com perda de disco, falha de MongoDB,
  falha do `img_storage`/SeaweedFS, modificação do watermark externo, perda de mensagens em
  `ws_queue` (notificação ao browser, não resultado).

## 5. Proposta de ambiente de ensaio isolado (a confirmar)

- Projeto Compose dedicado `picturas-fiab` (volumes próprios `picturas-fiab_*`), com um ficheiro
  *override* versionado em `docs/rnf-fiab-01/` ou `tests/rnf-fiab-01/` que remove as portas
  publicadas (`ports: !reset []`) exceto as necessárias ao *harness* em portas alternativas
  (ex.: RabbitMQ management, `projects`, MongoDB de projetos) para não colidir com o stack
  `picturas` em execução.
- Subconjunto mínimo de serviços: `rabbitmq`, `projects_mongoDB`, `projects`, `users_mongoDB`,
  `users`, `img_storage`, `seaweedfs` e os workers do corpus. Sem frontend, nginx, IA nem vídeo
  nos cenários R1–R8 (o vídeo entra só na regressão da Fase 4).
- Reposição: `podman compose -p picturas-fiab down -v` **apenas sobre o projeto de ensaio**
  (nunca `picturas`), mais regeneração determinística do corpus e verificação de manifesto.

## 6. Proposta de corpus e efeitos (a confirmar)

- **10 imagens PNG geradas por script** com semente fixa (padrões e gradientes, dimensões não
  quadradas, ex. 640×480, ~0,3–1 MB). Só o gerador e o manifesto SHA-256 são versionados.
- **3 efeitos PIL que tornam visível a reaplicação**, encadeados in-place:
  1. `border` (aumenta as dimensões a cada aplicação — reaplicação detetável só pelo tamanho);
  2. `brightness` (fator ≠ 1 — reaplicação muda o histograma/hash);
  3. `rotate` 90° (troca largura/altura em imagens não quadradas).
- O resultado de referência de cada imagem é o hash SHA-256 obtido em R0; reaplicações e
  saídas parciais são detetadas por hash, dimensões e validação de decodificação.
- Variante opcional para quotas: um projeto com uma ferramenta avançada barata para medir
  `operations.processed` antes/depois (decisão na Fase 2, porque os efeitos PIL não cobram).

## 7. Proposta de mecanismos de injeção de falhas (detalhe na Fase 2)

Sem atrasos aleatórios. Hooks **desligados por omissão**, ativados só por variável de ambiente
no projeto de ensaio (ex.: `RNF_FIAB_01_FAULT_POINT=<ponto>` e `RNF_FIAB_01_FAULT_MATCH=<msg>`):

- Ponto atingido → linha de log estruturada `RNF-FIAB-01 FAULT-POINT point=… msg=… ts=…` e o
  processo **bloqueia numa barreira** (ficheiro/FIFO). O *harness* espera pela linha de log, e
  só então executa `podman kill -s KILL` — a janela da falha é provada pelo log, não por tempo.
- Pontos nos workers: `after_receive`, `during_write` (escrita parcial antes do *rename*/fecho),
  `after_output_before_reply`, `after_reply_before_ack`.
- Pontos em `projects`: antes/depois de persistir `Result`, antes de publicar o passo seguinte,
  antes/depois da consolidação.
- R5 e R7 não precisam de matar processos: o *harness* publica diretamente em `project_queue`
  respostas duplicadas (inclusive concorrentes) ou de um token antigo.
- "Worker apto" é sinalizado por uma linha de log de prontidão (`RNF-FIAB-01 READY`) emitida
  depois de `basic_consume`; o tempo de retoma mede-se de READY até à primeira entrega/
  consumo do trabalho recuperado.

## 8. Plano curto de fases

| Fase | Entregáveis                                                                                                                                  | Ponto de paragem              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1    | `diagnostico.md` (diagrama de sequência, tabela de janelas por passo), `especificacao-e-decisao.md` (definições, critérios mensuráveis, alternativas, decisão recomendada) | Aprovação da decisão          |
| 2    | Hooks desligados por omissão, *harness* R0–R8, gerador de corpus e manifesto, override Compose isolado, testes unitários/integração, `protocolo-baseline.md`, `resultados-baseline.md`, `evidencias/baseline/` | Aprovação da baseline         |
| 3    | Incrementos pequenos com testes (ACK seguro e confirms nos workers; ACK após processamento em `projects`; identidade e índices únicos; transições idempotentes; saídas por tentativa estáveis; erros transitórios/permanentes com limite), `implementacao.md` | Aprovação antes da validação  |
| 4    | Repetição exata do protocolo, `resultados-finais.md`, `regressao-e-limitacoes.md`, resumo                                                    | Fim                           |

## 9. Decisões pedidas antes da Fase 1

> **Aprovadas** pelo responsável em 2026-11-14, sem alterações, antes do início da Fase 1.

1. **Runtime:** usar `podman compose` como equivalente de `docker compose` (não há Docker).
2. **Isolamento:** criar o projeto `picturas-fiab` com override de portas, mantendo intacto o
   stack `picturas` em execução — ou, em alternativa, autorizar parar temporariamente o stack
   `picturas` (sem apagar volumes).
3. **Corpus/efeitos:** 10 PNG gerados + `border` → `brightness` → `rotate 90°`.
4. **Âmbito:** watermark externo e `video_tool` só observados/regredidos, não alterados.
5. **Repetições:** 10 por cenário crítico (R1–R4, R6, R7); R5 e R8 com 10 também; R0 com 10
   execuções para a mediana de referência (pode subir para 20 se a dispersão for alta).
