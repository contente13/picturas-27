# UC-VID-001 — Legendas Automáticas com Revisão

## 0. Identificação

| Campo | Valor |
|---|---|
| Grupo / Equipa | Grupo 1 |
| Autores | Eduardo Freitas, Francisco Contente, Luís Pires, Rui Castro |
| Data | 2026-10-06 |
| Versão do documento | v1.0 |
| Unidade Curricular | Requisitos e Arquiteturas de Software — MEI, Universidade do Minho |

## 1.1 Funcionalidade 1 — Legendas Automáticas com Revisão

| Campo | Valor |
|---|---|
| Funcionalidade | Legendas automáticas com revisão (IA): transcrição da fala de um vídeo, edição das legendas pelo utilizador e exportação (ficheiro de legendas ou legendas incorporadas no vídeo). |
| Perfil(s) de utilizador abrangidos | Premium (ator principal), porque é uma ferramenta de IA e o PictuRAS reserva as ferramentas avançadas de IA a este plano, tal como o Assistente IA (UC06). O utilizador registado (gratuito) e o anónimo não executam a funcionalidade: o registado vê o aviso de que é exclusiva do plano Premium com sugestão de upgrade, e o anónimo é convidado a registar-se. |
| Justificação no contexto do MVP | As legendas automáticas são das funcionalidades de vídeo com maior valor percebido (acessibilidade, redes sociais, vídeos sem som) e justificam por si só a subscrição Premium. Para o MVP, validam o que as ferramentas de imagem nunca testaram: a IA aplicada ao áudio de um vídeo, um processamento longo e cancelável, e um fluxo com revisão humana (gerar, rever, corrigir, exportar). Sem ela, ficaria por validar se a arquitetura atual de ferramentas de IA, pensada para operações curtas sobre imagens, suporta tarefas demoradas, resultados editáveis e dependência de um serviço de IA externo. |

## 2.1 Caso de Uso 01 — Gerar, Rever e Exportar Legendas Automáticas de um Vídeo

### 2.1.1 Cabeçalho

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-001 |
| Nome | Gerar, rever e exportar legendas automáticas de um vídeo |
| Versão | v1.0 |
| Autor | Luís Pires |
| Data | 2026-10-06 |
| Objetivo | O utilizador obtém legendas sincronizadas com a fala de um vídeo do seu projeto, gera-as automaticamente, corrige-as no editor e exporta-as como ficheiro de legendas ou incorporadas no vídeo. |
| Âmbito | Módulos de edição e projetos do PictuRAS: frontend (reprodutor, editor de legendas), API Gateway, Project Service (pipeline, execuções e dados do projeto), nova ferramenta de IA de transcrição (microserviço consumidor de RabbitMQ), nova ferramenta de incorporação de legendas no vídeo, armazenamento (SeaweedFS / Image Storage), WebSocket Gateway (progresso), serviço de utilizadores e subscrições (perfil) e serviço de IA de transcrição. |
| Ator Principal | Utilizador premium com um projeto aberto que contém um vídeo. |
| Stakeholders e Interesses | - Utilizador premium: legendas corretas e sincronizadas, com o mínimo de correção manual, e controlo sobre o resultado final.<br>- Utilizador registado (gratuito): perceber o que a funcionalidade oferece e o que ganha em subscrever o Premium.<br>- Utilizador anónimo: ser encaminhado para o registo sem perder o vídeo em que estava a trabalhar.<br>- Audiência do vídeo: legendas legíveis e fiéis ao que é dito (acessibilidade).<br>- Serviço de IA de transcrição (sistema externo ou local): pedidos bem formados e dentro dos limites de utilização.<br>- Equipa DevOps / Desenvolvimento: tarefas longas que não degradem as operações de imagem, com filas controladas e ficheiros temporários limpos.<br>- Administrador de sistema / RGPD: o áudio e as transcrições são dados pessoais, devendo ser protegidos (encriptação em repouso e em trânsito, acesso restrito).<br>- Proprietário do negócio: diferenciação entre planos que incentive a subscrição Premium. |
| Pré-condições | - O utilizador está autenticado com perfil premium.<br>- O projeto tem pelo menos um vídeo carregado com sucesso, em formato suportado e dentro dos limites do perfil.<br>- O serviço de transcrição, a fila de mensagens, o armazenamento e o WebSocket Gateway estão disponíveis.<br>- Não existe outra execução de processamento ativa no mesmo projeto. |
| Trigger | O utilizador seleciona a ferramenta "Legendas automáticas" sobre um vídeo do projeto. |

