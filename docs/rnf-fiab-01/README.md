# RNF-FIAB-01 — Tolerância a falhas de workers de imagem

> **Requisito.** Preservar e recuperar automaticamente trabalhos de processamento de imagens
> interrompidos pela falha de um worker, garantindo a conclusão dos trabalhos recuperáveis sem
> publicar resultados duplicados.

Esta pasta reúne toda a análise, especificação, protocolo, resultados e evidências do trabalho
sobre o requisito `RNF-FIAB-01`. A resposta no chat nunca é a única fonte: tudo o que conta está
aqui.

## Estado por fase

| Fase | Conteúdo                                              | Estado                          |
| ---- | ----------------------------------------------------- | ------------------------------- |
| 0    | Inspeção, ambiente e plano                            | Concluída e aprovada            |
| 1    | Diagnóstico do fluxo e especificação verificável      | Concluída e aprovada            |
| 2    | Testes de falha, hooks, corpus e baseline             | Concluída e aprovada            |
| 3    | Implementação incremental                             | Concluída e aprovada            |
| 4    | Validação final, regressão e relatório                | Concluída — aguarda confirmação |

## Índice

| Ficheiro                                                     | Fase | Conteúdo                                                                 |
| ------------------------------------------------------------ | ---- | ------------------------------------------------------------------------ |
| [fase-0-inspecao.md](fase-0-inspecao.md)                     | 0    | Inventário do código, ambiente real, achados preliminares, plano         |
| [diagnostico.md](diagnostico.md)                             | 1    | Ciclo completo de mensagens e todas as janelas de perda/duplicação       |
| [especificacao-e-decisao.md](especificacao-e-decisao.md)     | 1    | Definições formais, critérios de aceitação, alternativas e decisão       |
| [protocolo-baseline.md](protocolo-baseline.md)               | 2    | Corpus, hooks, cenários R0–R8, métricas, repetições, reposição           |
| [resultados-baseline.md](resultados-baseline.md)             | 2    | Medições da versão original                                              |
| [implementacao.md](implementacao.md)                         | 3    | Alterações técnicas por incremento e respetivos testes                   |
| [resultados-finais.md](resultados-finais.md)                 | 4    | Mesmo protocolo após implementação, tabela antes/depois                  |
| [regressao-e-limitacoes.md](regressao-e-limitacoes.md)       | 4    | Regressão (cancelamento, quotas, mistos, vídeo, outros workers), riscos  |
| `evidencias/`                                                | 2–4  | Manifestos SHA-256, contagens, estados persistidos, logs sanitizados     |

`implementacao.md`
foi acrescentado à estrutura sugerida para não misturar decisões (Fase 1) com o registo das
alterações (Fase 3).

## Regras de evidência

- Sem media grande, modelos ou segredos em `evidencias/`. O corpus de imagens é **gerado** por
  script determinístico; só o manifesto (nomes, tamanhos, SHA-256) é versionado.
- Logs sanitizados: sem JWT, cabeçalhos `Authorization`, palavras-passe ou URLs assinados.
- Cada execução regista SHA/ramo, imagens e versões do runtime, configuração sanitizada,
  fixtures e hashes, cenário, repetição, timestamps, falha injetada, métricas, resultado e
  limitações (ver [protocolo-baseline.md](protocolo-baseline.md) §8).
- Execuções falhadas permanecem no denominador.

## Reprodução

As instruções completas de reprodução estão em [protocolo-baseline.md](protocolo-baseline.md)
(Fase 2) e são revistas na Fase 4. Notas de ambiente relevantes já identificadas estão em
[fase-0-inspecao.md § Ambiente](fase-0-inspecao.md#2-ambiente-de-execução-verificado).
