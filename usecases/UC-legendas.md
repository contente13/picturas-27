# 4.2. UC-VID-001 - Criar legendas para um vídeo

## 4.2.1. Cabeçalho

*Tabela 14: Caso de uso UC-VID-001 - Criar legendas para um vídeo*

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-001 |
| Nome | Criar legendas para um vídeo |
| Versão | v1.3 |
| Autor(es) | Luís Pires e Rui Castro |
| Data | 2026-10-19 |
| Objetivo | Permitir ao utilizador criar legendas manualmente ou, se for Premium, gerar uma proposta automática com IA, rever e editar o texto e os tempos, guardá-la e, opcionalmente, descarregá-la ou incorporá-la num novo vídeo com a fonte e a cor padrão, sem opções de personalização visual. |
| Âmbito | PictuRAS - projetos e processamento de vídeo: leitor, editor de texto e tempos das legendas, geração automática por IA para Premium, persistência, exportação e incorporação assíncrona com estilo visual padrão não configurável. |
| Ator Principal | Utilizador autenticado: Registado ou Premium. |
| Stakeholders e Interesses | Utilizador Registado ou Premium: criar legendas sincronizadas e controlar o resultado; o Premium pode acelerar a criação com uma proposta de IA. Audiência do vídeo: ler legendas legíveis e sincronizadas. Proprietário do projeto: manter o vídeo original e as legendas guardadas. Equipa de Desenvolvimento/DevOps: processar a geração e a incorporação sem bloquear outras operações e limpar temporários. Administrador do sistema: proteger vídeos, legendas e resultados. |
| Pré-condições | O utilizador está autenticado e autorizado a editar o projeto; o projeto contém um vídeo disponível, carregado ou produzido por uma operação concluída. Para iniciar a geração automática ou a incorporação, não pode existir outra operação de processamento de vídeo Em Fila, Em Processamento ou a Finalizar no mesmo projeto, independentemente da ferramenta (RN7). Operações do mesmo utilizador noutros projetos não impedem o pedido. |
| Trigger | O utilizador seleciona um vídeo e abre a ferramenta «Legendas». |

## 4.2.2. Fluxo Principal

*Tabela 15: UC-VID-001 - Fluxo principal*

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona um vídeo do projeto. | Apresenta o vídeo no leitor com nome, duração, formato e controlos de reprodução. |
| 2 | Seleciona «Legendas». | Abre o editor e carrega as legendas existentes para essa versão do vídeo ou apresenta uma lista vazia. |
| 3 | Escolhe «Criar manualmente» e «Adicionar legenda». | Cria um segmento editável com campos para texto, início e fim. Em alternativa, um utilizador Premium pode escolher «Gerar automaticamente» e seguir FA2. |
| 4 | Escreve o texto e define os tempos, usando a reprodução do vídeo para sincronizar o segmento. | Atualiza a lista e a sobreposição de pré-visualização e valida os valores segundo RN3. |
| 5 | Repete os passos 3 e 4 até terminar e escolhe «Guardar». | Valida e guarda os segmentos revistos no projeto, associados à versão do vídeo, e confirma a gravação. |
| 6 | Escolhe «Descarregar legendas» ou «Incorporar no vídeo». | Para descarregar, oferece SRT e WebVTT e gera o ficheiro. Para incorporar, usa a fonte e a cor padrão do sistema, valida acesso, limites, quota e concorrência e cria uma tarefa assíncrona. Não apresenta opções para alterar o estilo visual. |
| 7 | Aguarda o processamento, podendo continuar a utilizar a aplicação. | Apresenta o estado e o progresso da incorporação e permite cancelar. |
| 8 | Pré-visualiza ou descarrega o resultado. | Disponibiliza o ficheiro de legendas ou o novo vídeo. O vídeo original permanece inalterado. |

## 4.2.3. Fluxos Alternativos

*Tabela 16: UC-VID-001 - Fluxos alternativos*

