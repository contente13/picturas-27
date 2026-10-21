# 4.3. UC-VID-002 - Recortar vídeo
## 4.3.1. Cabeçalho

**Tabela 21: Caso de uso UC-VID-002 - Recortar vídeo**

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-002 |
| Nome | Recortar vídeo |
| Versão | v1.2 |
| Autor | Francisco Contente |
| Data | 2026-10-05 |
| Objetivo | Permitir ao utilizador delimitar um intervalo temporal (início e fim) de um vídeo do projeto ativo, gerando um novo vídeo apenas com esse intervalo, sem alterar o original. |
| Âmbito  | PictuRAS - módulo de processamento de vídeo, gestão de quotas por perfil e lista de vídeos do projeto ativo. |
| Ator Principal  | Utilizador autenticado: Registado (gratuito) ou Premium. |
| Stakeholders e Interesses  | Utilizador Registado: encurtar vídeos para partilha rápida, dentro da quota gratuita. Utilizador Premium: recortar vídeos mais longos, sem limite diário. Proprietário do sistema: proteger os recursos de computação com limites por perfil e incentivar a subscrição Premium. Equipa DevOps/Arquitetura: garantir processamento desacoplado da interface web, sem esgotar CPU ou memória do servidor web. |
| Pré-condições  | O utilizador tem sessão iniciada com perfil Registado ou Premium; o vídeo de origem encontra-se no projeto ativo e disponível no armazenamento, tendo sido carregado com validação de RN2 ou gerado no projeto por outra operação concluída; o vídeo tem formato suportado (RN6); o serviço de processamento de vídeo está disponível. |
| Trigger  | O utilizador seleciona um vídeo do projeto ativo e aciona a opção «Recortar vídeo». |

## 4.3.2. Fluxo Principal

**Tabela 22: UC-VID-002 - Fluxo principal**

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona o vídeo pretendido no projeto ativo e aciona «Recortar vídeo». | Mantém o leitor central existente como único leitor visível e apresenta o painel de recorte diretamente por baixo dele, com duração, resolução e formato. Gera no cliente uma filmstrip com 8 a 12 fotogramas. Para o perfil Registado, apresenta também as operações diárias restantes. Pré-preenche T_in = 0 e T_out = duração total como ponto de partida (este intervalo ainda não é válido para submissão, RN3). |
| 2 | Define T_in e T_out arrastando as pegas da moldura de recorte na filmstrip, usando os marcadores de posição atual ou introduzindo os valores em segundos, com uma casa decimal. | Sincroniza os campos, a seleção visual, o indicador de reprodução e o leitor central. |
| 3 | Aciona «Aplicar recorte». | - |
| 4 | - | Valida o pedido pela seguinte ordem: (a) intervalo temporal (RN3); (b) duração do recorte face ao limite do perfil (RN1); (c) inexistência de outra operação de processamento de vídeo ativa no mesmo projeto, independentemente da ferramenta (RN5), não considerando operações do mesmo utilizador noutros projetos; (d) quota diária, no perfil Registado (RN4). Se tudo for válido, reserva uma operação da quota para o perfil Registado. |
| 5 | - | Cria uma tarefa de processamento assíncrona no estado Em Fila e devolve o identificador da tarefa ao utilizador. |
| 6 | - | Enquanto a tarefa está Em Fila ou Em Processamento, apresenta no painel, sem abrir janelas, o estado, a percentagem de progresso (quando em processamento) e a opção «Cancelar Processamento». O utilizador pode aguardar ou continuar a usar a aplicação. |
| 7 | - | Quando a tarefa começa a ser executada, passa a Em Processamento e processa o vídeo, gerando um novo vídeo com o intervalo pedido, no mesmo formato, codecs, resolução e taxa de fotogramas do original. |
| 8 | - | Ao concluir, marca a tarefa como Concluída, consome a operação reservada (perfil Registado) e adiciona o novo vídeo ao projeto, com pré-visualização. |

## 4.3.3. Fluxos Alternativos

**Tabela 23: UC-VID-002 - Fluxos alternativos**

