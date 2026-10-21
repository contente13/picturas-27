# 4.4. UC-VID-003 - Juntar vários vídeos
## 4.4.1. Cabeçalho

**Tabela 29: Caso de uso UC-VID-003 - Juntar vários vídeos**

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

**Tabela 30: UC-VID-003 - Fluxo principal**

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Ativa a seleção de vídeos na biblioteca e seleciona um ou mais vídeos do projeto. | Mostra a ordem de seleção em cada vídeo e o número de vídeos selecionados. Valida a quantidade selecionada. Se forem pelo menos dois, disponibiliza a opção «Juntar vídeos»; caso contrário, segue para E1. O utilizador pode cancelar a seleção a qualquer momento, sem efeitos no projeto. |
| 2 | Seleciona «Juntar vídeos». | Apresenta os vídeos numa lista ordenada, com miniatura, nome, duração, resolução, formato e informação de áudio, e os limites do perfil (RN3, RN4). Para o perfil Registado, apresenta também as operações diárias restantes (RN16). |
| 3 | Define a ordem dos vídeos por drag and drop ou pelos controlos de ordenação. | Atualiza imediatamente a sequência e calcula a duração total estimada do vídeo final. |
| 4 | Confirma a sequência escolhida. | Valida o número de vídeos, a duração total, o tamanho total, a compatibilidade técnica entre os ficheiros e a disponibilidade de cada vídeo no armazenamento (E3). Esta confirmação não cria tarefa nem reserva quota. |
| 5 | - | Determina os parâmetros comuns de saída (resolução, taxa de fotogramas e codecs), identifica os clips que precisam de normalização e informa o utilizador dos ajustes necessários: redimensionamento, barras, conversão de fotogramas ou formato e silêncio nos clips sem áudio (FA4-FA7). Clips já compatíveis com os parâmetros comuns podem ser usados sem recodificação. |
| 6 | Aciona «Gerar vídeo». | Verifica que não existe outra operação de processamento de vídeo Em Fila ou Em Processamento no mesmo projeto, independentemente da ferramenta. Para Registados, verifica a quota diária partilhada e reserva atomicamente uma operação, considerando as consumidas e reservadas (RN16). Volta a validar a sequência (passo 4). Se tudo for válido, cria uma tarefa assíncrona Em Fila e devolve o identificador em ≤ 2 s. A verificação da concorrência e a criação/reserva da execução impedem duas tarefas simultâneas no mesmo projeto. |
| 7 | Pode aguardar ou continuar a utilizar a aplicação. | Mostra o progresso da operação e disponibiliza a opção «Cancelar processamento», com atualização em ≤ 5 s. |
| 8 | - | Normaliza apenas os clips cujos parâmetros não correspondam ao formato comum ou não permitam concatenação direta; os clips já compatíveis podem ser usados sem recodificação. Em seguida, concatena todos pela ordem definida pelo utilizador (RN5). |
| 9 | - | Valida o ficheiro produzido (codecs H.264/AAC e duração igual à soma dos clips) e guarda o resultado como um novo vídeo no projeto (RN15), com as legendas dos clips (RN20), sem alterar os originais. |
| 10 | Reproduz o resultado e escolhe descarregar ou continuar a utilizá-lo no projeto. | Apresenta a pré-visualização do vídeo final e disponibiliza a exportação/download. |

## 4.4.3. Fluxos Alternativos

**Tabela 31: UC-VID-003 - Fluxos alternativos**

| Fluxo | Descrição |
|---|---|
| FA1 - Alterar ordem dos vídeos | No passo 3, o utilizador reorganiza os clips. O sistema atualiza a sequência e recalcula a duração total antes da confirmação. Retoma o passo 3. |
| FA2 - Remover um vídeo da seleção | Antes do passo 6, o utilizador remove um dos clips. O sistema atualiza a lista e recalcula duração e tamanho estimados. Se restar apenas um vídeo, desativa a opção de concatenação. |
| FA3 - Adicionar outro vídeo | Antes do processamento, o utilizador adiciona outro vídeo do mesmo projeto. O sistema inclui-o na sequência e volta a executar as validações antes da submissão. |
| FA4 - Vídeos com resoluções diferentes | No passo 5, o sistema deteta resoluções distintas e define uma resolução comum baseada no menor número de píxeis da seleção. Normaliza apenas os clips que não correspondam a essa referência, preservando a proporção de cada um; os clips já compatíveis não são recodificados por causa da resolução. Prossegue para o passo 6. |
| FA5 - Vídeos com taxas de fotogramas diferentes | No passo 5, o sistema deteta taxas de fotogramas distintas e define como referência a menor taxa da seleção. Normaliza apenas os clips com taxa superior; os clips que já correspondem à referência não são recodificados por causa do FPS. |
| FA6 - Vídeos com formatos/codecs diferentes | Se os formatos forem suportados mas diferentes entre si (por exemplo, MP4 e WebM), o sistema informa quais os clips que precisam de conversão para o formato intermédio comum. Os clips já compatíveis com a saída e com a concatenação direta podem ser usados sem recodificação (RN5). |
| FA7 - Clip sem áudio | Na validação e normalização, se alguns vídeos não tiverem áudio, o sistema permite continuar e mantém silêncio durante esses segmentos. |
| FA8 - Cancelamento do processamento | Durante os passos 7 ou 8, o utilizador escolhe «Cancelar processamento». O sistema solicita a interrupção, marca a tarefa como Cancelada, elimina resultados parciais e temporários, liberta a operação reservada (perfil Registado) e mantém os vídeos originais e a sequência definida. A interface regressa a um estado utilizável. Resultados tardios dessa tarefa não são consolidados. |
| FA9 - Abandono da página | Se o utilizador sair da página durante o processamento, a tarefa continua no servidor. Quando regressar com a tarefa ainda em curso, o sistema mostra o estado, o progresso e recupera a sequência que está a ser processada. Se a tarefa já tiver terminado, o resultado está disponível na biblioteca do projeto; a janela de junção não volta a mostrar operações terminadas, e abrir «Juntar vídeos» inicia sempre uma nova junção. |
| FA10 - Nova concatenação com os mesmos vídeos | Depois de concluir, o utilizador pode alterar a ordem ou remover/adicionar clips e iniciar uma nova concatenação sem ter de voltar a carregar os vídeos. |

