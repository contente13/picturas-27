# Entrega P1 → P2 (2) — RNF-FIAB-01

## Push

- **Ramo:** `rnf-fiab-01` (`origin/rnf-fiab-01`), com base em `df5d0bc`. Não inclui o teu
  `e6bbe1d` (`benchmarks/fault-tolerance/`), que está só no `main`.
- **Commit final:** o commit que acrescenta este ficheiro (ver `git log origin/rnf-fiab-01`). O
  código é o de `cab1b35`.
- **Alterações depois de `cab1b35`:** só documentação, **nenhuma alteração de código**.
  - `a5191e5`: `docs/rnf-fiab-01/ENTREGA-P1-FIAB.md` (1.ª entrega).
  - O commit seguinte: este ficheiro e uma errata na 1.ª entrega. Os identificadores da tabela do
    diagnóstico passam a coincidir com `diagnostico.md`: W1 (colateral), W5, P4–P7/P12 e P3, em
    vez de `W1′`, `R8b`, `P3–P6` e `P10`. **Usa os de `diagnostico.md`**; a correspondência abaixo
    já os usa.

## Revisão do diagnóstico da P2

Revisto `benchmarks/fault-tolerance/RELATORIO-RNF-FIAB-01.md` §1 (`origin/main`, `e6bbe1d`).
Os números de linha da P2 referem-se a `0523102`; no `df5d0bc` os de `projects/routes/projects.js`
mudam (por exemplo, o `Process.delete` está em `:208` e o `Process.create` do sucessor em
`:514`), porque o *upload* foi refatorado em `b8c8ba4`. O comportamento é o mesmo.

| Linha da P2 | Corresponde a (W/X/P/K) | Concordo? / correção |
|---|---|---|
| D1 `auto_ack=True` nos workers | **W1** | Concordo. **Acrescentar a perda colateral:** com `auto_ack` e *prefetch* sem limite, as mensagens já entregues ao worker morrem com ele. Na minha baseline, R1–R3 perdem o trabalho alvo e mais 4–6 imagens por repetição, e o R4 (morte depois da resposta) perde também 68/100 trabalhos só por isso. Coincide com o teu piloto ("queda do `rotate` perde 1 a 5 imagens"). |
| D2 escrita direta e mesmo ficheiro a partir da 2.ª etapa | **W2, W3** (e **K3** entre execuções) | Concordo. No R2 da baseline o ficheiro truncado não chega a ser publicado, porque o trabalho se perde antes (W1). A reaplicação foi medida no R5b (16 reaplicações e 1 resultado vazio de 0 bytes) e no R7 (44). |
| D3 erros com `messageId`/`correlationId` trocados e argumentos desalinhados | **W5** (e **X3** no watermark) | Concordo; **a hipótese confirma-se** com uma nuance. O `raise` dentro do `except` sai do *callback*: no R8b (parâmetro inválido) o worker do brightness **termina** em 10/10. No R8a (imagem inválida) o worker do border **sobrevive** em 10/10, porque o ciclo `while True: read_msg` volta a registar o consumidor, mas perde as mensagens em *buffer* (5–6 imagens válidas por repetição). Erro notificado: 0/20. A "T-07 do PL1-G4" não sei confirmar. |
| D4 `projects` confirma antes de tratar | **P1** (e **P12**) | Concordo. P12: uma exceção transitória no *callback* (por exemplo, `post_image` falha) também perde o trabalho, porque a mensagem já foi confirmada e o `Process` apagado. |
| D5 avanço de etapa não atómico | **P4, P5** (e **P6**, **P7**) | Concordo. **Acrescentar P8:** apagar o `Process` antes de gravar o resultado permite que outro trabalho conte `remaining == 0` e consolide **sem** este resultado. Medido no R6b (3 consolidações com 7–9 resultados) e no R6d (1). |
| D6 sem idempotência nas respostas | **P2** (sequenciais) e **P3** (concorrentes) | Concordo, mas só com cópias **concorrentes**. Com cópias **sequenciais** (P2), a primeira apaga o `Process` e a segunda é ignorada. É o que viste no piloto e não é defeito. Para ver P3 as cópias têm de chegar enquanto a primeira ainda está a ser tratada. O meu harness publica-as logo a seguir à resposta original (`after_reply_before_ack`, `duplicate` ×3). Resultado: R5a com 20 resultados duplicados; R5b com cadeias paralelas, 8 duplicados, 16 reaplicações e lotes pendurados. |
| D7 sem *confirms* nem persistência; Node abre uma ligação por mensagem | **W4, W6** (workers) e **P6** (`projects`) | Concordo. Âmbito: a falha do broker **não é cenário medido** (a perda do disco do broker está excluída), mas a correção cobre-a (mensagens persistentes, *confirms*, nova ligação nos dois lados). A ligação por mensagem do Node é também a principal razão de a versão corrigida ser 22 % mais rápida (M11). |
| D8 cancelamento não interrompe os workers e reutiliza caminhos | **K3** (K1 e K2 estão corretos) | Concordo; **a hipótese confirma-se**: R7 com 44/100 imagens com efeito reaplicado e o `img03` (alvo) em 10/10. |
| *(em falta)* | **P9** | Morte entre o último `Result.create` e `commitRunIfActive`: todos os resultados gravados e nunca consolidados. É o teu "P9: resultados gravados mas sem consolidação" do piloto; falta na tabela. |
| *(em falta)* | **P10** | Uma resposta de erro apaga o `Process`: o lote consolida **com resultados em falta**, sem estado "falhado". |
| *(em falta)* | **P11** | Um `Process` de *preview* com o mesmo token conta como pendente e pode atrasar ou bloquear a consolidação. |
| *(em falta)* | **K4** | O *undo* (`DELETE …/tool/:tool`) com uma execução em curso apaga os `Process` mas não incrementa `activeToken`. Medido na regressão final. |
| *(em falta)* | **W7** | Com ACK manual, um efeito longo (IA) bloqueia os *heartbeats* se correr no fio da ligação. Não é defeito da base, mas é um requisito da correção. |
| *(em falta)* | **X1–X3** | Watermark externo: reentrega com marca aplicada duas vezes (X1), segunda resposta (X2), `error.description` em vez de `error.msg` (X3). Fora do âmbito, imagem que não se pode alterar. |