### 2.1.2 Fluxo Principal

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona um vídeo do projeto. | Apresenta o vídeo num reprodutor, com duração, formato e indicação de que tem pista de áudio. |
| 2 | Seleciona a ferramenta "Legendas automáticas". | Verifica o perfil (premium) e apresenta as opções: idioma da fala (deteção automática por omissão) e estado atual (sem legendas). |
| 3 | Escolhe o idioma (ou mantém a deteção automática) e confirma "Gerar legendas". | Valida o vídeo (pista de áudio, duração e tamanho, RN2 e RN3), cria uma execução e publica o pedido de transcrição na fila RabbitMQ. |
| 4 | — | Mostra o progresso em tempo real (extração do áudio, transcrição, ajuste dos tempos) com a opção "Cancelar". |
| 5 | — | A ferramenta extrai o áudio do vídeo, envia-o ao serviço de transcrição e obtém o texto com marcas de tempo. Agrupa o texto em segmentos de legenda segundo as regras de RN4 e marca os de baixa confiança. |
| 6 | — | Consolida a execução e apresenta o editor de legendas: lista de segmentos (início, fim, texto) sincronizada com o reprodutor, que mostra as legendas sobrepostas ao vídeo. Indica o idioma detetado e o número de segmentos incertos. |
| 7 | Revê as legendas: reproduz o vídeo, edita o texto, ajusta tempos, junta, divide, apaga ou adiciona segmentos. | Valida cada alteração (RN4), atualiza a sobreposição no reprodutor e guarda o rascunho automaticamente no projeto. |
| 8 | Escolhe a saída: "Descarregar legendas" (SRT ou WebVTT) ou "Incorporar no vídeo" (com tamanho, posição e cor do texto). | Se a escolha for só descarregar, gera o ficheiro de legendas e avança para o passo 10. Se for incorporar, cria uma nova execução e publica o pedido na fila. |
| 9 | — | A ferramenta de incorporação produz um novo vídeo com as legendas gravadas na imagem, enviando o progresso pelo WebSocket. Valida o resultado e guarda-o como nova versão do vídeo, sem alterar o original (RN6). |
| 10 | Reproduz o resultado e pede o download. | Disponibiliza o ficheiro (legendas ou vídeo) através de um URL pré-assinado. O caso de uso termina com sucesso. |

### 2.1.3 Fluxos Alternativos

| Fluxo | Descrição |
|---|---|
| FA1 – Deteção automática do idioma | No passo 3, o utilizador mantém "Deteção automática". O sistema deteta o idioma e apresenta-o no passo 6. Se a deteção não tiver confiança suficiente, pede ao utilizador que escolha o idioma e volta ao passo 3. |
| FA2 – Idioma detetado ou escolhido incorretamente | No passo 6 ou 7, o utilizador verifica que o idioma está errado e escolhe outro para voltar a gerar. O sistema avisa que as edições feitas serão descartadas, pede confirmação e volta ao passo 3. |
| FA3 – Rever apenas os segmentos incertos | No passo 7, o utilizador filtra a lista para ver só os segmentos marcados como baixa confiança. O sistema mostra apenas esses segmentos, mantendo a sincronização com o reprodutor. |
| FA4 – Retomar a revisão mais tarde | No passo 7, o utilizador sai ou fecha a página. O sistema mantém o rascunho no projeto. Ao regressar, o sistema carrega as legendas guardadas no passo 6, sem repetir a transcrição. |
| FA5 – Editar legendas já existentes | No passo 2, o vídeo já tem legendas geradas anteriormente. O sistema abre o editor com essas legendas (passo 6), sem nova transcrição, e oferece "Gerar de novo" como alternativa. |
| FA6 – Apenas exportar o ficheiro de legendas | No passo 8, o utilizador escolhe só descarregar o ficheiro. O sistema gera-o no formato escolhido, sem criar novo vídeo (passo 9 omitido), e segue para o passo 10. |
| FA7 – Vídeo alterado depois de gerar as legendas | No passo 2 ou 8, o vídeo foi modificado (por exemplo, recortado) depois de as legendas serem geradas. O sistema marca as legendas como desatualizadas, avisa que podem estar dessincronizadas e oferece gerar de novo ou continuar mesmo assim. |
| FA8 – Incorporação sem alterações | No passo 8, as legendas e as opções de estilo são iguais às da última incorporação consolidada. O sistema não cria execução nova e apresenta de imediato o resultado existente (passo 10). |
| FA9 – Cancelamento pelo utilizador | Durante os passos 4 a 5 ou 9, o utilizador seleciona "Cancelar". O sistema interrompe a execução, descarta os resultados parciais e restaura o estado anterior do projeto (sem legendas, ou com as últimas legendas guardadas), sem recarregar a página. |
| FA10 – Recuperação da ligação em tempo real | Durante os passos 4 a 5 ou 9, o utilizador perde a ligação WebSocket. Ao reconectar, o sistema consulta o estado da execução e retoma o progresso ou apresenta o resultado, sem interromper o processamento. |

### 2.1.4 Exceções