## 4.4.4. Exceções

**Tabela 32: UC-VID-003 - Exceções**

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
| E10 - Processamento concorrente incompatível | Se existir outra operação de processamento de vídeo Em Fila ou Em Processamento no mesmo projeto, independentemente da ferramenta e dos vídeos selecionados, impede a criação de nova tarefa, não reserva quota e informa que deve aguardar a conclusão ou cancelar a operação anterior. Operações do mesmo utilizador noutros projetos não originam esta exceção. |
| E11 - Quota diária esgotada (passo 6) | Se as cinco operações diárias do Registado estiverem consumidas ou reservadas, rejeita o pedido, informa quando a quota será reposta e não cria tarefa nem reserva operação adicional. |

## 4.4.5. Pós-condições

**Tabela 33: UC-VID-003 - Pós-condições**

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | Existe um novo vídeo no projeto contendo os vídeos selecionados pela ordem definida pelo utilizador. Os vídeos originais permanecem inalterados. O resultado encontra-se disponível para reprodução e exportação. |
| Garantia Mínima | Se ocorrer uma falha ou cancelamento, todos os vídeos originais permanecem intactos e utilizáveis. Qualquer resultado parcial ou ficheiro temporário é eliminado. A reserva de quota do Registado é libertada sem consumo; a tarefa criada fica Falhada ou Cancelada. O utilizador recebe uma mensagem explicativa e pode tentar novamente. |

## 4.4.6. Regras de Negócio e Restrições

**Tabela 34: UC-VID-003 - Regras de Negócio e Restrições**

