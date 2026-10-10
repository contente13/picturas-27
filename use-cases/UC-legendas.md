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
| E8 – Edição inválida (passo 7): sobreposição de tempos, início $\ge$ fim, texto vazio ou texto acima do limite de caracteres. | Assinala o segmento com o problema, explica a regra violada (RN4) e bloqueia a exportação enquanto existirem erros. |
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
| RN2 | Limites do vídeo para gerar legendas: duração $\le$ 10 min e tamanho $\le$ 500 MB. Idiomas suportados no MVP: português, inglês, espanhol e francês. |
| RN3 | O vídeo tem de ter pelo menos uma pista de áudio com fala. |
| RN4 | Cada segmento de legenda tem início < fim, sem sobreposição com os restantes, duração entre 0,5 s e 10 s, e no máximo 2 linhas de 42 caracteres. |
| RN5 | As legendas ficam associadas à versão do vídeo para que foram geradas. Se o vídeo for alterado depois, passam a "desatualizadas" (FA7). |
| RN6 | O vídeo original nunca é alterado. A incorporação de legendas produz sempre uma nova versão. |
| RN7 | Formatos de exportação: SRT e WebVTT para o ficheiro de legendas; MP4 (H.264/AAC) para o vídeo com legendas incorporadas. |
| RN8 | Só pode existir uma execução ativa por projeto. Resultados tardios de execuções canceladas são ignorados. |
| RN9 | O progresso deve ser comunicado em tempo real e o cancelamento deve devolver a interface a um estado utilizável em menos de 1 s. |
| RN10 | O áudio, as transcrições e as legendas são dados pessoais: ficam encriptados em repouso e em trânsito, só são acessíveis pelo dono do projeto ou por link de partilha válido, e o áudio extraído é eliminado após a transcrição. |
| RN11 | Execuções falhadas ou canceladas, ou que não produzam qualquer segmento, não são contabilizadas como utilização do serviço. |

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
| REQ-VID-LEG-001 | O sistema deve permitir selecionar um vídeo do projeto e abri-lo num reprodutor que mostra a duração, o formato e se tem pista de áudio. | F | Deve ter | NOVO | Passo 1 | Abrir 3 vídeos de teste (com e sem áudio): duração, formato e indicador de áudio corretos nos 3 casos. |
| REQ-VID-LEG-002 | O sistema deve disponibilizar a ferramenta "Legendas automáticas" sobre um vídeo do projeto. | F | Deve ter | NOVO | Trigger, Passo 2 | Com um vídeo selecionado, a ferramenta está visível e utilizável na barra de ferramentas; sem vídeo, não está disponível. |
| REQ-VID-LEG-003 | O sistema deve permitir executar a ferramenta apenas a utilizadores premium, validando o perfil no backend e não apenas na interface. | F | Deve ter | NOVO | Passo 2, RN1, E1 | Pedido direto à API com token de utilizador registado (gratuito) ou sem token é recusado e não cria execução. |
| REQ-VID-LEG-004 | O sistema deve informar o utilizador registado (gratuito) de que a funcionalidade é exclusiva do plano Premium e sugerir o upgrade. | F | Deveria ter | ALT *(estende RF64)* | E1, RN1 | Com conta gratuita, ao selecionar a ferramenta aparece "Disponível apenas no plano Premium" com ligação para o upgrade; nenhuma execução é criada. |
| REQ-VID-LEG-005 | O sistema deve pedir registo ou login ao utilizador anónimo que selecione a ferramenta, preservando o projeto e o vídeo em que estava a trabalhar. | F | Deveria ter | NOVO | E1, RN1, Stakeholder anónimo | Após registo/login, o utilizador regressa ao mesmo projeto com o vídeo intacto. |
| REQ-VID-LEG-006 | O sistema deve apresentar as opções de geração: idioma da fala (português, inglês, espanhol, francês ou deteção automática, esta por omissão) e o estado atual das legendas do vídeo (sem legendas, geradas ou desatualizadas). | F | Deve ter | NOVO | Passo 2, RN2, FA1 | A lista mostra os 4 idiomas e "Deteção automática" pré-selecionada; o estado apresentado coincide com os dados do projeto. |
| REQ-VID-LEG-007 | O sistema deve recusar a geração, antes de criar a execução, se o vídeo não tiver pista de áudio, informando o motivo. | F | Deve ter | NOVO | Passo 3, RN3, E2 | Vídeo sem áudio é recusado com mensagem a indicar ausência de áudio; não existe execução criada. |
| REQ-VID-LEG-008 | O sistema deve recusar a geração, antes de criar a execução, se o vídeo exceder 10 min de duração ou 500 MB, indicando o limite aplicável e sugerindo recortar o vídeo. | F | Deve ter | NOVO | Passo 3, RN2, E3 | Vídeos de 10 min e de 500 MB são aceites; vídeos acima de qualquer dos limites são recusados com o limite indicado e sem execução criada. |
| REQ-VID-LEG-009 | O sistema deve criar uma execução associada ao projeto e publicar na fila RabbitMQ da ferramenta de transcrição o pedido com o vídeo e o idioma escolhido. | F | Deve ter | ALT *(estende execuções com token)* | Passo 3 | Ao confirmar, o projeto passa a ter uma execução ativa (token) e a mensagem é visível na fila, na interface de gestão do RabbitMQ. |
| REQ-VID-LEG-010 | O sistema deve impedir nova execução (geração ou incorporação) enquanto o projeto tiver uma execução ativa, oferecendo cancelá-la ou aguardar. | F | Deve ter | ALT | RN8, E9 | Um segundo pedido durante uma execução ativa é recusado com as duas opções; nunca existe mais do que um token ativo por projeto. |
| REQ-VID-LEG-011 | O sistema deve mostrar o progresso em tempo real, por fases (extração do áudio, transcrição, ajuste dos tempos, incorporação), através do WebSocket, com a opção "Cancelar" sempre disponível. | F | Deve ter | ALT *(reutiliza T-10 e WS Gateway)* | Passo 4, Passo 9, RN9 | Durante a execução, a interface mostra a fase atual e a barra de progresso sem recarregar a página, e o botão "Cancelar" está visível. |
| REQ-VID-LEG-012 | O sistema deve permitir cancelar a geração ou a incorporação, interrompendo a execução, descartando os resultados parciais e restaurando o último estado consolidado (sem legendas ou últimas legendas guardadas), sem recarregar a página. | F | Deve ter | ALT *(estende T-01 e T-10)* | FA9, Garantia Mínima | Cancelar a meio: não restam resultados parciais no armazenamento, a interface mostra o estado anterior e o vídeo original está intacto. |
| REQ-VID-LEG-013 | O sistema deve ignorar os resultados tardios de execuções canceladas, validando cada resultado contra o token da execução ativa. | F | Deve ter | ALT | RN8, FA9 | Publicar manualmente um resultado de uma execução cancelada: não é persistido nem apresentado. |
| REQ-VID-LEG-014 | O sistema deve, quando o utilizador volta a ligar-se ao WebSocket durante uma execução, consultar o estado da execução e retomar o progresso ou apresentar o resultado, sem interromper o processamento. | F | Deveria ter | ALT | FA10 | Desligar a rede durante 10 s a meio da geração: ao reconectar a interface mostra o estado correto e a execução conclui normalmente. |
| REQ-VID-LEG-015 | A ferramenta de transcrição deve extrair a pista de áudio do vídeo. | F | Deve ter | NOVO | Passo 5 | Em 3 vídeos de teste, o áudio extraído tem a duração do vídeo com tolerância de 0,5 s. |
| REQ-VID-LEG-016 | A ferramenta de transcrição deve converter a fala em texto com marcas de tempo, no idioma falado e sem tradução, através de um serviço de transcrição configurável (mock no MVP). | F | Deve ter | NOVO | Passo 5, A2, A3 | Para um vídeo de teste, o resultado contém texto e tempos de início e fim por segmento; o mock responde segundo o contrato definido. |
| REQ-VID-LEG-017 | O sistema deve detetar o idioma da fala quando o utilizador mantém "Deteção automática", apresentá-lo no editor e, se a confiança for insuficiente, pedir ao utilizador que escolha o idioma e voltar à seleção de opções. | F | Deveria ter | NOVO | FA1 | Vídeo em inglês com deteção automática mostra "Inglês" no editor; áudio de idioma ambíguo leva ao pedido de escolha de idioma. |
| REQ-VID-LEG-018 | O sistema deve agrupar o texto transcrito em segmentos que cumpram RN4: início < fim, sem sobreposição, duração entre 0,5 s e 10 s, no máximo 2 linhas de 42 caracteres. | F | Deve ter | NOVO | Passo 5, RN4 | Um validador automático aplicado aos segmentos gerados a 5 vídeos de teste não encontra nenhuma violação. |
| REQ-VID-LEG-019 | O sistema deve marcar os segmentos de baixa confiança e indicar o seu número no editor. | F | Deveria ter | NOVO | Passo 5, FA3 | Segmentos com confiança abaixo do limiar aparecem marcados; o número apresentado coincide com o número de segmentos marcados. |
| REQ-VID-LEG-020 | O sistema deve terminar a execução quando o formato ou codec de áudio não for suportado ou a extração falhar, informar que o áudio não pôde ser lido, sugerir converter o vídeo para MP4 (H.264/AAC) e manter o projeto inalterado. | F | Deve ter | NOVO | E4 | Com um vídeo de áudio corrompido, a execução termina em erro, aparece a mensagem com a sugestão e o projeto não sofre alterações. |
| REQ-VID-LEG-021 | O sistema deve, quando não detetar fala (apenas música, ruído ou silêncio), concluir sem segmentos, informar o utilizador e permitir tentar outro idioma ou adicionar legendas manualmente. | F | Deve ter | NOVO | E5, RN3 | Com um vídeo só com música: 0 segmentos, mensagem informativa e editor vazio com a opção de adicionar segmento. |
| REQ-VID-LEG-022 | O sistema deve, quando o serviço de transcrição estiver indisponível, devolver erro ou exceder o tempo limite, terminar a execução, mostrar "Falha no processamento. Tente novamente.", manter o projeto inalterado e permitir repetir o pedido. | F | Deve ter | ALT *(estende RF65)* | E6 | Parar o serviço de transcrição: após o tempo limite aparece a mensagem, o projeto fica inalterado e repetir o pedido com o serviço reposto funciona. |
| REQ-VID-LEG-023 | O sistema deve consolidar a execução e apresentar o editor de legendas: lista de segmentos (início, fim, texto) sincronizada com o reprodutor, com as legendas sobrepostas ao vídeo no browser, o idioma detetado e o número de segmentos incertos. | F | Deve ter | NOVO | Passo 6, A7 | Selecionar um segmento posiciona o reprodutor no seu início; durante a reprodução a legenda visível é a do segmento correspondente, com desvio até 200 ms. |
| REQ-VID-LEG-024 | O sistema deve permitir editar o texto e os tempos (início e fim) de um segmento. | F | Deve ter | NOVO | Passo 7 | A alteração fica refletida na lista e na sobreposição em menos de 1 s. |
| REQ-VID-LEG-025 | O sistema deve permitir adicionar e apagar segmentos. | F | Deveria ter | NOVO | Passo 7 | Adicionar um segmento e apagar outro: lista e sobreposição ficam atualizadas e o rascunho guardado coincide. |
| REQ-VID-LEG-026 | O sistema deve permitir juntar dois segmentos consecutivos e dividir um segmento em dois. | F | Poderia ter | NOVO | Passo 7 | Juntar e dividir mantêm o texto original e respeitam RN4 ou assinalam o erro. |
| REQ-VID-LEG-027 | O sistema deve validar cada alteração contra RN4, assinalando o segmento com problema e explicando a regra violada. | F | Deve ter | NOVO | Passo 7, E8, RN4 | Cada caso é assinalado com a regra respetiva: sobreposição, início $\ge$ fim, texto vazio, mais de 2 linhas ou 42 caracteres, duração fora de 0,5 s a 10 s. |
| REQ-VID-LEG-028 | O sistema deve bloquear a exportação (ficheiro e incorporação) enquanto existirem segmentos inválidos. | F | Deve ter | NOVO | E8 | Com um segmento inválido a exportação é recusada; depois de corrigido, é permitida. |
| REQ-VID-LEG-029 | O sistema deve guardar automaticamente o rascunho das legendas (segmentos com início, fim e texto) como dados do projeto, após cada alteração. | F | Deve ter | NOVO | Passo 7, FA4, A5 | Editar, fechar a página e reabrir: as alterações estão presentes; o rascunho é gravado até 5 s após a última edição. |
| REQ-VID-LEG-030 | O sistema deve, ao reabrir um vídeo com legendas guardadas, carregá-las no editor sem repetir a transcrição. | F | Deve ter | NOVO | FA4, FA5 | Reabrir um vídeo com legendas: o editor mostra as legendas guardadas e não é publicado nenhum pedido na fila de transcrição. |
| REQ-VID-LEG-031 | O sistema deve permitir gerar de novo as legendas de um vídeo, incluindo com outro idioma, avisando que as edições feitas serão descartadas e pedindo confirmação. | F | Deveria ter | NOVO | FA2, FA5 | Escolher "Gerar de novo" ou mudar o idioma mostra o aviso; ao recusar nada muda; ao confirmar, as legendas são substituídas pelas novas. |
| REQ-VID-LEG-032 | O sistema deve permitir filtrar a lista para mostrar apenas os segmentos de baixa confiança, mantendo a sincronização com o reprodutor. | F | Deveria ter | NOVO | FA3 | Com o filtro ativo, a lista mostra apenas os segmentos marcados e a seleção continua a posicionar o reprodutor. |
| REQ-VID-LEG-033 | O sistema deve associar as legendas à versão do vídeo para a qual foram geradas. | F | Deve ter | NOVO | RN5, A5 | O registo das legendas contém o identificador da versão do vídeo de origem. |
| REQ-VID-LEG-034 | O sistema deve marcar as legendas como desatualizadas quando o vídeo for alterado depois de geradas, avisando que podem estar dessincronizadas e oferecendo gerar de novo ou continuar mesmo assim. | F | Deveria ter | NOVO | FA7, RN5 | Recortar um vídeo com legendas: o estado passa a "desatualizadas", surge o aviso com as duas opções e ambas funcionam. |
| REQ-VID-LEG-035 | O sistema deve permitir escolher a saída: descarregar o ficheiro de legendas ou incorporá-las no vídeo; ao escolher só descarregar, não deve criar execução nem novo vídeo. | F | Deve ter | NOVO | Passo 8, FA6 | Escolher "Descarregar legendas": o ficheiro é gerado, não existe execução nova nem vídeo novo no projeto. |
| REQ-VID-LEG-036 | O sistema deve exportar as legendas em formato SRT. | F | Deve ter | NOVO | Passo 8, RN7, FA6 | O ficheiro SRT descarregado é aceite por um reprodutor externo (ex.: VLC) e os segmentos coincidem com o editor. |
| REQ-VID-LEG-037 | O sistema deve exportar as legendas em formato WebVTT. | F | Deveria ter | NOVO | Passo 8, RN7, FA6 | O ficheiro WebVTT descarregado é aceite como pista de legendas num reprodutor HTML5 e os segmentos coincidem com o editor. |
| REQ-VID-LEG-038 | O sistema deve incorporar as legendas no vídeo através de uma nova ferramenta consumidora de RabbitMQ, criando para isso uma nova execução, com um estilo por omissão. | F | Deve ter | NOVO | Passo 8, Passo 9 | Ao escolher "Incorporar no vídeo" é criada uma execução e publicada a mensagem na fila da ferramenta de incorporação. |
| REQ-VID-LEG-039 | O sistema deve permitir configurar o tamanho, a posição e a cor do texto das legendas incorporadas. | F | Poderia ter | NOVO | Passo 8, Q4 | Alterar cada opção produz um vídeo com a alteração visível; depende da decisão em Q4. |
| REQ-VID-LEG-040 | O sistema deve guardar o resultado da incorporação como nova versão do vídeo, em MP4 (H.264/AAC), sem alterar o vídeo original. | F | Deve ter | NOVO | Passo 9, RN6, RN7 | Após incorporar, o projeto tem duas versões; o ficheiro original mantém o mesmo hash; o novo é MP4 H.264/AAC. |
| REQ-VID-LEG-041 | O sistema deve validar o vídeo resultante da incorporação (existe, é legível e tem duração coerente com a do original) antes de o guardar como nova versão. | F | Deveria ter | NOVO | Passo 9 | Um resultado corrompido ou truncado, forçado em teste, não é guardado como versão. |
| REQ-VID-LEG-042 | O sistema deve, se a incorporação falhar a meio, descartar o vídeo parcial, manter as legendas editadas e o vídeo anterior, informar o erro e permitir repetir apenas a incorporação, sem refazer a transcrição. | F | Deve ter | NOVO | E7 | Forçar a falha da ferramenta de incorporação: não resta vídeo parcial, as legendas mantêm-se e repetir lança só a incorporação. |
| REQ-VID-LEG-043 | O sistema deve, quando as legendas e o estilo são iguais aos da última incorporação consolidada, apresentar de imediato o resultado existente sem criar execução. | F | Deveria ter | ALT *(reutiliza fingerprint)* | FA8, A6 | Incorporar duas vezes seguidas sem alterações: a segunda não publica mensagem na fila e mostra o resultado existente. |
| REQ-VID-LEG-044 | O sistema deve permitir reproduzir o resultado (vídeo com legendas incorporadas) antes de o descarregar. | F | Deveria ter | NOVO | Passo 10 | O vídeo resultante é reproduzido no reprodutor com as legendas visíveis. |
| REQ-VID-LEG-045 | O sistema deve disponibilizar o ficheiro pedido (legendas ou vídeo) através de um URL pré-assinado. | F | Deve ter | ALT *(reutiliza URL pré-assinado)* | Passo 10 | O URL permite descarregar o ficheiro correto e deixa de funcionar depois de expirar. |
| REQ-VID-LEG-046 | O sistema deve, quando o link de download expirou ou o ficheiro foi removido, informar o utilizador e oferecer a geração de um novo link a partir do resultado guardado no projeto. | F | Deveria ter | ALT | E10 | Com um link expirado, aparece a mensagem e a opção funciona se o resultado ainda existir no projeto. |
| REQ-VID-LEG-047 | O sistema não deve contabilizar como utilização do serviço as execuções falhadas, canceladas ou que não produzam segmentos, devolvendo as operações eventualmente reservadas. | F | Deveria ter | ALT *(estende reembolso T-07)* | RN11, E5, E6, FA9 | Nos cenários de falha do serviço (E6), sem fala (E5) e cancelamento (FA9), o contador de operações do utilizador é igual antes e depois. |
| REQ-VID-LEG-048 | O áudio extraído, as transcrições e as legendas devem estar encriptados em trânsito (TLS 1.2 ou superior) e em repouso. | NF (Segurança) | Deve ter | ALT *(estende RNF44 e storage)* | RN10, R3, Stakeholder RGPD | Inspecionar o armazenamento e a base de dados: o conteúdo não é legível sem a chave; as ligações usam TLS. |
| REQ-VID-LEG-049 | O sistema deve eliminar o áudio extraído depois da transcrição e remover ficheiros temporários e resultados parciais em caso de sucesso, falha ou cancelamento. | NF (Integridade) | Deve ter | NOVO | RN10, Garantia de Sucesso e Mínima | Após cada um dos 3 desfechos, o volume partilhado e o armazenamento não contêm áudio extraído, temporários nem parciais dessa execução. |
| REQ-VID-LEG-050 | O sistema deve permitir aceder às legendas, às transcrições e ao áudio apenas ao dono do projeto ou a quem tenha um link de partilha válido, com permissões de convidado a definir. | NF (Segurança) | Deve ter | ALT *(estende RF53 e RNF44)* | RN10, Q6 | Pedido com outro utilizador autenticado é recusado; com link revogado é recusado; com link válido segue as permissões definidas. |
| REQ-VID-LEG-051 | O cancelamento deve devolver a interface a um estado utilizável em menos de 1 s. | NF (Desempenho) | Deve ter | ALT *(estende T-01)* | RN9, FA9 | Em 20 cancelamentos medidos, pelo menos 95% devolvem a interface utilizável em menos de 1 s. |
| REQ-VID-LEG-052 | Os eventos de progresso devem chegar à interface com um atraso máximo de 2 s (proposto). | NF (Desempenho) | Deveria ter | ALT | Passo 4, RN9 | Comparar o instante de publicação do evento com o da sua apresentação: atraso $\le$ 2 s em 95% dos eventos de 3 execuções. |
| REQ-VID-LEG-053 | A geração de legendas deve processar o áudio por blocos com progresso parcial e concluir em tempo não superior a 2 vezes a duração do áudio, para vídeos até 10 min (proposto); fica por confirmar se esta ferramenta é exceção ao limite de 60 s da restrição R5. | NF (Desempenho) | Deveria ter | NOVO | Q1, R5 | Medir a geração em vídeos de 1, 5 e 10 min com o serviço de transcrição escolhido; o progresso parcial é visível durante a execução. |
| REQ-VID-LEG-054 | A geração de legendas e a incorporação devem executar-se em consumidores e filas dedicados, para que tarefas longas não atrasem as operações de imagem existentes. | NF (Desempenho) | Deve ter | ALT *(estende RabbitMQ e RNF43)* | Stakeholder DevOps, R5 | Com uma geração de legendas em curso, 90% de 20 aplicações de um filtro simples a uma imagem concluem em menos de 5 s (RNF43). |
| REQ-VID-LEG-055 | O serviço de transcrição deve ser configurável por variável de ambiente, permitindo substituir o mock por um modelo local ou por uma API externa sem alterar código. | NF (Manutenibilidade) | Deveria ter | NOVO *(padrão GEN_EXPAND_URL)* | A2, Q2, R1 | Alterar a variável e reiniciar o serviço faz os pedidos seguirem para o novo destino, sem nova construção da imagem. |
| REQ-VID-LEG-056 | Todas as exceções E1 a E10 devem ser comunicadas através do módulo central de mensagens de erro, em português, indicando a causa e a ação possível. | NF (Usabilidade) | Deveria ter | ALT *(estende T-02)* | E1 a E10, T-02 | Provocar cada exceção: a mensagem aparece em português com causa e ação, sem texto técnico. |
| REQ-VID-LEG-057 | O reprodutor e a sobreposição das legendas devem funcionar nos navegadores Chrome, Edge, Firefox e Safari, nas versões recentes. | NF (Compatibilidade) | Deveria ter | NOVO | R4, A7 | Teste manual em cada navegador com um MP4 H.264/AAC: reprodução e sobreposição corretas. |
| REQ-VID-LEG-058 | A gravação do rascunho deve usar controlo de versão otimista para impedir que uma edição sobreponha outra feita em simultâneo, com a política de edição por convidados a definir. | NF (Integridade) | Deveria ter | ALT *(estende RNF46 e RNF53)* | Q6, Q7 | Duas sessões editam o mesmo rascunho: a gravação com versão desatualizada recebe conflito e nenhum dado é perdido. |
| REQ-VID-LEG-059 | Quando o serviço de transcrição for real (modelo local ou API), a transcrição de fala clara nos 4 idiomas suportados deve ter uma taxa de erro de palavras (WER) não superior a 25% (proposto). | NF (Qualidade) | Poderia ter | NOVO | Stakeholder Audiência, Q2 | Medir o WER em amostras de referência de fala clara para cada idioma; não aplicável com o mock. |

