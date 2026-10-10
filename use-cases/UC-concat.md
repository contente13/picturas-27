# UC-VID-003 — Juntar Vários Vídeos

## 0. Identificação

| Campo | Valor |
|---|---|
| Grupo / Equipa | Grupo 1 |
| Autores | Eduardo Freitas, Francisco Contente, Luís Pires, Rui Castro |
| Data | 2026-10-06 |
| Versão do documento | v1.0 |
| Unidade Curricular | Requisitos e Arquiteturas de Software — MEI, Universidade do Minho |

## 1.3 Funcionalidade 3 — Juntar vários vídeos

| Campo | Valor |
|---|---|
| Funcionalidade | Juntar vários vídeos (video concatenation): o utilizador seleciona dois ou mais vídeos de um projeto, define a ordem dos segmentos e gera um único vídeo resultante da concatenação. |
| Perfil(s) de utilizador abrangido(s) | Registado e Premium. O utilizador registado pode utilizar a funcionalidade dentro dos limites definidos para o plano gratuito; o utilizador Premium beneficia de limites superiores e/ou ausência de limite diário. O perfil anónimo não utiliza esta funcionalidade no MVP, devido ao custo de armazenamento e processamento associado a múltiplos vídeos. |
| Justificação no contexto do MVP | A concatenação de vídeos introduz uma operação típica de edição de vídeo que não existe no processamento atual de imagens e permite validar o tratamento de múltiplos ficheiros numa única operação. A funcionalidade testa seleção, ordenação, validação de compatibilidade, processamento assíncrono e produção de um novo vídeo sem alterar os originais. Além disso, é adequada ao MVP porque entrega valor claro ao utilizador sem exigir um editor de vídeo completo: permite construir rapidamente um único vídeo a partir de vários clips. |

## 2.3 Caso de Uso 03 — Juntar vários vídeos

### 2.3.1 Cabeçalho

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-003 |
| Nome | Juntar vários vídeos |
| Versão | v1.0 |
| Autor | Eduardo Freitas |
| Data | 2026-10-06 |
| Objetivo | Permitir ao utilizador selecionar dois ou mais vídeos de um projeto, definir a ordem em que devem aparecer e gerar um único vídeo resultante da concatenação, mantendo os ficheiros originais inalterados. |
| Âmbito | PictuRAS — gestão de projetos e processamento de vídeo, incluindo seleção de vídeos, ordenação dos clips, validação de compatibilidade, processamento assíncrono, armazenamento do resultado e exportação. |
| Ator Principal | Utilizador autenticado: Registado ou Premium. |
| Stakeholders e Interesses | - Utilizador Registado: combinar vários clips de forma simples dentro dos limites do seu plano.<br>- Utilizador Premium: combinar vídeos maiores ou em maior quantidade, com menos restrições.<br>- Proprietário do sistema: controlar utilização de CPU, memória e armazenamento, diferenciando os planos.<br>- Equipa DevOps/Desenvolvimento: garantir que o processamento de múltiplos vídeos não bloqueia os restantes serviços.<br>- Administrador do sistema: assegurar proteção dos vídeos e resultados durante armazenamento e processamento. |
| Pré-condições | - O utilizador encontra-se autenticado.<br>- O projeto contém pelo menos dois vídeos carregados com sucesso.<br>- Os vídeos selecionados encontram-se disponíveis no armazenamento.<br>- O serviço de processamento de vídeo está operacional. |
| Trigger | O utilizador seleciona um ou mais vídeos do projeto e tenta acionar a opção Juntar vídeos. |