## Evidências no ramo

Tudo em `docs/rnf-fiab-01/` (índice no `README.md` da pasta). O código de medição está em
`tests/rnf-fiab-01/`. Cada repetição tem um `rep-NN.json` com timestamps, a falha injetada, a
verificação por media (hashes), a quota, as filas e um excerto de logs sanitizado. Cada fase
tem um `campaign.json` (SHA, ficheiros alterados, IDs das imagens) e um `summary.json`.

- **Diagnóstico:** `docs/rnf-fiab-01/diagnostico.md` (e `fase-0-inspecao.md`).
- **Especificação e decisão:** `docs/rnf-fiab-01/especificacao-e-decisao.md` (§1–§3 definições,
  §4 métricas M1–M12, §5 alternativas A/B/C, §6 decisões D1–D8, §7 riscos, §8 exclusões).
- **Baseline:**
  - resumo: `resultados-baseline.md`;
  - dados brutos: `evidencias/baseline/` (160 repetições + `summary.json`, `campaign.json` e
    `campaign-rerun-*.json` das 3 repetições refeitas por erro do harness, com os registos
    originais em `superseded-rep-NN.json`);
  - protocolo: `protocolo-baseline.md`;
  - corpus: `evidencias/corpus-manifest.json`.
- **Campanha final:**
  - resumo: `resultados-finais.md`;
  - dados brutos: `evidencias/final/` (160 repetições + `summary.json`);
  - piloto de confirmação depois das últimas alterações: `evidencias/final-confirm-pilot/`.
- **Regressão:** `regressao-e-limitacoes.md` §1; dados em `evidencias/final-regression/`
  (`<check>.json` + `summary.json`).
- **M11 (A/B):** `resultados-finais.md` §5; dados em `evidencias/m11-baseline/` e
  `evidencias/m11-final/` (30 repetições cada, `campaign-rerun-*.json` por bloco com a imagem que
  correu). Executor: `tests/rnf-fiab-01/m11_ab.sh` + `compose.ab-baseline.yaml`.
- **Implementação e pilotos da Fase 3:** `implementacao.md`; `evidencias/phase3-pilot/`,
  `evidencias/phase3-debug-pilot/`.
- **Diagnóstico dos uploads lentos:** `evidencias/slow-debug-pilot/`.
- **Pilotos da baseline** (não contam): `evidencias/baseline-pilot/`.

## Uploads presos no img_storage

