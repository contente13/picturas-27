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
| Stakeholders e Interesses | - Utilizador premium: legendas corretas e sincronizadas, com o mínimo de correção manual, e controlo sobre o resultado final.<br>- Utilizador registado (gratuito): perceber o que a funcionalidade oferece e o que ganha em subscrever o Premium.<br>- Utilizador anónimo: ser encaminhado para registo/login, preservando o contexto de navegação; o perfil anónimo não processa vídeos no MVP.<br>- Audiência do vídeo: legendas legíveis e fiéis ao que é dito (acessibilidade).<br>- Serviço de IA de transcrição (sistema externo ou local): pedidos bem formados e dentro dos limites de utilização.<br>- Equipa DevOps / Desenvolvimento: tarefas longas que não degradem as operações de imagem, com filas controladas e ficheiros temporários limpos.<br>- Administrador de sistema / RGPD: o áudio e as transcrições são dados pessoais, devendo ser protegidos (encriptação em repouso e em trânsito, acesso restrito).<br>- Proprietário do negócio: diferenciação entre planos que incentive a subscrição Premium. |
| Pré-condições | - O utilizador está autenticado com perfil premium.<br>- O projeto tem pelo menos um vídeo disponível, carregado com sucesso ou gerado por uma operação anterior, em formato suportado. Os limites de carregamento externo não são reaplicados aos vídeos gerados; a geração de legendas continua sujeita a RN2.<br>- O serviço de transcrição, a fila de mensagens, o armazenamento e o WebSocket Gateway estão disponíveis.<br>- Para iniciar geração ou incorporação, não existe outra execução de processamento de vídeo ativa no mesmo projeto (RN8). A revisão e a exportação apenas de SRT/WebVTT não exigem essa condição. |
| Trigger | O utilizador seleciona a ferramenta "Legendas automáticas" sobre um vídeo do projeto. |

### 2.1.2 Fluxo Principal

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona um vídeo do projeto. | Apresenta o vídeo num reprodutor, com duração, formato e indicação de que tem pista de áudio. |
| 2 | Seleciona a ferramenta "Legendas automáticas". | Verifica o perfil (premium) e apresenta as opções: idioma da fala (deteção automática por omissão) e estado atual (sem legendas). |
| 3 | Escolhe o idioma (ou mantém a deteção automática) e confirma "Gerar legendas". | Valida o vídeo (pista de áudio, duração, tamanho e formato, RN2, RN3 e RN12), verifica a concorrência (RN8), cria uma execução e publica o pedido de transcrição na fila RabbitMQ. |
| 4 | — | Mostra o progresso em tempo real (extração do áudio, transcrição, ajuste dos tempos) com a opção "Cancelar". |
| 5 | — | A ferramenta extrai o áudio do vídeo, envia-o ao serviço de transcrição e obtém o texto com marcas de tempo. Agrupa o texto em segmentos de legenda segundo as regras de RN4 e marca os de baixa confiança. |
| 6 | — | Consolida a execução e apresenta o editor de legendas: lista de segmentos (início, fim, texto) sincronizada com o reprodutor, que mostra as legendas sobrepostas ao vídeo. Indica o idioma detetado e o número de segmentos incertos. |
| 7 | Revê as legendas: reproduz o vídeo, edita o texto, ajusta tempos, junta, divide, apaga ou adiciona segmentos. | Valida cada alteração (RN4), atualiza a sobreposição no reprodutor e guarda o rascunho automaticamente no projeto. |
| 8 | Escolhe a saída: "Descarregar legendas" (SRT ou WebVTT) ou "Incorporar no vídeo" (estilo por omissão; configuração de tamanho, posição e cor sujeita a Q4). | Se a escolha for só descarregar, gera o ficheiro de legendas e avança para o passo 10. Se for incorporar, verifica RN8 e cria uma nova execução na fila com estilo por omissão; a configuração de tamanho, posição e cor é proposta sujeita a Q4. |
| 9 | — | A ferramenta de incorporação produz um novo vídeo com as legendas gravadas na imagem, enviando o progresso pelo WebSocket. Valida o resultado e guarda-o como nova versão do vídeo, sem alterar o original (RN6). O resultado fica disponível na biblioteca do projeto para reprodução e utilização em operações posteriores. |
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
| FA7 – Vídeo alterado depois de gerar as legendas | Quando o vídeo é recortado através de UC-VID-002, o novo vídeo herda uma cópia independente dos segmentos que intersectem o intervalo selecionado. Os tempos são limitados ao intervalo e ajustados relativamente ao início do recorte; segmentos com duração resultante inferior a 0,5 s são descartados. O vídeo original e as suas legendas permanecem inalterados (RN5). |
| FA8 – Incorporação sem alterações | No passo 8, a versão do vídeo, as legendas e as opções de estilo são iguais às da última incorporação consolidada. O sistema não cria execução nova e apresenta de imediato o resultado existente (passo 10). |
| FA9 – Cancelamento pelo utilizador | Durante os passos 4 a 5 ou 9, o utilizador seleciona "Cancelar". O sistema interrompe a execução, descarta os resultados parciais e restaura o estado anterior do projeto (sem legendas, ou com as últimas legendas guardadas), sem recarregar a página. |
| FA10 – Recuperação da ligação em tempo real | Durante os passos 4 a 5 ou 9, o utilizador perde a ligação WebSocket. Ao reconectar, o sistema consulta o estado da execução e retoma o progresso ou apresenta o resultado, sem interromper o processamento. |

### 2.1.4 Exceções