| Fluxo | Descrição |
|---|---|
| FA1 - Editar legendas existentes | No passo 2, o vídeo já tem segmentos guardados. O utilizador pode editar, adicionar ou apagar segmentos, independentemente do seu plano. Prossegue para o passo 4 ou 5, conforme as alterações realizadas. |
| FA2 - Gerar proposta automática (Premium) | No passo 3, um utilizador Premium pede a geração automática. O sistema valida os limites Premium aplicáveis, o tempo máximo de processamento e a inexistência de outra operação de vídeo ativa no mesmo projeto (RN7), transcreve o áudio e apresenta segmentos com texto e tempos para revisão. A proposta não substitui as legendas guardadas até o utilizador a rever e guardar. O utilizador pode corrigir, adicionar ou apagar qualquer segmento usando o editor manual e prosseguir a partir do passo 5. |
| FA3 - Usar a posição atual do leitor | No passo 4, o utilizador define o início ou o fim do segmento a partir do instante atual de reprodução, continuando a edição nesse passo. |
| FA4 - Descarregar apenas o ficheiro | No passo 6, o utilizador escolhe SRT ou WebVTT. O sistema gera o ficheiro sem criar tarefa de vídeo nem consumir quota de processamento, prosseguindo diretamente para o passo 8. |
| FA4b - Descarregar o vídeo com legendas | Na vista do vídeo, com legendas guardadas, o utilizador escolhe «Vídeo com legendas». O sistema gera no momento uma cópia do vídeo com as legendas guardadas como faixa de legendas ativa por omissão (MP4: mov_text; WebM: WebVTT), sem recodificar, e entrega-a como `<nome>_com_legendas.<ext>`. Não é criada tarefa, não é consumida quota e o vídeo do projeto não é alterado. O utilizador pode também descarregar só o vídeo ou só as legendas (FA4). |
| FA5 - Retomar a edição | Depois de guardar no passo 5, o utilizador sai do editor. Ao regressar, o sistema carrega os segmentos persistidos. Alterações por guardar são sinalizadas antes de sair. |
| FA6 - Alterar legendas depois da incorporação | Depois de concluir o processamento, o utilizador edita e guarda os segmentos e pede nova incorporação. O sistema cria outro vídeo derivado, sem substituir os resultados anteriores. |
| FA7 - Legendas após recorte | No recorte UC-VID-002, o novo vídeo recebe uma cópia independente dos segmentos que intersectem o intervalo, com tempos limitados e reajustados segundo UC-VID-002/RN7. |
| FA8 - Cancelar incorporação | Durante o passo 7, o utilizador cancela. O sistema interrompe a tarefa, remove resultados parciais, liberta a quota reservada e preserva o vídeo e as legendas guardadas. |
| FA9 - Retomar após perder ligação | Durante o passo 7, a tarefa continua no servidor mesmo que o utilizador perca a ligação. Ao regressar, consulta o estado atual e acede ao resultado se já tiver terminado. |

## 4.2.4. Exceções

*Tabela 17: UC-VID-001 - Exceções*