### 2.3.2 Fluxo Principal

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona um ou mais vídeos do projeto. | Valida a quantidade selecionada. Se forem pelo menos dois, disponibiliza a opção Juntar vídeos, caso contrário, segue para E1. |
| 2 | Seleciona Juntar vídeos. | Apresenta os vídeos numa lista ordenada, com miniatura, nome, duração, resolução, formato e informação de áudio. |
| 3 | Define a ordem dos vídeos por drag and drop ou pelos controlos de ordenação. | Atualiza imediatamente a sequência e calcula a duração total estimada do vídeo final. |
| 4 | Confirma a sequência escolhida. | Valida o número de vídeos, a duração total, o tamanho total e a compatibilidade técnica entre os ficheiros. |
| 5 | — | Se necessário, determina os ajustes técnicos necessários para uniformizar os vídeos antes da concatenação. |
| 6 | Aciona Gerar vídeo. | Verifica a quota e a existência de outra operação sobre os mesmos vídeos; se tudo for válido, reserva 1 operação da quota do utilizador Registado e cria uma tarefa assíncrona em fila, devolvendo o identificador da tarefa. |
| 7 | Pode aguardar ou continuar a utilizar a aplicação. | Mostra o progresso da operação e disponibiliza a opção Cancelar processamento, com atualização em ≤ 5 s. |
| 8 | — | Normaliza os vídeos quando necessário e concatena-os pela ordem definida pelo utilizador. |
| 9 | — | Valida o ficheiro produzido e guarda o resultado como um novo vídeo no projeto, sem alterar os originais. |
| 10 | Reproduz o resultado e escolhe descarregar ou continuar a utilizá-lo no projeto. | Apresenta a pré-visualização do vídeo final e disponibiliza a exportação/download. |

### 2.3.3 Fluxos Alternativos

| Fluxo | Descrição |
|---|---|
| FA1 — Alterar ordem dos vídeos | No passo 3, o utilizador reorganiza os clips. O sistema atualiza a sequência e recalcula a duração total antes da confirmação. |
| FA2 — Remover um vídeo da seleção | Antes do passo 6, o utilizador remove um dos clips. O sistema atualiza a lista e recalcula duração e tamanho estimados. Se restar apenas um vídeo, desativa a opção de concatenação. |
| FA3 — Adicionar outro vídeo | Antes do processamento, o utilizador adiciona outro vídeo do mesmo projeto. O sistema inclui-o na sequência e volta a executar as validações. |
| FA4 — Vídeos com resoluções diferentes | No passo 5, o sistema deteta resoluções distintas e informa que os clips serão normalizados para uma resolução comum baseada na menor resolução da seleção, preservando a proporção de imagem de cada clip. |
| FA5 — Vídeos com taxas de fotogramas diferentes | O sistema deteta taxas de fotogramas distintas e normaliza todos os clips para a menor taxa de fotogramas existente na seleção antes da concatenação, informando o utilizador. |
| FA6 — Vídeos com formatos/codecs diferentes | Se os formatos forem suportados mas incompatíveis entre si, o sistema converte temporariamente os clips para um formato intermédio comum antes de os concatenar. |
| FA7 — Clip sem áudio | Se alguns vídeos não tiverem áudio, o sistema permite continuar e mantém silêncio durante esses segmentos. |
| FA8 — Cancelamento do processamento | Durante os passos 7 ou 8, o utilizador escolhe Cancelar processamento. O sistema interrompe a tarefa, elimina resultados parciais, liberta a operação reservada e mantém os vídeos originais e a sequência definida. |
| FA9 — Abandono da página | Se o utilizador sair da página durante o processamento, a tarefa continua no servidor. Quando regressar, o estado da execução e o resultado são recuperados. |
| FA10 — Nova concatenação com os mesmos vídeos | Depois de concluir, o utilizador pode alterar a ordem ou remover/adicionar clips e iniciar uma nova concatenação sem ter de voltar a carregar os vídeos. |

### 2.3.4 Exceções