| Condição | Comportamento do Sistema |
|---|---|
| E1 – Perfil sem acesso (passo 2): o utilizador é registado (gratuito) ou anónimo. | Bloqueia a funcionalidade. Ao registado, mostra "Disponível apenas no plano Premium" e sugere o upgrade. Ao anónimo, pede registo ou login e preserva o contexto de navegação, sujeito às permissões após autenticação. Não cria execução. |
| E2 – Vídeo sem pista de áudio (passo 3). | Recusa a geração e informa que o vídeo não tem áudio para transcrever. Não cria execução nem gera custo. |
| E3 – Duração ou tamanho do vídeo excedem o limite (passo 3). | Recusa a geração antes de criar a execução, indica o limite aplicável (RN2) e sugere recortar o vídeo antes de gerar legendas. |
| E4 – Formato ou codec de áudio não suportado, ou extração do áudio falha (passo 5). | Termina a execução, indica que o áudio do vídeo não pôde ser lido e sugere converter o vídeo para MP4 (H.264/AAC). O projeto fica inalterado. |
| E5 – Sem fala detetável (passo 5): o áudio contém apenas música, ruído ou silêncio. | Conclui sem novos segmentos, apresenta editor vazio sem substituir eventuais legendas já guardadas e informa que não foi detetada fala e permite tentar noutro idioma ou adicionar legendas manualmente. A execução não gera custo. |
| E6 – Serviço de transcrição indisponível, com erro ou tempo excedido (passo 5). | Termina a execução, mostra "Falha no processamento. Tente novamente.", mantém o projeto inalterado e permite repetir o pedido. A execução não gera custo. |
| E7 – Falha a meio da incorporação (passo 9). | Descarta o vídeo parcial, mantém as legendas editadas e o vídeo anterior, e informa o erro com a opção de repetir só a incorporação, sem refazer a transcrição. |
| E8 – Edição inválida (passo 7): sobreposição de tempos, início ≥ fim, texto vazio ou texto acima do limite de caracteres. | Assinala o segmento com o problema, explica a regra violada (RN4) e bloqueia a exportação enquanto existirem erros. |
| E9 – Já existe uma execução ativa no projeto (passos 3 ou 8). | Impede nova execução, informa que há um processamento em curso e oferece cancelá-lo ou aguardar. |
| E10 – Link de download expirado ou ficheiro removido (passo 10). | Informa que o link ou ficheiro não está disponível. Se o resultado ainda existir no projeto, oferece novo URL pré-assinado; se tiver sido removido, não gera link para um ficheiro inexistente e informa que é necessário voltar a exportar/incorporar a partir dos dados disponíveis. |

### 2.1.5 Pós-condições

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | O projeto contém as legendas revistas e guardadas, associadas à versão do vídeo para a qual foram geradas. Se o utilizador incorporou as legendas, existe uma nova versão do vídeo com elas gravadas, e o original permanece inalterado. O ficheiro pedido (legendas ou vídeo) está disponível para download, guardado de forma encriptada. Não restam ficheiros temporários. O resultado incorporado fica na biblioteca do projeto para reprodução e operações posteriores; o projeto continua disponível para edição. |
| Garantia Mínima | Em qualquer falha ou cancelamento, o vídeo original e o último estado consolidado do projeto, incluindo as legendas já guardadas, ficam intactos e utilizáveis. Os resultados parciais são removidos, nenhuma execução falhada ou cancelada gera custo, e o utilizador recebe uma mensagem a explicar o que aconteceu e pode tentar novamente. |

### 2.1.6 Regras de Negócio e Restrições

| ID | Regra |
|---|---|
| RN1 | A funcionalidade só está disponível para o perfil premium. O registado (gratuito) recebe aviso de plano e o anónimo é encaminhado para o registo. |
| RN2 | Limites do vídeo para gerar legendas: duração ≤ 10 min e tamanho ≤ 500 MB. Idiomas suportados no MVP: português, inglês, espanhol e francês. Estes limites são específicos da transcrição e não substituem os limites gerais de carregamento do perfil; são propostas sujeitas a validação (A4). |
| RN3 | O vídeo tem de ter pelo menos uma pista de áudio com fala. |
| RN4 | Cada segmento tem texto não vazio e tempos dentro da duração da versão do vídeo (`0 ≤ início < fim ≤ duração`), sem sobreposição, duração entre 0,5 s e 10 s e no máximo 2 linhas de 42 caracteres. Alterações inválidas são assinaladas e bloqueiam exportação/incorporação até correção (E8). |
| RN5 | As legendas ficam associadas à versão do vídeo para a qual foram geradas. Num recorte (UC-VID-002 — RN7), o novo vídeo herda uma cópia independente dos segmentos que intersectem o intervalo: `início_novo = max(início, T_in) − T_in` e `fim_novo = min(fim, T_out) − T_in`. Segmentos com duração resultante inferior a 0,5 s são descartados; os restantes cumprem RN4. As legendas do original permanecem inalteradas. |
| RN6 | O vídeo original nunca é alterado. Uma incorporação executada com sucesso produz uma nova versão; quando já existir resultado equivalente para a mesma versão de vídeo, legendas e estilo, reutiliza-se esse resultado sem criar execução ou versão adicional (FA8). |
| RN7 | Formatos de exportação: SRT e WebVTT para o ficheiro de legendas; MP4 (H.264/AAC) para o vídeo com legendas incorporadas. |
| RN8 | Cada projeto pode ter no máximo uma execução de processamento de vídeo Em Fila ou Em Processamento, independentemente da ferramenta (geração/incorporação de legendas, recorte ou concatenação). A verificação e a criação/reserva da execução impedem duas tarefas simultâneas. Resultados tardios de execuções canceladas ou falhadas são ignorados. Rever legendas ou exportar apenas SRT/WebVTT não cria execução de vídeo. |
| RN9 | O progresso deve ser comunicado em tempo real e o cancelamento deve devolver a interface a um estado utilizável em menos de 1 s. |
| RN10 | Os vídeos originais e derivados, o áudio, as transcrições e as legendas ficam encriptados em repouso e em trânsito e são acessíveis ao proprietário do projeto ou a quem tenha um link de partilha válido. O áudio extraído é eliminado após a transcrição. O acesso por link não dispensa a autenticação e o perfil Premium exigidos para executar a ferramenta. |
| RN11 | Execuções falhadas, canceladas ou de geração que não produzam qualquer segmento não são contabilizadas como utilização do serviço; quaisquer reservas e slots são libertados. Uma geração sem fala apresenta editor vazio (E5), mantendo o último estado guardado quando já existirem legendas. O acesso é Premium, sem limite diário; esta regra não introduz cobrança ou quota numérica adicional. |
| RN12 | Entrada aceite para geração: MP4 (H.264/AAC) e WebM (VP8/Vorbis), com pista de áudio compatível. Vídeos sem áudio são recusados para transcrição (E2). A incorporação produz MP4 (H.264/AAC), independentemente do formato original. |