### 4.2 Impacto no Sistema Existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Frontend: página de projeto e barra de ferramentas | Estender | Nova ferramenta "Legendas automáticas", reprodutor de vídeo e editor de legendas. A página atual está centrada em imagens, pelo que é preciso confirmar no código o que assume sobre o tipo de ficheiro. | REQ-VID-LEG-001, REQ-VID-LEG-002, REQ-VID-LEG-004, REQ-VID-LEG-005, REQ-VID-LEG-006, REQ-VID-LEG-023 a REQ-VID-LEG-028, REQ-VID-LEG-031, REQ-VID-LEG-032, REQ-VID-LEG-034, REQ-VID-LEG-035, REQ-VID-LEG-044, REQ-VID-LEG-057 |
| Frontend: overlay de processamento e cancelamento (T-10) | Estender | Reutilizar o overlay com barra de progresso e botão Cancelar, acrescentando as fases da geração e da incorporação. | REQ-VID-LEG-011, REQ-VID-LEG-012, REQ-VID-LEG-014, REQ-VID-LEG-051, REQ-VID-LEG-052 |
| Frontend: download (T-09, ZIP e PDF) | Estender | Novas opções de download (SRT, WebVTT, MP4) ao lado das existentes, que se mantêm. | REQ-VID-LEG-035, REQ-VID-LEG-036, REQ-VID-LEG-037, REQ-VID-LEG-045, REQ-VID-LEG-046 |
| Frontend: mensagens de erro (T-02) | Estender | Novos códigos e textos para as exceções do vídeo e das legendas. | REQ-VID-LEG-004, REQ-VID-LEG-007, REQ-VID-LEG-008, REQ-VID-LEG-020, REQ-VID-LEG-021, REQ-VID-LEG-022, REQ-VID-LEG-042, REQ-VID-LEG-046, REQ-VID-LEG-056 |
| API Gateway | Estender | Novas rotas para gerar, cancelar, guardar rascunho e exportar, mantendo a validação de JWT e a propagação do perfil do utilizador. A autenticação não muda. | REQ-VID-LEG-003, REQ-VID-LEG-009, REQ-VID-LEG-010, REQ-VID-LEG-012, REQ-VID-LEG-029, REQ-VID-LEG-030, REQ-VID-LEG-050 |
| Project Service: modelo de dados do projeto | Alterar | Passa a suportar vídeos e legendas versionadas (segmentos, idioma, versão do vídeo de origem, estado "desatualizadas"), para além das imagens. É o ponto onde o modelo muda. | REQ-VID-LEG-029, REQ-VID-LEG-030, REQ-VID-LEG-033, REQ-VID-LEG-034, REQ-VID-LEG-040, REQ-VID-LEG-058 |
| Project Service: execuções com token e cache por fingerprint | Estender | Aplicar o mecanismo de `activeToken`, `committedToken` e `prevCommittedToken` e o short-circuit a duas execuções encadeadas (transcrição e incorporação). A assunção A6 tem de ser validada no código, porque foi desenhado para imagens. | REQ-VID-LEG-009, REQ-VID-LEG-010, REQ-VID-LEG-012, REQ-VID-LEG-013, REQ-VID-LEG-043 |
| Project Service: validação do vídeo e do perfil | Estender | Obter metadados do vídeo (áudio, duração, tamanho) e validá-los antes de criar a execução. | REQ-VID-LEG-003, REQ-VID-LEG-007, REQ-VID-LEG-008 |
| Tools (Tools/utils e novas ferramentas) | Estender | Duas novas ferramentas Python, uma de transcrição e outra de incorporação, que reutilizam os utilitários de RabbitMQ e de mensagens. Necessitam de processamento de áudio e vídeo (por exemplo, FFmpeg). | REQ-VID-LEG-015 a REQ-VID-LEG-022, REQ-VID-LEG-038, REQ-VID-LEG-040, REQ-VID-LEG-041, REQ-VID-LEG-042, REQ-VID-LEG-049 |
| RabbitMQ (exchange picturas e definições de filas) | Estender | Novas filas e consumidores dedicados às duas ferramentas. | REQ-VID-LEG-009, REQ-VID-LEG-054 |
| WebSocket Gateway | Estender | Novos eventos de progresso por fase e consulta do estado de uma execução. Continua a comunicar apenas com o RabbitMQ. | REQ-VID-LEG-011, REQ-VID-LEG-014, REQ-VID-LEG-052 |
| Image Storage e SeaweedFS | Estender | Guardar vídeos até 500 MB, versões de vídeo e ficheiros exportados, com URL pré-assinado. A encriptação em repouso mantém-se. O nome "Image Storage" deixa de descrever o âmbito do serviço. | REQ-VID-LEG-040, REQ-VID-LEG-045, REQ-VID-LEG-046, REQ-VID-LEG-048 |
| Nginx | Estender | Pode ser preciso ajustar o limite do corpo dos pedidos e os tempos limite para ficheiros grandes, caso o carregamento de vídeo (A1) ainda não o tenha feito. | REQ-VID-LEG-008 |
| Users Service e Subscriptions | Estender | Verificar o perfil premium nesta ferramenta, mantendo o premium sem limite diário, e reutilizar o reembolso de operações. | REQ-VID-LEG-003, REQ-VID-LEG-004, REQ-VID-LEG-047 |
| Partilha e colaboração (UC07, presença e versão do projeto) | Manter | Mantém-se como está. Fica por decidir se os convidados com permissão de edição podem editar as legendas (Q6). | REQ-VID-LEG-050, REQ-VID-LEG-058 |
| Ferramentas de imagem existentes | Manter | Sem alterações, mas o seu desempenho não pode degradar com as novas ferramentas em execução. | REQ-VID-LEG-054 |
| Backups (mongo-backup) e encriptação de campos | Manter | Os rascunhos das legendas ficam na base de dados do Project Service e são abrangidos pelos backups existentes. | REQ-VID-LEG-048 |
| docker-compose.yaml | Estender | Novos serviços (ferramentas e mock de transcrição, análogo ao generative-mock), limites de memória e variável de configuração do serviço de transcrição. | REQ-VID-LEG-054, REQ-VID-LEG-055 |
| Requisitos existentes (RF64, RF65, RNF43, RNF44, RNF46, RNF53, RNF57) | Estender | A ferramenta passa a estar abrangida por estes requisitos. O RNF57 (dados da IA não persistidos) é coerente com a eliminação do áudio extraído em LEG-049. | REQ-VID-LEG-004, REQ-VID-LEG-022, REQ-VID-LEG-048, REQ-VID-LEG-049, REQ-VID-LEG-050, REQ-VID-LEG-054, REQ-VID-LEG-058 |

