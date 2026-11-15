# RNF-FIAB-01 — Protocolo de ensaio e baseline

Fase 2. Este protocolo é executado **igual** na baseline (Fase 2) e na validação final (Fase 4):
mesmo corpus, mesmo stack, mesmos cenários, mesmo número de repetições, mesmos critérios.
Definições e métricas: [especificacao-e-decisao.md](especificacao-e-decisao.md) §1 e §4.

## 1. Artefactos

| Ficheiro | Função |
| --- | --- |
| `Tools/utils/fault_hooks.py` | Hooks dos workers de imagem (inertes por omissão) |
| `Tools/utils/{rabbit_mq,tool_msg,img_handler}.py` | Chamadas aos hooks, protegidas por `fault_hooks.ENABLED` (CRLF preservado) |
| `projects/utils/faultHooks.js` | Hooks do orquestrador (inertes por omissão) |
| `projects/utils/rabbit_mq.js`, `projects/routes/projects.js` | Linhas `READY`/`RECEIVED` e 5 pontos em `process_msg`, todos protegidos por `if (faultHooks.ENABLED)` |
| `projects/tests/fault-hooks.test.js` | Testes unitários dos hooks Node (`node:test`) |
| `tests/rnf-fiab-01/test_fault_hooks.py` | Testes unitários dos hooks Python |
| `tests/rnf-fiab-01/test_baseline_characterization.py` | Caracterização do comportamento original (W1, W4, W5); a inverter na Fase 3 |
| `tests/rnf-fiab-01/corpus.py` | Gerador determinístico do corpus e da referência |
| `tests/rnf-fiab-01/compose.fiab.yaml` | Override do stack isolado `picturas-fiab` |
| `tests/rnf-fiab-01/harness.py` | Execução dos cenários R0–R8, recolha de métricas e sumário |
| `tests/rnf-fiab-01/inspect_objects.js` | Hash de objetos guardados, executado dentro do contentor `projects` |
| `tests/rnf-fiab-01/requirements.txt` | Dependências fixadas do harness |
| `docs/rnf-fiab-01/evidencias/corpus-manifest.json` | Manifesto SHA-256 do corpus e da referência |
| `docs/rnf-fiab-01/evidencias/<fase>/` | `campaign.json`, `<cenário>/rep-NN.json`, `summary.json` |

## 2. Ambiente de ensaio isolado

- Projeto Compose **`picturas-fiab`** (contentores `picturas-fiab-*`, volumes `picturas-fiab_*`).
  O stack `picturas` do utilizador não é tocado.
- Serviços: `rabbitmq`, `projects_mongoDB`, `projects`, `users_mongoDB`, `users`,
  `img_storage`, `seaweedfs`, `border_tool`, `brightness_tool`, `rotate_tool`.
- Portas só em `127.0.0.1` e fora das portas normais: AMQP `25672`, gestão RabbitMQ `25673`,
  MongoDB de projetos `37018`, `projects` `19002` (HTTPS), `users` `20001` (HTTPS). As restantes
  portas são removidas.
- Hooks ligados (`RNF_FIAB_01_HOOKS=1`) apenas em `projects` e nos três workers do pipeline.
- `restart: "no"` nesses quatro serviços: é o harness que reinicia (`podman start`) depois de
  matar, e o tempo de retoma é medido a partir da linha `READY`, independentemente da política
  de reinício do runtime. Diferença face à produção (`on-failure`) registada nas limitações.
- O harness autentica-se no `projects` com o cabeçalho interno `x-caller-id` (sem gateway) e cria
  um utilizador `free` novo por repetição no `users`, com email `@example.invalid` e palavra-passe
  aleatória que nunca é registada. As credenciais do broker são lidas do contentor em tempo de
  execução; não ficam em ficheiros.