| Condição | Comportamento do Sistema |
|---|---|
| E1 — Menos de dois vídeos selecionados | O sistema impede a operação e informa que são necessários pelo menos dois vídeos. |
| E2 — Formato ou codec não suportado | O sistema identifica o vídeo incompatível, impede o processamento e indica quais os formatos suportados. |
| E3 — Vídeo corrompido ou inacessível | Durante a validação ou antes de iniciar a concatenação, o sistema deteta que um dos vídeos selecionados não pode ser lido, foi removido ou deixou de estar disponível. O sistema não inicia ou interrompe a operação, identifica o vídeo problemático, elimina eventuais ficheiros temporários e pede ao utilizador que o remova ou substitua. |
| E4 — Duração total excede o limite do perfil | O sistema impede a criação da tarefa e informa o utilizador do limite aplicável, sugerindo reduzir ou recortar os vídeos. |
| E5 — Tamanho total excede o limite do perfil | O sistema não inicia o processamento e informa que a seleção ultrapassa o tamanho permitido. |
| E6 — Resolução ou taxa de fotogramas impossível de normalizar | O sistema cancela a operação antes da concatenação e informa quais os vídeos incompatíveis. |
| E7 — Falha durante a conversão intermédia | O sistema termina a execução, elimina os ficheiros temporários e mantém os originais intactos. |
| E8 — Falha durante a concatenação | O resultado parcial é descartado, os vídeos originais permanecem inalterados e o utilizador pode repetir a operação. |
| E9 — Falta de espaço de armazenamento | O sistema interrompe a operação antes de consolidar o resultado e informa que não existe espaço disponível suficiente. |
| E10 — Processamento concorrente incompatível | O sistema impede uma nova execução sobre os mesmos vídeos e informa que já existe uma operação em curso. |

### 2.3.5 Pós-condições

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | Existe um novo vídeo no projeto contendo os vídeos selecionados pela ordem definida pelo utilizador. Os vídeos originais permanecem inalterados. O resultado encontra-se disponível para reprodução e exportação. |
| Garantia Mínima | Se ocorrer uma falha ou cancelamento, todos os vídeos originais permanecem intactos e utilizáveis. Qualquer resultado parcial ou ficheiro temporário é eliminado e o utilizador recebe uma mensagem explicativa. |

### 2.3.6 Regras de Negócio e Restrições

| ID | Regra |
|---|---|
| RN1 | A operação requer pelo menos dois vídeos. |
| RN2 | Apenas vídeos pertencentes ao mesmo projeto podem ser selecionados para a mesma operação de concatenação no MVP. |
| RN3 | No MVP, uma operação de concatenação pode incluir no máximo 10 vídeos para utilizadores Registados e 30 vídeos para utilizadores Premium. |
| RN4 | Para utilizadores Registados, a duração total da seleção não pode exceder 10 minutos e o tamanho agregado não pode exceder 500 MB. Para utilizadores Premium, a duração total não pode exceder 60 minutos e o tamanho agregado não pode exceder 2 GB. |
| RN5 | O sistema deve normalizar, quando necessário, os formatos, codecs de vídeo e áudio, taxas de fotogramas e parâmetros de áudio dos clips para uma configuração comum compatível com o formato de saída definido para o MVP. |
| RN6 | Quando os vídeos selecionados tiverem resoluções diferentes, o vídeo final deve utilizar como referência a resolução do clip com menor número total de píxeis. Os clips com resolução superior são redimensionados para essa resolução e nenhum clip deve sofrer upscale. |
| RN7 | Quando os clips tiverem proporções de imagem diferentes, o sistema deve preservar o aspect ratio original de cada clip, adicionando barras laterais ou superiores/inferiores quando necessário. O sistema não deve deformar nem realizar crop automático dos clips no MVP. |
| RN8 | Quando os vídeos selecionados tiverem taxas de fotogramas diferentes, o vídeo final deve utilizar a menor taxa de fotogramas entre os clips selecionados. Os clips com taxa superior são convertidos para esse valor antes da concatenação. |
| RN9 | Os vídeos originais nunca são alterados durante a concatenação. |
| RN10 | A ordem do vídeo final corresponde exatamente à ordem confirmada pelo utilizador antes do processamento. |
| RN11 | Clips sem áudio são permitidos; nesses intervalos, o resultado contém silêncio. |
| RN12 | O processamento deve ser realizado de forma assíncrona e permitir cancelamento. |
| RN13 | Ficheiros intermédios criados para normalização ou concatenação devem ser eliminados após conclusão, cancelamento ou falha. |
| RN14 | Um processamento falhado ou cancelado não deve produzir um vídeo final parcialmente válido. |
| RN15 | O resultado é armazenado como um novo vídeo do projeto e nunca substitui automaticamente os ficheiros utilizados como entrada. |
| RN16 | Cada concatenação submetida pelo utilizador reserva 1 operação da quota no momento em que o pedido é aceite; a operação só é consumida quando a tarefa termina com sucesso. Em qualquer cancelamento, falha de criação, falha de processamento, rejeição por validação ou outro desfecho sem conclusão, a reserva é libertada imediatamente e não é consumida. |