| Condição | Comportamento do Sistema |
|---|---|
| E1 – Perfil sem acesso (passo 2): o utilizador é registado (gratuito) ou anónimo. | Bloqueia a funcionalidade. Ao registado, mostra "Disponível apenas no plano Premium" e sugere o upgrade. Ao anónimo, pede registo ou login e preserva o projeto em que estava. Não cria execução. |
| E2 – Vídeo sem pista de áudio (passo 3). | Recusa a geração e informa que o vídeo não tem áudio para transcrever. Não cria execução nem gera custo. |
| E3 – Duração ou tamanho do vídeo excedem o limite (passo 3). | Recusa a geração antes de criar a execução, indica o limite aplicável (RN2) e sugere recortar o vídeo antes de gerar legendas. |
| E4 – Formato ou codec de áudio não suportado, ou extração do áudio falha (passo 5). | Termina a execução, indica que o áudio do vídeo não pôde ser lido e sugere converter o vídeo para MP4 (H.264/AAC). O projeto fica inalterado. |
| E5 – Sem fala detetável (passo 5): o áudio contém apenas música, ruído ou silêncio. | Conclui sem segmentos, informa que não foi detetada fala e permite tentar noutro idioma ou adicionar legendas manualmente. A execução não gera custo. |
| E6 – Serviço de transcrição indisponível, com erro ou tempo excedido (passo 5). | Termina a execução, mostra "Falha no processamento. Tente novamente.", mantém o projeto inalterado e permite repetir o pedido. A execução não gera custo. |
| E7 – Falha a meio da incorporação (passo 9). | Descarta o vídeo parcial, mantém as legendas editadas e o vídeo anterior, e informa o erro com a opção de repetir só a incorporação, sem refazer a transcrição. |
| E8 – Edição inválida (passo 7): sobreposição de tempos, início ≥ fim, texto vazio ou texto acima do limite de caracteres. | Assinala o segmento com o problema, explica a regra violada (RN4) e bloqueia a exportação enquanto existirem erros. |
| E9 – Já existe uma execução ativa no projeto (passos 3 ou 8). | Impede nova execução, informa que há um processamento em curso e oferece cancelá-lo ou aguardar. |
| E10 – Link de download expirado ou ficheiro removido (passo 10). | Informa que o ficheiro já não está disponível e oferece gerar novo link a partir do resultado guardado no projeto. |

### 2.1.5 Pós-condições

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | O projeto contém as legendas revistas e guardadas, associadas à versão do vídeo para a qual foram geradas. Se o utilizador incorporou as legendas, existe uma nova versão do vídeo com elas gravadas, e o original permanece inalterado. O ficheiro pedido (legendas ou vídeo) está disponível para download, guardado de forma encriptada. Não restam ficheiros temporários. |
| Garantia Mínima | Em qualquer falha ou cancelamento, o vídeo original e o último estado consolidado do projeto, incluindo as legendas já guardadas, ficam intactos e utilizáveis. Os resultados parciais são removidos, nenhuma execução falhada ou cancelada gera custo, e o utilizador recebe uma mensagem a explicar o que aconteceu e pode tentar novamente. |

### 2.1.6 Regras de Negócio e Restrições

| ID | Regra |
|---|---|
| RN1 | A funcionalidade só está disponível para o perfil premium. O registado (gratuito) recebe aviso de plano e o anónimo é encaminhado para o registo. |
| RN2 | Limites do vídeo para gerar legendas: duração ≤ 10 min e tamanho ≤ 500 MB. Idiomas suportados no MVP: português, inglês, espanhol e francês. |
| RN3 | O vídeo tem de ter pelo menos uma pista de áudio com fala. |
| RN4 | Cada segmento de legenda tem início < fim, sem sobreposição com os restantes, duração entre 0,5 s e 10 s, e no máximo 2 linhas de 42 caracteres. |
| RN5 | As legendas ficam associadas à versão do vídeo para que foram geradas. Se o vídeo for alterado depois, passam a "desatualizadas" (FA7). |
| RN6 | O vídeo original nunca é alterado. A incorporação de legendas produz sempre uma nova versão. |
| RN7 | Formatos de exportação: SRT e WebVTT para o ficheiro de legendas; MP4 (H.264/AAC) para o vídeo com legendas incorporadas. |
| RN8 | Só pode existir uma execução ativa por projeto. Resultados tardios de execuções canceladas são ignorados. |
| RN9 | O progresso deve ser comunicado em tempo real e o cancelamento deve devolver a interface a um estado utilizável em menos de 1 s. |
| RN10 | O áudio, as transcrições e as legendas são dados pessoais: ficam encriptados em repouso e em trânsito, só são acessíveis pelo dono do projeto ou por link de partilha válido, e o áudio extraído é eliminado após a transcrição. |
| RN11 | Execuções falhadas ou canceladas, ou que não produzam qualquer segmento, não são contabilizadas como utilização do serviço, e qualquer reserva de tarefa ou slot de concorrência é libertada imediatamente. |

### 2.1.7 Assunções

