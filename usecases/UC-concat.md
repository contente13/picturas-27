# 4.4. UC-VID-003 - Juntar vários vídeos

## 4.4.1. Cabeçalho

*Tabela 30: Caso de uso UC-VID-003 - Juntar vários vídeos*

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-003 |
| Nome | Juntar vários vídeos |
| Versão | v1.2 |
| Autor | Eduardo Freitas e Rui Castro |
| Data | 2026-10-19 |
| Objetivo | Permitir ao utilizador selecionar dois ou mais vídeos de um projeto, definir a ordem em que devem aparecer e gerar um único vídeo resultante da concatenação, mantendo os ficheiros originais inalterados. |
| Âmbito | PictuRAS - gestão de projetos e processamento de vídeo, incluindo seleção de vídeos, ordenação dos clips, validação de compatibilidade, processamento assíncrono, armazenamento do resultado e exportação. |
| Ator Principal | Utilizador autenticado: Registado ou Premium. |
| Stakeholders e Interesses | Utilizador Registado: combinar vários clips de forma simples dentro dos limites do seu plano. Utilizador Premium: combinar vídeos maiores ou em maior quantidade, com menos restrições. Proprietário do sistema: controlar utilização de CPU, memória e armazenamento, diferenciando os planos. Equipa DevOps/Desenvolvimento: garantir que o processamento de múltiplos vídeos não bloqueia os restantes serviços. Administrador do sistema: assegurar proteção dos vídeos e resultados durante armazenamento e processamento. |
| Pré-condições | O utilizador encontra-se autenticado; o projeto contém pelo menos dois vídeos disponíveis, carregados com sucesso ou gerados por operações anteriores concluídas; os vídeos selecionados encontram-se disponíveis no armazenamento; o serviço de processamento de vídeo está operacional. |
| Trigger | O utilizador seleciona vídeos do projeto e aciona a opção «Juntar vídeos». |

## 4.4.2. Fluxo Principal

*Tabela 31: UC-VID-003 - Fluxo principal*

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Ativa a seleção de vídeos na biblioteca e seleciona um ou mais vídeos do projeto. | Mostra a ordem de seleção em cada vídeo e o número de vídeos selecionados. Valida a quantidade selecionada. Se forem pelo menos dois, disponibiliza a opção «Juntar vídeos»; caso contrário, segue para E1. O utilizador pode cancelar a seleção a qualquer momento, sem efeitos no projeto. |
| 2 | Seleciona «Juntar vídeos». | Apresenta os vídeos numa lista ordenada, com miniatura, nome, duração, resolução, formato e informação de áudio, e os limites do perfil (RN3, RN4). Para o perfil Registado, apresenta também as operações diárias restantes (RN16). |
| 3 | Define a ordem dos vídeos por drag and drop ou pelos controlos de ordenação. | Atualiza imediatamente a sequência e calcula a duração total estimada do vídeo final. |
| 4 | Confirma a sequência escolhida. | Valida o número de vídeos, a duração total, o tamanho total, a compatibilidade técnica entre os ficheiros e a disponibilidade de cada vídeo no armazenamento (E3). Esta confirmação não cria tarefa nem reserva quota. |
| 5 | - | Determina o formato comum (resolução, taxa de fotogramas, codecs) e informa o utilizador dos ajustes que alteram o resultado: redimensionamento, barras, conversão de fotogramas, conversão de formato e silêncio nos clips sem áudio (FA4-FA7). |
| 6 | Aciona «Gerar vídeo». | Verifica que não existe outra operação de processamento de vídeo Em Fila, Em Processamento ou a Finalizar no mesmo projeto, independentemente da ferramenta. Para Registados, verifica a quota diária partilhada e reserva atomicamente uma operação, considerando as consumidas e reservadas (RN16). Volta a validar a sequência (passo 4). Se tudo for válido, cria uma tarefa assíncrona Em Fila e devolve o identificador em ≤ 2 s. A verificação da concorrência e a criação/reserva da execução impedem duas tarefas simultâneas no mesmo projeto. |
| 7 | Pode aguardar ou continuar a utilizar a aplicação. | Mostra o progresso da operação e disponibiliza a opção «Cancelar processamento», com atualização em ≤ 5 s. |
| 8 | - | Converte cada vídeo para o formato intermédio comum (RN5) e concatena-os pela ordem definida pelo utilizador. |
| 9 | - | Valida o ficheiro produzido (codecs H.264/AAC e duração igual à soma dos clips) e guarda o resultado como um novo vídeo no projeto (RN15), com as legendas dos clips (RN20), sem alterar os originais. |
| 10 | Reproduz o resultado e escolhe descarregar ou continuar a utilizá-lo no projeto. | Apresenta a pré-visualização do vídeo final e disponibiliza a exportação/download. |

