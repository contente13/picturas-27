# Avaliação final P4 — RNF-EFIC-01

A campanha `final-80de1e` pode ser reproduzida a partir do commit `c7e597a2674a74f6fc0f225145e74260ff23a61e` no `main`.

**50/50 tentativas concluídas.** Pilotos não incluídos.

| Cenário | Tentativas | Sucessos íntegros | Memórias elegíveis | Mediana RSS adicional (MiB) | Redução RSS | Mediana resposta com sucesso (s) | Variação de tempo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| small | 10/10 | 10 | 10 | 122.67 | 66.79% | 0.731 | +6.38% |
| large | 10/10 | 10 | 10 | 180.98 | 97.14% | 7.851 | -17.99% |
| image | 10/10 | 10 | 10 | 39.56 | -2.15% | 0.158 | -1.98% |
| concurrent_small | 10/10 | 10 | 10 | 135.94 | 86.10% | 1.284 | -13.04% |
| concurrent | 10/10 | 10 | 8 | 221.06 | — | 24.513 | — |

RSS inclui processos-filho, não apenas heap; não equivale a RAM física única. Janelas inválidas e pedidos falhados não suportam reduções de memória. Tempos de pedidos falhados não são tempos de uploads concluídos. As amostras de tempo de sucessos são apresentadas independentemente da validade das janelas RSS.

No concorrente grande: 10/10 trios íntegros, 8 janelas RSS elegíveis; respostas HTTP {'204': 30}. Não existe baseline de memória elegível para calcular redução percentual neste cenário.

Critérios: redução mínima de memória de 50% (alvo 70%); aumento máximo de tempo de 15% (alvo de não aumentar), na condição de três vídeos pequenos. Decisão calculada: {'common_memory_minimum_met': True, 'common_memory_target_met': True, 'common_time_minimum_met': True, 'common_time_target_met': True, 'large_concurrent_all_successful': True}. Valores nulos significam que a série necessária ainda não terminou.