| Fluxo | Descrição |
|---|---|
| FA1 - Cancelamento do processamento | Durante os passos 6 ou 7, o utilizador aciona «Cancelar Processamento». O sistema interrompe a tarefa, elimina quaisquer resultados parciais, liberta a operação reservada (a quota não é consumida), marca a tarefa como Cancelada e devolve o utilizador ao passo 2, com o vídeo e o intervalo anteriores mantidos. |
| FA2 - Utilizador abandona a página durante o processamento | Se, no passo 6, o utilizador fecha o separador ou termina a sessão, a tarefa continua no servidor. Ao concluir, o resultado fica no projeto e o utilizador é notificado no próximo acesso à aplicação. |

## 4.3.4. Exceções

**Tabela 24: UC-VID-002 - Exceções**

| Condição | Comportamento do Sistema |
|---|---|
| E1 - Intervalo temporal inválido (passo 4a) | Se T_in ≥ T_out, os valores estiverem fora da duração do vídeo, não forem múltiplos de 0,1 s, o intervalo for inferior a 1 s ou corresponder à duração total do vídeo, o sistema bloqueia a submissão, destaca o campo inválido e indica a regra violada. O utilizador mantém-se no passo 2. |
| E2 - Duração do recorte acima do limite do perfil (passo 4b) | Rejeita o pedido e indica o limite do perfil. O utilizador mantém-se no passo 2. |
| E3 - Quota diária esgotada (passo 4d) | Quando as cinco operações diárias do utilizador Registado estão consumidas ou reservadas, não cria a tarefa e informa que a quota se encontra esgotada e quando será reposta. |
| E4 - Outra operação de vídeo ativa no projeto (passo 4c) | Se já existir uma operação de processamento de vídeo Em Fila ou Em Processamento no mesmo projeto, independentemente da ferramenta, o sistema não cria a tarefa nem reserva quota. Informa qual a operação em curso e que é necessário aguardar a sua conclusão ou cancelá-la. Operações do mesmo utilizador noutros projetos não originam esta exceção. |
| E5 - Falha na criação ou no processamento da tarefa (passos 5 e 7) | Se a tarefa não puder ser criada, não a regista. Se o vídeo for ilegível, corrompido, possuir codec não suportado ou ocorrer um erro interno durante o processamento, marca a tarefa criada como Falhada. Em ambos os casos, assegura que nenhum resultado parcial fica disponível no projeto, liberta a operação reservada e informa o utilizador do motivo. |
| E6 - Tempo máximo de processamento excedido (passo 7) | Se a execução ultrapassar o limite do perfil (RN8), termina a tarefa como Falhada, assegura que nenhum resultado parcial fica disponível no projeto, liberta a operação reservada e informa o utilizador, sugerindo um recorte mais curto. O tempo em fila não conta; uma execução exatamente igual ao limite é válida. |

## 4.3.5. Pós-condições

**Tabela 25: UC-VID-002 - Pós-condições**

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | Existe, no projeto, um novo vídeo, com o nome do original acrescido do sufixo _recorte, com duração igual a T_out − T_in (±1 fotograma), no mesmo formato, codecs, resolução e taxa de fotogramas do original, disponível para pré-visualização. O vídeo original e as suas legendas permanecem intactos. Quando existirem legendas editáveis, o novo vídeo contém uma cópia independente dos segmentos aplicáveis, com tempos ajustados segundo RN7. Para o perfil Registado, a quota diária é consumida em exatamente uma operação. |
| Garantia Mínima | Em caso de rejeição, falha, cancelamento ou tempo excedido, o vídeo original permanece inalterado; nenhum ficheiro parcial ou corrompido fica disponível no projeto; a quota diária não é consumida (qualquer operação reservada é libertada); o estado final da tarefa (Falhada ou Cancelada), ou o motivo da rejeição do pedido, é apresentado ao utilizador. |

## 4.3.6. Regras de Negócio e Restrições

**Tabela 26: UC-VID-002 - Regras de Negócio e Restrições**