| ID | Assunção |
|---|---|
| A1 | O carregamento de vídeo e a sua validação inicial já fazem parte do MVP, e este caso de uso parte de um vídeo carregado com sucesso. |
| A2 | A transcrição é feita por um novo microserviço Python no padrão das ferramentas existentes (fila RabbitMQ e resultado devolvido na exchange picturas), e no MVP usa um modelo local ou um mock, tal como o generative-mock do expand_ai, para não depender de GPU nem de chaves externas. |
| A3 | O MVP faz apenas transcrição no idioma da fala, sem tradução para outro idioma. |
| A4 | Os limites e os idiomas de RN2 são propostas da equipa, ainda não validadas com a equipa docente. |
| A5 | As legendas são guardadas como dados do projeto (segmentos com início, fim e texto), versionadas com o vídeo, e não como ficheiro do utilizador. |
| A6 | Os mecanismos atuais de execuções com token (cancelamento e restauro do estado anterior), de progresso por WebSocket e de cache por fingerprint da pipeline (evitar reprocessar quando nada mudou) podem ser reutilizados para vídeo sem alterações de fundo. |
| A7 | A sobreposição das legendas no reprodutor, durante a revisão, é feita no browser e não exige processamento no servidor. |
| A8 | O vídeo tem um só idioma de fala e o MVP não distingue falantes diferentes. |
| A9 | Os limites numéricos de RN2, o atraso máximo de 2 s nos eventos de progresso e o tempo limite de cancelamento em < 1 s são valores de partida adequados ao MVP. |

### 2.1.8 Questões em Aberto

| ID | Questão em aberto |
|---|---|
| Q1 | A restrição R5 limita as ferramentas de IA a cerca de 60 s de tempo de resposta, mas transcrever vários minutos de áudio pode demorar mais. Aceita-se processar por blocos com progresso parcial, ou abre-se uma exceção ao limite para esta ferramenta? |
| Q2 | Qual é o serviço de transcrição do MVP: mock, modelo local ou API externa? Cada opção tem impacto diferente nos requisitos de memória e computação e na conformidade RGPD (R1 e R3). |
| Q3 | A tradução das legendas para outro idioma deve ficar neste caso de uso ou ser uma funcionalidade à parte? |
| Q4 | O estilo das legendas incorporadas (tamanho, posição, cor) é configurável no MVP, ou basta um estilo fixo? |
| Q5 | Os utilizadores registados devem poder experimentar a ferramenta com um limite pequeno (por exemplo, 30 s) em vez de ficarem totalmente bloqueados, como acontece com o Assistente IA? |
| Q6 | Um utilizador convidado com permissão de edição num projeto partilhado pode editar as legendas ou apenas ver? E o que acontece se duas pessoas as editarem ao mesmo tempo? |
| Q7 | Onde se guarda o rascunho das legendas (base de dados do Project Service ou armazenamento de objetos), e que tamanho máximo se aceita? |

---

## 4. Esboço de requisitos derivados

### 4.1 Requisitos de Sistema

