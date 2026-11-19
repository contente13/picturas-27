# RNF-FIAB-01 — Resultados da baseline (versão original)

Fase 2. Medições da versão original (`df5d0bc` + hooks inertes) com o protocolo de
[protocolo-baseline.md](protocolo-baseline.md). Métricas e critérios:
[especificacao-e-decisao.md](especificacao-e-decisao.md) §4. Dados brutos:
[`evidencias/baseline/`](evidencias/baseline/) (`campaign.json`, `<cenário>/rep-NN.json`,
`summary.json`).

**Conclusão: a versão original não cumpre o RNF-FIAB-01.** Nenhum cenário com falha de worker
ou de `projects` (R1–R4, R6) termina com o lote consolidado e correto. Há resultados duplicados
(R5a/b), reaplicações (R5b, R7), consolidações prematuras (R6b, R6d) e erros permanentes que
nunca chegam ao utilizador (R8). Não há retoma automática em nenhuma repetição. Os originais e as
quotas nunca foram afetados.

## 1. Identificação da campanha

| Campo | Valor |
| --- | --- |
| Commit / ramo | `df5d0bc2a53b` / `main`, com os ficheiros de hooks e de ensaio por versionar (lista em `campaign.json`) |
| Runtime | podman 4.9.3 rootless, Docker Compose v5.1.1 como provider de `podman compose`, kernel 7.0.0-43, 18 CPUs |
| Stack | Projeto `picturas-fiab` (`compose.fiab.yaml`), IDs das imagens em `campaign.json` |
| Corpus | 10 PNG 640×480 + 1 ficheiro não-imagem, seed 20261114, Pillow 13.0.0, manifesto [`corpus-manifest.json`](evidencias/corpus-manifest.json) |
| Pipeline | border 12 px (200,30,30) → brightness 1,4 → rotate 90° (referência 504×664) |
| Execução | R0: 2026-11-14 21:22 UTC; R1–R8b: 21:28 → 2026-11-15 00:56 UTC; re-execuções de *harness errors*: 01:08 UTC |
| Repetições | 10 por variante, 160 execuções medidas |
| `T_obs` | 120 s (mediana R0 = 0,677 s, `10 × mediana` < 120 s) |

## 2. Resultados por cenário

`Lotes OK`: execução consolidada **e** todos os trabalhos com hash de píxeis igual à referência
**e** sem duplicados (critério de M1 por execução). `Corretos`: trabalhos com exatamente um
resultado correto, entre todos os trabalhos do lote (não só o trabalho alvo da falha).

| Cenário | Falha injetada (ponto) | Consolidados | Lotes OK | Corretos | Perdidos (M2) | Duplicados (M3) | Reaplicados (M4) | Prematuros (M8) | Retoma (M9) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R0 | — | 10/10 | 10/10 | 100/100 | 0 | 0 | 0 | 0 | — |
| R1 | kill brightness, `after_receive` | 0/10 | 0/10 | 42/100 | 58 | 0 | 0 | 0 | nunca |
| R2 | kill brightness, `during_write` | 0/10 | 0/10 | 37/100 | 63 | 0 | 0 | 0 | nunca |
| R3 | kill brightness, `after_output_before_reply` | 0/10 | 0/10 | 42/100 | 58 | 0 | 0 | 0 | nunca |
| R4 | kill brightness, `after_reply_before_ack` | 0/10 | 0/10 | 32/100 | 68 | 0 | 0 | 0 | nunca |
| R5a | 3 cópias da resposta do rotate (passo final) | 10/10 | 0/10 | 100/100 | 0 | **20** | 0 | 0 | — |
| R5b | 3 cópias da resposta do border (passo intermédio) | 5/10 | 0/10 | 80/100 | 11 | **8** | **16** (+1 vazio) | 0 | — |
| R5c | resposta repetida depois da consolidação | 10/10 | 10/10 | 100/100 | 0 | 0 | 0 | 0 | — |
| R6a | kill projects, `after_receive` | 0/10 | 0/10 | 56/100 | 44 | 0 | 0 | 0 | nunca |
| R6b | kill projects, `after_process_delete` (passo 1) | 3/10 | 0/10 | 69/100 | 31 | 0 | 0 | **3** | nunca |
| R6c | kill projects, `before_next_publish` (passo 1) | 0/10 | 0/10 | 64/100 | 36 | 0 | 0 | 0 | nunca |
| R6d | kill projects, `after_result_persist` (passo 2) | 8/10 | 7/10 | 97/100 | 3 | 0 | 0 | **1** | nunca |
| R6e | kill projects, `before_commit` | 0/10 | 0/10 | 100/100 | 0 | 0 | 0 | 0 | nunca |
| R7 | resposta antiga após cancelar e iniciar nova execução | 10/10 | 0/10 | 56/100 | 0 | 0 | **44** | 0 | — |
| R8a | media inválida no lote (11 media) | 0/10 | — | 43/100 válidos | 56 válidos (+10 inválidos) | 0 | 0 | 0 | — |
| R8b | parâmetro inválido no brightness | 0/10 | — | 0/100 | 100 | 0 | 0 | 0 | — |

