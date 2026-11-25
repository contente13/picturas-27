# RNF-FIAB-01 — Tolerância a falhas de workers de imagem

> **Requisito.** Preservar e recuperar automaticamente trabalhos de processamento de imagens
> interrompidos pela falha de um worker, garantindo a conclusão dos trabalhos recuperáveis sem
> publicar resultados duplicados.

**Estado: cumprido.** A versão original perde trabalhos, duplica e reaplica efeitos em todos os
cenários com falha. A versão corrigida (no `main` desde `5d084ce`) conclui 100 % dos lotes
recuperáveis, sem perdas, duplicados ou reaplicações, retoma em milissegundos e não tem
sobrecarga sem falhas. Resumo e tabela antes/depois em
[resultados-finais.md](resultados-finais.md). A avaliação independente da Pessoa 2 está em
[`benchmarks/fault-tolerance/RELATORIO-RNF-FIAB-01.md`](../../benchmarks/fault-tolerance/RELATORIO-RNF-FIAB-01.md).

## Documentos

| Ficheiro | Conteúdo |
| --- | --- |
| [diagnostico.md](diagnostico.md) | Ciclo de mensagens da versão original e janelas de perda/duplicação (W, X, P, K), confirmação na baseline e correspondência com o diagnóstico da Pessoa 2 |
| [especificacao-e-decisao.md](especificacao-e-decisao.md) | Definições, critérios de aceitação e métricas M1–M12, alternativas e decisões de desenho D1–D8 |
| [protocolo-baseline.md](protocolo-baseline.md) | Stack de ensaio, corpus, hooks, cenários R0–R8, métricas e reprodução |
| [resultados-baseline.md](resultados-baseline.md) | Medições da versão original |
| [implementacao.md](implementacao.md) | Alterações por incremento e testes |
| [resultados-finais.md](resultados-finais.md) | Medições da versão corrigida, critérios, verificação da versão integrada e correções ao consumidor do `projects` |
| [regressao-e-limitacoes.md](regressao-e-limitacoes.md) | Regressão (cancelamento, quotas, projetos mistos, vídeo, outros workers), limitações e riscos |

## Evidências

| Pasta em `evidencias/` | Conteúdo |
| --- | --- |
| `corpus-manifest.json` | Manifesto do corpus (nomes, tamanhos, SHA-256) |
| `baseline/`, `final/` | Campanhas da versão original e da corrigida (160 execuções cada) |
| `m11-baseline/`, `m11-final/` | Comparação A/B de M11 na mesma sessão |
| `final-regression/` | Verificações de regressão |
| `integrado-6d19557/` | Verificação da versão integrada com o *harness* da Pessoa 2 |
| `consumidor-projects/` | Reprodução das correções ao consumidor do `projects` |
| `baseline-pilot/`, `phase3-pilot/`, `phase3-debug-pilot/`, `slow-debug-pilot/`, `m11-warmup-pilot/`, `final-confirm-pilot/` | Pilotos e diagnósticos; não contam para as campanhas |

Regras: sem media, modelos ou segredos (o corpus é gerado por script e só o manifesto é
versionado); logs sanitizados; cada execução regista versão, imagens, *runtime*, cenário, falha
injetada e métricas ([protocolo-baseline.md](protocolo-baseline.md) §8); execuções falhadas
contam no denominador.

O histórico dos commits do ramo `rnf-fiab-01` está nas tags `rnf-fiab-01-verificacao` e
`rnf-fiab-01-consumidor`.

## Reprodução

[protocolo-baseline.md](protocolo-baseline.md) §2 e §7 (stack `picturas-fiab` e harness em
`tests/rnf-fiab-01/`). O *harness* da Pessoa 2 está em `benchmarks/fault-tolerance/`.
