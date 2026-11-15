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