Em todos os cenários: **originais alterados (M5) = 0** e **cobranças adicionais (M6) = 0**.
Nenhuma repetição registou o ponto de falha por atingir (`fault_not_reached = 0`).

### Leitura por cenário

- **R0.** Mediana 0,677 s (Q1 0,656; Q3 0,687; mín. 0,643; máx. 0,699), IQR = 4,6 % da mediana.
- **R1–R3.** O trabalho alvo (`img03`) perde-se nas 10 repetições: o pedido foi confirmado ao broker
  na entrega (W1, `auto_ack`) e nunca é reentregue. Perdem-se também, em média, 4–5 trabalhos
  **de outras imagens**: as mensagens que o worker já tinha recebido em *prefetch* (também
  confirmadas na entrega) morrem com ele. O lote fica pendurado com `Process` pendentes.
- **R4.** O trabalho alvo conclui nas 10 repetições (a resposta já tinha sido publicada), mas o lote
  nunca consolida pela mesma perda colateral do *prefetch*. No piloto R4 consolidou porque, nessa
  repetição, o worker não tinha mensagens em *buffer*: o resultado depende da ordem de chegada.
- **R5a.** Cada cópia extra da resposta final cria um `Result` (sem índice único, P10): 2 duplicados
  por repetição, todos com o hash correto.
- **R5b.** Cada cópia da resposta intermédia lança uma cadeia paralela sobre o mesmo ficheiro
  `out/<nome>` (in-place): aparecem resultados em 504×664 e 664×504 (rotação aplicada mais vezes ou
  sobre um ficheiro a meio de outra escrita), 5 lotes pendurados e, em R5b rep 7, um `Result`
  publicado que aponta para um objeto **vazio** (0 bytes nas duas leituras: não é um problema da
  inspeção). Nenhum lote fica correto.
- **R5c.** Uma cópia tardia de uma resposta já consolidada é ignorada (guarda do token, sem `Process`).
- **R6a–c.** Morrer o `projects` durante o tratamento de uma resposta perde-a (o amqplib confirma
  antes do *callback* assíncrono, P1) e, com ela, as respostas em *prefetch*. Em R6b o `Process` do
  `img03` já tinha sido apagado: o contador `remaining` chega a 0 sem esse trabalho e o lote é
  **consolidado com 7–9 resultados** em 3 repetições (P8).
- **R6d.** Com o `Result` do `img03` já gravado, 8/10 lotes consolidam; 1 deles prematuramente (9
  resultados no instante da consolidação) e 2 ficam pendurados.