| ID | Regra |
|---|---|
| RN1 | Limites por perfil (duração do recorte). Registado: ≤ 60 s e máximo de 5 operações por dia. Premium: ≤ 600 s e sem limite diário. Anónimo: sem acesso. |
| RN2 | Limites de carregamento de vídeos externos. Registado: ≤ 200 MB e ≤ 10 min. Premium: ≤ 2 GB e ≤ 60 min. Estes limites aplicam-se apenas ao carregamento e não são reaplicados a vídeos gerados no projeto por recorte, concatenação ou incorporação de legendas. Esses vídeos podem servir de origem ao recorte, sujeitos aos formatos de RN6 e aos limites da operação (RN1, RN3 e RN8). |
| RN3 | Intervalo temporal: 0 ≤ T_in < T_out ≤ duração do vídeo; intervalo mínimo de 1 s; o intervalo não pode corresponder à duração total do vídeo (T_out − T_in < duração do vídeo); os instantes devem ser múltiplos de 0,1 s, sendo rejeitados valores com outra precisão. |
| RN4 | Quota (perfil Registado). Cada recorte conta como uma operação. A operação é reservada ao aceitar o pedido (passo 4), consumida apenas quando a tarefa termina com sucesso e libertada em qualquer outro desfecho (cancelamento, falha na criação ou no processamento, tempo excedido). A verificação considera operações consumidas e reservadas, incluindo as de outras ferramentas do PictuRAS, e é feita antes de criar a tarefa. A verificação e a reserva são atómicas: operações concorrentes não podem ultrapassar as cinco operações diárias. As operações restantes são sempre visíveis ao utilizador. |
| RN5 | Uma operação de vídeo ativa por projeto (RNG-11). Cada projeto pode ter, no máximo, uma operação de processamento de vídeo Em Fila ou Em Processamento, independentemente da ferramenta (recorte, geração ou incorporação de legendas, concatenação), em conformidade com UC-VID-001/RN7 e UC-VID-003/RN18. O mesmo utilizador pode ter operações ativas em projetos diferentes; ficam em fila e a execução efetiva depende da disponibilidade dos workers, e a quota diária continua a ser por utilizador (RN4). O carregamento de vídeos, a edição de legendas e a exportação SRT/WebVTT não são operações de processamento e não são bloqueados. A verificação e a criação da tarefa são atómicas, e o bloqueio é libertado quando a tarefa termina, falha ou é cancelada. |
| RN6 | Formatos. Entrada aceite: MP4 (H.264/AAC) e WebM (VP8/Vorbis). O resultado mantém o formato, os codecs, a resolução e a taxa de fotogramas do original. A pista de áudio, se existir, é recortada em sincronia com o vídeo. |
| RN7 | Não destrutividade. O vídeo original nunca é alterado nem substituído; cada recorte gera um novo vídeo no projeto, com o nome do original acrescido do sufixo _recorte (por exemplo, ferias.mp4 passa a ferias_recorte.mp4; se o nome já existir, acrescenta-se um número sequencial, como ferias_recorte_2.mp4). Se existirem legendas editáveis, cada segmento [início, fim] que intersecte o recorte é copiado com início_novo = max(início, T_in) − T_in e fim_novo = min(fim, T_out) − T_in. Segmentos com duração resultante inferior a 0,5 s são descartados. As cópias são independentes, cumprem UC-VID-001/RN4 e não alteram as legendas originais. |
| RN8 | Tempo máximo de processamento. Registado: 120 s. Premium: 900 s. Contados desde a transição da tarefa para Em Processamento até ao fim do processo (conclusão, falha ou cancelamento). O tempo em fila não conta. |
| RN9 | Privacidade. O vídeo original e os resultados gerados são acessíveis ao proprietário do projeto ou a quem tenha um link de partilha válido, e protegidos por encriptação em trânsito e em repouso. O acesso por link não dispensa a autenticação e o perfil exigidos para executar a ferramenta. |

## 4.3.7. Assunções

**Tabela 27: UC-VID-002 - Assunções**