```bash
cd <repo>
podman compose -p picturas-fiab -f docker-compose.yaml -f tests/rnf-fiab-01/compose.fiab.yaml \
  up -d --build rabbitmq projects_mongoDB projects users_mongoDB users img_storage seaweedfs \
  border_tool brightness_tool rotate_tool
cd tests/rnf-fiab-01
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python corpus.py generate      # ou verify, se data/corpus já existir
.venv/bin/python harness.py check
```

## 3. Corpus e referência

- 10 PNG 640×480 RGB (`img01.png`–`img10.png`, ~65 KB) gerados com semente `20261114`
  (gradiente, 12 formas, bloco de ruído), mais `img11-invalid.png` (bytes que não são imagem)
  para R8a. Pillow fixado (`13.0.0`); `corpus.py verify` falha se os bytes divergirem.
- Pipeline: `border(12, rgb(200,30,30))` → `brightness(1.4)` → `rotate(90)`. Cada efeito torna
  a reaplicação visível: a borda aumenta as dimensões, o brilho altera os píxeis e a rotação
  troca largura/altura.
- **Referência independente:** `corpus.py` aplica as mesmas operações PIL no host e guarda o
  hash dos píxeis RGBA (`sha256("<w>x<h>:" + RGBA)`) de cada saída esperada
  (`expected_pixel_sha256`, 504×664). O harness calcula o mesmo hash, com `sharp`, sobre o objeto
  efetivamente publicado em S3. No R0 os 100 resultados coincidiram com a referência (Pillow
  11.0.0 nos workers e 13.0.0 no host), o que valida a referência.
- Originais: o SHA-256 do objeto `src` em S3 e da cópia local `src/<nome>` é comparado com o
  manifesto (M5).

## 4. Hooks de injeção

Configuração armada pelo harness em `<volume image_data>/.rnf-fiab-01/fault.json`:

```json
{"id": "R2-03-ab12cd", "target": "brightness_tool", "point": "during_write",
 "match": "img03.png", "cur_pos": 1, "action": "block", "count": 3}
```

- **Inércia:** sem `RNF_FIAB_01_HOOKS=1` nenhuma função lê ficheiros nem escreve logs;
  `store_img` é `Image.save(path)`; os pontos no orquestrador nem são aguardados. Testado em
  `test_rnf_fiab_01_disabled_hooks_are_identity` e no teste Node homólogo.
- **Disparo único:** cada `id` dispara uma vez (marcador `fired-<id>` criado com `O_EXCL`), pelo
  que o worker reiniciado não volta a falhar.
- **Prova da janela:** o hook escreve `RNF-FIAB-01 FAULT-POINT service=… id=… point=… msg=… ts=…`
  e bloqueia até existir `release-<id>`. O harness só mata o processo depois de ler essa linha.
  Não há atrasos aleatórios.
- **Medição:** `RNF-FIAB-01 READY` (consumidor registado) e `RNF-FIAB-01 RECEIVED msg=…
  redelivered=…` (entrega recebida) em todos os serviços com hooks.

| Serviço | Ponto | Onde | Janela |
| --- | --- | --- | --- |
| worker | `after_receive` | antes do *callback* da ferramenta | W1 |
| worker | `before_write` | antes de `Image.save` | K3 (R7) |
| worker | `during_write` | metade dos bytes escritos e `fsync` | W2 |
| worker | `after_output_before_reply` | saída escrita, antes de `basic_publish` | W3 |
| worker | `after_reply_before_ack` | depois de `basic_publish`; ações `block`, `duplicate` (N cópias seguidas) e `capture` | W4, R5 |
| projects | `after_receive` | resposta já confirmada, antes de procurar o `Process` | P1 |
| projects | `after_process_delete` | `Process` apagado, antes de tratar a resposta | P4 |
| projects | `before_next_publish` | sucessor criado, antes de o publicar | P5 |
| projects | `after_result_persist` | `Result` criado (último passo) | P7/P8 |
| projects | `before_commit` | `remaining == 0`, antes de `commitRunIfActive` | P9 |

## 5. Cenários