| ID | Requisito | Tipo | Prioridade | Novo/Alt | Origem | Como verificar |
|---|---|---|---|---|---|---|
| REQ-VID-LEG-001 | O sistema deve permitir selecionar um vídeo do projeto e abri-lo num reprodutor que mostra a duração, o formato e se tem pista de áudio. | F | Deve ter | NOVO | Passo 1 | Dado um projeto com 3 vídeos, quando o utilizador abre o vídeo de teste, então a duração, o formato e a indicação de áudio são corretos. |
| REQ-VID-LEG-002 | O sistema deve disponibilizar a ferramenta "Legendas automáticas" sobre um vídeo do projeto. | F | Deve ter | NOVO | Trigger, Passo 2 | Dado um vídeo selecionado, quando o utilizador abre a barra de ferramentas, então a ferramenta está visível e utilizável. |
| REQ-VID-LEG-003 | O sistema deve permitir executar a ferramenta apenas a utilizadores premium, validando o perfil no backend e não apenas na interface. | F | Deve ter | NOVO | Passo 2, RN1, E1 | Dado um utilizador registado ou anónimo, quando envia um pedido directo à API, então o pedido é recusado e não cria execução. |
| REQ-VID-LEG-004 | O sistema deve informar o utilizador registado (gratuito) de que a funcionalidade é exclusiva do plano Premium e sugerir o upgrade. | F | Deveria ter | ALT | E1, RN1 | Dado um utilizador gratuito, quando seleciona a ferramenta, então vê a mensagem "Disponível apenas no plano Premium" com ligação para o upgrade. |
| REQ-VID-LEG-005 | O sistema deve pedir registo ou login ao utilizador anónimo que selecione a ferramenta, preservando o projeto e o vídeo em que estava a trabalhar. | F | Deveria ter | NOVO | E1, RN1 | Dado um utilizador anónimo, quando seleciona a ferramenta, então é redirecionado para registo/login e, após autenticação, regressa ao projeto e vídeo anteriores. |
| REQ-VID-LEG-006 | O sistema deve apresentar as opções de geração: idioma da fala (português, inglês, espanhol, francês ou deteção automática, esta por omissão) e o estado atual das legendas do vídeo (sem legendas, geradas ou desatualizadas). | F | Deve ter | NOVO | Passo 2, RN2, FA1 | Dado um vídeo sem legendas, quando abre a ferramenta, então a lista mostra os 4 idiomas e "Deteção automática" como opção ativa, e o estado do vídeo corresponde ao estado do projeto. |
| REQ-VID-LEG-007 | O sistema deve recusar a geração, antes de criar a execução, se o vídeo não tiver pista de áudio, informando o motivo. | F | Deve ter | NOVO | Passo 3, RN3, E2 | Dado um vídeo sem áudio, quando o utilizador confirma a geração, então o pedido é rejeitado e a mensagem indica ausência de áudio. |
| REQ-VID-LEG-008 | O sistema deve recusar a geração, antes de criar a execução, se o vídeo exceder 10 min de duração ou 500 MB, indicando o limite aplicável e sugerindo recortar o vídeo. | F | Deve ter | NOVO | Passo 3, RN2, E3 | Dado um vídeo de 10 min e 500 MB, quando é submetido, então é aceite; dado um vídeo acima de qualquer limite, então é recusado com mensagem e sem execução criada. |
| REQ-VID-LEG-009 | O sistema deve criar uma execução associada ao projeto e publicar na fila RabbitMQ da ferramenta de transcrição o pedido com o vídeo e o idioma escolhido. | F | Deve ter | ALT | Passo 3 | Dado um pedido válido, quando o utilizador confirma, então o projeto regista uma execução ativa e a mensagem é publicada na fila. |
| REQ-VID-LEG-010 | O sistema deve impedir nova execução (geração ou incorporação) enquanto o projeto tiver uma execução ativa, oferecendo cancelá-la ou aguardar. | F | Deve ter | ALT | RN8, E9 | Dado um projeto com execução em curso, quando um segundo pedido é submetido, então é recusado e apresentam-se as opções cancelar ou aguardar. |
| REQ-VID-LEG-011 | O sistema deve mostrar o progresso em tempo real, por fases (extração do áudio, transcrição, ajuste dos tempos, incorporação), através do WebSocket, com a opção "Cancelar" sempre disponível. | F | Deve ter | ALT | Passo 4, Passo 9, RN9 | Dado um processamento em curso, quando o estado muda, então a interface mostra a fase atual e a barra de progresso sem recarregar a página. |
| REQ-VID-LEG-012 | O sistema deve permitir cancelar a geração ou a incorporação, interrompendo a execução, descartando os resultados parciais e restaurando o último estado consolidado (sem legendas ou últimas legendas guardadas), sem recarregar a página. | F | Deve ter | ALT | FA9, Garantia Mínima | Dado um processamento em curso, quando o utilizador cancela, então a execução termina e o projeto volta ao estado imediatamente anterior. |
| REQ-VID-LEG-013 | O sistema deve ignorar os resultados tardios de execuções canceladas, validando cada resultado contra o token da execução ativa. | F | Deve ter | ALT | RN8, FA9 | Dado um resultado enviado por uma execução cancelada, quando é recebido, então não é persistido nem apresentado. |
| REQ-VID-LEG-014 | O sistema deve, quando o utilizador volta a ligar-se ao WebSocket durante uma execução, consultar o estado da execução e retomar o progresso ou apresentar o resultado, sem interromper o processamento. | F | Deveria ter | ALT | FA10 | Dado um utilizador com ligação perdida durante uma execução, quando reconecta, então o sistema mostra o estado correto sem interromper a tarefa. |
| REQ-VID-LEG-015 | A ferramenta de transcrição deve extrair a pista de áudio do vídeo. | F | Deve ter | NOVO | Passo 5 | Dado um vídeo de teste com áudio, quando a tarefa executa, então o áudio extraído tem a duração correta. |
| REQ-VID-LEG-016 | A ferramenta de transcrição deve converter a fala em texto com marcas de tempo, no idioma falado e sem tradução, através de um serviço de transcrição configurável (mock no MVP). | F | Deve ter | NOVO | Passo 5, A2, A3 | Dado um vídeo de teste, quando a transcrição termina, então o resultado contém texto com início e fim por segmento. |
| REQ-VID-LEG-017 | O sistema deve detetar o idioma da fala quando o utilizador mantém "Deteção automática", apresentá-lo no editor e, se a confiança for insuficiente, pedir ao utilizador que escolha o idioma e voltar à seleção de opções. | F | Deveria ter | NOVO | FA1 | Dado um vídeo em inglês, quando a deteção automática funciona, então o editor mostra "Inglês"; dado um áudio ambíguo, então o utilizador escolhe o idioma. |
| REQ-VID-LEG-018 | O sistema deve agrupar o texto transcrito em segmentos que cumpram RN4: início < fim, sem sobreposição, duração entre 0,5 s e 10 s, no máximo 2 linhas de 42 caracteres. | F | Deve ter | NOVO | Passo 5, RN4 | Dado um conjunto de segmentos gerados, quando são validados, então não existem sobreposições, tempos inválidos nem linhas excedidas. |
| REQ-VID-LEG-019 | O sistema deve marcar os segmentos de baixa confiança e indicar o seu número no editor. | F | Deveria ter | NOVO | Passo 5, FA3 | Dado um segmento com confiança baixa, quando o editor abre, então o segmento aparece marcado e o contador mostra o número correto. |
| REQ-VID-LEG-020 | O sistema deve terminar a execução quando o formato ou codec de áudio não for suportado ou a extração falhar, informar que o áudio não pôde ser lido, sugerir converter o vídeo para MP4 (H.264/AAC) e manter o projeto inalterado. | F | Deve ter | NOVO | E4 | Dado um vídeo com áudio corrompido, quando a execução falha, então o projeto permanece inalterado e a mensagem indica a correção sugerida. |
| REQ-VID-LEG-021 | O sistema deve, quando não detetar fala (apenas música, ruído ou silêncio), concluir sem segmentos, informar o utilizador e permitir tentar outro idioma ou adicionar legendas manualmente. | F | Deve ter | NOVO | E5, RN3 | Dado um vídeo apenas com música, quando termina a execução, então o projeto permanece com zero segmentos e a mensagem oferece ação seguinte. |
| REQ-VID-LEG-022 | O sistema deve, quando o serviço de transcrição estiver indisponível, devolver erro ou exceder o tempo limite, terminar a execução, mostrar "Falha no processamento. Tente novamente.", manter o projeto inalterado e permitir repetir o pedido. | F | Deve ter | ALT | E6 | Dado um serviço indisponível, quando a execução falha, então a mensagem aparece e o projeto não é alterado. |
| REQ-VID-LEG-023 | O sistema deve consolidar a execução e apresentar o editor de legendas: lista de segmentos sincronizada com o reprodutor, com as legendas sobrepostas ao vídeo, o idioma detetado e o número de segmentos incertos. | F | Deve ter | NOVO | Passo 6, A7 | Dado um vídeo com segmentos, quando o editor abre, então a lista, a sobreposição e o idioma são consistentes com a execução. |
| REQ-VID-LEG-024 | O sistema deve permitir editar o texto e os tempos (início e fim) de um segmento. | F | Deve ter | NOVO | Passo 7 | Dado um segmento editado, quando a alteração é confirmada, então a lista e a sobreposição são atualizadas em menos de 1 s. |
| REQ-VID-LEG-025 | O sistema deve permitir adicionar, apagar, juntar e dividir segmentos, mantendo as regras de RN4. | F | Deve ter | NOVO | Passo 7,RN4 | Dado um conteúdo editado, quando o utilizador adiciona, elimina ou divide segmentos, então a estrutura final continua válida ou é assinalada como inválida. |
| REQ-VID-LEG-026 | O sistema deve validar cada alteração contra RN4, assinalando o segmento com problema e explicando a regra violada. | F | Deve ter | NOVO | Passo 7, E8, RN4 | Dado um segmento com início ≥ fim, quando é validado, então o problema é assinalado e a regra é indicada. |
| REQ-VID-LEG-027 | O sistema deve bloquear a exportação (ficheiro e incorporação) enquanto existirem segmentos inválidos. | F | Deve ter | NOVO | E8 | Dado um segmento inválido, quando o utilizador tenta exportar, então a ação é recusada até o segmento ser corrigido. |
| REQ-VID-LEG-028 | O sistema deve guardar automaticamente o rascunho das legendas como dados do projeto, após cada alteração. | F | Deve ter | NOVO | Passo 7, FA4, A5 | Dado uma edição, quando o utilizador fecha a página, então o rascunho é guardado e reaparece ao reabrir. |
| REQ-VID-LEG-029 | O sistema deve, ao reabrir um vídeo com legendas guardadas, carregá-las no editor sem repetir a transcrição. | F | Deve ter | NOVO | FA4, FA5 | Dado um vídeo com rascunho guardado, quando o utilizador abre o editor, então as legendas guardadas aparecem e não é criada nova execução. |
| REQ-VID-LEG-030 | O sistema deve permitir gerar de novo as legendas de um vídeo, incluindo com outro idioma, avisando que as edições feitas serão descartadas e pedindo confirmação. | F | Deveria ter | NOVO | FA2, FA5 | Dado um vídeo com legendas existentes, quando o utilizador escolhe "Gerar de novo", então recebe confirmação antes de substituição. |
| REQ-VID-LEG-031 | O sistema deve permitir escolher a saída: descarregar o ficheiro de legendas ou incorporá-las no vídeo; ao escolher só descarregar, não deve criar execução nem novo vídeo. | F | Deve ter | NOVO | Passo 8, FA6 | Dado um conjunto de legendas válidas, quando o utilizador escolhe "Descarregar legendas", então o ficheiro é gerado e não é criada nenhuma execução nova. |
| REQ-VID-LEG-032 | O sistema deve exportar as legendas em SRT e WebVTT e disponibilizar o ficheiro através de um URL pré-assinado. | F | Deve ter | NOVO | Passo 8, RN7, Passo 10 | Dado um ficheiro de legendas gerado, quando é pedido o download, então o URL devolvido funciona e o ficheiro indicado é o correto. |
| REQ-VID-LEG-033 | O sistema deve incorporar as legendas no vídeo através de uma nova execução, guardando o resultado como nova versão do vídeo, sem alterar o original. | F | Deve ter | NOVO | Passo 8, Passo 9, RN6, RN7 | Dado um vídeo que recebe incorporação, quando a execução conclui, então o projeto inclui uma nova versão e o original mantém o hash anterior. |
| REQ-VID-LEG-034 | O sistema deve, se a incorporação falhar a meio, descartar o vídeo parcial, manter as legendas editadas e o vídeo anterior, informar o erro e permitir repetir apenas a incorporação. | F | Deve ter | NOVO | E7 | Dado uma incorporação falhada, quando a execução termina, então não existe vídeo parcial, o projeto continua com as legendas válidas e a opção de repetir só a incorporação está disponível. |
| REQ-VID-LEG-035 | O sistema deve, se a execução não produzir todos os segmentos esperados ou tiver falha de serviço, devolver a operação ao estado anterior e libertar qualquer reserva de tarefa ou slot de concorrência. | F | Deve ter | ALT | RN11, FA9, E5, E6 | Dado uma execução falhada ou cancelada, quando termina, então o projeto é restaurado e qualquer operação reservada é liberada imediatamente. |
| REQ-VID-LEG-036 | O sistema deve garantir a encriptação em trânsito e em repouso do áudio, das transcrições e das legendas, e eliminar o áudio extraído após a transcrição. | NF (Segurança) | Deve ter | ALT | RN10 | Dado um ficheiro protecionado, quando é armazenado ou transferido, então usa TLS e não é legível sem as chaves do sistema. |
| REQ-VID-LEG-037 | O sistema deve permitir acesso às legendas e ao áudio apenas ao dono do projeto ou a quem tenha um link de partilha válido. | NF (Segurança) | Deve ter | ALT | RN10 | Dado um utilizador não autorizado, quando tenta aceder a um recurso protegido, então o acesso é negado. |
| REQ-VID-LEG-038 | O cancelamento deve devolver a interface a um estado utilizável em menos de 1 s. | NF (Desempenho) | Deve ter | ALT | RN9, FA9 | Dado 20 cancelamentos em teste, quando o utilizador aciona o botão, então pelo menos 95% dos casos devolvem a interface a um estado utilizável em menos de 1 s. |
| REQ-VID-LEG-039 | Os eventos de progresso devem chegar à interface com um atraso máximo de 2 s e as atualizações de estado em ≤ 5 s. | NF (Desempenho) | Deveria ter | ALT | Passo 4, RN9 | Dado um processamento em execução, quando cada evento é publicado, então a interface mostra a atualização em ≤ 2 s e a apresentação do estado em ≤ 5 s. |
| REQ-VID-LEG-040 | O sistema deve executar a transcrição e a incorporação em filas e consumidores dedicados, para que tarefas longas não atrasem as operações de imagem existentes. | NF (Desempenho) | Deve ter | ALT | Stakeholder DevOps, RN8 | Dado uma geração em curso, quando a aplicação executa uma operação de imagem simples, então o tempo de resposta não é degradado de forma significativa. |