| ID | Regra |
|---|---|
| RN1 | A operação requer pelo menos dois vídeos distintos; cada vídeo aparece uma única vez na sequência. |
| RN2 | Apenas vídeos pertencentes ao mesmo projeto podem ser selecionados para a mesma operação de concatenação no MVP. |
| RN3 | No MVP, uma operação de concatenação pode incluir no máximo 10 vídeos para utilizadores Registados e 30 vídeos para utilizadores Premium. |
| RN4 | Para utilizadores Registados, a duração total da seleção não pode exceder 10 minutos e o tamanho agregado não pode exceder 500 MB. Para utilizadores Premium, a duração total não pode exceder 60 minutos e o tamanho agregado não pode exceder 2 GB. |
| RN5 | O sistema determina parâmetros comuns para a saída do MVP: MP4 com vídeo H.264 (yuv420p), resolução e taxa de fotogramas de referência (RN6-RN8) e áudio AAC a 48 kHz estéreo. Converte ou recodifica apenas os clips cujos parâmetros não correspondam a esses valores ou que não permitam concatenação direta; clips já compatíveis podem ser usados sem recodificação. Quando um clip não tem áudio, o resultado contém silêncio no intervalo correspondente (RN11). O sistema comunica os ajustes que alteram o resultado, como redimensionamento, barras, fotogramas, formato ou áudio. |
| RN6 | Quando os vídeos selecionados tiverem resoluções diferentes, o vídeo final deve utilizar como referência a resolução do clip com menor número total de píxeis, considerando a orientação com que o vídeo é apresentado (um vídeo rodado de telemóvel conta na vertical). As dimensões de referência são arredondadas para valores pares, uma exigência do H.264. Os clips com resolução superior são redimensionados para essa resolução e nenhum clip sofre upscale. |
| RN7 | Quando os clips tiverem proporções de imagem diferentes, o sistema deve preservar o aspect ratio original de cada clip, adicionando barras laterais ou superiores/inferiores quando necessário. O sistema não deve deformar nem realizar crop automático dos clips no MVP. |
| RN8 | Quando os vídeos selecionados tiverem taxas de fotogramas diferentes, o vídeo final deve utilizar a menor taxa de fotogramas entre os clips selecionados. Os clips com taxa superior são convertidos para esse valor antes da concatenação. |
| RN9 | Os vídeos originais nunca são alterados durante a concatenação. |
| RN10 | A ordem do vídeo final corresponde exatamente à ordem confirmada pelo utilizador antes do processamento. |
| RN11 | Clips sem áudio são permitidos; nesses intervalos, o resultado contém silêncio. |
| RN12 | O processamento deve ser realizado de forma assíncrona e permitir cancelamento. |
| RN13 | Ficheiros intermédios criados para normalização ou concatenação devem ser eliminados após conclusão, cancelamento ou falha. |
| RN14 | Um processamento falhado ou cancelado não deve produzir um vídeo final parcialmente válido. |
| RN15 | O resultado é armazenado como um novo vídeo do projeto e nunca substitui automaticamente os ficheiros utilizados como entrada. O nome é o do primeiro clip da sequência com o sufixo _juncao (ex.: ferias.mp4 passa a ferias_juncao.mp4; se já existir, ferias_juncao_2.mp4), em linha com _recorte (UC-VID-002) e _legendas (UC-VID-001). |
| RN16 | Cada concatenação conta como uma operação, independentemente das normalizações internas. Para Registados, a quota é de cinco operações diárias partilhadas entre todas as ferramentas do PictuRAS, reposta à meia-noite (Europe/Lisbon). A verificação considera consumidas e reservadas e reserva atomicamente uma operação ao aceitar o pedido; o consumo ocorre apenas no sucesso. A reserva é libertada imediatamente em falha de criação, processamento, cancelamento ou outro desfecho sem sucesso. Pedidos rejeitados antes da reserva não consomem quota. Premium não tem limite diário. |
| RN17 | Entrada aceite: MP4 (H.264/AAC) e WebM (VP8/Vorbis), incluindo seleções mistas e clips sem áudio (RN11). O sistema normaliza apenas os clips cujos parâmetros não correspondam aos parâmetros comuns necessários à concatenação e produz o resultado em MP4 (H.264/AAC). |
| RN18 | Cada projeto pode ter no máximo uma operação de processamento de vídeo Em Fila ou Em Processamento, independentemente da ferramenta utilizada (RNG-11), em conformidade com UC-VID-001/RN7 e UC-VID-002/RN5. O mesmo utilizador pode ter operações ativas em projetos diferentes, sujeitas à quota diária por utilizador (RN16) e à disponibilidade dos workers. Resultados tardios de tarefas canceladas ou falhadas não são consolidados. |
| RN19 | Os vídeos de entrada e o resultado são acessíveis ao proprietário do projeto ou a quem tenha um link de partilha válido, com encriptação em trânsito e em repouso. O acesso por link não dispensa a autenticação e o perfil exigidos para executar a ferramenta. |
| RN20 | As legendas editáveis de cada clip (UC-VID-001) são copiadas para o vídeo resultante, deslocadas pela duração dos clips anteriores e limitadas ao intervalo do respetivo clip; segmentos com menos de 0,5 s são descartados (UC-VID-001/RN3). As legendas dos originais não são alteradas. Legendas já incorporadas na imagem fazem parte do vídeo e mantêm-se. |
| RN21 | Tempo máximo de processamento de uma concatenação: 600 s para Registado e 3600 s para Premium, contados desde a passagem a Em Processamento; o tempo em fila não conta. Ao exceder o limite, a tarefa termina como Falhada (Garantia Mínima). Um cancelamento termina o processamento em ≤ 5 s. |

## 4.4.7. Assunções

**Tabela 35: UC-VID-003 - Assunções**

| ID | Assunção |
|---|---|
| A1 | O carregamento de vídeos já faz parte do suporte base a vídeo do PictuRAS e este caso de uso começa com os vídeos já disponíveis no projeto, carregados ou gerados por operações anteriores. Os limites de carregamento externo não são reaplicados aos vídeos gerados; os limites agregados de RN3 e RN4 continuam a aplicar-se à concatenação. |
| A2 | O sistema terá um mecanismo de processamento assíncrono para operações de vídeo, semelhante ao utilizado atualmente nas ferramentas pesadas de imagem. |
| A3 | O MVP ajustará automaticamente os clips cujos parâmetros de resolução, codec, taxa de fotogramas ou áudio não correspondam aos parâmetros comuns necessários à concatenação; clips já compatíveis poderão ser usados sem recodificação. |
| A4 | O formato de saída inicial será MP4 (H.264/AAC), conforme RN17, ficando outros formatos para evolução posterior. |
| A5 | A funcionalidade não inclui transições entre clips no MVP; a passagem de um vídeo para o seguinte é direta. |
| A6 | A concatenação não permite, neste caso de uso, recortar cada clip internamente; essa responsabilidade pertence ao caso de uso de recorte de vídeo. |
| A7 | O áudio original de cada clip é preservado, salvo quando for necessária conversão técnica para compatibilidade. |
| A8 | Não é necessário aplicar filtros ou ferramentas de imagem durante a concatenação; essas operações pertencem a outros casos de uso. |
| A9 | O pedido de concatenação deve responder em ≤ 2 s, e as atualizações de progresso devem chegar ao utilizador em ≤ 5 s, respeitando uma execução em fila ou processamento. |

