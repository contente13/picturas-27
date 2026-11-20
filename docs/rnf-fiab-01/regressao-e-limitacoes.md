# RNF-FIAB-01 — Regressão, limitações e riscos (Fase 4)

## 1. Regressão

Script: [`tests/rnf-fiab-01/regression.py`](../../tests/rnf-fiab-01/regression.py), executado
contra o stack isolado com o worker de vídeo e mais cinco workers de imagem (`contrast`,
`saturation`, `resize`, `binarization`, `cut`), todos construídos da árvore de trabalho. Os
resultados estão em [`evidencias/final-regression/`](evidencias/final-regression/), um ficheiro
por verificação e `summary.json`.

| Verificação | O que preserva | Resultado |
| --- | --- | --- |
| `mixed` | Projeto misto (2 imagens + 1 vídeo MOV), pipeline border → brightness: as imagens seguem o caminho novo e o vídeo o caminho antigo; uma única consolidação depois de ambos; imagens com o hash de referência; vídeo exportado; quota cobrada uma vez (2 efeitos de vídeo = 2 operações) | PASS (quota +2) |
| `cancel` | Cancelamento a meio (projeto misto) e nova execução: o token cancelado não deixa resultados nem consolida; a nova execução consolida com os 4 resultados; uma cobrança por `POST /process` | PASS (+1, +1) |
| `workers` | Cinco outros workers de imagem, que partilham `Tools/utils`, executam uma cadeia completa (3 imagens, 5 efeitos) com um resultado por imagem e as dimensões esperadas (240×190) | PASS |
| `undo` | *Undo* com uma execução em curso (D7/K4): a execução não consolida nem deixa resultados | PASS depois da correção abaixo |
| `video` | Projeto só com vídeo (caminho antigo): consolida com um resultado de vídeo | PASS |
| `frames` | Extração de frames (barreiras do caminho antigo) num projeto misto: 3 frames + 1 imagem | PASS |
| `preview` | *Preview* de uma imagem (caminho antigo, ACK depois do tratamento) chega ao último passo | PASS |

**Defeito encontrado e corrigido.** Na primeira execução, `undo` falhou: a execução invalidada
não consolidava, mas os 2 resultados que já tinha guardado ficavam na base de dados. Não eram
visíveis (só os resultados do token consolidado são servidos), mas o cancelamento apaga-os e o
*undo* não. O *undo* passou a apagar também os resultados do token que invalida (objetos e
documentos). Depois disso, as 7 verificações passaram numa execução completa.

Na primeira execução, `mixed` falhou também com `501 Error storing image` do `img_storage` ao
carregar uma imagem de origem, segundos depois de os workers extra arrancarem; passou nas
execuções seguintes. É o mesmo componente da anomalia descrita em
[resultados-finais.md](resultados-finais.md) §4.

**Testes automáticos.** `projects/tests/*.test.js` 36/36, incluindo os testes já existentes de
vídeo, upload de media, extração de frames e lotes. `tests/rnf-fiab-01` 17/17. Os testes do
worker de vídeo no host (`Tools/video/tests`) não foram executados: o código do vídeo não foi
alterado e o worker passou nas verificações `mixed`, `video` e `frames`.

### Contratos e comportamento preservados

- HTTP: sem alterações de rotas, códigos ou corpos.
- RabbitMQ: mesmas filas, *bindings* e formato JSON. Mudam apenas os valores de `messageId` e
  dos caminhos nos pedidos de imagem, e o `correlationId` das respostas de erro, que passa a
  ser o correto.
- Originais: nunca alterados (M5 = 0 em 160 execuções).
- Quotas: a cobrança continua apenas em `POST /process`; nenhum caminho de recuperação a
  reinvoca (M6 = 0; regressão `mixed`/`cancel`). O cancelamento continua a devolver só operações
  de IA, como antes; efeitos de vídeo cobrados não são devolvidos (comportamento pré-existente).
- Projetos mistos, vídeo, extração de frames e *previews*: regressão acima.

## 2. Limitações