- **R6e.** Os 10 resultados estão gravados e corretos, mas a consolidação nunca acontece (P9): não
  existe reconciliação no arranque.
- **R7.** A tentativa da execução cancelada, ao ser libertada, escreve no mesmo `out/<nome>` que a
  execução nova (in-place) e a resposta antiga avança a cadeia: em média 4,4 imagens por lote ficam
  com o efeito reaplicado, incluindo o `img03` nas 10 repetições (M7 violada). Nenhum `Result`
  ficou registado com o token antigo nesta campanha (no piloto ficou 1).
- **R8a.** O worker do border sobrevive à imagem inválida (10/10), mas o erro
  nunca chega ao utilizador (`error_notified = false`) e o lote nunca consolida. A re-subscrição
  do consumidor depois do erro perde as mensagens em *buffer*: perdem-se, além da imagem inválida,
  em média 5–6 trabalhos válidos. Sem ciclo de reentrega (`max_deliveries_per_msg = 1`).
- **R8b.** O worker do brightness termina na primeira mensagem com parâmetro inválido (10/10),
  nenhum trabalho conclui e o erro nunca é notificado.

## 3. Situação face aos critérios

| Métrica | Meta (mínimo) | Baseline | Cumpre |
| --- | --- | --- | --- |
| M1 Recuperáveis concluídos corretamente | 100 % | 7 de 90 lotes (R1–R4, R6), 7,8 % | Não |
| M2 Trabalhos perdidos | 0 | 361 em R1–R4 e R6 | Não |
| M3 Duplicados publicados | 0 | 28 (R5a 20, R5b 8) | Não |
| M4 Reaplicações | 0 | 60 (R5b 16, R7 44) + 1 resultado vazio (R5b) | Não |
| M5 Originais alterados | 0 | 0 | Sim |
| M6 Cobranças adicionais | 0 | 0 | Sim (as ferramentas do ensaio não são cobradas; ver §5) |
| M7 Sobrescrita por tentativa antiga | 0 | 10/10 repetições de R7 | Não |
| M8 Consolidação prematura | 0 | 4 (R6b 3, R6d 1) | Não |
| M9 Tempo de retoma | ≤ 5 s (≤ 15 s) | Não há retoma | Não |
| M10 Tempo até à conclusão | reportado | Não há conclusão em R1–R4, R6a–c, R6e | — |
| M11 Sobrecarga sem falhas | ≤ 5 % (≤ 10 %) | Referência: 0,677 s | Base de comparação |
| M12 Fim controlado de erro permanente | 100 % | 0/20 notificados; R8b mata o worker | Não |

## 4. Ajustes de métricas e justificação

1. **M1/M2 contam todos os trabalhos do lote**, não apenas o trabalho alvo da falha. As perdas
   colaterais (mensagens em *prefetch* de um processo morto) são consequência direta da falha
   injetada e o requisito pede a conclusão de todos os trabalhos recuperáveis.
2. **Nova classe "ilegível" na verificação.** Um resultado cujo objeto não pôde ser lido ou
   descodificado no instante da verificação era contado como reaplicação (M4). Passa a ser contado
   à parte (`verify.unreadable`), e a inspeção relê esses objetos uma vez, 2 s depois, registando
   as duas tentativas. Na baseline afetou um único resultado (R8a rep 2, `img01`): relido depois
   da campanha, o objeto estava íntegro e com o hash de referência, pelo que o sumário o
   reclassifica a partir do detalhe por media (dimensões nulas = sem píxeis). O total de M4 em R8a
   passa de 1 para 0; esse trabalho continua contado como não correto (lado conservador).