- **Quando acontece:**
  - Só em repetições em que um contentor é **morto e reiniciado** (worker ou `projects`):
    6/90 na campanha final (R1 rep 2, R3 rep 8, R4 rep 2, R6b rep 9, R6c reps 1–2) e 2/16 no
    piloto de confirmação (R2, R3). **Nunca** nas 60 repetições sem reinício (R0, R5, R7, R8).
  - O registo `[JOB-SLOW]` mostra que é `storage.upload` (`POST http://img_storage:11000/upload/…`
    feito pelo `projects`): **todos** os uploads em curso ficam parados o mesmo tempo (≈ 10 s,
    30 s ou 45 s) e terminam juntos. O MongoDB não registou operações lentas.
  - Num episódio (pilotos da Fase 3), um pedido não relacionado ao mesmo `img_storage`
    (`POST /:user/:project/img` do harness, upload de origem) ficou também parado (23,7 s) e
    terminou ao mesmo tempo que os uploads dos trabalhos. Isto indica que o bloqueio é do
    **`img_storage` ou do caminho dele até ao SeaweedFS**, e não de um *socket* do `projects`.
  - **Não reproduzi** com um teste direto: 10 rondas de 8 uploads concorrentes do `projects`
    para o `img_storage`, com `kill` + `start` de um worker a meio, todas em 15–40 ms.
- **Causa provável:** não isolada. Duas hipóteses:
  1. **O caminho de upload do `img_storage` introduzido em `b8c8ba4`:** `temporaryUpload` + S3
     `ManagedUpload` com `queueSize: 1`, e o tratamento de `aborted`/`close` em
     `utils/temporaryUpload.js` e `route/upload.js`.
  2. **A rede do podman rootless** quando contentores reiniciam (netavark/aardvark), afetando
     ligações *keep-alive* existentes entre `img_storage` e SeaweedFS.

  O DNS foi descartado: as resoluções logo após o reinício demoraram 1–2 ms.
- **Afeta a Pessoa 3?** **Possivelmente sim.**
  - Se a causa for a hipótese 1, está no caminho de upload do RNF-EFIC-01 e pode aparecer como
    cauda de latência (p99) ou como `501 Error storing image` (vi dois: o R0 rep 1 depois de um
    *rebuild*, e o `mixed` da regressão segundos depois de arrancarem workers).
  - Se for a hipótese 2, é do ambiente de ensaio e não da aplicação.
  - Sugestão para a Pessoa 3: medir também a cauda dos uploads em cenários com reinício de
    contentores e acrescentar tempos por pedido no `img_storage`. Não muda os resultados do
    RNF-FIAB-01 (o lote termina sempre correto; M9 não é afetado), só o M10.

## Pontos de injeção (se mudaram desde a 1.ª entrega)

**Nenhum mudou desde a 1.ª entrega** (o código é o de `cab1b35`). Mas revi os teus shims
(`faultshim/sitecustomize.py` e `faultshim/node/fault-shim.js` em `e6bbe1d`) contra a versão
corrigida e **há incompatibilidades**. Sem as ajustar, a medição final dá falsos "ponto não
atingido" ou mede janelas diferentes das da baseline.

### Python (`sitecustomize.py`): o estado `threading.local` perde-se

Na versão corrigida, o `on_message_callback` registado em `basic_consume` corre no **fio da
ligação** e só lança a ferramenta num **fio separado**; retorna logo. O teu `_wrap_callback`
define `_state.msg_id`/`_state.target` (`threading.local`) nesse fio e limpa-os no `finally`
quando o *callback* retorna, ou seja, imediatamente.

- `Image.Image.save` corre no fio da ferramenta: `_state` está vazio, por isso `before_write`,
  `during_write` e `after_write` **nunca disparam**.
- `basic_publish` corre de novo no fio da ligação (via `add_callback_threadsafe`), depois do
  `finally`: `before_publish`, `after_publish` e `duplicate` **também não disparam**.
- Só `after_receive` funciona. Um `hold` em `after_receive` bloqueia o fio da ligação: sem
  *heartbeats*, o broker fecha a ligação se o `hold` durar mais do que o *timeout* de *heartbeat*
  (60 s por omissão), e a mensagem é reentregue.

**Correção sugerida:** com `prefetch_count=1` cada worker tem no máximo uma mensagem em curso.
Basta trocar `threading.local()` por um objeto global e limpá-lo **na receção seguinte** (ou
quando passar por `basic_ack`), não no `finally` do *callback*. Funciona igual na base
(*callback* síncrono) e na versão corrigida.

Diferenças de semântica a registar no relatório (com o estado corrigido):