### 4.2 Impacto no Sistema Existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Frontend: página de projeto e barra de ferramentas | Estender | Nova ferramenta "Legendas automáticas", reprodutor de vídeo e editor de legendas. A página atual está centrada em imagens, pelo que é preciso confirmar no código o que assume sobre o tipo de ficheiro. | REQ-VID-LEG-001, REQ-VID-LEG-002, REQ-VID-LEG-006, REQ-VID-LEG-023, REQ-VID-LEG-024, REQ-VID-LEG-025, REQ-VID-LEG-028, REQ-VID-LEG-031, REQ-VID-LEG-032 |
| Frontend: overlay de processamento e cancelamento | Estender | Reutilizar o overlay com barra de progresso e botão Cancelar, acrescentando as fases da geração e da incorporação. | REQ-VID-LEG-011, REQ-VID-LEG-012, REQ-VID-LEG-014, REQ-VID-LEG-038, REQ-VID-LEG-039 |
| Frontend: download e exportação | Estender | Novas opções de download (SRT, WebVTT, MP4) ao lado das existentes. | REQ-VID-LEG-031, REQ-VID-LEG-032, REQ-VID-LEG-033 |
| API Gateway | Estender | Novas rotas para gerar, cancelar, guardar rascunho e exportar, mantendo a validação de JWT e a propagação do perfil do utilizador. | REQ-VID-LEG-003, REQ-VID-LEG-009, REQ-VID-LEG-010, REQ-VID-LEG-028, REQ-VID-LEG-029, REQ-VID-LEG-037 |
| Project Service: modelo de dados do projeto | Alterar | Passa a suportar vídeos, legendas versionadas (segmentos, idioma, versão do vídeo de origem, estado "desatualizadas") e rascunhos. | REQ-VID-LEG-028, REQ-VID-LEG-029, REQ-VID-LEG-030, REQ-VID-LEG-033 |
| Tools | Estender | Duas novas ferramentas Python, uma de transcrição e outra de incorporação, que reutilizam utilitários de RabbitMQ e de mensagens. | REQ-VID-LEG-015, REQ-VID-LEG-016, REQ-VID-LEG-020, REQ-VID-LEG-021, REQ-VID-LEG-022, REQ-VID-LEG-034, REQ-VID-LEG-036 |
| RabbitMQ e WebSocket Gateway | Estender | Novas filas e eventos de progresso por fase e consulta do estado de execução. | REQ-VID-LEG-009, REQ-VID-LEG-011, REQ-VID-LEG-014, REQ-VID-LEG-039, REQ-VID-LEG-040 |
| Sistema de quotas e perfis | Estender | Reembolso imediato de tarefas canceladas ou falhadas e libertação de qualquer slot de concorrência reservado. | REQ-VID-LEG-035 |
| Armazenamento | Estender | Guardar vídeos e ficheiros exportados com URL pré-assinado, manter encriptação e limpar ficheiros temporários. | REQ-VID-LEG-032, REQ-VID-LEG-036, REQ-VID-LEG-037 |