| Condição | Comportamento do Sistema |
|---|---|
| E1 - Utilizador Anónimo | Encaminha para registo ou início de sessão e não cria tarefa. |
| E2 - Vídeo removido, inacessível ou sem metadados válidos | Informa o utilizador e impede a edição ou operação. |
| E3 - Segmentos inválidos | Identifica o problema e impede guardar, descarregar ou incorporar até à correção. |
| E4 - Utilizador sem permissão de edição | Recusa a alteração sem expor nem modificar os dados do projeto. |
| E5 - Duração do vídeo acima do limite de incorporação | Recusa a incorporação antes de criar tarefa e informa o limite aplicável: 60 s para Registado ou 600 s para Premium. |
| E6 - Quota diária esgotada | Para Registado, recusa o pedido sem criar tarefa ou reserva adicional e informa quando a quota será reposta. |
| E7 - Outra operação de vídeo ativa no mesmo projeto | Ao pedir a geração automática ou a incorporação num projeto que já tem uma operação de vídeo Em Fila, Em Processamento ou a Finalizar, de qualquer ferramenta, não cria nova tarefa nem reserva quota e informa qual a operação em curso e que é necessário aguardar que termine ou cancelá-la. Operações do mesmo utilizador noutros projetos não originam esta exceção. |
| E8 - Falha, tempo excedido ou falta de espaço | Marca a tarefa como Falhada, remove resultados parciais e temporários, liberta a reserva e preserva vídeo e legendas. |
| E9 - Link expirado ou ficheiro indisponível | Renova o URL se o objeto existir; caso contrário, informa que é necessário exportar ou incorporar novamente. |
| E10 - Utilizador não Premium pede geração automática | Recusa a geração por IA, informa que esta opção requer Premium e mantém disponível a criação e edição manual. |
| E11 - Falha ou indisponibilidade da geração por IA | Informa o utilizador, não altera as legendas guardadas e permite continuar manualmente ou tentar novamente mais tarde. |
| E12 - Áudio sem fala reconhecível ou idioma não suportado | Informa que não foi possível gerar uma proposta útil, não substitui as legendas guardadas e permite continuar manualmente. |
| E13 - Vídeo excede os limites Premium ou a geração ultrapassa o tempo máximo | Recusa ou termina a tarefa, informa o limite aplicável, mantém as legendas guardadas e permite continuar manualmente. |

## 4.2.5. Pós-condições

*Tabela 18: UC-VID-001 - Pós-condições*

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | As legendas ficam guardadas no projeto e associadas à versão do vídeo. Se pedido, existe um ficheiro SRT/WebVTT ou um novo vídeo com legendas incorporadas. O original permanece inalterado e não ficam ficheiros temporários. |
| Garantia Mínima | Em caso de falha ou cancelamento, o vídeo original e as últimas legendas guardadas permanecem intactos. Resultados parciais são removidos e qualquer quota reservada é libertada. |

## 4.2.6. Regras de Negócio e Restrições

*Tabela 19: UC-VID-001 - Regras de Negócio e Restrições*

