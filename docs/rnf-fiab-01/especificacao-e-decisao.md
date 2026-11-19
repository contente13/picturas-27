# RNF-FIAB-01 — Especificação verificável e decisão arquitetural

Fase 1. Base: `main` @ `df5d0bc`. As janelas referidas (W*, X*, P*, K*) estão definidas em
[diagnostico.md](diagnostico.md). **Nada aqui está implementado**; a implementação só começa na
Fase 3, depois de aprovada esta decisão.

## 1. Definições formais

| Termo | Definição |
| --- | --- |
| **Execução** `E` | Par `(project_id, token)`, aberto quando `POST /:user/:project/process` incrementa `activeToken`. Está **ativa** enquanto `project.activeToken == token`. |
| **Pipeline da execução** | Lista ordenada `imageTools(project)` congelada no momento da abertura de `E` (*snapshot*). Hoje é relida a cada passo; a solução guarda o *snapshot* para que uma retoma execute exatamente os mesmos passos. |
| **Media** | Elemento de `project.imgs` com `media_type == "image"`. Vídeos ficam fora da medição (ver §6). |
| **Trabalho lógico** `J` | `(project_id, token, img_id)`: aplicar o pipeline de `E` a uma media. Produz no máximo **um** `Result` visível (tipo `image` ou `text`). |
| **Etapa** `T(J,k)` | Aplicação do passo `k` (0 ≤ k < n) do pipeline a `J`. |
| **Tentativa** | Uma execução de `T(J,k)` por um worker, iniciada por uma entrega da mensagem de pedido. Uma etapa pode ter várias tentativas (reentrega, republicação); só **uma** pode ser consolidada. |
| **Identificador do pedido** | Determinístico por etapa: `request-<project_id>-<token>-<img_id>-<k>`. Republicar a mesma etapa reutiliza o mesmo `messageId`; respostas de tentativas diferentes da mesma etapa têm o mesmo `correlationId`. Não contém `preview`, pelo que a regra `/preview/` existente mantém-se. |
| **Entrada/saída estáveis** | `in(T(J,0)) = src/<nome>` (cópia local do original); `out(T(J,k)) = out/runs/<token>/<img_id>/<k>/<nome>`; `in(T(J,k)) = out(T(J,k-1))`, exceto se o passo `k-1` produzir texto, caso em que `in(T(J,k)) = in(T(J,k-1))` (regra atual). Nenhuma etapa escreve no ficheiro que lê; o nome base é preservado (a UI e o ZIP usam-no). |
| **Consolidação** | Transição atómica `committedToken := token` (com `resultsToken` e `committedTools`) condicionada a `activeToken == token`, seguida de **uma** notificação ao cliente. |
| **Trabalho recuperável** | `J` de uma execução ativa interrompido por uma **falha transitória** (§2), cuja entrada estável existe e cujas tentativas não excederam os limites (§3). |
| **Trabalho perdido** | `J` recuperável que não atinge `COMPLETED` dentro da janela de observação `T_obs` (§4) ou cuja execução fica sem consolidação. |
| **Resultado duplicado publicado** | Mais de um `Result` com o mesmo `(project_id, token, img_id)` (ou, para extração de frames, o mesmo `file_name`) visível em `GET …/process/url` ou no ZIP para o `committedToken`. |
| **Reaplicação indevida** | O `Result` de `J` difere (SHA-256, dimensões) da referência obtida em R0 para a mesma media e pipeline. |

### Estados

```text
Etapa T:      PENDING_DISPATCH ─publish confirmado→ DISPATCHED ─resposta sucesso→ SUCCEEDED
                                                      └─resposta erro permanente / limite→ FAILED
Trabalho J:   RUNNING(k) ─T(J,n-1) SUCCEEDED + Result persistido→ COMPLETED
                         └─T falhou de forma permanente→ FAILED
Execução E:   ACTIVE ─todos os J terminais + E ativa→ COMMITTED
                     ├─cancelamento / nova execução / undo→ SUPERSEDED (respostas ignoradas)
                     └─(ver decisão D6 para J FAILED)
```