### 4.3 Matriz de Rastreabilidade
| Elemento do Caso de Uso | Descrição do Elemento | Requisitos Mapeados |
| :--- | :--- | :--- |
| **UC-VID-001: Trigger** | O utilizador seleciona a ferramenta | REQ-VID-LEG-002 |
| **UC-VID-001: Passo 1** | Selecionar vídeo e abrir no reprodutor | REQ-VID-LEG-001 |
| **UC-VID-001: Passo 2** | Verificar perfil e apresentar opções | REQ-VID-LEG-003, REQ-VID-LEG-006 |
| **UC-VID-001: Passo 3** | Escolher idioma, validar vídeo, criar execução | REQ-VID-LEG-007, REQ-VID-LEG-008, REQ-VID-LEG-009 |
| **UC-VID-001: Passo 4** | Progresso em tempo real com cancelar | REQ-VID-LEG-011, REQ-VID-LEG-052 |
| **UC-VID-001: Passo 5** | Extrair áudio, transcrever, segmentar, marcar incertos | REQ-VID-LEG-015, REQ-VID-LEG-016, REQ-VID-LEG-018, REQ-VID-LEG-019, REQ-VID-LEG-053 |
| **UC-VID-001: Passo 6** | Consolidar e apresentar o editor | REQ-VID-LEG-023 |
| **UC-VID-001: Passo 7** | Rever e editar, validar, guardar rascunho | REQ-VID-LEG-024, REQ-VID-LEG-025, REQ-VID-LEG-026, REQ-VID-LEG-027, REQ-VID-LEG-029 |
| **UC-VID-001: Passo 8** | Escolher a saída e iniciar a incorporação | REQ-VID-LEG-035, REQ-VID-LEG-036, REQ-VID-LEG-037, REQ-VID-LEG-038, REQ-VID-LEG-039 |
| **UC-VID-001: Passo 9** | Incorporar e guardar como nova versão | REQ-VID-LEG-011, REQ-VID-LEG-038, REQ-VID-LEG-040, REQ-VID-LEG-041 |
| **UC-VID-001: Passo 10** | Reproduzir e descarregar | REQ-VID-LEG-044, REQ-VID-LEG-045 |
| **UC-VID-001: FA1** | Deteção automática do idioma | REQ-VID-LEG-006, REQ-VID-LEG-017 |
| **UC-VID-001: FA2** | Idioma incorreto, gerar de novo | REQ-VID-LEG-031 |
| **UC-VID-001: FA3** | Rever apenas segmentos incertos | REQ-VID-LEG-019, REQ-VID-LEG-032 |
| **UC-VID-001: FA4** | Retomar a revisão mais tarde | REQ-VID-LEG-029, REQ-VID-LEG-030 |
| **UC-VID-001: FA5** | Editar legendas já existentes | REQ-VID-LEG-030, REQ-VID-LEG-031 |
| **UC-VID-001: FA6** | Apenas exportar o ficheiro de legendas | REQ-VID-LEG-035, REQ-VID-LEG-036, REQ-VID-LEG-037 |
| **UC-VID-001: FA7** | Vídeo alterado depois de gerar as legendas | REQ-VID-LEG-033, REQ-VID-LEG-034 |
| **UC-VID-001: FA8** | Incorporação sem alterações | REQ-VID-LEG-043 |
| **UC-VID-001: FA9** | Cancelamento pelo utilizador | REQ-VID-LEG-012, REQ-VID-LEG-013, REQ-VID-LEG-047, REQ-VID-LEG-051 |
| **UC-VID-001: FA10** | Recuperação da ligação em tempo real | REQ-VID-LEG-014 |
| **UC-VID-001: E1** | Perfil sem acesso | REQ-VID-LEG-003, REQ-VID-LEG-004, REQ-VID-LEG-005, REQ-VID-LEG-056 |
| **UC-VID-001: E2** | Vídeo sem pista de áudio | REQ-VID-LEG-007, REQ-VID-LEG-056 |
| **UC-VID-001: E3** | Duração ou tamanho excedidos | REQ-VID-LEG-008, REQ-VID-LEG-056 |
| **UC-VID-001: E4** | Formato ou codec não suportado, extração falha | REQ-VID-LEG-020, REQ-VID-LEG-056 |
| **UC-VID-001: E5** | Sem fala detetável | REQ-VID-LEG-021, REQ-VID-LEG-047, REQ-VID-LEG-056 |
| **UC-VID-001: E6** | Serviço de transcrição indisponível ou com erro | REQ-VID-LEG-022, REQ-VID-LEG-047, REQ-VID-LEG-056 |
| **UC-VID-001: E7** | Falha a meio da incorporação | REQ-VID-LEG-042, REQ-VID-LEG-056 |
| **UC-VID-001: E8** | Edição inválida | REQ-VID-LEG-027, REQ-VID-LEG-028, REQ-VID-LEG-056 |
| **UC-VID-001: E9** | Execução ativa no projeto | REQ-VID-LEG-010, REQ-VID-LEG-056 |
| **UC-VID-001: E10** | Link de download expirado | REQ-VID-LEG-046, REQ-VID-LEG-056 |
| **UC-VID-001: RN1** | Exclusivo do perfil premium | REQ-VID-LEG-003, REQ-VID-LEG-004, REQ-VID-LEG-005 |
| **UC-VID-001: RN2** | Limites de duração, tamanho e idiomas | REQ-VID-LEG-006, REQ-VID-LEG-008 |
| **UC-VID-001: RN3** | Vídeo com pista de áudio com fala | REQ-VID-LEG-007, REQ-VID-LEG-021 |
| **UC-VID-001: RN4** | Regras de cada segmento de legenda | REQ-VID-LEG-018, REQ-VID-LEG-027, REQ-VID-LEG-028 |
| **UC-VID-001: RN5** | Legendas associadas à versão do vídeo | REQ-VID-LEG-033, REQ-VID-LEG-034 |
| **UC-VID-001: RN6** | O original nunca é alterado | REQ-VID-LEG-040 |
| **UC-VID-001: RN7** | Formatos de exportação | REQ-VID-LEG-036, REQ-VID-LEG-037, REQ-VID-LEG-040 |
| **UC-VID-001: RN8** | Uma execução ativa por projeto | REQ-VID-LEG-010, REQ-VID-LEG-013 |
| **UC-VID-001: RN9** | Progresso em tempo real e cancelamento em menos de 1 s | REQ-VID-LEG-011, REQ-VID-LEG-051 |
| **UC-VID-001: RN10** | Proteção de áudio, transcrições e legendas | REQ-VID-LEG-048, REQ-VID-LEG-049, REQ-VID-LEG-050 |
| **UC-VID-001: RN11** | Falhas e cancelamentos não contam como utilização | REQ-VID-LEG-047 |
| **UC-VID-001: A2, A3, Q2, R1** | Serviço de transcrição configurável, sem tradução | REQ-VID-LEG-016, REQ-VID-LEG-055 |
| **UC-VID-001: A5** | Legendas guardadas como dados do projeto | REQ-VID-LEG-029, REQ-VID-LEG-033 |
| **UC-VID-001: A6** | Reutilização de tokens, WebSocket e fingerprint | REQ-VID-LEG-009 a REQ-VID-LEG-014, REQ-VID-LEG-043 |
| **UC-VID-001: A7, R4** | Sobreposição no browser e compatibilidade de navegadores | REQ-VID-LEG-023, REQ-VID-LEG-057 |
| **UC-VID-001: Q1, R5** | Tempo de processamento de áudio longo | REQ-VID-LEG-053 |
| **UC-VID-001: Q4** | Estilo das legendas incorporadas | REQ-VID-LEG-039 |
| **UC-VID-001: Q6, Q7** | Edição por convidados, concorrência e rascunho | REQ-VID-LEG-050, REQ-VID-LEG-058 |
| **Stakeholder Equipa DevOps** | Tarefas longas sem degradar as de imagem | REQ-VID-LEG-054 |
| **Stakeholder Audiência** | Legendas fiéis ao que é dito | REQ-VID-LEG-059 |
| **UC-VID-001: T-02** | Mensagens de erro uniformizadas | REQ-VID-LEG-056 |