### 2.1.7 Assunções

| ID | Assunção |
|---|---|
| A1 | O carregamento de vídeo e a sua validação inicial já fazem parte do MVP, e este caso de uso parte de um vídeo disponível no projeto, carregado com sucesso ou gerado por uma operação anterior concluída. |
| A2 | A transcrição usa um novo microserviço Python no padrão das ferramentas existentes (RabbitMQ e exchange picturas). O requisito derivado do PDF toma o mock como referência do MVP; a escolha definitiva entre mock, modelo local e API externa permanece em Q2. O destino do serviço é configurável por variável de ambiente, sem alterar código. |
| A3 | O MVP faz apenas transcrição no idioma da fala, sem tradução para outro idioma. |
| A4 | Os limites e os idiomas de RN2 são propostas da equipa, ainda não validadas com a equipa docente. |
| A5 | As legendas são guardadas como dados do projeto (segmentos com início, fim e texto), versionadas com o vídeo, e não como ficheiro do utilizador. |
| A6 | Os mecanismos atuais de token, progresso por WebSocket e cache por fingerprint são candidatos a reutilização. A monitorização, interrupção e limpeza de subprocessos de vídeo são trabalho novo (UC-VID-002 — A4); a aplicabilidade da cache e do restauro deve ser validada, sem assumir reutilização sem alterações. |
| A7 | A sobreposição das legendas no reprodutor, durante a revisão, é feita no browser e não exige processamento no servidor. |
| A8 | O vídeo tem um só idioma de fala e o MVP não distingue falantes diferentes. |
| A9 | Os limites de RN2 e as metas de desempenho são propostas sujeitas a validação: eventos de progresso em ≤ 2 s, interface utilizável após cancelamento em < 1 s, sincronização visual em até 200 ms, alterações no editor em < 1 s e autosave em até 5 s. O processamento por blocos e a meta de transcrição em até 2 vezes a duração do áudio dependem de Q1/Q2. A resposta visual ao cancelamento não equivale ao fim imediato do processo no servidor. |

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
| Q8 | Como harmonizar o acesso por link de partilha de RN10 com o acesso exclusivo do proprietário no recorte (UC-VID-002 — RN9)? O PDF não define uma política comum para os recursos de vídeo. |
| Q9 | Qual o limiar de baixa confiança dos segmentos e da deteção automática do idioma? O PDF prevê a sinalização, mas não fixa os valores. |

---

## 4. Esboço de requisitos derivados

### 4.1 Requisitos de Sistema