## 4.4.3. Fluxos Alternativos

*Tabela 32: UC-VID-003 - Fluxos alternativos*

| Fluxo | Descrição |
|---|---|
| FA1 - Alterar ordem dos vídeos | No passo 3, o utilizador reorganiza os clips. O sistema atualiza a sequência e recalcula a duração total antes da confirmação. Retoma o passo 3. |
| FA2 - Remover um vídeo da seleção | Antes do passo 6, o utilizador remove um dos clips. O sistema atualiza a lista e recalcula duração e tamanho estimados. Se restar apenas um vídeo, desativa a opção de concatenação. |
| FA3 - Adicionar outro vídeo | Antes do processamento, o utilizador adiciona outro vídeo do mesmo projeto. O sistema inclui-o na sequência e volta a executar as validações antes da submissão. |
| FA4 - Vídeos com resoluções diferentes | No passo 5, o sistema deteta resoluções distintas e informa que os clips serão normalizados para uma resolução comum baseada na menor resolução da seleção, preservando a proporção de imagem de cada clip. Prossegue para o passo 6. |
| FA5 - Vídeos com taxas de fotogramas diferentes | No passo 5, o sistema deteta taxas de fotogramas distintas e normaliza todos os clips para a menor taxa de fotogramas existente na seleção antes da concatenação, informando o utilizador. |
| FA6 - Vídeos com formatos/codecs diferentes | Se os formatos forem suportados mas diferentes entre si (por exemplo, MP4 e WebM), o sistema informa o utilizador de que os clips são convertidos para um formato intermédio comum antes de os concatenar (RN5). |
| FA7 - Clip sem áudio | Na validação e normalização, se alguns vídeos não tiverem áudio, o sistema permite continuar e mantém silêncio durante esses segmentos. |
| FA8 - Cancelamento do processamento | Durante os passos 7 ou 8, o utilizador escolhe «Cancelar processamento». O sistema solicita a interrupção, marca a tarefa como Cancelada, elimina resultados parciais e temporários, liberta a operação reservada (perfil Registado) e mantém os vídeos originais e a sequência definida. A interface regressa a um estado utilizável. Resultados tardios dessa tarefa não são consolidados. |
| FA9 - Abandono da página | Se o utilizador sair da página durante o processamento, a tarefa continua no servidor. Quando regressar com a tarefa ainda em curso, o sistema mostra o estado, o progresso e recupera a sequência que está a ser processada. Se a tarefa já tiver terminado, o resultado está disponível na biblioteca do projeto; a janela de junção não volta a mostrar operações terminadas, e abrir «Juntar vídeos» inicia sempre uma nova junção. |
| FA10 - Nova concatenação com os mesmos vídeos | Depois de concluir, o utilizador pode alterar a ordem ou remover/adicionar clips e iniciar uma nova concatenação sem ter de voltar a carregar os vídeos. |

## 4.4.4. Exceções

*Tabela 33: UC-VID-003 - Exceções*