As transições são **condicionais** (comparar-e-trocar no MongoDB): `RUNNING(k) → RUNNING(k+1)`
só se o estado atual for `RUNNING(k)` e a execução estiver ativa. Uma resposta que não encontra o
estado esperado é **idempotentemente descartada** (mas garante-se que o efeito seguinte já foi
pedido — ver §5, I4).

## 2. Classificação de erros

| Classe | Exemplos | Tratamento |
| --- | --- | --- |
| **Transitório — worker** | Processo morto/OOM, contentor reiniciado, ligação ao broker perdida antes do ACK | Reentrega pelo broker; nova tentativa. |
| **Transitório — publicação** | `nack` do broker, canal fechado antes da confirmação | Worker: não faz ACK → reentrega. Orquestrador: etapa fica `PENDING_DISPATCH` e é republicada. |
| **Transitório — orquestrador** | `projects` morto, MongoDB/`img_storage` temporariamente indisponível, exceção não determinística | Resposta não confirmada → reentrega; contador de falhas de tratamento por etapa. |
| **Permanente — entrada/efeito** | Ficheiro não é imagem (`UnidentifiedImageError`), parâmetros inválidos (`KeyError`/`ValueError`), `procedure` errado, entrada estável inexistente | Worker responde `status=error` com o `correlationId` correto e faz ACK; o orquestrador marca `T` e `J` como `FAILED`. Sem novas tentativas. |
| **Permanente — limite** | Tentativas esgotadas (§3) | Tratado como erro permanente com código `attempts_exhausted`. |

No worker, qualquer exceção levantada pelo efeito é tratada como permanente, incluindo erros de
E/S ou de rede de uma ferramenta de IA (por exemplo, o `expand_ai` sem resposta do
`generative-mock`). O worker não distingue de forma fiável uma entrada inválida de uma falha
externa passageira, e repetir uma entrada inválida até ao limite atrasaria o lote sem a
corrigir. O trabalho fica `FAILED`, o utilizador é notificado e pode reprocessar. Só a falta de
confirmação da resposta pelo broker é transitória no worker (sem ACK, reentrega até ao limite).

## 3. Limites de repetição

| Limite | Valor proposto | Onde se conta | Porquê |
| --- | --- | --- | --- |
| Entregas por etapa (worker) | `RNF_FIAB_01_MAX_DELIVERIES=3` | Registo de tentativas no volume partilhado `image_data` (`.attempts/<messageId>`), escrito **antes** de processar | As filas *classic* não contam reentregas (só o *flag* `redelivered`). Um registo por `messageId` determinístico conta também republicações. Evita ciclos infinitos com entradas que matam o worker. |
| Falhas de tratamento da resposta (orquestrador) | 5 por etapa | Campo no documento da etapa | Evita *hot loop* de `nack`/reentrega quando a falha não é transitória. |
| Republicação de `PENDING_DISPATCH` | 1 por reconciliação; reconciliação no arranque e periódica (proposta: 10 s) | `projects` | Cobre P4–P6 sem depender de nova resposta. |

## 4. Critérios de aceitação e métricas

Os valores são **candidatos**; são confirmados ou ajustados com base na baseline (Fase 2) e a
justificação fica em `resultados-baseline.md`. Execuções falhadas contam sempre no denominador.