## 4.4.8. Questões em Aberto

**Tabela 36: UC-VID-003 - Questões em Aberto**

| ID | Questão | Resolução |
|---|---|---|
| Q1 | Confirmam-se para o MVP os limites propostos de RN3 (10/30 vídeos) e RN4 (10 min/500 MB e 60 min/2 GB)? | Decidido (v1.2): mantêm-se os limites definidos em RN3 e RN4. Estes permitem diferenciar os perfis Registado e Premium, controlar o consumo de recursos de processamento e armazenamento e limitar a complexidade das operações no MVP. |
| Q2 | Confirmam-se as decisões do MVP: saída MP4 (RN17), menor resolução sem upscale (RN6), proporção preservada com barras (RN7), menor FPS (RN8), sem transições (A5) e apenas vídeos do mesmo projeto (RN2)? | Decidido (v1.2): adotam-se as opções definidas em RN2 e RN6-RN8, RN17 e A5. O formato MP4 assegura uma saída uniforme; a normalização de resolução e FPS garante compatibilidade entre os clips, preservando as proporções sem upscale. A ausência de transições e a restrição ao mesmo projeto reduzem a complexidade de processamento e gestão de permissões no MVP. |
| Q3 | Confirmam-se o acesso Registado/Premium e a contabilização de uma única operação por concatenação, independentemente das conversões internas (RN16)? | Decidido (v1.2): a concatenação fica disponível para Registado e Premium e contabiliza uma única operação por resultado concluído, conforme RN16. As conversões internas fazem parte da mesma operação solicitada pelo utilizador, pelo que não justificam consumos adicionais de quota. Esta abordagem mantém a contabilização previsível e coerente com as restantes ferramentas do PictuRAS. |
| Q4 | Como tratar legendas editáveis associadas aos clips na concatenação: copiá-las e deslocar os tempos ou exigir nova geração? | Decidido (v1.2): as legendas editáveis são copiadas e os respetivos tempos ajustados à posição de cada clip, conforme RN20. Esta solução preserva a sincronização e evita a necessidade de gerar novamente legendas já existentes. |
| Q5 | Qual o tempo máximo de processamento e o prazo de interrupção efetiva de uma concatenação? | Decidido (v1.2): estabelece-se um limite de processamento de 600 s para Registado e 3600 s para Premium, excluindo o tempo em fila, e um prazo máximo de 5 s para interromper uma tarefa cancelada, conforme RN21. Estes limites evitam execuções indefinidas, controlam a ocupação dos recursos e permitem recuperar a disponibilidade do sistema após cancelamento. |
---

## 4. Esboço de requisitos derivados

### 4.1 Requisitos de Sistema