### 2.3.7 Assunções

| ID | Assunção |
|---|---|
| A1 | O carregamento de vídeos já faz parte do suporte base a vídeo do PictuRAS e este caso de uso começa com os vídeos já disponíveis no projeto. |
| A2 | O sistema terá um mecanismo de processamento assíncrono para operações de vídeo, semelhante ao utilizado atualmente nas ferramentas pesadas de imagem. |
| A3 | O MVP poderá normalizar automaticamente resolução, codec e taxa de fotogramas antes de concatenar os clips. |
| A4 | O formato de saída inicial será MP4, ficando outros formatos para evolução posterior. |
| A5 | A funcionalidade não inclui transições entre clips no MVP; a passagem de um vídeo para o seguinte é direta. |
| A6 | A concatenação não permite, neste caso de uso, recortar cada clip internamente; essa responsabilidade pertence ao caso de uso de recorte de vídeo. |
| A7 | O áudio original de cada clip é preservado, salvo quando for necessária conversão técnica para compatibilidade. |
| A8 | Não é necessário aplicar filtros ou ferramentas de imagem durante a concatenação; essas operações pertencem a outros casos de uso. |
| A9 | O pedido de concatenação deve responder em ≤ 2 s, e as atualizações de progresso devem chegar ao utilizador em ≤ 5 s, respeitando uma execução em fila ou processamento. |

### 2.3.8 Questões em Aberto

Não existem questões em aberto nesta versão do caso de uso.

---

## 4. Esboço de requisitos derivados

### 4.1 Requisitos de Sistema