Media alvo `img03.png`; alvo de falha nos workers: `brightness_tool` (passo 1, o primeiro passo
encadeado in-place).

| ID | Injeção | Sequência |
| --- | --- | --- |
| R0 | nenhuma | criar projeto → `POST /process` → esperar consolidação |
| R1 | `brightness_tool` `after_receive` | armar → `POST` → esperar FAULT-POINT → `podman kill -s KILL` → `podman start` → esperar `READY` → observar até `T_obs` |
| R2 | `brightness_tool` `during_write` | idem |
| R3 | `brightness_tool` `after_output_before_reply` | idem |
| R4 | `brightness_tool` `after_reply_before_ack` | idem, mas o kill só acontece depois de `projects` registar `RECEIVED` da resposta (prova de que o broker a aceitou) |
| R5a | `rotate_tool` (último passo) `after_reply_before_ack` `duplicate`×3 | 3 respostas iguais seguidas → tratadas em concorrência |
| R5b | `border_tool` (primeiro passo) `duplicate`×3 | duplicados num passo intermédio |
| R5c | `rotate_tool` `capture` | depois da consolidação, o harness republica a resposta capturada (duplicado sequencial tardio) |
| R6a–e | `projects` em `after_receive` (img03, 1.ª resposta), `after_process_delete` (img03, `cur_pos` 1), `before_next_publish` (img03, `cur_pos` 1), `after_result_persist` (img03, `cur_pos` 2), `before_commit` (o primeiro que chegar) | kill de `projects` → `start` → `READY` → observar até `T_obs` |
| R7 | `brightness_tool` `before_write` (img03, execução `t`) | FAULT-POINT → `DELETE /process` → `POST /process` (execução `t'`) → barreira: todos os trabalhos de `t'` registados no passo 1 → libertar a tentativa antiga → verificar `t'` |
| R8a | media inválida | 10 imagens + `img11-invalid.png` → `POST` → observar até `T_obs` |
| R8b | parâmetro inválido | `brightness = "invalid"` → `POST` → observar até `T_obs` |

## 6. Métricas e cálculo

| Métrica | Campo(s) no registo | Cálculo |
| --- | --- | --- |
| M1/M2 | `committed`, `verify.media_correct`, `verify.missing` | execução consolidada **e** todos os J com hash de píxeis = referência; trabalhos sem `Result` = perdidos |
| M3 | `verify.duplicates` | Σ (`Result` por media − 1) no token da execução |
| M4 | `verify.reapplied` | `Result` cujo hash de píxeis ≠ referência |
| M5 | `verify.originals_changed` | objeto `src` (S3) ou ficheiro `src/` local ≠ manifesto |
| M6 | `quota_delta` | Σ `operations.processed` depois − antes (via `GET /users/:id`) |
| M7 | R7: `verify.reapplied`, `old_results` | resultados da execução nova alterados pela tentativa antiga; `Result` com token antigo |
| M8 | `results_at_commit` | nº de `Result` no instante em que `committedToken` passa a `token` (amostragem de 20 ms) |
| M9 | `resume_s` | `t_resume − t_ready`: primeira linha `RECEIVED` do serviço reiniciado com o `msg` interrompido |
| M10 | `complete_after_fault_s` | `t_commit − t_fault` |
| M11 | `duration_s` (R0) | `t_commit − t_post` (pedido HTTP enviado → consolidação observada no MongoDB) |
| M12 | `max_deliveries_per_msg`, `worker_running_after`, `error_notified` | R8 |

- `T_obs = max(10 × mediana R0, 120 s)`, contado a partir de `t_ready` (R1–R4, R6) ou de `t_post`
  (R0, R5, R7, R8). Na baseline: mediana R0 = 0,677 s → `T_obs = 120 s`.
- Um trabalho é **perdido** se não tiver `Result` correto quando a observação termina.
- R5 usa uma janela de observação adicional após a chegada da última cópia (até não haver
  `Process` pendentes, máx. 30 s, mais 2 s) para apanhar efeitos tardios; esta janela não serve
  de prova de falha, apenas de fim de observação.

