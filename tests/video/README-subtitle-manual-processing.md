# B2 — Edição manual de legendas durante processamento

Correção realizada em 23/10/2026, sobre o commit de base `21e2e0e72c62f386d760ce71715d6b71facdbe4f`, ainda sem commit próprio.

## Alteração

Em `frontend/components/toolbar/video-subtitles-tool.tsx`, adicionar/remover segmentos, editar texto e tempos, guardar, descartar alterações e exportar SRT/WebVTT deixaram de ser bloqueados por uma tarefa de geração ou incorporação em curso. Mantêm-se permissões, validação das legendas e a exigência de guardar alterações antes de exportar. Os campos ficam temporariamente bloqueados enquanto o pedido de gravação está pendente, para evitar que a sua resposta apague uma alteração mais recente.

Gerar e incorporar continuam bloqueados quando este painel acompanha uma tarefa ativa. O controlo global de uma tarefa por projeto permanece no servidor, incluindo tarefas de recorte ou concatenação iniciadas por outras ferramentas. Não foram alterados API, mensagens, workers ou contabilização de quota.

A proposta automática é mantida separada da edição manual, tanto na conclusão como na recuperação de uma proposta pendente. O utilizador escolhe explicitamente substituí-la pela proposta ou manter a edição manual; aplicar uma proposta não a grava. Isto evita perder alterações feitas durante a geração. Respostas de polling de um editor já abandonado são ignoradas.

## Alinhamento consultado

- `usecases/UC-legendas.md`: RN3–RN8, RN12–RN13; proposta sujeita a revisão e gravação, sem substituição automática das legendas guardadas.
- `usecases/UC-recorte.md`: RN5; edição e exportação não são processamento.
- `usecases/UC-concat.md`: RN18; exclusão mútua por projeto permanece.
- `usecases/requisitos-1.md`: REQ-VID-LEG-019.

O comportamento alterado está alinhado com estes pontos. Não foi identificada necessidade de alterar as regras funcionais no relatório para B2. O PDF não foi editado; a equipa pode atualizar o estado de B2 e acrescentar esta validação ao catálogo da entrega. Não se declara alinhamento integral do restante sistema.

## Validação executada

Ambiente: Windows/PowerShell, Node.js v24.21.0. Foram instaladas as dependências já declaradas do frontend, sem alterar `package.json` nem criar lockfile.

Na pasta `frontend`:

```powershell
node --test test/subtitleFiles.test.cjs test/videoSubtitlesPanel.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Resultado: **13 testes aprovados, zero falhas e zero ignorados**, incluindo os quatro testes existentes de serialização e nove testes novos do painel. TypeScript terminou com código 0, sem erros. `git diff --check` também terminou sem erros.

Os testes novos executam os handlers e efeitos do componente real, transpilado, com um suporte de hooks, respostas de API e temporizadores controlados. Cobrem ações manuais enquanto há processamento, bloqueios locais de novas operações, preservação de edições gravadas e por gravar quando chega a proposta, aplicação explícita sem gravação automática, falha/cancelamento, resposta tardia após mudança de vídeo e permissões de leitura. Para recorte/concatenação, o painel não acompanha essas tarefas: os testes confirmam que as ações manuais não iniciam processamento nem dependem desse acompanhamento local. A exclusão mútua do servidor não é exercitada por estes testes.

O executor Node foi inicialmente bloqueado pelo sandbox com `spawn EPERM`; a execução fora do sandbox foi autorizada e passou. Durante o desenvolvimento dos testes foram corrigidos erros no suporte da árvore JSX e na identificação do botão cujo texto muda durante geração.

## Por verificar

O Docker Desktop não está em execução: `docker compose ps --format json` não conseguiu ligar ao engine. Não foram executados integração com MongoDB/RabbitMQ/Whisper/FFmpeg, build Next.js ou percursos reais no navegador. TypeScript e os testes controlados não substituem essas verificações.

No ambiente completo, validar pelo menos:

1. Iniciar geração por IA; editar e guardar manualmente; exportar SRT/WebVTT; confirmar que a proposta chega separada e só substitui a edição por escolha explícita.
2. Durante incorporação, editar e guardar legendas; confirmar que o vídeo produzido usa os segmentos capturados no início da incorporação e que as novas legendas ficam guardadas no original.
3. Durante recorte e concatenação, guardar/exportar legendas e tentar iniciar outro processamento; confirmar que apenas a segunda tarefa é recusada.
4. Repetir com link de edição e verificar que acesso apenas de leitura continua a impedir alterações.