| ID | Requisito | Tipo | Prioridade | Novo/Alt | Origem | Como verificar |
|---|---|---|---|---|---|---|
| REQ-VID-CONCAT-001 | O sistema deve permitir selecionar múltiplos vídeos de um mesmo projeto para uma operação de concatenação. | F | Deve ter | Novo | UC-VID-003 — Passo 1; RN1; RN2 | Dado um projeto com vídeos, quando o utilizador seleciona vários, então ficam disponíveis para a operação. |
| REQ-VID-CONCAT-002 | O sistema deve disponibilizar a operação Juntar vídeos apenas quando estiverem selecionados pelo menos dois vídeos. | F | Deve ter | Novo | UC-VID-003 — Passo 1; E1; RN1 | Dado um projeto com 1 vídeo, quando tenta iniciar a concatenação, então a opção está indisponível; com ≥2, fica disponível. |
| REQ-VID-CONCAT-003 | O sistema deve limitar cada concatenação a no máximo 10 vídeos para utilizadores Registados e 30 para Premium. | F | Deve ter | Novo | UC-VID-003 — RN3 | Dado um Registado e um Premium, quando seleccionam 10/30 vídeos respetivamente, então a operação aceita; quando excedem estes limites, é rejeitada. |
| REQ-VID-CONCAT-004 | O sistema deve permitir ao utilizador ordenar, adicionar e remover clips antes de iniciar a concatenação. | F | Deve ter | Novo | UC-VID-003 — Passo 3; FA1; FA2; FA3 | Dado uma seleção em ordem, quando o utilizador reordena ou remove clips, então a sequência apresentada é atualizada imediatamente. |
| REQ-VID-CONCAT-005 | O sistema deve calcular e apresentar a duração total da sequência selecionada. | F | Deveria ter | Novo | UC-VID-003 — Passo 3 | Dado uma sequência com 3 vídeos, quando a ordem é confirmada, então a duração total apresentada coincide com a soma das durações. |
| REQ-VID-CONCAT-006 | O sistema deve validar antes do processamento a quantidade de vídeos, a duração total, o tamanho agregado e a compatibilidade técnica dos clips. | F | Deve ter | Novo | UC-VID-003 — Passo 4; E2–E6; RN3–RN5 | Dado uma seleção válida, quando o utilizador confirma, então a operação prossegue; dado uma seleção inválida, então é rejeitada com mensagem adequada. |
| REQ-VID-CONCAT-007 | O sistema deve aplicar os limites de 10 min e 500 MB para Registados e 60 min e 2 GB para Premium. | F | Deve ter | Novo | UC-VID-003 — RN4; E4; E5 | Dado uma seleção imediatamente abaixo, no limite e acima do limite, quando submete a operação, então resulta em aceitação ou rejeição correta. |
| REQ-VID-CONCAT-008 | O sistema deve normalizar, quando necessário, formatos, codecs, parâmetros de áudio e outras características técnicas necessárias à concatenação. | F | Deve ter | Novo | UC-VID-003 — Passo 5; FA6; RN5 | Dado clips tecnicamente diferentes mas suportados, quando a concatenação inicia, então a normalização é aplicada antes do processamento. |
| REQ-VID-CONCAT-009 | Quando existirem resoluções diferentes, o sistema deve utilizar como referência a resolução do clip com menor número total de píxeis, sem efetuar upscale, preservando a proporção dos clips através de barras quando necessário. | F | Deve ter | Novo | UC-VID-003 — FA4; RN6; RN7 | Dado clips com resoluções diferentes, quando a concatenação termina, então o resultado usa a resolução de referência e mantém as proporções sem deformar ou crop. |
| REQ-VID-CONCAT-010 | Quando existirem taxas de fotogramas diferentes, o sistema deve normalizar os clips para a menor taxa de fotogramas da seleção. | F | Deve ter | Novo | UC-VID-003 — FA5; RN8 | Dado clips com FPS diferentes, quando a concatenação termina, então o resultado usa a menor taxa de fotogramas da seleção. |
| REQ-VID-CONCAT-011 | O sistema deve permitir clips sem áudio, produzindo silêncio durante esses segmentos no resultado. | F | Deveria ter | Novo | UC-VID-003 — FA7; RN11 | Dado clips sem áudio, quando o resultado é reproduzido, então o silêncio e a sequência corretos são preservados. |
| REQ-VID-CONCAT-012 | O sistema deve executar a concatenação de forma assíncrona, apresentar o progresso e permitir cancelamento durante o processamento. | F | Deve ter | Alterado | UC-VID-003 — Passos 6–8; FA8; RN12 | Dado uma tarefa ativa, quando o utilizador observa o progresso ou cancela, então o sistema responde em ≤ 5 s. |
| REQ-VID-CONCAT-013 | O vídeo resultante deve conter os clips exatamente pela ordem confirmada pelo utilizador e ser armazenado como um novo vídeo, sem modificar os ficheiros de entrada. | F | Deve ter | Novo | UC-VID-003 — Passos 8–9; RN9; RN10; RN15 | Dado clips A-B-C, quando conclui a concatenação, então o vídeo final aparece nessa ordem e os originais permanecem inalterados. |
| REQ-VID-CONCAT-014 | O sistema deve disponibilizar o vídeo resultante para pré-visualização e exportação/download. | F | Deve ter | Novo | UC-VID-003 — Passo 10; Garantia de Sucesso | Dado um vídeo resultante, quando o utilizador abre a pré-visualização, então consegue reproduzir e exportar o ficheiro. |
| REQ-VID-CONCAT-015 | O sistema deve permitir que o processamento continue quando o utilizador abandonar a página e recuperar posteriormente o estado ou resultado da execução. | F | Deveria ter | Novo | UC-VID-003 — FA9 | Dado um processamento em curso, quando o utilizador abandona a página, então ao regressar vê o estado ou o resultado recuperado. |
| REQ-VID-CONCAT-016 | Em caso de falha ou cancelamento, o sistema deve eliminar resultados parciais e ficheiros temporários, preservando todos os vídeos originais. | NF (Integridade) | Deve ter | Alterado | UC-VID-003 — E7–E9; Garantia Mínima; RN13; RN14 | Dado uma operação cancelada ou falhada, quando a execução termina, então não existem ficheiros temporários nem vídeo parcial e os originais permanecem intactos. |
| REQ-VID-CONCAT-017 | Cada concatenação aceita pelo sistema reserva 1 operação da quota do utilizador Registado; a operação apenas é consumida quando a geração termina com sucesso. Em cancelamento, falha de criação, falha de processamento, rejeição por validação ou outro desfecho sem conclusão, a reserva é libertada imediatamente e não é consumida. | F | Deve ter | Alterado | UC-VID-003 — RN16 | Dada uma operação concluída com sucesso, quando termina, então a quota diminui 1; dada uma operação cancelada ou falhada, então o saldo volta ao valor anterior. |
| REQ-VID-CONCAT-018 | O sistema deve impedir o início de uma nova concatenação quando exista uma operação incompatível em curso sobre os mesmos vídeos. | F | Deve ter | Novo | UC-VID-003 — E10 | Dada uma tarefa de concatenação em processamento sobre um conjunto de vídeos, quando o utilizador submete um segundo pedido que envolva qualquer um desses mesmos vídeos, então o novo pedido é rejeitado e o utilizador é informado da existência de uma operação em curso. |
| REQ-VID-CONCAT-019 | O sistema deve apresentar os vídeos selecionados numa lista ordenada, mostrando para cada clip a miniatura, nome, duração, resolução, formato e informação de áudio. | F | Deve ter | Novo | UC-VID-003 — Passo 2 | Dado vários vídeos selecionados, quando a lista é mostrada, então todos os metadados são apresentados corretamente. |
| REQ-VID-CONCAT-020 | O sistema deve devolver a confirmação de aceitação da operação em ≤ 2 s e apresentar atualizações de progresso em ≤ 5 s, independentemente do tamanho da seleção. | NF (Desempenho) | Deve ter | Novo | A9, Passo 6, Passo 7 | Dado uma seleção válida, quando o utilizador confirma, então a resposta é devolvida em ≤ 2 s; durante a execução, as notificações de progresso chegam em ≤ 5 s. |