### 4.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição do Elemento | Requisitos Mapeados |
| :--- | :--- | :--- |
| Trigger | O utilizador seleciona a ferramenta | REQ-VID-LEG-002 |
| Passo 1 | Selecionar vídeo e abrir no reprodutor | REQ-VID-LEG-001 |
| Passo 2 | Verificar perfil e apresentar opções | REQ-VID-LEG-003, REQ-VID-LEG-006 |
| Passo 3 | Escolher idioma, validar vídeo, criar execução | REQ-VID-LEG-007, REQ-VID-LEG-008, REQ-VID-LEG-009 |
| Passo 4 | Progresso em tempo real com cancelar | REQ-VID-LEG-011, REQ-VID-LEG-039 |
| Passo 5 | Extrair áudio, transcrever, segmentar e marcar incertos | REQ-VID-LEG-015, REQ-VID-LEG-016, REQ-VID-LEG-018, REQ-VID-LEG-019 |
| Passo 6 | Consolidar e apresentar o editor | REQ-VID-LEG-023 |
| Passo 7 | Rever e editar, validar e guardar rascunho | REQ-VID-LEG-024, REQ-VID-LEG-025, REQ-VID-LEG-026, REQ-VID-LEG-028 |
| Passo 8 | Escolher a saída e iniciar a incorporação | REQ-VID-LEG-031, REQ-VID-LEG-032, REQ-VID-LEG-033 |
| Passo 9 | Incorporar e guardar como nova versão | REQ-VID-LEG-033, REQ-VID-LEG-034 |
| Passo 10 | Reproduzir e descarregar | REQ-VID-LEG-032 |
| FA1 | Deteção automática do idioma | REQ-VID-LEG-006, REQ-VID-LEG-017 |
| FA2 | Idioma incorreto, gerar de novo | REQ-VID-LEG-030 |
| FA3 | Rever apenas segmentos incertos | REQ-VID-LEG-019 |
| FA4 | Retomar a revisão mais tarde | REQ-VID-LEG-028, REQ-VID-LEG-029 |
| FA5 | Editar legendas já existentes | REQ-VID-LEG-029, REQ-VID-LEG-030 |
| FA6 | Apenas exportar o ficheiro de legendas | REQ-VID-LEG-031, REQ-VID-LEG-032 |
| FA7 | Vídeo alterado depois de gerar as legendas | REQ-VID-LEG-030 |
| FA8 | Incorporação sem alterações | REQ-VID-LEG-033 |
| FA9 | Cancelamento pelo utilizador | REQ-VID-LEG-012, REQ-VID-LEG-013, REQ-VID-LEG-035, REQ-VID-LEG-038 |
| FA10 | Recuperação da ligação em tempo real | REQ-VID-LEG-014 |
| E1 | Perfil sem acesso | REQ-VID-LEG-003, REQ-VID-LEG-004, REQ-VID-LEG-005 |
| E2 | Vídeo sem pista de áudio | REQ-VID-LEG-007 |
| E3 | Duração ou tamanho excedidos | REQ-VID-LEG-008 |
| E4 | Formato ou codec não suportado, extração falha | REQ-VID-LEG-020 |
| E5 | Sem fala detetável | REQ-VID-LEG-021, REQ-VID-LEG-035 |
| E6 | Serviço de transcrição indisponível ou com erro | REQ-VID-LEG-022, REQ-VID-LEG-035 |
| E7 | Falha a meio da incorporação | REQ-VID-LEG-034 |
| E8 | Edição inválida | REQ-VID-LEG-026, REQ-VID-LEG-027 |
| E9 | Execução ativa no projeto | REQ-VID-LEG-010 |
| E10 | Link de download expirado | REQ-VID-LEG-032 |
| RN1 | Exclusivo do perfil premium | REQ-VID-LEG-003, REQ-VID-LEG-004, REQ-VID-LEG-005 |
| RN2 | Limites de duração, tamanho e idiomas | REQ-VID-LEG-006, REQ-VID-LEG-008 |
| RN4 | Segmentos válidos | REQ-VID-LEG-018, REQ-VID-LEG-026 |
| RN8 | Uma execução ativa por projeto | REQ-VID-LEG-010, REQ-VID-LEG-013 |
| RN9 | Progresso e cancelamento | REQ-VID-LEG-011, REQ-VID-LEG-038, REQ-VID-LEG-039 |
| RN10 | Encriptação e acesso restrito | REQ-VID-LEG-036, REQ-VID-LEG-037 |
| RN11 | Reembolso e libertação de recursos | REQ-VID-LEG-035 |