| ID | Requisito | Tipo | Prioridade | Novo/Alt | Origem | Como verificar |
|---|---|---|---|---|---|---|
| REQ-VID-LEG-001 | O sistema deve permitir selecionar um vídeo do projeto e abri-lo num reprodutor que mostra a duração, o formato e se tem pista de áudio. | F | Deve ter | NOVO | Passo 1 | Dado um projeto com 3 vídeos, quando o utilizador abre o vídeo de teste, então a duração, o formato e a indicação de áudio são corretos. |
| REQ-VID-LEG-002 | O sistema deve disponibilizar a ferramenta "Legendas automáticas" sobre um vídeo do projeto. | F | Deve ter | NOVO | Trigger, Passo 2 | Dado um vídeo selecionado, quando o utilizador abre a barra de ferramentas, então a ferramenta está visível e utilizável. |
| REQ-VID-LEG-003 | O sistema deve permitir executar a ferramenta apenas a utilizadores premium, validando o perfil no backend e não apenas na interface. | F | Deve ter | NOVO | Passo 2, RN1, E1 | Dado um utilizador registado ou anónimo, quando envia um pedido directo à API, então o pedido é recusado e não cria execução. |
| REQ-VID-LEG-004 | O sistema deve informar o utilizador registado (gratuito) de que a funcionalidade é exclusiva do plano Premium e sugerir o upgrade. | F | Deveria ter | ALT | E1, RN1 | Dado um utilizador gratuito, quando seleciona a ferramenta, então vê a mensagem "Disponível apenas no plano Premium" com ligação para o upgrade. |
| REQ-VID-LEG-005 | O sistema deve pedir registo/login ao anónimo que tente aceder à ferramenta, preservando o contexto de navegação. A autenticação não dispensa a validação do plano Premium nem das permissões sobre o projeto. | F | Deveria ter | NOVO | E1, RN1; UC-VID-002 — A1 | Dado um anónimo que tenta aceder à ferramenta, então é encaminhado para autenticação; depois, o contexto é recuperado apenas se autorizado, e uma conta gratuita continua sem executar a ferramenta. |
| REQ-VID-LEG-006 | O sistema deve apresentar as opções de geração: idioma da fala (português, inglês, espanhol, francês ou deteção automática, esta por omissão) e o estado atual das legendas do vídeo (sem legendas, geradas ou rascunho em revisão). | F | Deve ter | NOVO | Passo 2, RN2, FA1 | Dado um vídeo sem legendas, quando abre a ferramenta, então a lista mostra os 4 idiomas e "Deteção automática" como opção ativa, e o estado do vídeo corresponde ao estado do projeto. |
| REQ-VID-LEG-007 | O sistema deve recusar a geração, antes de criar a execução, se o vídeo não tiver pista de áudio, informando o motivo. | F | Deve ter | NOVO | Passo 3, RN3, E2 | Dado um vídeo sem áudio, quando o utilizador confirma a geração, então o pedido é rejeitado e a mensagem indica ausência de áudio. |
| REQ-VID-LEG-008 | O sistema deve recusar a geração, antes de criar a execução, se o vídeo exceder 10 min de duração ou 500 MB, indicando o limite aplicável e sugerindo recortar o vídeo. | F | Deve ter | NOVO | Passo 3, RN2, E3 | Dado um vídeo de 10 min e 500 MB, quando é submetido, então é aceite; dado um vídeo acima de qualquer limite, então é recusado com mensagem e sem execução criada. |
| REQ-VID-LEG-009 | O sistema deve criar uma execução associada ao projeto e publicar na fila RabbitMQ da ferramenta de transcrição o pedido com o vídeo e o idioma escolhido. | F | Deve ter | ALT | Passo 3 | Dado um pedido válido, quando o utilizador confirma, então o projeto regista uma execução ativa e a mensagem é publicada na fila. |
| REQ-VID-LEG-010 | O sistema deve impedir geração/incorporação enquanto existir qualquer execução de processamento de vídeo Em Fila ou Em Processamento no mesmo projeto, oferecendo cancelá-la ou aguardar. A aceitação concorrente não pode criar duas tarefas ativas. | F | Deve ter | ALT | RN8, E9 | Com recorte ou concatenação ativo no projeto, um pedido de geração/incorporação é recusado; dois pedidos simultâneos deixam no máximo uma execução ativa. |
| REQ-VID-LEG-011 | O sistema deve mostrar o progresso em tempo real, por fases (extração do áudio, transcrição, ajuste dos tempos, incorporação), através do WebSocket, com a opção "Cancelar" sempre disponível. | F | Deve ter | ALT | Passo 4, Passo 9, RN9 | Dado um processamento em curso, quando o estado muda, então a interface mostra a fase atual e a barra de progresso sem recarregar a página. |
| REQ-VID-LEG-012 | O sistema deve permitir cancelar a geração ou a incorporação, interrompendo a execução, descartando os resultados parciais e restaurando o último estado consolidado (sem legendas ou últimas legendas guardadas), sem recarregar a página. | F | Deve ter | ALT | FA9, Garantia Mínima | Dado um processamento em curso, quando o utilizador cancela, então a execução termina e o projeto volta ao estado imediatamente anterior. |
| REQ-VID-LEG-013 | O sistema deve ignorar os resultados tardios de execuções canceladas, validando cada resultado contra o token da execução ativa. | F | Deve ter | ALT | RN8, FA9 | Dado um resultado enviado por uma execução cancelada, quando é recebido, então não é persistido nem apresentado. |
| REQ-VID-LEG-014 | O sistema deve, quando o utilizador volta a ligar-se ao WebSocket durante uma execução, consultar o estado da execução e retomar o progresso ou apresentar o resultado, sem interromper o processamento. | F | Deveria ter | ALT | FA10 | Dado um utilizador com ligação perdida durante uma execução, quando reconecta, então o sistema mostra o estado correto sem interromper a tarefa. |
| REQ-VID-LEG-015 | A ferramenta de transcrição deve extrair a pista de áudio do vídeo. | F | Deve ter | NOVO | Passo 5 | Dado um vídeo de teste com áudio, quando a tarefa executa, então o áudio extraído tem a duração correta. |
| REQ-VID-LEG-016 | A ferramenta de transcrição deve converter a fala em texto com marcas de tempo, no idioma falado e sem tradução, através de um serviço de transcrição configurável (mock no MVP). | F | Deve ter | NOVO | Passo 5, A2, A3 | Dado um vídeo de teste, quando a transcrição termina, então o resultado contém texto com início e fim por segmento. |
| REQ-VID-LEG-017 | O sistema deve detetar o idioma da fala quando o utilizador mantém "Deteção automática", apresentá-lo no editor e, se a confiança for insuficiente, pedir ao utilizador que escolha o idioma e voltar à seleção de opções. | F | Deveria ter | NOVO | FA1 | Dado um vídeo em inglês, quando a deteção automática funciona, então o editor mostra "Inglês"; dado um áudio ambíguo, então o utilizador escolhe o idioma. |
| REQ-VID-LEG-018 | O sistema deve agrupar o texto em segmentos com texto não vazio, tempos dentro do vídeo, sem sobreposição, duração entre 0,5 s e 10 s e no máximo 2 linhas de 42 caracteres, conforme RN4. | F | Deve ter | NOVO | Passo 5, RN4 | Validar segmentos gerados: nenhum tem texto vazio, tempos fora do vídeo, sobreposição ou limites excedidos. |
| REQ-VID-LEG-019 | O sistema deve marcar os segmentos de baixa confiança e indicar o seu número no editor. | F | Deveria ter | NOVO | Passo 5, FA3 | Dado um segmento com confiança baixa, quando o editor abre, então o segmento aparece marcado e o contador mostra o número correto. |
| REQ-VID-LEG-020 | O sistema deve terminar a execução quando o formato ou codec de áudio não for suportado ou a extração falhar, informar que o áudio não pôde ser lido, sugerir converter o vídeo para MP4 (H.264/AAC) e manter o projeto inalterado. | F | Deve ter | NOVO | E4 | Dado um vídeo com áudio corrompido, quando a execução falha, então o projeto permanece inalterado e a mensagem indica a correção sugerida. |
| REQ-VID-LEG-021 | O sistema deve, quando não detetar fala (apenas música, ruído ou silêncio), concluir sem segmentos, informar o utilizador e permitir tentar outro idioma ou adicionar legendas manualmente. | F | Deve ter | NOVO | E5, RN3 | Dado um vídeo apenas com música, quando termina a execução, então o editor apresenta zero segmentos gerados e eventuais legendas anteriores permanecem guardadas e a mensagem oferece ação seguinte. |
| REQ-VID-LEG-022 | O sistema deve, quando o serviço de transcrição estiver indisponível, devolver erro ou exceder o tempo limite, terminar a execução, mostrar "Falha no processamento. Tente novamente.", manter o projeto inalterado e permitir repetir o pedido. | F | Deve ter | ALT | E6 | Dado um serviço indisponível, quando a execução falha, então a mensagem aparece e o projeto não é alterado. |
| REQ-VID-LEG-023 | O sistema deve consolidar a execução e apresentar o editor de legendas: lista de segmentos sincronizada com o reprodutor, com sobreposição no browser e desvio visual proposto de até 200 ms, o idioma detetado e o número de segmentos incertos. | F | Deve ter | NOVO | Passo 6, A7 | Dado um vídeo com segmentos, quando o editor abre, então a lista, a sobreposição e o idioma são consistentes; selecionar um segmento posiciona o reprodutor no início e a legenda visível acompanha a reprodução com desvio ≤ 200 ms (meta proposta). |
| REQ-VID-LEG-024 | O sistema deve permitir editar o texto e os tempos (início e fim) de um segmento. | F | Deve ter | NOVO | Passo 7 | Dado um segmento editado, quando a alteração é confirmada, então a lista e a sobreposição são atualizadas em menos de 1 s. |
| REQ-VID-LEG-025 | O sistema deve permitir adicionar, apagar, juntar e dividir segmentos, mantendo as regras de RN4. | F | Deve ter | NOVO | Passo 7,RN4 | Dado um conteúdo editado, quando o utilizador adiciona, elimina ou divide segmentos, então a estrutura final continua válida ou é assinalada como inválida. |
| REQ-VID-LEG-026 | O sistema deve validar cada alteração contra RN4, assinalando o segmento com problema e explicando a regra violada. | F | Deve ter | NOVO | Passo 7, E8, RN4 | Dado um segmento com início ≥ fim, quando é validado, então o problema é assinalado e a regra é indicada. |
| REQ-VID-LEG-027 | O sistema deve bloquear a exportação (ficheiro e incorporação) enquanto existirem segmentos inválidos. | F | Deve ter | NOVO | E8 | Dado um segmento inválido, quando o utilizador tenta exportar, então a ação é recusada até o segmento ser corrigido. |
| REQ-VID-LEG-028 | O sistema deve guardar automaticamente o rascunho das legendas como dados do projeto, após cada alteração, em até 5 s após a última edição (meta proposta); ao sair da página, assegura a gravação pendente. | F | Deve ter | NOVO | Passo 7, FA4, A5 | Dado uma edição, quando o utilizador fecha a página, então o rascunho é guardado e reaparece ao reabrir; medir gravação em ≤ 5 s após a última edição e verificar a gravação pendente ao sair. |
| REQ-VID-LEG-029 | O sistema deve, ao reabrir um vídeo com legendas guardadas, carregá-las no editor sem repetir a transcrição. | F | Deve ter | NOVO | FA4, FA5 | Dado um vídeo com rascunho guardado, quando o utilizador abre o editor, então as legendas guardadas aparecem e não é criada nova execução. |
| REQ-VID-LEG-030 | O sistema deve permitir gerar de novo as legendas de um vídeo, incluindo com outro idioma, avisando que as edições feitas serão descartadas e pedindo confirmação. | F | Deveria ter | NOVO | FA2, FA5 | Dado um vídeo com legendas existentes, quando o utilizador escolhe "Gerar de novo", então recebe confirmação antes de substituição. |
| REQ-VID-LEG-031 | O sistema deve permitir escolher a saída: descarregar o ficheiro de legendas ou incorporá-las no vídeo; ao escolher só descarregar, não deve criar execução nem novo vídeo. | F | Deve ter | NOVO | Passo 8, FA6 | Dado um conjunto de legendas válidas, quando o utilizador escolhe "Descarregar legendas", então o ficheiro é gerado e não é criada nenhuma execução nova. |
| REQ-VID-LEG-032 | O sistema deve exportar as legendas em SRT e WebVTT e disponibilizar o ficheiro através de um URL pré-assinado. | F | Deve ter | NOVO | Passo 8, RN7, Passo 10 | Dado um ficheiro de legendas gerado, quando é pedido o download, então o URL devolvido funciona e o ficheiro indicado é o correto. |
| REQ-VID-LEG-033 | Quando não existir resultado equivalente reutilizável (FA8), o sistema deve incorporar legendas através de uma nova ferramenta consumidora de RabbitMQ e uma nova execução, com estilo por omissão, validando o resultado (existente, legível e de duração coerente) antes de o guardar em MP4 (H.264/AAC) como nova versão disponível na biblioteca do projeto, sem alterar o original. | F | Deve ter | NOVO | Passos 8 e 9, RN6, RN7, RN12 | Após incorporação, verificar formato/codecs, reprodução e disponibilidade para outras operações; o hash original mantém-se. Um resultado corrompido ou truncado não é consolidado. |
| REQ-VID-LEG-034 | O sistema deve, se a incorporação falhar a meio, descartar o vídeo parcial, manter as legendas editadas e o vídeo anterior, informar o erro e permitir repetir apenas a incorporação. | F | Deve ter | NOVO | E7 | Dado uma incorporação falhada, quando a execução termina, então não existe vídeo parcial, o projeto continua com as legendas válidas e a opção de repetir só a incorporação está disponível. |
| REQ-VID-LEG-035 | O sistema não deve contabilizar como utilização do serviço execuções falhadas, canceladas ou gerações sem segmentos, libertando quaisquer reservas e slots. Falha/cancelamento preserva o último estado consolidado; ausência de fala apresenta editor vazio e preserva legendas já guardadas, quando existirem. | F | Deve ter | ALT | RN11, FA9, E5, E6 | Nos cenários de falha, cancelamento e ausência de fala, o contador não aumenta e reservas são libertadas. Sem fala, é possível adicionar legendas manualmente sem perder as anteriores guardadas. |
| REQ-VID-LEG-036 | O sistema deve garantir a encriptação em trânsito (TLS 1.2 ou superior) e em repouso do áudio, das transcrições e das legendas, e eliminar o áudio extraído após a transcrição. | NF (Segurança) | Deve ter | ALT | RN10 | Dado um ficheiro protecionado, quando é armazenado ou transferido, então usa TLS 1.2 ou superior e não é legível sem as chaves do sistema. |
| REQ-VID-LEG-037 | O sistema deve permitir acesso aos vídeos originais e derivados, às legendas, às transcrições e ao áudio ao proprietário ou através de um link de partilha válido. | NF (Segurança) | Deve ter | ALT | RN10 | O proprietário e quem apresenta um link válido conseguem aceder; outro utilizador sem autorização e quem apresenta link inválido, expirado ou revogado são recusados. Executar a ferramenta continua a exigir autenticação e perfil Premium. |
| REQ-VID-LEG-038 | O cancelamento deve devolver a interface a um estado utilizável em menos de 1 s. | NF (Desempenho) | Deve ter | ALT | RN9, FA9 | Dado 20 cancelamentos em teste, quando o utilizador aciona o botão, então todos os casos devolvem a interface a um estado utilizável em menos de 1 s (meta proposta, a validar). |
| REQ-VID-LEG-039 | Os eventos de progresso devem chegar à interface com um atraso máximo de 2 s e as atualizações de estado em ≤ 5 s. | NF (Desempenho) | Deveria ter | ALT | Passo 4, RN9 | Dado um processamento em execução, quando cada evento é publicado, então a interface mostra a atualização em ≤ 2 s e a apresentação do estado em ≤ 5 s. |
| REQ-VID-LEG-040 | O sistema deve executar a transcrição e a incorporação em filas e consumidores dedicados, para que tarefas longas não atrasem as operações de imagem existentes. | NF (Desempenho) | Deve ter | ALT | Stakeholder DevOps, RN8 | Dado uma geração em curso, quando a aplicação executa uma operação de imagem simples, então pelo menos 90% de 20 aplicações de um filtro simples concluem em menos de 5 s (meta do PDF, sujeita a validação). |
| REQ-VID-LEG-041 | O sistema deve aceitar para transcrição MP4 (H.264/AAC) e WebM (VP8/Vorbis), com pista de áudio compatível, e produzir MP4 (H.264/AAC) na incorporação. | F | Deve ter | NOVO | RN12, E2, E4 | Testar ambos os formatos, verificar a recusa sem áudio e confirmar MP4 H.264/AAC incorporado. |
| REQ-VID-LEG-042 | O sistema deve associar as legendas à versão do vídeo e, no recorte, copiar de forma independente os segmentos que intersectem o intervalo, limitar e reajustar os tempos e descartar durações inferiores a 0,5 s, sem alterar as legendas originais. | F | Deve ter | NOVO | FA7, RN5, A5; UC-VID-002 — RN7 | Dado recorte [10 s, 20 s], [9 s, 10,3 s] é descartado, [12 s, 15 s] passa a [2 s, 5 s] e [19 s, 22 s] passa a [9 s, 10 s]. Editar as cópias não modifica o original. |
| REQ-VID-LEG-043 | O sistema deve filtrar a lista para mostrar só segmentos de baixa confiança, mantendo a sincronização com o reprodutor. | F | Deveria ter | NOVO | FA3 | Com o filtro ativo, só aparecem segmentos marcados e selecionar um posiciona o reprodutor no instante correto. |
| REQ-VID-LEG-044 | Quando a versão do vídeo, as legendas e o estilo coincidirem com uma incorporação consolidada, o sistema deve reutilizar esse resultado sem criar execução. | F | Deveria ter | ALT | FA8, A6 | Incorporar duas vezes sem alterações: a segunda não publica pedido na fila; mudar o vídeo, texto ou estilo exige resultado correspondente. |
| REQ-VID-LEG-045 | O sistema deve permitir pré-visualizar o vídeo incorporado antes do download e renovar URLs pré-assinados expirados apenas se o resultado guardado existir. Se foi removido, informa a necessidade de nova exportação/incorporação. | F | Deveria ter | ALT | Passo 10, E10 | Reproduzir o resultado; expirar o URL e renovar com sucesso. Remover o resultado e verificar que não é gerado link para um objeto inexistente. |
| REQ-VID-LEG-046 | O sistema deve eliminar o áudio extraído após a transcrição e limpar ficheiros temporários e resultados parciais após sucesso, falha ou cancelamento. | NF (Privacidade) | Deve ter | NOVO | RN10, Garantias de Sucesso e Mínima | Nos três desfechos, verificar ausência de áudio extraído, temporários e parciais, preservando vídeos e legendas consolidados. |
| REQ-VID-LEG-047 | A geração deve processar áudio por blocos com progresso parcial e concluir em até 2 vezes a duração do áudio, para vídeos até 10 min. Esta é uma proposta dependente do serviço escolhido e da decisão sobre a exceção ao limite de 60 s de R5. | NF (Desempenho) | Deveria ter | NOVO | Q1, Q2, A9 | Com o serviço escolhido, medir vídeos de 1, 5 e 10 min e verificar progresso parcial e meta proposta. O mock valida o contrato, sem demonstrar desempenho de transcrição real. |
| REQ-VID-LEG-048 | O serviço de transcrição deve ser configurável por variável de ambiente, permitindo substituir mock, modelo local ou API compatível sem alterar código. | NF (Configurabilidade) | Deveria ter | NOVO | A2, Q2 | Alterar a variável e reiniciar: os pedidos seguem para o novo serviço sem reconstruir a imagem. |
| REQ-VID-LEG-049 | As exceções E1 a E10 devem usar o módulo central de mensagens, em português, indicando causa e ação possível. | NF (Usabilidade) | Deveria ter | ALT | E1–E10 | Provocar cada exceção e verificar mensagem em português, sem detalhes técnicos, com ação possível. |
| REQ-VID-LEG-050 | O reprodutor e a sobreposição de legendas devem funcionar nas versões recentes de Chrome, Edge, Firefox e Safari. | NF (Compatibilidade) | Deveria ter | NOVO | A7 | Testar MP4 H.264/AAC em cada navegador e verificar reprodução e legendas. A matriz de compatibilidade WebM deve ser validada separadamente. |
| REQ-VID-LEG-051 | A gravação automática do rascunho deve usar controlo de versão otimista para impedir que edições simultâneas se sobreponham. A política de edição por convidados fica em Q6. | NF (Integridade) | Deveria ter | ALT | Passo 7, Q6, Q7 | Duas sessões editam a mesma versão: a segunda gravação recebe conflito e não substitui silenciosamente as alterações da primeira. |
| REQ-VID-LEG-052 | Quando o serviço de transcrição for real, a fala clara nos quatro idiomas deve ter taxa de erro de palavras (WER) ≤ 25%, meta proposta a validar. Não se aplica ao mock. | NF (Qualidade) | Poderia ter | NOVO | Stakeholder Audiência, Q2 | Medir WER em amostras de referência de cada idioma com o serviço real; não usar resultados do mock como prova de qualidade. |
| REQ-VID-LEG-053 | O sistema deve permitir configurar tamanho, posição e cor do texto incorporado, caso esta opção seja aprovada para o MVP; até à decisão em Q4, o fluxo usa estilo por omissão. | F | Poderia ter | NOVO | Passo 8, Q4 | Se aprovada, alterar cada opção e verificar o efeito no resultado; até lá, validar o estilo por omissão. |