### 4.2 Impacto no sistema existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Frontend / interface de projetos | Estender | Adicionar seleção múltipla de vídeos, ordenação dos clips, apresentação de metadados, duração total, progresso, cancelamento, pré-visualização e download do resultado. | REQ-VID-CONCAT-001, REQ-VID-CONCAT-002, REQ-VID-CONCAT-004, REQ-VID-CONCAT-005, REQ-VID-CONCAT-012, REQ-VID-CONCAT-014, REQ-VID-CONCAT-015, REQ-VID-CONCAT-019 |
| Serviço de gestão de projetos | Estender | Permitir associar vários vídeos a uma mesma operação, validar que pertencem ao mesmo projeto e registar o vídeo resultante como novo elemento do projeto. | REQ-VID-CONCAT-001, REQ-VID-CONCAT-006, REQ-VID-CONCAT-013 |
| Serviço de processamento de vídeo | Estender | Implementar concatenação de múltiplos vídeos, incluindo normalização de formatos, codecs, áudio, resolução e FPS. | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010, REQ-VID-CONCAT-011, REQ-VID-CONCAT-013 |
| Sistema de filas / processamento assíncrono | Estender | Suportar tarefas de concatenação assíncronas, progresso, cancelamento e continuação do processamento quando o utilizador abandona a página. | REQ-VID-CONCAT-012, REQ-VID-CONCAT-015, REQ-VID-CONCAT-020 |
| Armazenamento de ficheiros | Estender | Armazenar o novo vídeo resultante e gerir/eliminar ficheiros temporários e intermédios usados durante a normalização e concatenação. | REQ-VID-CONCAT-013, REQ-VID-CONCAT-016 |
| Sistema de quotas e perfis | Estender | Aplicar limites diferentes por perfil quanto ao número de vídeos, duração total e tamanho agregado, e contabilizar cada concatenação bem-sucedida como uma operação. | REQ-VID-CONCAT-003, REQ-VID-CONCAT-007, REQ-VID-CONCAT-017 |
| Mecanismo de validação de vídeo | Estender | Validar compatibilidade dos clips, formatos/codecs suportados, resolução, FPS, duração, tamanho e número de vídeos antes do processamento. | REQ-VID-CONCAT-006, REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010 |
| Controlo de concorrência de operações | Estender | Impedir operações incompatíveis simultâneas sobre os mesmos vídeos. | REQ-VID-CONCAT-018 |
| Mecanismos de recuperação e limpeza | Estender | Garantir que falhas e cancelamentos não deixam ficheiros parciais e não alteram os vídeos originais. | REQ-VID-CONCAT-016 |
| Funcionalidades existentes de autenticação/perfis | Manter | Reutilizar o mecanismo atual de autenticação e distinção entre Registado e Premium. | REQ-VID-CONCAT-003, REQ-VID-CONCAT-007, REQ-VID-CONCAT-017 |