| ID | Métrica | Definição operacional | Meta | Mínimo |
| --- | --- | --- | --- | --- |
| M1 | Trabalhos recuperáveis concluídos corretamente | `#J COMPLETED com SHA-256 igual à referência R0 e execução consolidada ÷ #J recuperáveis injetados` | 100 % | 100 % |
| M2 | Trabalhos perdidos | `#J recuperáveis não COMPLETED até T_obs` | 0 | 0 |
| M3 | Resultados duplicados publicados | `#Result além do primeiro por (project, committedToken, img_id[, file_name])` | 0 | 0 |
| M4 | Reaplicações indevidas | `#Result com hash/dimensões ≠ referência` | 0 | 0 |
| M5 | Originais alterados | `#objetos src/ (S3) e ficheiros src/ cujo SHA-256 mudou` | 0 | 0 |
| M6 | Cobranças adicionais | `Δ users.operations.processed − cobrança esperada de um único POST /process` | 0 | 0 |
| M7 | Sobrescrita por tentativa antiga | `#ficheiros/Results da execução ativa alterados por respostas/tentativas de token anterior` | 0 | 0 |
| M8 | Consolidação prematura | `#consolidações observadas com algum J não terminal ou Result em falta` | 0 | 0 |
| M9 | Tempo de retoma | De `t_ready` (linha `RNF-FIAB-01 READY` do worker ou de `projects` reiniciado) até `t_resume` (linha `RNF-FIAB-01 RECEIVED` da tentativa seguinte da etapa interrompida, ou reprocessamento da resposta em R6) | ≤ 5 s | ≤ 15 s |
| M10 | Tempo até à conclusão | De `t_fault` (linha `FAULT-POINT`) até à consolidação observada no MongoDB | reportado | reportado |
| M11 | Sobrecarga sem falhas | Aumento da mediana da duração do lote R0 (`POST /process` → `committedToken == token`) entre baseline e final | ≤ 5 % | ≤ 10 % |
| M12 | Fim controlado de erro permanente | R8: `J FAILED` em ≤ `MAX_DELIVERIES` tentativas, nenhuma mensagem em ciclo, utilizador notificado uma vez | 100 % | 100 % |

- `T_obs` = max(10 × mediana R0, 120 s), contado a partir de `t_ready`.
- M9 exclui o tempo de arranque do contentor (que depende do runtime) e mede o comportamento da
  aplicação; o tempo total é visível em M10.
- M11: 10 repetições por versão, mesmo corpus e recursos; reporta-se mediana e IQR. Se o IQR da
  baseline exceder 5 % da mediana, aumentam-se as repetições para 20 em ambas as versões antes de
  concluir.

### Critérios por cenário

| Cenário | Injeção (observável) | Aprovado se |
| --- | --- | --- |
| R0 | Nenhuma | Todos os J COMPLETED; 10 Results; hashes = referência (que este cenário define); quota inalterada para efeitos PIL; duração registada |
| R1 | Hook `after_receive` → `podman kill -s KILL` | M1, M2, M3, M4, M9 |
| R2 | Hook `during_write` (escrita parcial já no disco) → kill | idem + nenhum ficheiro parcial consumido |
| R3 | Hook `after_output_before_reply` → kill | idem; a reexecução não altera o hash final |
| R4 | Hook `after_reply_before_ack` (resposta **confirmada** pelo broker) → kill | idem; a resposta duplicada da nova tentativa é descartada |
| R5 | *Harness* publica N cópias da mesma resposta, sequenciais e concorrentes, em passo intermédio e final | M3, M4, M8; um único sucessor por etapa |
| R6 | Hooks em `projects` (após receber resposta; após persistir estado; após persistir `Result`; antes/depois da consolidação) → kill de `projects` | M1, M2, M3, M8, M9 |
| R7 | Hook mantém tentativa da execução `t` bloqueada; cancelamento; `POST /process` abre `t+1`; liberta-se a tentativa antiga e/ou o *harness* entrega resposta antiga | M7; execução `t+1` consolida com hashes de referência; quota coerente (devolução no cancelamento, uma cobrança na nova) |
| R8 | Media inválida no corpus (bytes não-imagem) e parâmetro inválido | M12; restantes J COMPLETED; sem ciclo infinito |

## 5. Alternativas