| Condição | Comportamento do Sistema |
|---|---|
| E1 - Menos de dois vídeos selecionados | O sistema impede a operação e informa que são necessários pelo menos dois vídeos. |
| E2 - Formato ou codec não suportado | Identifica o vídeo incompatível, impede o processamento e indica quais os formatos suportados. |
| E3 - Vídeo corrompido ou inacessível | Na validação (passos 4 e 6, incluindo a leitura de cada vídeo no armazenamento) ou durante o processamento, o sistema deteta que um dos vídeos selecionados não pode ser lido, foi removido ou deixou de estar disponível. O sistema não inicia ou interrompe a operação, identifica o vídeo problemático, elimina eventuais ficheiros temporários e pede ao utilizador que o remova ou substitua. |
| E4 - Duração total excede o limite do perfil | Impede a criação da tarefa e informa o utilizador do limite aplicável, sugerindo reduzir ou recortar os vídeos. |
| E5 - Tamanho total excede o limite do perfil | Não inicia o processamento e informa que a seleção ultrapassa o tamanho permitido. |
| E6 - Resolução ou taxa de fotogramas impossível de normalizar | Um vídeo com dimensão inferior a 16 píxeis ou taxa de fotogramas inválida (fora de 1-240 fps) não pode ser normalizado. O sistema recusa a operação antes da concatenação e informa quais os vídeos incompatíveis. |
| E7 - Falha durante a conversão intermédia | Termina a execução, elimina os ficheiros temporários e mantém os originais intactos. |
| E8 - Falha durante a concatenação | Descarta o resultado parcial, mantém os vídeos originais inalterados e permite que o utilizador repita a operação. |
| E9 - Falta de espaço de armazenamento | Antes de começar, o sistema verifica se o espaço de trabalho tem pelo menos o triplo do tamanho total dos vídeos (originais, intermédios e resultado). Se não tiver, ou se o espaço se esgotar durante o processamento, interrompe a operação antes de consolidar o resultado, elimina os temporários e informa que não existe espaço disponível suficiente. |
| E10 - Processamento concorrente incompatível | Se existir outra operação de processamento de vídeo Em Fila, Em Processamento ou a Finalizar no mesmo projeto, independentemente da ferramenta e dos vídeos selecionados, impede a criação de nova tarefa, não reserva quota e informa que deve aguardar a conclusão ou cancelar a operação anterior. Operações do mesmo utilizador noutros projetos não originam esta exceção. |
| E11 - Quota diária esgotada (passo 6) | Se as cinco operações diárias do Registado estiverem consumidas ou reservadas, rejeita o pedido, informa quando a quota será reposta e não cria tarefa nem reserva operação adicional. |

## 4.4.5. Pós-condições

*Tabela 34: UC-VID-003 - Pós-condições*

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | Existe um novo vídeo no projeto contendo os vídeos selecionados pela ordem definida pelo utilizador. Os vídeos originais permanecem inalterados. O resultado encontra-se disponível para reprodução e exportação. |
| Garantia Mínima | Se ocorrer uma falha ou cancelamento, todos os vídeos originais permanecem intactos e utilizáveis. Qualquer resultado parcial ou ficheiro temporário é eliminado. A reserva de quota do Registado é libertada sem consumo; a tarefa criada fica Falhada ou Cancelada. O utilizador recebe uma mensagem explicativa e pode tentar novamente. |

## 4.4.6. Regras de Negócio e Restrições

*Tabela 35: UC-VID-003 - Regras de Negócio e Restrições*