| Limitação | Efeito | Registo |
| --- | --- | --- |
| Uma única réplica do `projects` | A reconciliação e as transições assumem uma instância (como hoje); várias instâncias seriam seguras para as transições (comparar-e-trocar), mas republicariam passos `PENDING_DISPATCH` em duplicado (inofensivo: pedido idempotente) | [implementacao.md](implementacao.md) §11 |
| Previews, vídeos e extração de frames continuam no modelo antigo | Beneficiam do ACK depois do tratamento e da consolidação única, mas um `projects` que morre a meio do tratamento de uma resposta de vídeo pode deixar essa execução pendurada | Exclusão aceite na especificação §8 (vídeo e previews só em regressão) |
| Watermark externo | Sem *confirms* nem limite de entregas (imagem pré-construída); as saídas por passo e o tratamento idempotente protegem os resultados, mas uma falha do worker deixa o lote por consolidar: trabalhos com watermark não são recuperáveis | especificação §7–§8 |
| Imagens de projetos com `extract_frames` | Seguem o caminho antigo; não são trabalhos recuperáveis | especificação §6, §8 |
| Erros do efeito no worker | Qualquer exceção do efeito (incluindo E/S ou rede numa ferramenta de IA) termina o trabalho como `FAILED` | especificação §2 |
| Objetos órfãos no armazenamento | Se o `projects` morrer entre carregar o resultado e criar o `Result`, o objeto fica órfão (não publicado) | — |
| Registo de tentativas e pastas `runs/` | Não há limpeza automática além do que `POST /process` remove | Ocupação pequena (1 byte por entrega) |
| Medições numa única máquina, podman rootless | Tempos absolutos não transferíveis; `restart: "no"` no ensaio (M9 exclui o arranque do contentor) | protocolo §10 |
| M6 com ferramentas não cobradas | border/brightness/rotate não descontam quota; a não-recobrança foi verificada na regressão com efeitos de vídeo | §1 |
| Workers de imagem e fila apagada | `Tools/utils` declara a sua fila mas não faz `queue_bind`, e o tratamento de um cancelamento do consumidor pelo broker (fila apagada) no pika não foi verificado. Se a fila de um worker for apagada com o broker a correr, o *binding* só volta com o próximo arranque do broker (`definitions.json`). O `projects` e o `video_tool` já repõem o *binding* | [resultados-finais.md](resultados-finais.md) §9 |
| Correções ao consumidor do `projects` (§9 dos resultados) | Não medidas pela campanha (nenhum cenário R0–R8 passa por esse código); verificadas por testes automáticos e por reprodução com o RabbitMQ real | [resultados-finais.md](resultados-finais.md) §9 |
| Alterações depois da campanha | Registo `[JOB-SLOW]` e limpeza no *undo* (rota que R0–R8 não usam); confirmadas por um piloto de todos os cenários e pela regressão | [resultados-finais.md](resultados-finais.md) §7 |

## 3. Riscos e recomendações

1. **Uploads presos no `img_storage`** ([resultados-finais.md](resultados-finais.md) §4): 10–45
   s em algumas repetições com reinício de contentores. Não compromete o requisito (o lote
   termina sempre), mas atrasa a conclusão. Recomenda-se investigar o caminho de upload do
   `img_storage` (alterado recentemente por outro requisito) e a rede do podman rootless, por
   exemplo com tempos por pedido no `img_storage` e um *timeout* no cliente do `projects`. O
   registo `[JOB-SLOW]` ajuda a localizar casos em produção.
2. **Aplicar o modelo de trabalhos a vídeos e *previews*** se passarem a fazer parte do âmbito:
   o `video_tool` já confirma no fim; faltaria o documento de trabalho com estado no `projects`.
3. **Monitorizar** `[JOB-FAILED]`, `[JOB-DUPLICATE]`, `[RECONCILE]` e `[JOB-SLOW]`: medem
   erros permanentes, entregas repetidas, recuperações e lentidão.
4. **Versionar** as alterações da Fase 3 e repetir a campanha a partir do commit, se for preciso
   que o SHA registado identifique exatamente o código medido (hoje fica registado `674709b`
   mais a lista de ficheiros alterados).