| | A — Reentrega pelo broker | B — Recuperação por estado persistido | C — Combinação (**recomendada**) |
| --- | --- | --- | --- |
| Ideia | ACK manual nos workers só após resposta confirmada; ACK em `projects` só após tratar a resposta; mensagens persistentes | `projects` regista cada etapa com prazo (*lease*); um varrimento republica etapas expiradas | A como caminho rápido + estado persistido idempotente com *outbox* e reconciliação para as janelas que o broker não cobre |
| Cobre | W1–W4, P1 | W1–W6, P1, P4–P6, P9 | Todas as janelas do diagnóstico no âmbito |
| Não cobre | P4–P6, P9 (estado entre persistir e publicar); duplicados (exige idempotência à parte) | — | Perda de disco do broker/MongoDB (exclusão) |
| Tempo de retoma | Imediato: o broker reentrega quando a ligação fecha | Limitado pelo *lease*: tem de ser maior que o pior tempo de um efeito de IA (dezenas de s), o que falha M9 | Imediato (A); a reconciliação só atua em P4–P6/P9 |
| Duplicados | Reentrega gera tentativas repetidas → precisa de idempotência | *Lease* expirado com worker lento gera execuções concorrentes → precisa de *fencing* | Idempotência por identidade determinística, transições condicionais e índices únicos |
| Ciclos infinitos | Reentrega ilimitada em filas *classic* | Controlado pelo contador | Registo de tentativas por `messageId` (§3) |
| Alterações de contrato | Nenhuma de formato; correção do `correlationId` nas respostas de erro | Nenhuma | Igual a A; `messageId` determinístico (formato livre, o consumidor só usa `/preview/`) |
| Risco principal | *Heartbeat* com efeitos longos (W7) causa reentregas espúrias | Tempo de retoma; complexidade de prazos | Mais código no orquestrador; migração de `Process` |

**Decisão recomendada: C.** É a única que cumpre M1/M2 nas janelas P4–P9 sem sacrificar M9.
Mantém as filas *classic* e as definições existentes (sem recriar filas no volume
`rabbitmq_data`), não altera o formato JSON das mensagens e não depende do watermark externo.

## 6. Decisões de desenho (a implementar na Fase 3, por incrementos)

| ID | Decisão | Janelas | Contratos afetados (produtores → consumidores) |
| --- | --- | --- | --- |
| D1 | **Workers `Tools/utils`**: `auto_ack=False`, `prefetch_count=1`, *publisher confirms* + `delivery_mode=2` na resposta, ACK **só depois** da confirmação; registo de tentativas por `messageId` com limite; corrigir argumentos das respostas de erro e o `correlationId`; escrita atómica (ficheiro temporário com a mesma extensão + `os.replace`); efeito executado de forma a não bloquear o *heartbeat* (fio de trabalho + `add_callback_threadsafe`, padrão já usado pelo watermark). | W1–W5, W7 | Resposta de erro: `correlationId` passa a ser o pedido (já é assim no vídeo e no watermark). Único consumidor: `projects`. |
| D2 | **Mensageria de `projects`**: uma ligação/canal de confirmação reutilizados, com reconexão; `publish` devolve promessa resolvida na confirmação; mensagens persistentes; consumidor com `prefetch` limitado que faz `ack` **depois** de a promessa do tratamento terminar e `nack(requeue)` em falha transitória, com o limite de §3. | P1, P6, P12 | Nenhum formato muda. `ws_queue` mantém-se. |
| D3 | **Identidade e unicidade**: `messageId` determinístico; estado da etapa/trabalho persistido com índice único `(project_id, token, img_id)`; `Process.msg_id` único; `Result` com índice único por etapa (`run_key = <project>:<token>:<img_id>:<etapa>`) e criação por *upsert*; a chave não usa o nome do ficheiro, porque as ferramentas de texto o geram com um contador do processo. *Snapshot* do pipeline na execução. | P3, R5 | Coleções internas de `projects`; migração compatível (documentos antigos sem os novos campos tratados como legado). |
| D4 | **Transições idempotentes + *outbox***: a resposta é tratada por comparar-e-trocar; o sucessor é gravado como `PENDING_DISPATCH` **na mesma escrita** que avança `J`, publicado com confirmação e marcado `DISPATCHED`. Reconciliação no arranque e periódica republica `PENDING_DISPATCH` de execuções ativas e reavalia consolidações pendentes. O `Process` deixa de ser apagado antes de o resultado estar persistido. | P1, P4–P9 | — |
| D5 | **Saídas estáveis por execução e etapa** (`out/runs/<token>/<img_id>/<k>/<nome>`), entrada ≠ saída. `POST /process` apaga os diretórios `runs/<token>` das execuções anteriores e os seus trabalhos; uma tentativa antiga ainda a correr falha ou escreve no diretório da sua execução, e a sua resposta é descartada (D7). | W2, W3, X1, X2, K3 | Valores de `inputImageURI`/`outputImageURI` mudam; formato igual. Consumidores: todos os workers de imagem, watermark (aceita qualquer caminho em `/images`). |
| D6 | **Consolidação**: só quando **todos** os `J` estão em estado terminal **e** a execução está ativa, numa transição condicional; notificação de conclusão enviada só por quem efetua a transição. **Proposta para `J FAILED` (erro permanente):** a execução consolida com os resultados dos `J COMPLETED` e reporta explicitamente as medias falhadas (preserva o comportamento visível atual de resultados parciais, mas deixa de ser prematuro). Alternativa: não consolidar e manter o commit anterior. | P8, P10, R8 | `ws_queue`: mesma mensagem de sucesso/erro; nenhuma mensagem nova obrigatória. |
| D7 | **Cancelamento e respostas antigas**: respostas cujo `token ≠ activeToken` ou cuja etapa não está no estado esperado são descartadas com ACK; tentativas antigas escrevem apenas no seu diretório de execução. O *undo* (`DELETE …/tool/:tool`) passa a invalidar a execução em curso como o cancelamento (K4), **sem** alterar quotas. | K1–K4, R7 | — |
| D8 | **Hooks de injeção** (Fase 2): desligados por omissão, ativos só com `RNF_FIAB_01_HOOKS=1` no projeto Compose de ensaio; linha de log `RNF-FIAB-01 FAULT-POINT` e bloqueio numa barreira (ficheiro) até o *harness* matar o processo. Linhas `RNF-FIAB-01 READY` e `RECEIVED` para medir M9. | todos | Nenhum. |