| ID | Regra |
|---|---|
| RN1 | A operação requer pelo menos dois vídeos distintos; cada vídeo aparece uma única vez na sequência. |
| RN2 | Apenas vídeos pertencentes ao mesmo projeto podem ser selecionados para a mesma operação de concatenação no MVP. |
| RN3 | No MVP, uma operação de concatenação pode incluir no máximo 10 vídeos para utilizadores Registados e 30 vídeos para utilizadores Premium. |
| RN4 | Para utilizadores Registados, a duração total da seleção não pode exceder 10 minutos e o tamanho agregado não pode exceder 500 MB. Para utilizadores Premium, a duração total não pode exceder 60 minutos e o tamanho agregado não pode exceder 2 GB. |
| RN5 | O sistema converte cada clip para um formato intermédio comum compatível com a saída do MVP: H.264 (yuv420p) com a resolução e a taxa de fotogramas de referência (RN6-RN8) e áudio AAC a 48 kHz estéreo. A conversão é feita sempre, mesmo quando os clips já parecem compatíveis, porque a junção sem recodificação exige parâmetros de codificação idênticos; só as alterações visíveis (resolução, barras, fotogramas, formato, silêncio) são comunicadas ao utilizador. |
| RN6 | Quando os vídeos selecionados tiverem resoluções diferentes, o vídeo final deve utilizar como referência a resolução do clip com menor número total de píxeis, considerando a orientação com que o vídeo é apresentado (um vídeo rodado de telemóvel conta na vertical). As dimensões de referência são arredondadas para valores pares, uma exigência do H.264. Os clips com resolução superior são redimensionados para essa resolução e nenhum clip sofre upscale. |
| RN7 | Quando os clips tiverem proporções de imagem diferentes, o sistema deve preservar o aspect ratio original de cada clip, adicionando barras laterais ou superiores/inferiores quando necessário. O sistema não deve deformar nem realizar crop automático dos clips no MVP. |
| RN8 | Quando os vídeos selecionados tiverem taxas de fotogramas diferentes, o vídeo final deve utilizar a menor taxa de fotogramas entre os clips selecionados. Os clips com taxa superior são convertidos para esse valor antes da concatenação. |
| RN9 | Os vídeos originais nunca são alterados durante a concatenação. |
| RN10 | A ordem do vídeo final corresponde exatamente à ordem confirmada pelo utilizador antes do processamento. |
| RN11 | Clips sem áudio são permitidos; nesses intervalos, o resultado contém silêncio. |
| RN12 | O processamento deve ser realizado de forma assíncrona e permitir cancelamento. |
| RN13 | Ficheiros intermédios criados para normalização ou concatenação devem ser eliminados após conclusão, cancelamento ou falha. |
| RN14 | Um processamento falhado ou cancelado não deve produzir um vídeo final parcialmente válido. |
| RN15 | O resultado é armazenado como um novo vídeo do projeto e nunca substitui automaticamente os ficheiros utilizados como entrada. O nome é o do primeiro clip da sequência com o sufixo `_juncao` (ex.: `ferias.mp4` passa a `ferias_juncao.mp4`; se já existir, `ferias_juncao_2.mp4`), em linha com `_recorte` (UC-VID-002) e `_legendas` (UC-VID-001). |
| RN16 | Cada concatenação conta como uma operação, independentemente das normalizações internas. Para Registados, a quota é de cinco operações diárias partilhadas entre todas as ferramentas do PictuRAS, reposta à meia-noite (Europe/Lisbon). A verificação considera consumidas e reservadas e reserva atomicamente uma operação ao aceitar o pedido; o consumo ocorre apenas no sucesso. A reserva é libertada imediatamente em falha de criação, processamento, cancelamento ou outro desfecho sem sucesso. Pedidos rejeitados antes da reserva não consomem quota. Premium não tem limite diário. |
| RN17 | Entrada aceite: MP4 (H.264/AAC) e WebM (VP8/Vorbis), incluindo seleções mistas e clips sem áudio (RN11). O sistema recodifica todos os clips para os parâmetros comuns definidos em RN5-RN8 e produz o resultado em MP4 (H.264/AAC). |
| RN18 | Cada projeto pode ter no máximo uma operação de processamento de vídeo Em Fila, Em Processamento ou a Finalizar, independentemente da ferramenta utilizada (RNG-11), em conformidade com UC-VID-001/RN7 e UC-VID-002/RN5. O mesmo utilizador pode ter operações ativas em projetos diferentes, sujeitas à quota diária por utilizador (RN16) e à disponibilidade dos workers. Resultados tardios de tarefas canceladas ou falhadas não são consolidados. |
| RN19 | Os vídeos de entrada e o resultado são acessíveis ao proprietário do projeto ou a quem tenha um link de partilha válido. O acesso por link não dispensa a autenticação e o perfil exigidos para executar a ferramenta. |
| RN20 | As legendas editáveis de cada clip (UC-VID-001) são copiadas para o vídeo resultante, deslocadas pela duração dos clips anteriores e limitadas ao intervalo do respetivo clip; segmentos com menos de 0,5 s são descartados (UC-VID-001/RN3). As legendas dos originais não são alteradas. Legendas já incorporadas na imagem fazem parte do vídeo e mantêm-se. |
| RN21 | Tempo máximo de processamento de uma concatenação: 600 s para Registado e 3600 s para Premium, contados desde a passagem a Em Processamento; o tempo em fila não conta. Ao exceder o limite, a tarefa termina como Falhada (Garantia Mínima). Um cancelamento termina o processamento em ≤ 5 s. |