| Ponto do shim | Base (`df5d0bc`) | Versão corrigida |
| --- | --- | --- |
| `during_write` | `save` no **destino final** → ficheiro truncado com o nome final | `save` num **temporário** `<pasta>/.<nome>.<pid>.<hex>.tmp<ext>` (com `format=`) → o meio ficheiro fica só no temporário. É isto que se quer provar (W2) |
| `after_write` | Depois de gravar o destino | Depois de gravar o **temporário**, **antes** de `os.replace(tmp, final)`. Para "saída final escrita, antes da resposta" usa `before_publish` |
| `after_publish` (+ crash) | O pedido já tinha sido confirmado (`auto_ack`) | A resposta foi confirmada pelo broker, mas o **pedido ainda não**: o `basic_ack` só é feito depois de o fio da ferramenta terminar → reentrega (W4/R4) |
| `duplicate` em `before/after_publish` | Cópias com `gap_s` (sequenciais → P2, ignoradas) | Igual, mas com *confirms* cada cópia espera a confirmação. Para P3 (concorrentes) usa `gap_s = 0` |

### Node (`fault-shim.js`): dois dos três pontos já não são chamados para imagens

| Ponto do shim | Na versão corrigida | O que fazer |
| --- | --- | --- |
| `before_successor_create` (`controllers/process.js` `create` com `cur_pos ≥ 1`) | **Nunca dispara para imagens.** O avanço de passo é `transition()` em `mongoStore` (`utils/runJobs.js`). O `create` só é chamado no `POST /process` (`cur_pos = 0`) e no caminho antigo (vídeo/*preview*) | Acrescenta um *patch* para `utils/runJobs.js`: envolve o `mongoStore` exportado para envolver o `transition` do *store* devolvido, quando `update.state === "PENDING_DISPATCH"` (avanço de passo). O teu `Module._load` aplica o *patch* antes de `routes/projects.js` desestruturar o `require`, por isso funciona |
| `before_result_create` (`controllers/result.js` `create`) | **Nunca dispara para imagens.** O resultado é `upsertResult()` no mesmo `mongoStore` | Envolve `upsertResult` da mesma forma |
| `before_commit` (`controllers/project.js` `commitRunIfActive`) | **Funciona.** `runJobs` chama `Project.commitRunIfActive` através de uma função que o lê no momento da chamada | Nada |

Atenção à equivalência de janelas: na base, `before_successor_create` dispara **depois** de o
`Process` ter sido apagado (P4 → trabalho perdido). Na versão corrigida, morrer **antes** do
`transition` é morrer antes de qualquer alteração de estado: a resposta é reentregue e o passo
refaz-se. A janela "estado do passo seguinte persistido, publicação ainda não feita" (P5/P6),
que a *outbox* resolve, é **depois** do `transition` e antes da publicação: os meus R6b
(`after_process_delete`) e R6c (`before_next_publish`). Para a cobrires com o shim, envolve a
**saída** do `transition` (*crash* depois de resolver) ou `send_msg_tool` em
`utils/project_msg.js`.

## Outras notas

- **Conflito de nomes entre os dois stacks de ensaio.** O teu `fiab.py` e o meu harness usam o
  mesmo projeto Compose, **`picturas-fiab`**, e ambos têm um `compose.fiab.yaml`. Na mesma
  máquina partilhariam contentores e volumes; o primeiro `up` de um recriaria os do outro. As
  minhas portas: 127.0.0.1 25672/25673 (RabbitMQ), 37018 (Mongo), 19002 (`projects`), 20001
  (`users`). Na minha máquina, o stack `picturas-fiab` existe, parado, com os volumes da
  campanha. **Proposta:** muda o teu para, por exemplo, `picturas-fiab-p2`. Eu não apago nada
  meu sem combinarmos.
- **Os meus hooks no código são inertes por omissão.** Só ficam ativos com `RNF_FIAB_01_HOOKS=1`,
  que só o meu `compose.fiab.yaml` define. A tua medição externa por shims não é afetada (custo:
  uma comparação booleana por ponto).
- **Métricas e numeração:** de acordo com usar W/X/P/K e M1–M12. Nos resultados uso os nomes dos
  cenários R0–R8 com as variantes R5a/b/c, R6a–e e R8a/b (15 variantes + R0). Se as tuas 14
  variantes não corresponderem uma a uma, diz-me a tabela de equivalência e eu acrescento-a a
  `protocolo-baseline.md`.
- **Repetir a minha campanha a partir do commit:** a campanha final correu antes do commit
  (registo `674709b` + ficheiros alterados). O código medido é idêntico ao de `cab1b35`. Se for
  preciso para o relatório, repito-a a partir do commit.