## 7. Repetições e execução

- R0: 10 repetições (o IQR da baseline foi 4,6 % da mediana, abaixo do limiar de 5 % que obrigaria
  a 20). Cenários R1–R8: 10 repetições por variante (R5a/b/c, R6a–e, R8a/b são variantes).
  Total: 160 execuções medidas.
- Pilotos: 1 repetição por variante em `evidencias/baseline-pilot/` com `T_obs = 20 s`; não contam.
- Ordem fixa: R0, depois R1→R8b, cada variante com as suas 10 repetições consecutivas.
- Execuções falhadas ou em que o ponto de falha não foi atingido ficam no denominador e são
  marcadas (`harness_error`, `notes`).

```bash
.venv/bin/python harness.py run --phase baseline --scenario R0 --reps 10
.venv/bin/python harness.py summarize --phase baseline        # fixa a mediana R0 e T_obs
.venv/bin/python harness.py run --phase baseline \
  --scenario R1,R2,R3,R4,R5a,R5b,R5c,R6a,R6b,R6c,R6d,R6e,R7,R8a,R8b --reps 10
.venv/bin/python harness.py summarize --phase baseline
```

Na Fase 4 repetem-se os mesmos comandos com `--phase final`.

## 8. Registo por execução

Cada `rep-NN.json` contém: cenário, repetição, `fault_id` e configuração da falha, utilizador e
projeto de teste, *timestamps* (`t_setup_done`, `t_post`, `t_fault`, `t_kill`, `t_ready`,
`t_resume`, `t_commit`, …), estado das filas antes e depois, quota antes e depois, verificação
por media (nº de resultados, hash, dimensões), `results_at_commit`, métricas derivadas e um
excerto de logs filtrado (`RNF-FIAB-01`, `[COMMIT`, `[RUN-GUARD`, erros) e sanitizado (tokens,
cabeçalhos de autorização e assinaturas S3 substituídos por `<redacted>`).

`campaign.json` (um por fase) contém SHA, ramo e ficheiros alterados do repositório, versões do
podman/compose/kernel, nome e ID de cada imagem, SHA-256 da configuração Compose combinada (não
o conteúdo, que tem segredos de desenvolvimento), serviços com hooks, SHA-256 do manifesto do
corpus e `T_obs` mínimo.

## 9. Reposição do ambiente

- **Entre repetições (automático):** apaga os ficheiros de hooks, garante que `projects` e os
  workers estão a correr (e espera `READY`), regista e purga as filas do stack de ensaio, cria
  utilizador e projeto novos. Execuções diferentes nunca partilham projeto, token ou ficheiros.
- **Reposição total (manual, só com autorização):** apenas sobre o projeto de ensaio:

  ```bash
  podman compose -p picturas-fiab -f docker-compose.yaml -f tests/rnf-fiab-01/compose.fiab.yaml down -v
  ```

  Nunca usar `-p picturas`. Depois, repetir a §2.

## 10. Limitações do protocolo

- Os hooks acrescentam código ao caminho medido mesmo quando inativos (uma comparação booleana
  por ponto); a "versão original" medida é `df5d0bc` + hooks inertes.
- `restart: "no"` no ensaio; em produção a política é `on-failure`. M9 exclui o arranque do
  contentor; M10 inclui-o.
- Os *timestamps* do Node têm resolução de milissegundos e os do Python de microssegundos; o
  relógio é o mesmo (contentores no mesmo kernel).
- A deteção de consolidação usa amostragem de 20 ms no MongoDB.
- Imagens pequenas (~65 KB) tornam o lote curto (~0,7 s): a sobrecarga relativa (M11) é sensível
  a poucos milissegundos. Ver a discussão em `resultados-baseline.md`.
- Só três workers PIL são exercitados com falhas; os de IA partilham `Tools/utils` mas não são
  medidos; o watermark externo e o vídeo ficam para a regressão (Fase 4).