| ID | Assunção |
|---|---|
| A1 | O perfil Anónimo não tem acesso às funcionalidades de vídeo. |
| A2 | O vídeo original já está disponível no projeto e no armazenamento de objetos, por carregamento validado segundo RN2 ou por uma operação anterior concluída com sucesso. Não é eliminado durante a edição ou o processamento do recorte. |
| A3 | O utilizador usa um navegador moderno com reprodução de vídeo HTML5. |
| A4 | O PictuRAS já dispõe de uma arquitetura assíncrona por workers, que este caso de uso reutiliza e estende. Os workers atuais não executam subprocessos de vídeo (por exemplo, FFmpeg) nem gerem a monitorização, o cancelamento ou a limpeza de processos em execução; esse mecanismo constitui trabalho novo. |
| A5 | O recorte utiliza sempre recodificação, garantindo precisão temporal de ±1 fotograma. |
| A6 | O PictuRAS já dispõe de autenticação, perfis e quota diária partilhada entre ferramentas, com reposição à meia-noite (Europe/Lisbon); este caso de uso reutiliza esses mecanismos (UC-VID-003/RN16). |
| A7 | Assume-se que o projeto permite exportar os vídeos nele existentes, funcionalidade fornecida pelo caso de uso de carregamento e gestão de vídeo e fora do âmbito deste; o recorte não acrescenta funcionalidade de exportação. |
| A8 | O utilizador possui espaço de armazenamento suficiente para guardar o novo vídeo; a gestão de quotas de disco não é tratada neste caso de uso. |
| A9 | Os limites numéricos (RN1, RN2 e RN8), a confirmação do pedido em ≤ 2 s, o atraso máximo de 5 s na apresentação do progresso e o prazo de 5 s para terminar o processamento de uma tarefa cancelada ou excedida são valores de partida adequados ao MVP, sujeitos a validação (Q7). |

## 4.3.8. Questões em Aberto

**Tabela 28: UC-VID-002 - Questões em Aberto**

| ID | Questão | Resolução |
|---|---|---|
| Q1 | O recorte deve poder ser encadeado com outras ferramentas e aplicado em lote (.zip/diretoria)? | Adiada para evolução posterior. No MVP, o recorte é aplicado individualmente, podendo o resultado ser reutilizado manualmente noutras ferramentas. O encadeamento automático e o processamento em lote (.zip/diretoria) ficam fora do âmbito, por acrescentarem complexidade de configuração, gestão de quotas e tratamento de falhas, sem serem necessários para cumprir o objetivo principal do recorte. |
| Q2 | Devem ser suportados mais formatos de vídeo? | Âmbito do MVP definido: apenas MP4 (H.264/AAC) e WebM (VP8/Vorbis), conforme RN6. O suporte de formatos adicionais fica por decidir. |
| Q3 | Em fases futuras, o perfil Premium deve ter prioridade de escalonamento na fila face ao perfil Registado? | Adiada. A prioridade de escalonamento não faz parte do MVP, conforme a descrição da funcionalidade no documento original. |
| Q4 | O utilizador Anónimo deve ter um acesso de demonstração (por exemplo, 10 s e marca de água)? | Decidido: sem acesso. O servidor só aceita recorte para perfis free e premium, recusando os restantes com HTTP 403. Não existe demonstração de 10 s nem marca de água. A possibilidade de a introduzir numa evolução futura continua em aberto. |
| Q5 | Os vídeos resultantes ficam guardados até o utilizador os apagar ou expiram após um prazo? | Decidido: os vídeos resultantes permanecem guardados até à eliminação do ficheiro ou do projeto pelo utilizador. Falta formalizar este comportamento como política de retenção nos requisitos. |
| Q6 | A conclusão do processamento deve gerar uma notificação (na aplicação ou por e-mail), em vez de apenas atualizar o estado da tarefa? | Decidido (v1.2): a conclusão do processamento é comunicada ao utilizador no próximo acesso à aplicação, conforme FA2. Não são enviadas notificações por e-mail no MVP. |
| Q7 | O tempo máximo do perfil Premium (900 s) é suficiente para recodificar um recorte de 600 s? | Pendente de validação experimental. O valor de 900 s está definido em RN8, mas a sua adequação depende de testes de processamento. |
| Q8 | Deve o recorte também admitir acesso por link de partilha, previsto para legendas em UC-VID-001/RN10, ou manter acesso exclusivo do proprietário? | Decidido (v1.2): o recorte admite acesso por link de partilha válido. Um link de edição permite executar o recorte, utilizando o perfil e a quota do proprietário do projeto; um link de leitura permite apenas visualizar os vídeos, não iniciar operações de recorte (RN9; UC-VID-001/Q1). |