## 4.4.7. Assunções

*Tabela 36: UC-VID-003 - Assunções*

| ID | Assunção |
|---|---|
| A1 | O carregamento de vídeos já faz parte do suporte base a vídeo do PictuRAS e este caso de uso começa com os vídeos já disponíveis no projeto, carregados ou gerados por operações anteriores. Os limites de carregamento externo não são reaplicados aos vídeos gerados; os limites agregados de RN3 e RN4 continuam a aplicar-se à concatenação. |
| A2 | O sistema terá um mecanismo de processamento assíncrono para operações de vídeo, semelhante ao utilizado atualmente nas ferramentas pesadas de imagem. |
| A3 | O MVP normalizará automaticamente resolução, codec e taxa de fotogramas antes de concatenar os clips. |
| A4 | O formato de saída inicial será MP4 (H.264/AAC), conforme RN17, ficando outros formatos para evolução posterior. |
| A5 | A funcionalidade não inclui transições entre clips no MVP; a passagem de um vídeo para o seguinte é direta. |
| A6 | A concatenação não permite, neste caso de uso, recortar cada clip internamente; essa responsabilidade pertence ao caso de uso de recorte de vídeo. |
| A7 | O áudio original de cada clip é preservado, salvo quando for necessária conversão técnica para compatibilidade. |
| A8 | Não é necessário aplicar filtros ou ferramentas de imagem durante a concatenação; essas operações pertencem a outros casos de uso. |
| A9 | O pedido de concatenação deve responder em ≤ 2 s, e as atualizações de progresso devem chegar ao utilizador em ≤ 5 s, respeitando uma execução em fila ou processamento. |

## 4.4.8. Questões em Aberto

*Tabela 37: UC-VID-003 - Questões em Aberto*

| ID | Questão | Resolução |
|---|---|---|
| Q1 | Confirmam-se para o MVP os limites propostos de RN3 (10/30 vídeos) e RN4 (10 min/500 MB e 60 min/2 GB)? | Decidido (v1.2): mantêm-se os limites definidos em RN3 e RN4. Estes permitem diferenciar os perfis Registado e Premium, controlar o consumo de recursos de processamento e armazenamento e limitar a complexidade das operações no MVP. |
| Q2 | Confirmam-se as decisões do MVP: saída MP4 (RN17), menor resolução sem upscale (RN6), proporção preservada com barras (RN7), menor FPS (RN8), sem transições (A5) e apenas vídeos do mesmo projeto (RN2)? | Decidido (v1.2): adotam-se as opções definidas em RN2 e RN6-RN8, RN17 e A5. O formato MP4 assegura uma saída uniforme; a normalização de resolução e FPS garante compatibilidade entre os clips, preservando as proporções sem upscale. A ausência de transições e a restrição ao mesmo projeto reduzem a complexidade de processamento e gestão de permissões no MVP. |
| Q3 | Confirmam-se o acesso Registado/Premium e a contabilização de uma única operação por concatenação, independentemente das conversões internas (RN16)? | Decidido (v1.2): a concatenação fica disponível para Registado e Premium e contabiliza uma única operação por resultado concluído, conforme RN16. As conversões internas fazem parte da mesma operação solicitada pelo utilizador, pelo que não justificam consumos adicionais de quota. Esta abordagem mantém a contabilização previsível e coerente com as restantes ferramentas do PictuRAS. |
| Q4 | Como tratar legendas editáveis associadas aos clips na concatenação: copiá-las e deslocar os tempos ou exigir nova geração? | Decidido (v1.2): as legendas editáveis são copiadas e os respetivos tempos ajustados à posição de cada clip, conforme RN20. Esta solução preserva a sincronização e evita a necessidade de gerar novamente legendas já existentes. |
| Q5 | Qual o tempo máximo de processamento e o prazo de interrupção efetiva de uma concatenação? | Decidido (v1.2): estabelece-se um limite de processamento de 600 s para Registado e 3600 s para Premium, excluindo o tempo em fila, e um prazo máximo de 5 s para interromper uma tarefa cancelada, conforme RN21. Estes limites evitam execuções indefinidas, controlam a ocupação dos recursos e permitem recuperar a disponibilidade do sistema após cancelamento. |