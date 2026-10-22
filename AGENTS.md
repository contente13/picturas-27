# Instruções para agentes de IA — PictuRAS

## Âmbito e responsabilidade

Este ficheiro orienta agentes de IA que apoiem o desenvolvimento do PictuRAS. A equipa continua responsável pelas decisões, alterações, documentação e validação entregues. Antes de alterar código, leia estas instruções e os documentos relevantes em `use-cases/`.

Distinga as ferramentas de IA usadas no desenvolvimento das funcionalidades de IA que fazem parte do produto, como a transcrição de legendas com Whisper.

## Contexto do projeto

O PictuRAS é uma aplicação web para edição de imagem, estendida nesta fase com suporte a vídeo. A solução é composta por serviços em Docker Compose: frontend Next.js/React/TypeScript, API Gateway, serviços `users`, `projects` e `subscriptions`, RabbitMQ, MongoDB, armazenamento S3 compatível e workers/ferramentas em Python. Consulte `README.md`, `docker-compose.yaml` e os `README.md` dos serviços antes de assumir detalhes operacionais.

A extensão de vídeo inclui quatro casos de uso: carregamento de vídeo, criação/edição/exportação de legendas (incluindo proposta automática para utilizadores Premium), recorte e concatenação. O processamento de vídeo é assíncrono e usa tarefas, RabbitMQ e FFmpeg. Os requisitos e as decisões aprovadas estão documentados em `use-cases/UC-video-upload.md`, `use-cases/UC-legendas.md`, `use-cases/UC-recorte.md`, `use-cases/UC-concat.md` e `use-cases/requisitos.md`.

## Como trabalhar

- Confirme primeiro o estado atual do código e leia os ficheiros envolvidos. O código e os documentos podem divergir; não assuma que uma especificação já está implementada.
- Preserve os serviços e padrões existentes. Evite introduzir dependências, serviços, formatos ou alterações de arquitetura sem necessidade demonstrável.
- Não introduza novas regras de negócio, permissões, limites ou comportamentos que não estejam fundamentados nos requisitos ou no código existente. Quando uma decisão funcional estiver em aberto, apresente as alternativas e solicite validação em vez de assumir uma solução.
- Limite as alterações aos ficheiros necessários para a tarefa. Evite refatorizações não solicitadas, alterações extensivas de formatação ou modificações em componentes não relacionados. Se identificar outros problemas, comunique-os separadamente.
- Mantenha as operações sobre vídeo não destrutivas: os originais não devem ser substituídos por resultados processados.
- Respeite autenticação, permissões do projeto, perfil, quota e limites da operação. Nos pedidos de processamento, tenha em conta a concorrência de tarefas por projeto e o ciclo de reserva, consumo ou devolução da quota.
- Trate cancelamento, falha e resultados tardios. Não publique resultados parciais nem associe o resultado de uma tarefa cancelada a uma tarefa posterior.
- Preserve compatibilidade entre API, frontend, workers e mensagens RabbitMQ. Quando alterar contratos de API, estruturas de dados ou mensagens RabbitMQ, identifique todos os produtores e consumidores afetados e verifique se precisam de alterações correspondentes.
- Valide entradas no servidor mesmo quando a interface também as valida.
- Mantenha nomes de ficheiros, metadados e tempos de legendas corretos, incluindo caracteres Unicode e transformações de segmentos em recortes/concatenações.
- Não exponha segredos. Não copie valores de `.env`, chaves privadas, certificados ou credenciais para código, logs, documentação ou respostas. Os certificados presentes no repositório não devem ser tratados como credenciais de produção.

## Alinhamento entre implementação e casos de uso

- Antes de implementar ou alterar uma funcionalidade, consulte os casos de uso e requisitos relevantes em `use-cases/`.
- Após cada alteração de código, verifique se o comportamento implementado continua alinhado com os casos de uso, requisitos e regras de negócio documentados.
- Considere também os casos de uso potencialmente afetados de forma indireta, especialmente quando existirem dependências entre funcionalidades ou serviços.
- Se uma alteração tornar um caso de uso incompleto, incorreto ou desatualizado, identifique explicitamente a divergência e comunique-a no resumo final.
- Não altere automaticamente os casos de uso para justificar uma implementação divergente. As alterações aos requisitos e decisões funcionais devem ser validadas pela equipa.
- Se identificar uma contradição entre o código e a documentação, não assuma automaticamente que o código representa o comportamento pretendido. Sinalize a divergência e, quando necessário, solicite esclarecimento antes de tomar decisões funcionais.
- Quando não existirem divergências, indique no resumo final que foi verificado o alinhamento com os casos de uso relevantes.
- Não declare alinhamento com documentos que não tenham sido efetivamente consultados.

## Gestão de alterações e testes

- Sempre que alterar um comportamento existente, verifique se os testes associados continuam válidos e representam o comportamento esperado.
- Adicione ou adapte testes quando necessário, incluindo cenários de erro, permissões e situações limite relevantes para a alteração.
- Não altere expectativas dos testes apenas para fazer passar uma implementação que contrarie os requisitos.
- Evite eliminar testes existentes sem justificação técnica. Quando for necessário remover ou substituir um teste, explique o motivo no resumo final.
- Se uma alteração afetar vários serviços, verifique a compatibilidade dos contratos, estruturas de dados e fluxos envolvidos.
- Não considere uma alteração concluída apenas porque os testes unitários passam. Avalie se são necessárias verificações adicionais de integração ou validação manual.

## Validação

Escolha validações existentes e proporcionais à alteração. Os testes automatizados estão principalmente em `projects/test/`, `projects/tests/`, `frontend/test/`, `users/test/` e `apiGateway/test/`; consulte `package.json` do serviço para os comandos disponíveis. Alguns cenários de integração e validação manual podem exigir serviços e dados de teste.

Para funcionalidades de vídeo, uma aprovação de teste unitário não demonstra por si só integração real com RabbitMQ, armazenamento, FFmpeg, navegador ou medição de requisitos temporais.

Registe precisamente o que foi exercitado, o ambiente usado, o resultado e o que ficou por verificar. Não afirme que verificou um comportamento sem evidência.

## Comunicação das alterações

No final de cada tarefa que envolva alterações ao código, apresente um resumo conciso com:

- **Alterações realizadas:** o que foi modificado e porquê.
- **Casos de uso e requisitos:** quais foram consultados, se a implementação continua alinhada e que divergências foram identificadas.
- **Testes e validação:** que verificações foram executadas e respetivos resultados.
- **Limitações:** o que não foi possível verificar ou ficou por resolver.
- **Documentação:** que documentos foram atualizados ou poderão necessitar de atualização.

Quando identificar divergências entre a implementação e os casos de uso, indique os ficheiros envolvidos e descreva o comportamento que deixou de corresponder à documentação.

Não declare testes, verificações ou alinhamento com requisitos que não tenham sido efetivamente analisados.