### 4.2 Impacto no sistema existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Controlo de quotas diárias (5 operações/dia) | Alterar | A contagem passa a ter reserva prévia no pedido, atómica com a verificação, consumo no sucesso e libertação nos restantes desfechos, partilhada com as outras ferramentas. | REQ-VID-TRIM-007, REQ-VID-TRIM-008, REQ-VID-TRIM-012 |
| Perfis de utilização (anónimo, registado, premium) | Estender | Passam a ter limites de duração de recorte e de quota; o anónimo fica sem acesso e o Premium sem limite diário. | REQ-VID-TRIM-004, REQ-VID-TRIM-005, REQ-VID-TRIM-007, REQ-VID-TRIM-012 |
| Arquitetura assíncrona por workers (tarefas, estado, progresso e cancelamento) | Estender | A noção de tarefa, estado, progresso e cancelamento passa a aplicar-se a vídeo, com no máximo uma tarefa ativa de vídeo por projeto, independentemente da ferramenta. Os workers têm de lançar, acompanhar, interromper e limpar o processamento de vídeo (p. ex., FFmpeg), gerar o resultado e aplicar o tempo máximo por perfil. | REQ-VID-TRIM-006, REQ-VID-TRIM-009, REQ-VID-TRIM-010, REQ-VID-TRIM-011, REQ-VID-TRIM-012, REQ-VID-TRIM-013, REQ-VID-QUAL-001, REQ-VID-QUAL-004, REQ-VID-QUAL-005, REQ-VID-QUAL-009, REQ-VID-QUAL-012 |
| Projeto do utilizador e armazenamento de objetos (SeaweedFS) | Estender | Passa a conter os vídeos resultantes e cópias independentes das legendas ajustadas ao recorte, mantendo os originais intactos e removendo temporários e resultados parciais. | REQ-VID-TRIM-011, REQ-VID-TRIM-015, REQ-VID-COMMON-001, REQ-VID-QUAL-001, REQ-VID-QUAL-008 |
| Interface de edição | Estender | Novo editor de recorte com leitor, linha temporal e validação de campos. | REQ-VID-TRIM-001, REQ-VID-TRIM-002, REQ-VID-TRIM-003 |
| Segurança e privacidade | Estender | Acesso pelo proprietário ou por link de partilha válido e encriptação aplicados aos vídeos originais e derivados. | REQ-VID-TRIM-005, REQ-VID-QUAL-002, REQ-VID-QUAL-003 |
| Validação inicial de vídeo | Estender | Aplicar limites individuais apenas ao carregamento externo, permitindo reutilizar vídeos gerados no projeto sem os reaplicar; manter as validações próprias do recorte. | REQ-VID-TRIM-013, REQ-VID-TRIM-014 |