| ID | Requisito | Tipo | Prioridade | Novo/Alt | Origem | Como verificar |
|---|---|---|---|---|---|---|
| REQ-VID-CONCAT-001 | O sistema deve permitir selecionar múltiplos vídeos de um mesmo projeto para uma operação de concatenação. | F | Deve ter | Novo | UC-VID-003 - Passo 1; RN1; RN2 | Dado um projeto com vídeos, quando o utilizador seleciona vários, então ficam disponíveis para a operação. |
| REQ-VID-CONCAT-002 | O sistema deve disponibilizar a operação Juntar vídeos apenas quando estiverem selecionados pelo menos dois vídeos. | F | Deve ter | Novo | UC-VID-003 - Passo 1; E1; RN1 | Dado um projeto com 1 vídeo, quando tenta iniciar a concatenação, então a opção está indisponível; com ≥2, fica disponível. |
| REQ-VID-CONCAT-003 | O sistema deve limitar cada concatenação a no máximo 10 vídeos para utilizadores Registados e 30 para Premium. | F | Deve ter | Novo | UC-VID-003 - RN3 | Dado um Registado e um Premium, quando seleccionam 10/30 vídeos respetivamente, então a operação aceita; quando excedem estes limites, é rejeitada. |
| REQ-VID-CONCAT-004 | O sistema deve permitir ao utilizador ordenar, adicionar e remover clips antes de iniciar a concatenação. | F | Deve ter | Novo | UC-VID-003 - Passo 3; FA1; FA2; FA3 | Dado uma seleção em ordem, quando o utilizador reordena ou remove clips, então a sequência apresentada é atualizada imediatamente. |
| REQ-VID-CONCAT-005 | O sistema deve calcular e apresentar a duração total da sequência selecionada. | F | Deveria ter | Novo | UC-VID-003 - Passo 3 | Dado uma sequência com 3 vídeos, quando a ordem é confirmada, então a duração total apresentada coincide com a soma das durações. |
| REQ-VID-CONCAT-006 | O sistema deve validar antes do processamento a quantidade de vídeos, a duração total, o tamanho agregado e a compatibilidade técnica dos clips. | F | Deve ter | Novo | UC-VID-003 - Passo 4; E2–E6; RN3–RN5 | Dado uma seleção válida, quando o utilizador confirma, então a operação prossegue; dado uma seleção inválida, então é rejeitada com mensagem adequada. |
| REQ-VID-CONCAT-007 | O sistema deve aplicar os limites de 10 min e 500 MB para Registados e 60 min e 2 GB para Premium. | F | Deve ter | Novo | UC-VID-003 - RN4; E4; E5 | Dado uma seleção imediatamente abaixo, no limite e acima do limite, quando submete a operação, então resulta em aceitação ou rejeição correta. |
| REQ-VID-CONCAT-008 | O sistema deve normalizar apenas os clips cujos formatos, codecs, parâmetros de áudio ou outras características técnicas não correspondam aos parâmetros comuns necessários à concatenação. | F | Deve ter | Novo | UC-VID-003 - Passos 5 e 8; FA4-FA7; RN5 | Dado clips com parâmetros já compatíveis, quando são concatenados, então não são recodificados sem necessidade; dados clips com parâmetros incompatíveis, então apenas os que precisam são normalizados antes da concatenação. |
| REQ-VID-CONCAT-009 | Quando existirem resoluções diferentes, o sistema deve utilizar como referência a resolução do clip com menor número total de píxeis, sem efetuar upscale, preservando a proporção dos clips através de barras quando necessário. | F | Deve ter | Novo | UC-VID-003 - FA4; RN6; RN7 | Dado clips com resoluções diferentes, quando a concatenação termina, então o resultado usa a resolução de referência e mantém as proporções sem deformar ou crop. |
| REQ-VID-CONCAT-010 | Quando existirem taxas de fotogramas diferentes, o sistema deve normalizar os clips para a menor taxa de fotogramas da seleção. | F | Deve ter | Novo | UC-VID-003 - FA5; RN8 | Dado clips com FPS diferentes, quando a concatenação termina, então o resultado usa a menor taxa de fotogramas da seleção. |
| REQ-VID-CONCAT-011 | O sistema deve permitir clips sem áudio, produzindo silêncio durante esses segmentos no resultado. | F | Deveria ter | Novo | UC-VID-003 - FA7; RN11 | Dado clips sem áudio, quando o resultado é reproduzido, então o silêncio e a sequência corretos são preservados. |
| REQ-VID-CONCAT-012 | O sistema deve executar a concatenação de forma assíncrona, apresentar o progresso e permitir cancelamento durante o processamento. | F | Deve ter | Alterado | UC-VID-003 - Passos 6–8; FA8; RN12 | Dado uma tarefa ativa, quando o utilizador observa o progresso ou cancela, então o sistema responde em ≤ 5 s. |
| REQ-VID-CONCAT-013 | O vídeo resultante deve conter os clips exatamente pela ordem confirmada pelo utilizador e ser armazenado como um novo vídeo, sem modificar os ficheiros de entrada. | F | Deve ter | Novo | UC-VID-003 - Passos 8–9; RN9; RN10; RN15 | Dado clips A-B-C, quando conclui a concatenação, então o vídeo final aparece nessa ordem e os originais permanecem inalterados. |
| REQ-VID-CONCAT-014 | O sistema deve disponibilizar o vídeo resultante para pré-visualização e exportação/download. | F | Deve ter | Novo | UC-VID-003 - Passo 10; Garantia de Sucesso | Dado um vídeo resultante, quando o utilizador abre a pré-visualização, então consegue reproduzir e exportar o ficheiro. |
| REQ-VID-CONCAT-015 | O sistema deve permitir que o processamento continue quando o utilizador abandonar a página e recuperar posteriormente o estado ou resultado da execução. | F | Deveria ter | Novo | UC-VID-003 - FA9 | Dado um processamento em curso, quando o utilizador abandona a página, então ao regressar vê o estado ou o resultado recuperado. |
| REQ-VID-CONCAT-016 | Cada concatenação aceite para Registados deve reservar atomicamente 1 operação da quota partilhada de 5 operações/dia, considerando consumidas e reservadas, com reposição à meia-noite (Europe/Lisbon). O consumo ocorre apenas no sucesso, independentemente das normalizações internas; qualquer desfecho sem sucesso liberta a reserva. Premium não tem limite diário. | F | Deve ter | Alterado | UC-VID-003 - Passo 6; RN16; E11 | Com 4 operações consumidas, aceitar uma concatenação e reservar a quinta; outro pedido noutro projeto é rejeitado. Dois pedidos simultâneos com uma operação disponível aceitam no máximo um. Sucesso consome 1; falha/cancelamento liberta. Premium pode continuar sem limite diário. |
| REQ-VID-CONCAT-017 | O sistema deve impedir uma nova concatenação quando existir outra operação de processamento de vídeo Em Fila ou Em Processamento no mesmo projeto, independentemente da ferramenta ou dos clips envolvidos. | F | Deve ter | Alterado | UC-VID-003 - Passo 6; E10; RN18 | Dado um recorte, transcrição, incorporação ou concatenação ativo, quando se pede concatenação no mesmo projeto sobre outros clips, então o pedido é rejeitado. Dois pedidos simultâneos no mesmo projeto nunca criam duas tarefas ativas. |
| REQ-VID-CONCAT-018 | O sistema deve apresentar os vídeos selecionados numa lista ordenada, mostrando para cada clip a miniatura, nome, duração, resolução, formato e informação de áudio. | F | Deve ter | Novo | UC-VID-003 - Passo 2 | Dado vários vídeos selecionados, quando a lista é mostrada, então todos os metadados são apresentados corretamente. |
| REQ-VID-CONCAT-019 | O sistema deve aceitar MP4 (H.264/AAC), WebM (VP8/Vorbis) e seleções mistas, normalizando apenas os clips cujos parâmetros não sejam compatíveis com a concatenação ou com a saída MP4 (H.264/AAC), e produzir silêncio nos intervalos dos clips sem áudio. | F | Deve ter | NOVO | RN17, RN5, RN11, E2 | Concatenar MP4 e WebM, incluindo um clip sem áudio; verificar a saída MP4 H.264/AAC e a normalização apenas dos clips incompatíveis. Com clips já compatíveis entre si e com a saída, verificar que não são recodificados sem necessidade. Rejeitar codecs não suportados antes de criar a tarefa. |
| REQ-VID-CONCAT-020 | O sistema deve rejeitar um pedido de concatenação do Registado quando as 5 operações diárias partilhadas estiverem consumidas ou reservadas, informando a reposição da quota sem criar tarefa ou reserva adicional. | F | Deve ter | NOVO | Passo 6, E11, RN16 | Com 4 operações consumidas e 1 reservada noutra ferramenta, o pedido é rejeitado e indica reposição à meia-noite (Europe/Lisbon). |
| REQ-VID-CONCAT-021 | O sistema deve ignorar resultados tardios de tarefas canceladas ou falhadas, consolidando um resultado apenas enquanto a tarefa que o produziu continuar ativa. | F | Deve ter | ALT | FA8, RN14, RN18 | Após cancelar uma tarefa e iniciar outra, entregar o resultado da anterior; não cria vídeo, não consome quota e não altera a nova execução. |
| REQ-VID-CONCAT-022 | O sistema deve copiar para o vídeo resultante as legendas editáveis de cada clip, deslocadas pela duração dos clips anteriores e limitadas ao respetivo clip, sem alterar as legendas dos originais. | F | Deveria ter | NOVO | RN20; Passo 9 | Dados os clips A (3 s) e B com uma legenda em [0,5 s, 2 s], quando se juntam A-B, então o resultado tem a legenda em [3,5 s, 5 s] e as legendas de B ficam iguais. |