Princípios transversais: não alterar `users`/quotas (a cobrança continua apenas em
`POST /process`; a recuperação nunca o reinvoca); não alterar `video_tool`; *previews* continuam a
usar o caminho atual (beneficiam de D1/D2, não são medidos); extração de frames mantém as
garantias existentes (barreiras e `persistFrameResults`). Num projeto com `extract_frames`, também
as imagens seguem o caminho antigo (um documento `Process` por etapa), porque a consolidação
desses lotes usa as barreiras do caminho antigo (`holdsRunCommit` em `routes/projects.js`); essas imagens não são trabalhos recuperáveis (§8).

## 7. Riscos e limitações conhecidos da decisão

| Risco | Mitigação / registo |
| --- | --- |
| Watermark externo sem confirms nem limite de tentativas | As saídas estáveis (D5) tornam a reexecução inofensiva; ciclo infinito com entrada "assassina" fica como limitação documentada. O worker confirma ao receber e troca os identificadores nas respostas de erro: se morrer ou falhar, a etapa fica `DISPATCHED` sem resposta e o lote não consolida (não há prazo por etapa, alternativa B rejeitada). Por isso um trabalho com watermark **não é recuperável** (§8). |
| Tentativa "zombie" (worker desligado do broker mas ainda a processar) | Saídas determinísticas e escrita atómica: o conteúdo final é idêntico; a resposta tardia é descartada por D4. |
| Objetos órfãos em S3 (upload feito, morte antes do `Result`) | Não publicados (sem `Result`); registados como limitação, com contagem nas evidências. |
| Migração de documentos `Process` existentes | Execuções em curso no momento da atualização são tratadas como legado (caminho antigo) ou canceladas; documentado na Fase 3. |
| Sobrecarga de confirms, persistência e escritas condicionais | Medida por M11; se exceder o mínimo, ajustar `prefetch`/reutilização de canal antes de concluir. |
| `heartbeat` e `consumer_timeout` (30 min por omissão no RabbitMQ 4) | D1 mantém o *heartbeat* ativo; efeitos de IA abaixo de 30 min. |

## 8. Exclusões

- Perda de dados persistidos pelo RabbitMQ ou MongoDB; partições de rede prolongadas.
- Falhas permanentes do `img_storage`/SeaweedFS (tratadas como erros, não como recuperação).
- Modificação do worker externo de watermark; os trabalhos cujo pipeline inclui watermark não são
  recuperáveis (§7).
- Imagens de projetos com `extract_frames` (caminho antigo, §6).
- Vídeo (`video_tool`): só regressão.
- *Previews*: não medidos; apenas regressão funcional.
- Notificações `ws_queue` perdidas (não são resultados).