### 4.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição abreviada | Requisito(s) de Sistema |
|---|---|---|
| Trigger / Passo 1 | Selecionar vídeo do projeto ativo e abrir editor | REQ-VID-TRIM-001 |
| Passo 2 | Definição de `T_in` e `T_out` | REQ-VID-TRIM-002 |
| Passo 3 | Acionar Aplicar recorte | (Ação exclusiva do ator; conduz ao passo 4) |
| Passo 4 | Validação do pedido e reserva da quota | REQ-VID-TRIM-003, REQ-VID-TRIM-004, REQ-VID-TRIM-006, REQ-VID-TRIM-007, REQ-VID-TRIM-008 |
| Passo 5 | Criação da tarefa assíncrona | REQ-VID-TRIM-009, REQ-VID-COMMON-002, REQ-VID-QUAL-004 |
| Passo 6 | Estado, progresso e cancelamento | REQ-VID-TRIM-009, REQ-VID-TRIM-010, REQ-VID-COMMON-002, REQ-VID-QUAL-005, REQ-VID-QUAL-012 |
| Passo 7 | Geração do vídeo | REQ-VID-TRIM-013, REQ-VID-QUAL-006, REQ-VID-QUAL-007 |
| Passo 8 | Conclusão, biblioteca do projeto, quota e legendas herdadas | REQ-VID-TRIM-011, REQ-VID-TRIM-012, REQ-VID-TRIM-015, REQ-VID-COMMON-001, REQ-VID-QUAL-008 |
| FA1 | Cancelamento (Em Fila ou Em Processamento) | REQ-VID-TRIM-010, REQ-VID-TRIM-012, REQ-VID-COMMON-003, REQ-VID-QUAL-001, REQ-VID-QUAL-012 |
| FA2 | Abandono da página | REQ-VID-TRIM-009, REQ-VID-COMMON-002 |
| E1 | Intervalo inválido | REQ-VID-TRIM-003 |
| E2 | Duração acima do limite do perfil | REQ-VID-TRIM-004 |
| E3 | Quota esgotada | REQ-VID-TRIM-007, REQ-VID-TRIM-008 |
| E4 | Tarefa ativa existente | REQ-VID-TRIM-006 |
| E5 | Falha na criação ou no processamento | REQ-VID-TRIM-012, REQ-VID-TRIM-013, REQ-VID-COMMON-003, REQ-VID-QUAL-001 |
| E6 | Tempo excedido | REQ-VID-TRIM-012, REQ-VID-COMMON-003, REQ-VID-QUAL-001, REQ-VID-QUAL-009 |
| RN1 | Limites por perfil | REQ-VID-TRIM-004, REQ-VID-TRIM-005, REQ-VID-TRIM-007, REQ-VID-TRIM-008, REQ-VID-TRIM-012 |
| RN2 | Limites exclusivos do carregamento e reutilização de vídeos gerados | REQ-VID-TRIM-014 |
| RN3 | Intervalo temporal | REQ-VID-TRIM-002, REQ-VID-TRIM-003 |
| RN4 | Quota (reserva atómica, consumo e libertação) | REQ-VID-TRIM-007, REQ-VID-TRIM-008, REQ-VID-TRIM-012 |
| RN5 | Uma tarefa ativa de vídeo por projeto | REQ-VID-TRIM-006 |
| RN6 | Formatos e características | REQ-VID-TRIM-013, REQ-VID-QUAL-006, REQ-VID-QUAL-007 |
| RN7 | Não destrutividade e cópia independente das legendas | REQ-VID-TRIM-011, REQ-VID-TRIM-015, REQ-VID-COMMON-001, REQ-VID-QUAL-008 |
| RN8 | Tempo máximo por perfil | REQ-VID-QUAL-009 |
| RN9 | Acesso restrito e encriptação | REQ-VID-TRIM-005, REQ-VID-QUAL-002, REQ-VID-QUAL-003 |
| Garantia de Sucesso | Novo vídeo íntegro e quota consumida | REQ-VID-TRIM-011, REQ-VID-TRIM-012, REQ-VID-TRIM-015, REQ-VID-COMMON-001, REQ-VID-QUAL-006, REQ-VID-QUAL-007, REQ-VID-QUAL-008 |
| Garantia Mínima | Original intacto, sem parciais, quota libertada, motivo visível | REQ-VID-TRIM-003, REQ-VID-TRIM-004, REQ-VID-TRIM-006, REQ-VID-TRIM-007, REQ-VID-TRIM-008, REQ-VID-TRIM-010, REQ-VID-TRIM-012, REQ-VID-TRIM-013, REQ-VID-COMMON-003, REQ-VID-QUAL-001, REQ-VID-QUAL-009, REQ-VID-QUAL-012 |