Os requisitos não funcionais são definidos na secção 5.2 de [requisitos.md](requisitos.md). As referências abaixo usam essa numeração comum.

### 4.2 Impacto no sistema existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Frontend / interface de projetos | Estender | Adicionar seleção múltipla de vídeos, ordenação dos clips, apresentação de metadados, duração total, progresso, cancelamento, pré-visualização e download do resultado. | REQ-VID-CONCAT-001, REQ-VID-CONCAT-002, REQ-VID-CONCAT-004, REQ-VID-CONCAT-005, REQ-VID-CONCAT-012, REQ-VID-CONCAT-014, REQ-VID-CONCAT-015, REQ-VID-CONCAT-018 |
| Serviço de gestão de projetos | Estender | Permitir associar vários vídeos a uma mesma operação, validar que pertencem ao mesmo projeto e registar o vídeo resultante como novo elemento do projeto. | REQ-VID-CONCAT-001, REQ-VID-CONCAT-006, REQ-VID-CONCAT-013 |
| Serviço de processamento de vídeo | Estender | Implementar concatenação de múltiplos vídeos, incluindo normalização apenas dos clips incompatíveis e verificação do espaço livre antes de processar. | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010, REQ-VID-CONCAT-011, REQ-VID-CONCAT-013, REQ-VID-CONCAT-019, REQ-VID-QUAL-014 |
| Sistema de filas / processamento assíncrono | Estender | Suportar tarefas de concatenação assíncronas, progresso, cancelamento e continuação do processamento quando o utilizador abandona a página. | REQ-VID-CONCAT-012, REQ-VID-CONCAT-015, REQ-VID-QUAL-004, REQ-VID-QUAL-005 |
| Armazenamento de ficheiros | Estender | Armazenar o novo vídeo resultante e gerir/eliminar ficheiros temporários e intermédios usados durante a normalização e concatenação. | REQ-VID-CONCAT-013, REQ-VID-QUAL-001, REQ-VID-QUAL-008 |
| Sistema de quotas e perfis | Estender | Aplicar limites diferentes por perfil quanto ao número de vídeos, duração total e tamanho agregado, e contabilizar cada concatenação bem-sucedida como uma operação. | REQ-VID-CONCAT-003, REQ-VID-CONCAT-007, REQ-VID-CONCAT-016, REQ-VID-CONCAT-020 |
| Mecanismo de validação de vídeo | Estender | Validar compatibilidade dos clips, formatos/codecs suportados, resolução, FPS, duração, tamanho e número de vídeos antes do processamento. | REQ-VID-CONCAT-006, REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010 |
| Controlo de concorrência de operações | Estender | Impedir operações de vídeo simultâneas no mesmo projeto, independentemente da ferramenta ou dos clips; ignorar resultados tardios de tarefas canceladas ou falhadas. | REQ-VID-CONCAT-017, REQ-VID-CONCAT-021 |
| Mecanismos de recuperação e limpeza | Estender | Garantir que falhas e cancelamentos não deixam ficheiros parciais e não alteram os vídeos originais. | REQ-VID-QUAL-001, REQ-VID-QUAL-008 |
| Funcionalidades existentes de autenticação/perfis | Manter | Reutilizar o mecanismo atual de autenticação e distinção entre Registado e Premium. | REQ-VID-CONCAT-003, REQ-VID-CONCAT-007, REQ-VID-CONCAT-016 |
| Legendas editáveis (UC-VID-001) | Estender | Copiar e deslocar as legendas dos clips para o vídeo resultante. | REQ-VID-CONCAT-022 |
| Segurança e partilha | Estender | Aplicar acesso pelo proprietário ou por link de partilha válido e encriptação aos vídeos de entrada e ao resultado. | REQ-VID-QUAL-002, REQ-VID-QUAL-003 |

