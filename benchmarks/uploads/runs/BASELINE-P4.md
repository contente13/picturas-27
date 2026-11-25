# Baseline P4 — RNF-EFIC-01

Campanha: `baseline-e3f5e6`. Commit original: `052310226c51fa57a17101c7bd1ad795674aac95`. Protocolo 4.

**50/50 tentativas oficiais concluídas.** Pilotos não estão incluídos.
Cada tentativa é mantida; falhas não são substituídas. Valores de memória/tempo abaixo incluem
apenas ensaios elegíveis com upload íntegro, amostragem válida, serviços estáveis e limpeza confirmada.
As falhas HTTP e janelas inválidas permanecem nas contagens.

| Cenário | Tentativas concluídas | Elegíveis para memória | HTTP | Mediana pico adicional RSS (MiB) | Min–max (MiB) | Mediana conclusão de todos os pedidos (s) |
| --- | ---: | ---: | --- | ---: | --- | ---: |
| small | 10/10 | 10 | {'204': 10} | 369.38 | 367.87–373.72 | 0.687 |
| large | 10/10 | 10 | {'204': 10} | 6333.24 | 5923.66–6336.91 | 9.574 |
| image | 10/10 | 10 | {'204': 10} | 38.73 | 35.35–41.77 | 0.161 |
| concurrent_small | 10/10 | 10 | {'204': 30} | 977.84 | 731.86–1032.20 | 1.477 |
| concurrent | 10/10 | 0 | {'504': 30} | — | — | — |

RSS agregado é soma de RSS de processos dos três serviços, incluindo FFprobe;
não equivale a memória física única nem a toda a stack. Não calcular percentagens usando
pedidos falhados ou amostragens inválidas. Medidas individuais, dispersão/IQR e desfechos
estão em `BASELINE-STATUS.json`, `baseline-trials.csv` e nos dados brutos de cada ensaio.

A meta adicional definida é concluir 3 × 900 MiB sem timeout na versão refatorada,
com integridade e as mesmas condições/recursos/timeouts. A aplicação não foi refatorada
pelo P4. A condição comum `concurrent_small` foi confirmada pelo utilizador.

## Campanha concluída e auditoria

Foram executadas exatamente dez tentativas em cada um dos cinco cenários: 50 ensaios,
90 pedidos, 60 respostas 204 com integridade verificada e 30 respostas 504. Pilotos não
estão incluídos. Os quatro cenários bem-sucedidos têm dez janelas válidas cada; as dez
janelas do concorrente grande falharam a qualidade e não têm referência numérica aceite.
Todos os serviços medidos permaneceram estáveis dentro das respetivas janelas, sem
reinícios ou flags OOM registados, usando as mesmas imagens originais.

A tentativa `small-09` foi revista após uma verificação prematura da remoção de um
observador. O resultado original não foi substituído; `review.json` confirma ausência
e limpeza, identifica o hash do original e autoriza a elegibilidade. A retoma começou
em `small-10`, sem repetir pedidos. Snapshots e hashes dos dois scripts estão na campanha;
a revisão só alterou espera pela remoção e controlo de retoma, sem mudar a medição.
Houve seis timeouts de comandos de paragem de helpers durante o bloco grande; foram
recuperados sem perder resultados e todos os helpers foram removidos.

A auditoria global encontrou 12 objetos sob projetos já removidos, nas tentativas
concorrentes grandes 4, 7, 9 e 10 (três por tentativa). As verificações imediatas tinham
reportado zero para esses prefixos. Isto é evidência de persistência/visibilidade tardia;
a causa exata não foi isolada. A condição de armazenamento limpo entre falhas grandes
não ficou garantida, o que limita a interpretação desse bloco. Os quatro blocos usados
na comparação numérica precederam essas falhas. O relatório não esconde esta limitação.

Foram preservadas as chaves, tamanhos e HEADs, interrompidas operações tardias após o fim
da campanha e removidas apenas as 12 chaves efetivamente descobertas nos projetos P4.
A auditoria posterior confirmou zero projetos e zero objetos P4. Nenhum destes passos
altera os resultados brutos ou constitui uma correção da aplicação.

Evidência: `post-baseline-audit.json` (antes), `baseline-late-objects.json`,
`late-object-cleanup.json` e `post-baseline-final-audit.json` (depois).
O protocolo deve incluir auditoria global fora das janelas e verificar
quiescência; não confiar apenas no check imediato após um HTTP 504.

Os tempos das 30 respostas 504 tiveram mediana de 73.103 s (intervalo 66.388–74.799 s). São tempos de resposta de erro, não tempos de uploads concluídos e não suportam comparação de desempenho com sucessos.