### 4.2 Impacto no Sistema Existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Frontend: página de projeto e barra de ferramentas | Estender | Nova ferramenta "Legendas automáticas", reprodutor de vídeo e editor de legendas. A página atual está centrada em imagens, pelo que é preciso confirmar no código o que assume sobre o tipo de ficheiro. | REQ-VID-LEG-001, REQ-VID-LEG-002, REQ-VID-LEG-006, REQ-VID-LEG-023, REQ-VID-LEG-024, REQ-VID-LEG-025, REQ-VID-LEG-028, REQ-VID-LEG-031, REQ-VID-LEG-032 |
| Frontend: overlay de processamento e cancelamento | Estender | Reutilizar o overlay com barra de progresso e botão Cancelar, acrescentando as fases da geração e da incorporação. | REQ-VID-LEG-011, REQ-VID-LEG-012, REQ-VID-LEG-014, REQ-VID-LEG-038, REQ-VID-LEG-039 |
| Frontend: download e exportação | Estender | Novas opções de download (SRT, WebVTT, MP4) ao lado das existentes. | REQ-VID-LEG-031, REQ-VID-LEG-032, REQ-VID-LEG-033 |
| API Gateway | Estender | Novas rotas para gerar, cancelar, guardar rascunho e exportar, mantendo a validação de JWT e a propagação do perfil do utilizador. | REQ-VID-LEG-003, REQ-VID-LEG-009, REQ-VID-LEG-010, REQ-VID-LEG-028, REQ-VID-LEG-029, REQ-VID-LEG-037 |
| Project Service: modelo de dados do projeto | Alterar | Passa a suportar vídeos, legendas versionadas (segmentos, idioma e versão do vídeo de origem), cópias independentes ajustadas ao recorte e rascunhos com controlo de versão otimista. | REQ-VID-LEG-028, REQ-VID-LEG-029, REQ-VID-LEG-030, REQ-VID-LEG-033, REQ-VID-LEG-042, REQ-VID-LEG-051 |
| Tools | Estender | Duas novas ferramentas Python, uma de transcrição e outra de incorporação, que reutilizam utilitários de RabbitMQ e de mensagens. | REQ-VID-LEG-015, REQ-VID-LEG-016, REQ-VID-LEG-020, REQ-VID-LEG-021, REQ-VID-LEG-022, REQ-VID-LEG-034, REQ-VID-LEG-036 |
| RabbitMQ e WebSocket Gateway | Estender | Novas filas e eventos de progresso por fase e consulta do estado de execução. | REQ-VID-LEG-009, REQ-VID-LEG-011, REQ-VID-LEG-014, REQ-VID-LEG-039, REQ-VID-LEG-040, REQ-VID-LEG-044 |
| Sistema de quotas e perfis | Estender | Reembolso imediato de tarefas canceladas ou falhadas e libertação de qualquer slot de concorrência reservado. | REQ-VID-LEG-035 |
| Armazenamento | Estender | Guardar vídeos e ficheiros exportados com URL pré-assinado, manter encriptação e limpar ficheiros temporários. | REQ-VID-LEG-032, REQ-VID-LEG-036, REQ-VID-LEG-037, REQ-VID-LEG-046 |
| Interação com o recorte temporal | Estender | Copiar legendas para a versão recortada com tempos ajustados, sem afetar o original. | REQ-VID-LEG-042 |
| Editor de legendas e gravação de rascunhos | Estender | Filtro de baixa confiança, controlo de versão otimista e compatibilidade dos navegadores. | REQ-VID-LEG-043, REQ-VID-LEG-050, REQ-VID-LEG-051 |
| Serviço de transcrição configurável | Estender | Destino configurável por ambiente; avaliar desempenho por blocos e qualidade apenas com o serviço real. | REQ-VID-LEG-047, REQ-VID-LEG-048, REQ-VID-LEG-052 |
| Cache, exportação e mensagens | Estender | Reutilizar incorporação com o mesmo vídeo/legendas/estilo; renovar links de objetos existentes e comunicar exceções em português. | REQ-VID-LEG-044, REQ-VID-LEG-045, REQ-VID-LEG-049 |
| Limpeza de recursos | Estender | Eliminar áudio extraído, temporários e parciais em todos os desfechos. | REQ-VID-LEG-046 |
| Estilo das legendas incorporadas | Estender | Usar estilo por omissão; configuração de tamanho, posição e cor sujeita à decisão em Q4. | REQ-VID-LEG-033, REQ-VID-LEG-053 |

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
| FA3 | Rever apenas segmentos incertos | REQ-VID-LEG-019, REQ-VID-LEG-043 |
| FA4 | Retomar a revisão mais tarde | REQ-VID-LEG-028, REQ-VID-LEG-029 |
| FA5 | Editar legendas já existentes | REQ-VID-LEG-029, REQ-VID-LEG-030 |
| FA6 | Apenas exportar o ficheiro de legendas | REQ-VID-LEG-031, REQ-VID-LEG-032 |
| FA7 | Cópia independente das legendas após recorte, com tempos ajustados | REQ-VID-LEG-042 |
| FA8 | Incorporação sem alterações | REQ-VID-LEG-044 |
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
| E10 | Link expirado ou ficheiro removido | REQ-VID-LEG-032, REQ-VID-LEG-045 |
| RN1 | Exclusivo do perfil premium | REQ-VID-LEG-003, REQ-VID-LEG-004, REQ-VID-LEG-005 |
| RN2 | Limites de duração, tamanho e idiomas | REQ-VID-LEG-006, REQ-VID-LEG-008 |
| RN4 | Segmentos válidos | REQ-VID-LEG-018, REQ-VID-LEG-026, REQ-VID-LEG-027 |
| RN8 | Uma execução ativa por projeto | REQ-VID-LEG-010, REQ-VID-LEG-013 |
| RN9 | Progresso e cancelamento | REQ-VID-LEG-011, REQ-VID-LEG-038, REQ-VID-LEG-039 |
| RN10 | Encriptação e acesso restrito | REQ-VID-LEG-036, REQ-VID-LEG-037 |
| RN11 | Reembolso e libertação de recursos | REQ-VID-LEG-035 |
| RN5 / FA7 | Associação à versão e cópia das legendas no recorte | REQ-VID-LEG-042 |
| RN12 | Formatos de entrada e saída | REQ-VID-LEG-041, REQ-VID-LEG-033 |
| RN10 / Garantias | Limpeza do áudio, temporários e parciais | REQ-VID-LEG-036, REQ-VID-LEG-046 |
| Q1 / Q2 / A9 | Processamento por blocos e desempenho proposto | REQ-VID-LEG-047 |
| A2 / Q2 | Configuração do serviço e qualidade da transcrição real | REQ-VID-LEG-048, REQ-VID-LEG-052 |
| E1–E10 | Mensagens centralizadas em português | REQ-VID-LEG-049 |
| A7 | Compatibilidade dos navegadores | REQ-VID-LEG-050 |
| Passo 7 / Q6 / Q7 | Autosave com controlo de versão otimista | REQ-VID-LEG-028, REQ-VID-LEG-051 |
| Passo 8 / Q4 | Estilo por omissão e configuração proposta | REQ-VID-LEG-033, REQ-VID-LEG-053 |
| Passo 10 | Pré-visualização e renovação do URL | REQ-VID-LEG-032, REQ-VID-LEG-045 |
| Stakeholder DevOps | Filas dedicadas para tarefas longas sem degradar filtros de imagem | REQ-VID-LEG-040 |