### 4.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição abreviada | Requisito(s) de Sistema |
|---|---|---|
| Trigger | Selecionar vídeos e validar quantidade mínima | REQ-VID-CONCAT-001, REQ-VID-CONCAT-002 |
| Passo 2 | Apresentar lista ordenada e metadados dos vídeos | REQ-VID-CONCAT-019 |
| Passo 3 | Definir ordem e calcular duração total | REQ-VID-CONCAT-004, REQ-VID-CONCAT-005 |
| Passo 4 | Validar quantidade, duração, tamanho e compatibilidade | REQ-VID-CONCAT-003, REQ-VID-CONCAT-006, REQ-VID-CONCAT-007 |
| Passo 5 | Determinar normalizações técnicas necessárias | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010 |
| Passo 6 | Criar tarefa assíncrona de concatenação e reservar quota | REQ-VID-CONCAT-012, REQ-VID-CONCAT-017, REQ-VID-CONCAT-020 |
| Passo 7 | Apresentar progresso e permitir cancelamento | REQ-VID-CONCAT-012, REQ-VID-CONCAT-020 |
| Passo 8 | Normalizar e concatenar segundo a ordem definida | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010, REQ-VID-CONCAT-011, REQ-VID-CONCAT-013 |
| Passo 9 | Guardar resultado como novo vídeo sem alterar os originais | REQ-VID-CONCAT-013, REQ-VID-CONCAT-016 |
| Passo 10 | Pré-visualizar e exportar/download do resultado | REQ-VID-CONCAT-014 |
| FA1 | Reordenar clips antes da concatenação | REQ-VID-CONCAT-004 |
| FA2 | Remover clips e impedir concatenação com apenas um vídeo | REQ-VID-CONCAT-002, REQ-VID-CONCAT-004 |
| FA3 | Adicionar outro vídeo do mesmo projeto e voltar a validar | REQ-VID-CONCAT-001, REQ-VID-CONCAT-004, REQ-VID-CONCAT-006 |
| FA4 | Normalizar resolução preservando aspect ratio e sem upscale | REQ-VID-CONCAT-009 |
| FA5 | Normalizar para a menor taxa de fotogramas | REQ-VID-CONCAT-010 |
| FA6 | Efetuar conversão técnica intermédia quando necessário | REQ-VID-CONCAT-008 |
| FA7 | Manter silêncio durante clips sem áudio | REQ-VID-CONCAT-011 |
| FA8 | Interromper processamento e eliminar resultados parciais | REQ-VID-CONCAT-012, REQ-VID-CONCAT-016, REQ-VID-CONCAT-017 |
| FA9 | Continuar tarefa e recuperar estado posteriormente | REQ-VID-CONCAT-015 |
| FA10 | Reutilizar vídeos do projeto numa nova operação | REQ-VID-CONCAT-004, REQ-VID-CONCAT-017 |
| E1 | Impedir operação com seleção insuficiente | REQ-VID-CONCAT-002 |
| E2 | Rejeitar vídeos tecnicamente não suportados | REQ-VID-CONCAT-006 |
| E3 | Impedir ou interromper operação com vídeo indisponível | REQ-VID-CONCAT-006, REQ-VID-CONCAT-016 |
| E4 | Rejeitar seleção acima do limite de duração | REQ-VID-CONCAT-007 |
| E5 | Rejeitar seleção acima do limite de tamanho | REQ-VID-CONCAT-007 |
| E6 | Rejeitar clips que não possam ser normalizados | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010 |
| E7 | Terminar tarefa e eliminar temporários | REQ-VID-CONCAT-016, REQ-VID-CONCAT-017 |
| E8 | Descartar resultado parcial e preservar originais | REQ-VID-CONCAT-016, REQ-VID-CONCAT-017 |
| E9 | Interromper sem produzir resultado parcial válido | REQ-VID-CONCAT-016, REQ-VID-CONCAT-017 |
| E10 | Impedir operação incompatível sobre os mesmos vídeos | REQ-VID-CONCAT-018 |
| RN1 | Requer pelo menos 2 vídeos | REQ-VID-CONCAT-001, REQ-VID-CONCAT-002 |
| RN2 | Vídeos do mesmo projeto | REQ-VID-CONCAT-001 |
| RN3 | Limites por número de vídeos | REQ-VID-CONCAT-003 |
| RN4 | Limites por duração e tamanho | REQ-VID-CONCAT-007 |
| RN5 | Normalização técnica | REQ-VID-CONCAT-008 |
| RN6 | Resolução de referência | REQ-VID-CONCAT-009 |
| RN7 | Preservação do aspect ratio | REQ-VID-CONCAT-009 |
| RN8 | Menor taxa de fotogramas | REQ-VID-CONCAT-010 |
| RN9 | Original inalterado | REQ-VID-CONCAT-013, REQ-VID-CONCAT-016 |
| RN10 | Ordem do resultado | REQ-VID-CONCAT-013 |
| RN11 | Silêncio em vídeos sem áudio | REQ-VID-CONCAT-011 |
| RN12 | Processamento assíncrono e cancelamento | REQ-VID-CONCAT-012 |
| RN13 | Limpeza de intermediários | REQ-VID-CONCAT-016 |
| RN14 | Sem resultado parcial válido | REQ-VID-CONCAT-016 |
| RN15 | Novo vídeo no projeto | REQ-VID-CONCAT-013 |
| RN16 | Reserva atómica e libertação imediata da quota | REQ-VID-CONCAT-017 |
| Garantia de Sucesso | Novo vídeo criado, originais intactos e resultado disponível | REQ-VID-CONCAT-013, REQ-VID-CONCAT-014, REQ-VID-CONCAT-017 |
| Garantia Mínima | Preservar originais e limpar ficheiros parciais em falha/cancelamento | REQ-VID-CONCAT-016, REQ-VID-CONCAT-017 |