| ID | Regra |
|---|---|
| RN1 | A ferramenta requer autenticação e autorização de edição do projeto. O Anónimo deve autenticar-se antes de a utilizar. |
| RN2 | A entrada é um vídeo disponível no projeto, em formato aceite pelo MVP conforme UC-VID-002/RN6 e UC-VID-003/RN17. Os vídeos gerados não voltam a estar sujeitos aos limites de carregamento externo; aplicam-se os limites da operação de processamento. |
| RN3 | Cada segmento tem texto não vazio, 0 ≤ início < fim ≤ duração, duração entre 0,5 e 10 s, no máximo duas linhas de 42 caracteres e não se sobrepõe a outro segmento. Segmentos inválidos não podem ser guardados nem exportados. |
| RN4 | As legendas são dados do projeto associados à versão do vídeo. Editá-las não modifica o ficheiro de vídeo. |
| RN5 | As legendas guardadas podem ser exportadas como ficheiro SRT ou WebVTT, ou dentro de uma cópia do vídeo como faixa de legendas ativa por omissão (FA4b). Nenhuma destas exportações cria tarefa de processamento de vídeo, consome quota ou altera o vídeo do projeto. Gravar as legendas na imagem é a incorporação (RN6). |
| RN6 | A incorporação cria um novo MP4 (H.264/AAC), aplica a fonte e a cor padrão definidas pelo sistema e nunca substitui o vídeo de origem. A fonte e a cor são fixas no MVP: o utilizador não pode configurá-las nem editá-las; apenas pode editar o texto e os tempos dos segmentos. |
| RN7 | Concorrência por projeto (RNG-11). Cada projeto pode ter no máximo uma operação de processamento de vídeo Em Fila, Em Processamento ou a Finalizar, independentemente da ferramenta (geração automática de legendas, incorporação, recorte ou concatenação), em conformidade com UC-VID-002/RN5 e UC-VID-003/RN18. O mesmo utilizador pode ter operações ativas em projetos diferentes; ficam em fila e a execução efetiva depende da disponibilidade dos workers, e a quota diária continua a ser por utilizador (RN8). A edição manual, a gravação e a exportação SRT/WebVTT não são operações de processamento de vídeo e não são bloqueadas. A verificação e a criação da tarefa são atómicas: de dois pedidos simultâneos para o mesmo projeto, no máximo um é aceite. Resultados tardios de tarefas canceladas ou falhadas não são consolidados. |
| RN8 | Cada incorporação conta como uma operação para Registado e usa a quota diária partilhada entre ferramentas (UC-VID-002/RN4; UC-VID-003/RN16). A operação é reservada ao aceitar, consumida no sucesso e libertada em qualquer outro desfecho. Premium não tem limite diário. Editar, guardar ou exportar SRT/WebVTT não consome quota de processamento. |
| RN9 | A incorporação é assíncrona, apresenta estado e progresso e pode ser cancelada. Falhas e cancelamentos removem ficheiros parciais e temporários. |
| RN10 | Vídeos, legendas e resultados são acessíveis apenas a utilizadores com permissão válida no projeto. |
| RN11 | No recorte, os segmentos que intersectam o intervalo são copiados independentemente, limitados e reajustados segundo UC-VID-002/RN7. A cópia não altera o original. |
| RN12 | A geração automática por IA só está disponível para Premium e aplica os limites Premium da funcionalidade: vídeo até 2 GB e 60 minutos (UC-VID-000/RN2), tempo máximo de processamento de 900 s (UC-VID-002/RN8) e sem quota diária adicional. Gera uma proposta de texto e tempos a partir do áudio do vídeo, no idioma falado; não traduz, não substitui segmentos já guardados e só passa a ser a versão do projeto quando o utilizador a revê e guarda. |
| RN13 | A proposta automática tem de cumprir RN3 antes de ser guardada ou exportada. O utilizador pode editar, adicionar ou remover segmentos com as mesmas operações e validações da criação manual. Falha ou cancelamento da geração não altera as legendas guardadas. |
| RN14 | Para incorporar legendas, a duração total do vídeo de origem não pode exceder 60 s para Registado nem 600 s para Premium, em alinhamento com UC-VID-002/RN1. É um limite próprio da incorporação, aplica-se também a vídeos gerados no projeto e não reaplica os limites de carregamento externo de UC-VID-000/RN2. |

## 4.2.7. Assunções

*Tabela 20: UC-VID-001 - Assunções*

| ID | Assunção |
|---|---|
| A1 | O carregamento e a validação inicial dos vídeos pertencem ao caso de uso de carregamento de vídeo. |
| A2 | A criação manual permanece disponível para Registado e Premium. A geração automática por IA é uma opção adicional exclusiva de Premium; produz uma proposta de transcrição no idioma falado, sem tradução, que o utilizador pode corrigir no mesmo editor. |
| A3 | Os segmentos são guardados como dados do projeto, com texto, tempos e versão de vídeo; não é necessário carregar um ficheiro para começar. |
| A4 | A pré-visualização ocorre no cliente. A incorporação é processada no servidor pelo mecanismo assíncrono das operações de vídeo. |
| A5 | A transcrição é feita por um modelo Whisper local, sem enviar áudio para serviços externos. Para cumprir o tempo máximo de RN12 (900 s), o sistema usa um modelo mais preciso até 30 minutos de áudio e um modelo mais rápido acima disso. |

## 4.2.8. Questões em Aberto

*Tabela 21: UC-VID-001 - Questões em Aberto*

| ID | Questão | Resolução |
|---|---|---|
| Q1 | Utilizadores com link de partilha podem editar legendas ou apenas visualizá-las? | Decidido (v1.3): depende da permissão do link. Um link de edição permite criar, editar, guardar, gerar e incorporar, com o perfil e a quota do proprietário; um link de leitura permite ver e descarregar as legendas guardadas. |
| Q2 | Que idiomas e formatos de áudio são suportados pela geração automática no MVP? | Decidido (v1.3): o idioma falado é detetado automaticamente, sem tradução (RN12). É aceite qualquer pista de áudio dos formatos de vídeo suportados (AAC ou Vorbis), convertida internamente para a transcrição. |