### 4.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição abreviada | Requisito(s) de Sistema |
|---|---|---|
| Trigger | Selecionar vídeos e validar quantidade mínima | REQ-VID-CONCAT-001, REQ-VID-CONCAT-002 |
| Passo 2 | Apresentar lista ordenada e metadados dos vídeos | REQ-VID-CONCAT-018 |
| Passo 3 | Definir ordem e calcular duração total | REQ-VID-CONCAT-004, REQ-VID-CONCAT-005 |
| Passo 4 | Validar quantidade, duração, tamanho e compatibilidade | REQ-VID-CONCAT-003, REQ-VID-CONCAT-006, REQ-VID-CONCAT-007, REQ-VID-CONCAT-019 |
| Passo 5 | Determinar quais clips precisam de normalização técnica | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010, REQ-VID-CONCAT-019 |
| Passo 6 | Criar tarefa assíncrona de concatenação e reservar quota | REQ-VID-CONCAT-012, REQ-VID-CONCAT-016, REQ-VID-CONCAT-017, REQ-VID-QUAL-004, REQ-VID-CONCAT-020 |
| Passo 7 | Apresentar progresso e permitir cancelamento | REQ-VID-CONCAT-012, REQ-VID-QUAL-005 |
| Passo 8 | Normalizar apenas quando necessário e concatenar segundo a ordem definida | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010, REQ-VID-CONCAT-011, REQ-VID-CONCAT-013, REQ-VID-CONCAT-019 |
| Passo 9 | Guardar resultado como novo vídeo sem alterar os originais | REQ-VID-CONCAT-013, REQ-VID-QUAL-001, REQ-VID-QUAL-008 |
| Passo 10 | Pré-visualizar e exportar/download do resultado | REQ-VID-CONCAT-014 |
| FA1 | Reordenar clips antes da concatenação | REQ-VID-CONCAT-004 |
| FA2 | Remover clips e impedir concatenação com apenas um vídeo | REQ-VID-CONCAT-002, REQ-VID-CONCAT-004 |
| FA3 | Adicionar outro vídeo do mesmo projeto e voltar a validar | REQ-VID-CONCAT-001, REQ-VID-CONCAT-004, REQ-VID-CONCAT-006 |
| FA4 | Ajustar apenas os clips que não correspondam à resolução de referência, preservando aspect ratio e sem upscale | REQ-VID-CONCAT-009 |
| FA5 | Ajustar apenas os clips com taxa de fotogramas superior à referência | REQ-VID-CONCAT-010 |
| FA6 | Converter apenas os clips cujos formatos ou codecs não sejam compatíveis | REQ-VID-CONCAT-008, REQ-VID-CONCAT-019 |
| FA7 | Manter silêncio durante clips sem áudio | REQ-VID-CONCAT-011 |
| FA8 | Interromper processamento e eliminar resultados parciais | REQ-VID-CONCAT-012, REQ-VID-QUAL-001, REQ-VID-QUAL-008, REQ-VID-CONCAT-016, REQ-VID-CONCAT-021 |
| FA9 | Continuar tarefa e recuperar estado posteriormente | REQ-VID-CONCAT-015 |
| FA10 | Reutilizar vídeos do projeto numa nova operação | REQ-VID-CONCAT-004, REQ-VID-CONCAT-016 |
| E1 | Impedir operação com seleção insuficiente | REQ-VID-CONCAT-002 |
| E2 | Rejeitar vídeos tecnicamente não suportados | REQ-VID-CONCAT-006, REQ-VID-CONCAT-019 |
| E3 | Impedir ou interromper operação com vídeo indisponível | REQ-VID-CONCAT-006, REQ-VID-QUAL-001, REQ-VID-QUAL-008 |
| E4 | Rejeitar seleção acima do limite de duração | REQ-VID-CONCAT-007 |
| E5 | Rejeitar seleção acima do limite de tamanho | REQ-VID-CONCAT-007 |
| E6 | Rejeitar clips que não possam ser normalizados | REQ-VID-CONCAT-008, REQ-VID-CONCAT-009, REQ-VID-CONCAT-010 |
| E7 | Terminar tarefa e eliminar temporários | REQ-VID-QUAL-001, REQ-VID-QUAL-008, REQ-VID-CONCAT-016 |
| E8 | Descartar resultado parcial e preservar originais | REQ-VID-QUAL-001, REQ-VID-QUAL-008, REQ-VID-CONCAT-016 |
| E9 | Verificar espaço livre mínimo de 3 × o tamanho agregado e interromper sem resultado parcial | REQ-VID-QUAL-001, REQ-VID-QUAL-008, REQ-VID-CONCAT-016, REQ-VID-QUAL-014 |
| E10 | Impedir outra operação de vídeo ativa no mesmo projeto | REQ-VID-CONCAT-017 |
| E11 | Rejeitar quota diária esgotada | REQ-VID-CONCAT-016, REQ-VID-CONCAT-020 |
| RN1 | Requer pelo menos 2 vídeos | REQ-VID-CONCAT-001, REQ-VID-CONCAT-002 |
| RN2 | Vídeos do mesmo projeto | REQ-VID-CONCAT-001 |
| RN3 | Limites por número de vídeos | REQ-VID-CONCAT-003 |
| RN4 | Limites por duração e tamanho | REQ-VID-CONCAT-007 |
| RN5 | Normalização técnica apenas quando necessária | REQ-VID-CONCAT-008, REQ-VID-CONCAT-019 |
| RN6 | Resolução de referência | REQ-VID-CONCAT-009 |
| RN7 | Preservação do aspect ratio | REQ-VID-CONCAT-009 |
| RN8 | Menor taxa de fotogramas | REQ-VID-CONCAT-010 |
| RN9 | Original inalterado | REQ-VID-CONCAT-013, REQ-VID-QUAL-008 |
| RN10 | Ordem do resultado | REQ-VID-CONCAT-013 |
| RN11 | Silêncio em vídeos sem áudio | REQ-VID-CONCAT-011 |
| RN12 | Processamento assíncrono e cancelamento | REQ-VID-CONCAT-012 |
| RN13 | Limpeza de intermediários | REQ-VID-QUAL-001 |
| RN14 | Sem resultado parcial válido | REQ-VID-QUAL-001, REQ-VID-COMMON-003 |
| RN15 | Novo vídeo no projeto | REQ-VID-CONCAT-013 |
| RN16 | Reserva atómica e libertação imediata da quota | REQ-VID-CONCAT-016 |
| Garantia de Sucesso | Novo vídeo criado, originais intactos e resultado disponível | REQ-VID-CONCAT-013, REQ-VID-CONCAT-014, REQ-VID-CONCAT-016 |
| Garantia Mínima | Preservar originais e limpar ficheiros parciais em falha/cancelamento | REQ-VID-QUAL-001, REQ-VID-QUAL-008, REQ-VID-CONCAT-016 |
| RN17 | Formatos de entrada/saída e normalização condicional | REQ-VID-CONCAT-008, REQ-VID-CONCAT-019 |
| RN18 | Uma operação ativa por projeto e proteção contra resultados tardios | REQ-VID-CONCAT-017, REQ-VID-CONCAT-021 |
| RN19 | Acesso pelo proprietário ou por link de partilha válido e encriptação | REQ-VID-QUAL-002, REQ-VID-QUAL-003 |
| RN20 | Legendas dos clips copiadas e deslocadas | REQ-VID-CONCAT-022 |
| RN21 | Tempo máximo e interrupção do processamento | REQ-VID-QUAL-010, REQ-VID-QUAL-012 |