3. **Erros do harness voltam a ser executados, uma única vez.** Três repetições falharam por erro
   da própria ferramenta de medição, não do sistema: R5b reps 4 e 7 (`TypeError` ao ordenar
   dimensões quando havia um objeto ilegível) e R8a rep 1 (`podman exec` da inspeção terminado com
   137). Foram corrigidos os dois defeitos, a inspeção passou a ter uma nova tentativa, e as três
   repetições foram re-executadas com `--only-reps` (resultados: R5b rep 4 pendurado com 7/10,
  rep 7 consolidado com 2 duplicados, 2 reaplicações e o resultado vazio; R8a rep 1 com 3/10
  válidos, sem consolidação), coerentes com as restantes repetições. O harness só aceita re-executar registos com
   `harness_error`; os registos originais ficam como `superseded-rep-NN.json` e são contados em
   `superseded_harness_errors`.
4. **M9/M10 não são mensuráveis na baseline**: o trabalho interrompido nunca é retomado. Ficam
   registados como "nunca" e servem apenas de comparação qualitativa.
5. **Sensibilidade de M11.** 5 % da mediana R0 são 34 ms; o IQR da baseline (31 ms) é da mesma ordem.
   Para que a comparação na Fase 4 não dependa de variação da máquina, propõe-se medir R0 da versão
   final **e repetir R0 da versão original na mesma sessão**, com 30 repetições cada, e comparar
   medianas (com o intervalo Q1–Q3). A baseline atual fica como referência histórica. Este ajuste
   precisa de confirmação antes da Fase 4.

## 5. Testes automáticos (2026-11-15)

| Suite | Onde | Resultado |
| --- | --- | --- |
| `tests/rnf-fiab-01` (hooks Python + caracterização da versão original) | host, `.venv/bin/python -m pytest -q` | 9/9 |
| `projects/tests/fault-hooks.test.js` | host, node 18.19.1 | 3/3 |
| `projects/tests/*.test.js` (suite completa do orquestrador, incl. hooks) | contentor `picturas-fiab-projects-1`, `node --test tests/*.test.js` | 21/21 |

Os testes de caracterização fixam o comportamento defeituoso atual (`auto_ack`, resposta sem
propriedades, erro posicional, `correlationId` trocado) e serão invertidos na Fase 3.

## 6. Limitações e incidentes

- **Ferramentas não cobradas.** border, brightness e rotate não descontam quota (só ferramentas de
  IA e efeitos de vídeo). M6 = 0 é verdadeiro mas pouco exigente aqui; a não-recobrança na
  recuperação é verificada na Fase 3 por testes do `projects` (a recuperação nunca chama o
  endpoint de quota).
- **`restart: "no"`** no ensaio: a retoma depende do harness reiniciar o contentor (ver protocolo §10).
- **`ws_gateway` não faz parte do stack de ensaio.** `error_notified` é inferido dos logs do
  `projects` (tratamento de uma resposta de erro, que é o que gera a notificação na `ws_queue`),
  não da entrega ao browser.
- **`campaign.json` reescrito.** A re-execução parcial de 01:08 UTC sobrescreveu `campaign.json`
  (mesmo commit, mesmos ficheiros alterados, mesmas imagens: nada foi reconstruído entre as
  duas). O `campaign.json` atual foi reconstruído a partir dessa cópia, com a hora original de
  início e uma nota a explicá-lo; cada re-execução tem o seu `campaign-rerun-*.json`. O harness já não reescreve `campaign.json` em re-execuções.
- **Stack `picturas` do utilizador parado durante a campanha.** Às 21:42:18 UTC de 2026-11-14 o
  utilizador parou deliberadamente o projeto `picturas` para libertar recursos (o harness só atua
  sobre `picturas-fiab`). O *stop* ocorreu durante R1 rep 10; de R2 em diante as repetições
  correram com menos carga na máquina do que R0 e R1. Não afeta as contagens; para tempos, R0 (a única referência
  temporal usada) foi medido com o stack `picturas` ligado, o que reforça a proposta de repetir R0
  da versão original na mesma sessão da Fase 4 (§4, ponto 5).
- Resultados válidos para uma única máquina; tempos absolutos não são transferíveis.
