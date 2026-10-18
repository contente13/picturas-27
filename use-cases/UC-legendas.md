# UC-VID-001 - Criar legendas para um vídeo

## 0. Identificação

| Campo | Valor |
|---|---|
| Grupo / Equipa | Grupo 1 |
| Autores | Eduardo Freitas, Francisco Contente, Luís Pires, Rui Castro |
| Data | 2026-10-18 |
| Versão do documento | v1.2 |
| Unidade Curricular | Requisitos e Arquiteturas de Software - MEI, Universidade do Minho |

## 1.1 Funcionalidade 1 - Criar legendas para um vídeo

| Campo | Valor |
|---|---|
| Funcionalidade | Criar legendas manualmente ou, para utilizadores Premium, gerar uma primeira versão automaticamente com IA; rever e editar o texto e os tempos, guardá-las no projeto, descarregá-las como SRT/WebVTT ou incorporá-las numa nova versão do vídeo com a fonte e a cor padrão do sistema. O estilo visual não é configurável. |
| Perfil(s) de utilizador abrangidos | Utilizadores Registado e Premium podem criar e editar legendas manualmente. Apenas o Premium pode pedir geração automática por IA. O Anónimo não inicia operações de vídeo no MVP. |
| Justificação no contexto do MVP | A funcionalidade melhora a acessibilidade dos vídeos através de edição manual acessível a todos os utilizadores autenticados e de uma opção de transcrição automática para Premium. A transcrição gera uma base editável; o utilizador mantém controlo sobre o resultado final. |

## 2.1 Caso de Uso 01 - Criar legendas para um vídeo

### 2.1.1 Cabeçalho

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-001 |
| Nome | Criar legendas para um vídeo |
| Versão | v1.2 |
| Autor | Luís Pires |
| Data | 2026-10-18 |
| Objetivo | Permitir ao utilizador criar legendas manualmente ou, se for Premium, gerar uma proposta automática com IA, rever e editar o texto e os tempos, guardá-la e, opcionalmente, descarregá-la ou incorporá-la num novo vídeo com a fonte e a cor padrão, sem opções de personalização visual. |
| Âmbito | PictuRAS - projetos e processamento de vídeo: leitor, editor de texto e tempos das legendas, geração automática por IA para Premium, persistência, exportação e incorporação assíncrona com estilo visual padrão não configurável. |
| Ator Principal | Utilizador autenticado: Registado ou Premium. |
| Stakeholders e Interesses | - Utilizador Registado ou Premium: criar legendas sincronizadas e controlar o resultado; o Premium pode acelerar a criação com uma proposta de IA.<br>- Audiência do vídeo: ler legendas legíveis e sincronizadas.<br>- Proprietário do projeto: manter o vídeo original e as legendas guardadas.<br>- Equipa de Desenvolvimento/DevOps: processar a geração e a incorporação sem bloquear outras operações e limpar temporários.<br>- Administrador do sistema: proteger vídeos, legendas e resultados. |
| Pré-condições | - O utilizador está autenticado e autorizado a editar o projeto.<br>- O projeto contém um vídeo disponível, carregado ou produzido por uma operação concluída.<br>- Para iniciar a geração automática ou a incorporação, não existe outra operação de processamento de vídeo Em Fila ou Em Processamento no mesmo projeto, independentemente da ferramenta (RN7). Operações do mesmo utilizador noutros projetos não impedem o pedido. |
| Trigger | O utilizador seleciona um vídeo e abre a ferramenta “Legendas”. |

### 2.1.2 Fluxo Principal

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona um vídeo do projeto. | Apresenta o vídeo no leitor com nome, duração, formato e controlos de reprodução. |
| 2 | Seleciona “Legendas”. | Abre o editor e carrega as legendas existentes para essa versão do vídeo ou apresenta uma lista vazia. |
| 3 | Escolhe “Criar manualmente” e “Adicionar legenda”. | Cria um segmento editável com campos para texto, início e fim. Em alternativa, um utilizador Premium pode escolher “Gerar automaticamente” e seguir FA2. |
| 4 | Escreve o texto e define os tempos, usando a reprodução do vídeo para sincronizar o segmento. | Atualiza a lista e a sobreposição de pré-visualização e valida os valores segundo RN3. |
| 5 | Repete os passos 3 e 4 até terminar e escolhe “Guardar”. | Valida e guarda os segmentos revistos no projeto, associados à versão do vídeo, e confirma a gravação. |
| 6 | Escolhe “Descarregar legendas” ou “Incorporar no vídeo”. | Para descarregar, oferece SRT e WebVTT e gera o ficheiro. Para incorporar, usa a fonte e a cor padrão do sistema, valida acesso, limites, concorrência no projeto (RN7) e quota e cria uma tarefa assíncrona. Não apresenta opções para alterar o estilo visual. |
| 7 | Aguarda o processamento, podendo continuar a utilizar a aplicação. | Apresenta o estado e o progresso da incorporação e permite cancelar. |
| 8 | Pré-visualiza ou descarrega o resultado. | Disponibiliza o ficheiro de legendas ou o novo vídeo. O vídeo original permanece inalterado. |

### 2.1.3 Fluxos Alternativos

| Fluxo | Descrição |
|---|---|
| FA1 - Editar legendas existentes | No passo 2, o vídeo já tem segmentos guardados. O utilizador pode editar, adicionar ou apagar segmentos, independentemente do seu plano. |
| FA2 - Gerar proposta automática (Premium) | No passo 3, um utilizador Premium pede a geração automática. O sistema valida os limites Premium aplicáveis, o tempo máximo de processamento e a inexistência de outra operação de vídeo ativa no mesmo projeto (RN7), transcreve o áudio e apresenta segmentos com texto e tempos para revisão. A proposta não substitui as legendas guardadas até o utilizador a rever e guardar. O utilizador pode corrigir, adicionar ou apagar qualquer segmento usando o editor manual e prosseguir a partir do passo 5. |
| FA3 - Usar a posição atual do leitor | No passo 4, o utilizador define início ou fim do segmento a partir do instante atual de reprodução. |
| FA4 - Descarregar apenas o ficheiro | No passo 6, escolhe SRT ou WebVTT. Não é criada tarefa de vídeo nem consumida quota de processamento. |
| FA5 - Retomar a edição | Depois de guardar, o utilizador sai do editor. Ao regressar, o sistema carrega os segmentos persistidos. Alterações por guardar são sinalizadas antes de sair. |
| FA6 - Alterar legendas depois da incorporação | O utilizador edita e guarda os segmentos e pede nova incorporação. O sistema cria outro vídeo derivado, sem substituir os resultados anteriores. |
| FA7 - Legendas após recorte | No recorte UC-VID-002, o novo vídeo recebe uma cópia independente dos segmentos que intersectem o intervalo, com tempos limitados e reajustados segundo UC-VID-002 - RN7. |
| FA8 - Cancelar incorporação | Durante o passo 7, o utilizador cancela. O sistema interrompe a tarefa, remove resultados parciais, liberta a quota reservada e preserva o vídeo e as legendas guardadas. |
| FA9 - Retomar após perder ligação | A tarefa continua no servidor. Ao regressar, o utilizador consulta o estado atual e acede ao resultado se já tiver terminado. |

### 2.1.4 Exceções

| Condição | Comportamento do Sistema |
|---|---|
| E1 - Utilizador Anónimo | Encaminha para registo ou início de sessão e não cria tarefa. |
| E2 - Vídeo removido, inacessível ou sem metadados válidos | Informa o utilizador e impede a edição ou operação. |
| E3 - Segmentos inválidos | Identifica o problema e impede guardar, descarregar ou incorporar até à correção. |
| E4 - Utilizador sem permissão de edição | Recusa a alteração sem expor nem modificar os dados do projeto. |
| E5 - Duração do vídeo acima do limite de incorporação | Recusa a incorporação antes de criar tarefa e informa o limite aplicável: 60 s para Registado ou 600 s para Premium. |
| E6 - Quota diária esgotada | Para Registado, recusa o pedido sem criar tarefa ou reserva adicional e informa quando a quota será reposta. |
| E7 - Outra operação de vídeo ativa no mesmo projeto | Ao pedir a geração automática ou a incorporação num projeto que já tem uma operação de vídeo Em Fila ou Em Processamento, de qualquer ferramenta, não cria nova tarefa nem reserva quota e informa qual a operação em curso e que é necessário aguardar que termine ou cancelá-la. Operações do mesmo utilizador noutros projetos não originam esta exceção. |
| E8 - Falha, tempo excedido ou falta de espaço | Marca a tarefa como Falhada, remove resultados parciais e temporários, liberta a reserva e preserva vídeo e legendas. |
| E9 - Link expirado ou ficheiro indisponível | Renova o URL se o objeto existir; caso contrário, informa que é necessário exportar ou incorporar novamente. |
| E10 - Utilizador não Premium pede geração automática | Recusa a geração por IA, informa que esta opção requer Premium e mantém disponível a criação e edição manual. |
| E11 - Falha ou indisponibilidade da geração por IA | Informa o utilizador, não altera as legendas guardadas e permite continuar manualmente ou tentar novamente mais tarde. |
| E12 - Áudio sem fala reconhecível ou idioma não suportado | Informa que não foi possível gerar uma proposta útil, não substitui as legendas guardadas e permite continuar manualmente. |
| E13 - Vídeo excede os limites Premium ou a geração ultrapassa o tempo máximo | Recusa ou termina a tarefa, informa o limite aplicável, mantém as legendas guardadas e permite continuar manualmente. |

### 2.1.5 Pós-condições

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | As legendas ficam guardadas no projeto e associadas à versão do vídeo. Se pedido, existe um ficheiro SRT/WebVTT ou um novo vídeo com legendas incorporadas. O original permanece inalterado e não ficam temporários. |
| Garantia Mínima | Em falha ou cancelamento, o vídeo original e as últimas legendas guardadas permanecem intactos. Resultados parciais são removidos e qualquer quota reservada é libertada. |

### 2.1.6 Regras de Negócio e Restrições

| ID | Regra |
|---|---|
| RN1 | A ferramenta requer autenticação e autorização de edição do projeto. O Anónimo deve autenticar-se antes de a utilizar. |
| RN2 | A entrada é um vídeo disponível no projeto, em formato aceite pelo MVP conforme UC-VID-002 - RN6 e UC-VID-003 - RN17. Os vídeos gerados não voltam a estar sujeitos aos limites de carregamento externo; aplicam-se os limites da operação de processamento. |
| RN3 | Cada segmento tem texto não vazio, `0 ≤ início < fim ≤ duração`, duração entre 0,5 e 10 s, no máximo duas linhas de 42 caracteres e não se sobrepõe a outro segmento. Segmentos inválidos não podem ser guardados nem exportados. |
| RN4 | As legendas são dados do projeto associados à versão do vídeo. Editá-las não modifica o ficheiro de vídeo. |
| RN5 | Os formatos de exportação são SRT e WebVTT. A exportação isolada não cria tarefa de processamento de vídeo. |
| RN6 | A incorporação cria um novo MP4 (H.264/AAC), aplica a fonte e a cor padrão definidas pelo sistema e nunca substitui o vídeo de origem. A fonte e a cor são fixas no MVP: o utilizador não pode configurá-las nem editá-las; apenas pode editar o texto e os tempos dos segmentos. |
| RN7 | Concorrência por projeto (RNG-11). Cada projeto pode ter no máximo uma operação de processamento de vídeo Em Fila ou Em Processamento, independentemente da ferramenta (geração automática de legendas, incorporação, recorte ou concatenação), em conformidade com UC-VID-002 - RN5 e UC-VID-003 - RN18. O mesmo utilizador pode ter operações ativas em projetos diferentes; ficam em fila e a execução efetiva depende da disponibilidade dos workers, e a quota diária continua a ser por utilizador (RN8). A edição manual, a gravação e a exportação SRT/WebVTT não são operações de processamento de vídeo e não são bloqueadas. A verificação e a criação da tarefa são atómicas: de dois pedidos simultâneos para o mesmo projeto, no máximo um é aceite. Resultados tardios de tarefas canceladas ou falhadas não são consolidados. |
| RN8 | Cada incorporação conta como uma operação para Registado e usa a quota diária partilhada entre ferramentas (UC-VID-002 - RN4; UC-VID-003 - RN16). A operação é reservada ao aceitar, consumida no sucesso e libertada em qualquer outro desfecho. Premium não tem limite diário. Editar, guardar ou exportar SRT/WebVTT não consome quota de processamento. |
| RN9 | A incorporação é assíncrona, apresenta estado e progresso e pode ser cancelada. Falhas e cancelamentos removem ficheiros parciais e temporários. |
| RN10 | Vídeos, legendas e resultados são protegidos em trânsito e em repouso e acessíveis apenas a utilizadores com permissão válida no projeto. |
| RN11 | No recorte, os segmentos que intersectam o intervalo são copiados independentemente, limitados e reajustados segundo UC-VID-002 - RN7. A cópia não altera o original. |
| RN12 | A geração automática por IA só está disponível para Premium e aplica os limites Premium da funcionalidade: vídeo até 2 GB e 60 minutos (UC-VID-000 - RN2), tempo máximo de processamento de 900 s (UC-VID-002 - RN8) e sem quota diária adicional. Gera uma proposta de texto e tempos a partir do áudio do vídeo, no idioma falado; não traduz, não substitui segmentos já guardados e só passa a ser a versão do projeto quando o utilizador a revê e guarda. |
| RN13 | A proposta automática tem de cumprir RN3 antes de ser guardada ou exportada. O utilizador pode editar, adicionar ou remover segmentos com as mesmas operações e validações da criação manual. Falha ou cancelamento da geração não altera as legendas guardadas. |
| RN14 | Para incorporar legendas, a duração total do vídeo de origem não pode exceder 60 s para Registado nem 600 s para Premium, em alinhamento com os valores por perfil de UC-VID-002 - RN1. É um limite próprio da incorporação, aplica-se também a vídeos gerados no projeto e não reaplica os limites de carregamento externo de UC-VID-000 - RN2. |

### 2.1.7 Assunções

| ID | Assunção |
|---|---|
| A1 | O carregamento e a validação inicial dos vídeos pertencem ao caso de uso de carregamento de vídeo. |
| A2 | A criação manual permanece disponível para Registado e Premium. A geração automática por IA é uma opção adicional exclusiva de Premium; produz uma proposta de transcrição no idioma falado, sem tradução, que o utilizador pode corrigir no mesmo editor. |
| A3 | Os segmentos são guardados como dados do projeto, com texto, tempos e versão de vídeo; não é necessário carregar um ficheiro para começar. |
| A4 | A pré-visualização ocorre no cliente. A incorporação é processada no servidor pelo mecanismo assíncrono das operações de vídeo. |
### 2.1.8 Questões em Aberto

| ID | Questão em aberto |
|---|---|
| Q1 | Utilizadores com link de partilha podem editar legendas ou apenas visualizá-las? |
| Q2 | Que idiomas e formatos de áudio são suportados pela geração automática no MVP? |

## 4. Esboço de requisitos derivados

### 4.1 Requisitos de Sistema

| ID | Requisito | Tipo | Prioridade | Origem | Critério de aceitação |
|---|---|---|---|---|---|
| REQ-VID-LEG-001 | Permitir selecionar um vídeo do projeto e abri-lo no leitor com nome, duração e formato. | F | Deve ter | NOVO | Selecionar um vídeo disponível apresenta o item correto e os respetivos metadados. |
| REQ-VID-LEG-002 | Abrir um editor com legendas existentes da versão ou lista vazia. | F | Deve ter | NOVO | Vídeos com e sem legendas mostram o estado correto. |
| REQ-VID-LEG-003 | Criar segmentos com texto, início e fim e pré-visualizá-los sincronizados. | F | Deve ter | NOVO | O segmento aparece na lista e sobreposto nos instantes definidos. |
| REQ-VID-LEG-004 | Editar e apagar segmentos existentes. | F | Deve ter | NOVO | Alterações ao texto/tempos e remoções atualizam a lista. |
| REQ-VID-LEG-005 | Validar segmentos segundo RN3 e bloquear gravação/exportação inválida. | F | Deve ter | NOVO | Valores inválidos são identificados e não são persistidos nem exportados. |
| REQ-VID-LEG-006 | Guardar legendas associadas à versão e carregá-las ao reabrir o editor. | F | Deve ter | NOVO | Guardar e reabrir apresenta os mesmos segmentos. |
| REQ-VID-LEG-007 | Exportar SRT e WebVTT sem criar tarefa de processamento de vídeo. | F | Deve ter | NOVO | Ambos os ficheiros têm conteúdo e tempos corretos; não existe nova tarefa. |
| REQ-VID-LEG-008 | Validar perfil, limites de duração segundo RN14, concorrência no projeto segundo RN7 e quota antes de aceitar incorporação. | F | Deve ter | NOVO | Vídeos até 60 s para Registado e 600 s para Premium podem prosseguir se cumprirem as restantes regras; vídeos acima do limite são recusados sem criar tarefa nem reservar quota. Com outra operação de vídeo ativa no mesmo projeto, o pedido é recusado sem criar tarefa nem reservar quota. |
| REQ-VID-LEG-009 | Incorporar legendas num novo MP4 (H.264/AAC), sem alterar o original. | F | Deve ter | NOVO | O vídeo derivado reproduz-se e o original permanece igual. |
| REQ-VID-LEG-010 | Mostrar estado/progresso, permitir cancelar e ignorar resultados tardios. | F | Deve ter | NOVO | Cancelar remove parciais e impede consolidar um resultado tardio. |
| REQ-VID-LEG-011 | Consumir quota Registado apenas no sucesso e libertar reserva nos restantes desfechos. | F | Deve ter | NOVO | Sucesso consome uma operação; falha e cancelamento libertam-na. |
| REQ-VID-LEG-012 | Copiar legendas para o vídeo recortado com tempos ajustados segundo UC-VID-002 - RN7. | F | Deve ter | NOVO | O recorte recebe cópia independente com os tempos esperados. |
| REQ-VID-LEG-013 | Limpar temporários e resultados parciais após sucesso, falha ou cancelamento. | NF (Integridade) | Deve ter | NOVO | Apenas resultados consolidados permanecem após cada desfecho. |
| REQ-VID-LEG-014 | Proteger vídeos e legendas e aplicar permissões do projeto. | NF (Segurança) | Deve ter | NOVO | Acesso sem autorização é recusado. |
| REQ-VID-LEG-015 | Disponibilizar a opção de geração automática apenas a utilizadores Premium, mantendo a criação e edição manual disponíveis para Registado e Premium. | F | Deve ter | NOVO | Registado não consegue iniciar geração e continua a criar legendas manualmente; Premium vê e consegue iniciar a opção automática. |
| REQ-VID-LEG-016 | Gerar, a partir do áudio do vídeo, uma proposta de segmentos com texto e tempos sincronizados, sem substituir dados persistidos até à confirmação do utilizador. | F | Deve ter | NOVO | A proposta aparece no editor sem alterar as legendas guardadas; ao descartar a proposta, os dados previamente guardados mantêm-se. |
| REQ-VID-LEG-017 | Permitir rever, editar e validar uma proposta automática no editor manual antes de guardar, exportar ou incorporar. | F | Deve ter | NOVO | Texto e tempos podem ser corrigidos; segmentos inválidos são bloqueados pelas regras de RN3. |
| REQ-VID-LEG-018 | Recusar a incorporação quando a duração do vídeo de origem exceder 60 s para Registado ou 600 s para Premium, sem aplicar os limites de carregamento externo a vídeos já existentes no projeto. | F | Deve ter | NOVO | Um Registado pode incorporar um vídeo de 60 s, mas não de 61 s; um Premium pode incorporar um vídeo de 600 s, mas não de 601 s; nenhum pedido recusado cria tarefa ou reserva quota. |
| REQ-VID-LEG-019 | Incorporar as legendas com a fonte e a cor padrão do sistema, sem permitir ao utilizador configurá-las ou editá-las; manter editáveis o texto e os tempos segundo RN3. | F | Deve ter | NOVO | Ao incorporar, o vídeo apresenta o estilo padrão. A interface não disponibiliza controlos de fonte ou cor, mas permite editar texto e tempos antes de guardar ou incorporar. |
| REQ-VID-LEG-020 | Disponibilizar a geração automática apenas para Premium e aplicar os limites Premium de entrada e de processamento definidos em RN12, sem quota diária adicional. | F | Deve ter | NOVO | Vídeos até 2 GB e 60 minutos podem ser processados; acima desses limites são recusados. A tarefa termina como Falhada se exceder 900 s de processamento, sem alterar as legendas guardadas; não existe quota diária adicional para Premium. |
| REQ-VID-LEG-021 | Aplicar RN7 à geração automática e à incorporação: aceitar no máximo uma operação de processamento de vídeo Em Fila ou Em Processamento por projeto, independentemente da ferramenta, aceitar operações do mesmo utilizador noutros projetos e não bloquear a edição, a gravação nem a exportação SRT/WebVTT. | F | Deve ter | ALT | Com um recorte ativo no projeto A, pedir a incorporação em A é recusado e pedir a geração automática no projeto B do mesmo utilizador é aceite; dois pedidos simultâneos para A criam no máximo uma tarefa; durante a tarefa ativa em A, guardar e exportar legendas em A continua a funcionar; depois de a tarefa terminar, falhar ou ser cancelada, A volta a aceitar uma nova operação. |

### 4.2 Impacto no Sistema Existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Frontend: página do projeto e leitor | Estender | Adicionar ferramenta “Legendas”, editor manual de texto e tempos, opção de geração automática Premium e pré-visualização sincronizada, sem controlos para alterar fonte ou cor. | REQ-VID-LEG-001 a REQ-VID-LEG-007, REQ-VID-LEG-015 a REQ-VID-LEG-017, REQ-VID-LEG-019 |
| API Gateway | Estender | Adicionar rotas para ler/gravar legendas, pedir geração automática com verificação Premium e iniciar incorporação, aplicando autenticação e permissões. | REQ-VID-LEG-006 a REQ-VID-LEG-011, REQ-VID-LEG-014 a REQ-VID-LEG-016, REQ-VID-LEG-018 |
| Serviço de IA/transcrição | Estender | Transcrever o áudio para uma proposta de segmentos com tempos, aplicando os limites Premium definidos, sem persistir nem substituir as legendas até confirmação do utilizador. | REQ-VID-LEG-015 a REQ-VID-LEG-017, REQ-VID-LEG-020 |
| Project Service: modelo de dados | Alterar | Guardar segmentos associados à versão de vídeo e referências a vídeos derivados. | REQ-VID-LEG-006, REQ-VID-009, REQ-VID-012 |
| Processamento de vídeo | Estender | Incorporar legendas com a fonte e a cor padrão, por tarefa assíncrona; validar previamente a duração de origem segundo RN14 e aplicar o tempo máximo de processamento por perfil, com progresso, cancelamento e limpeza. | REQ-VID-LEG-008 a REQ-VID-LEG-013, REQ-VID-LEG-018, REQ-VID-LEG-019 |
| Quotas e perfis | Estender | Reservar, consumir e libertar operações de incorporação segundo a quota partilhada; aplicar a elegibilidade e os limites Premium à geração automática, sem quota diária adicional. | REQ-VID-LEG-008, REQ-VID-LEG-011, REQ-VID-LEG-015, REQ-VID-LEG-020 |
| Controlo de concorrência de operações de vídeo | Alterar | Passar o bloqueio de uma operação ativa por utilizador para uma operação ativa por projeto, comum a todas as ferramentas de vídeo e atómico na criação da tarefa; libertá-lo no fim, falha ou cancelamento. | REQ-VID-LEG-008, REQ-VID-LEG-010, REQ-VID-LEG-021 |
| Armazenamento | Estender | Guardar exports e vídeos derivados com controlo de acesso e limpeza de temporários. | REQ-VID-LEG-007, REQ-VID-LEG-009, REQ-VID-LEG-013, REQ-VID-LEG-014 |
| Interação com recorte | Estender | Copiar segmentos para o vídeo recortado com tempos reajustados, sem alterar a origem. | REQ-VID-LEG-012 |

### 4.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição do Elemento | Requisitos Mapeados |
|---|---|---|
| Passos 1–2 | Selecionar vídeo e abrir editor | REQ-VID-LEG-001, REQ-VID-LEG-002 |
| Passos 3–5 / FA1–FA3 | Criar, editar, validar e guardar segmentos manualmente ou após geração automática | REQ-VID-LEG-003 a REQ-VID-LEG-006, REQ-VID-LEG-015 a REQ-VID-LEG-017 |
| FA2 / RN12–RN13 | Gerar proposta automática Premium e rever antes de guardar | REQ-VID-LEG-015 a REQ-VID-LEG-017 |
| RN12 / E13 | Aplicar limites Premium à geração automática | REQ-VID-LEG-020 |
| Passo 6 / FA4 | Exportar SRT/WebVTT | REQ-VID-LEG-007 |
| Passos 6–8 / FA6, FA8–FA9, E5 | Validar limites, incorporar, monitorizar e cancelar | REQ-VID-LEG-008 a REQ-VID-LEG-011, REQ-VID-LEG-013, REQ-VID-LEG-018 |
| FA7 / RN11 | Copiar legendas para o recorte | REQ-VID-LEG-012 |
| RN6 | Incorporar com fonte e cor padrão não configuráveis | REQ-VID-LEG-009, REQ-VID-LEG-019 |
| RN7 / E7 | Uma operação de vídeo ativa por projeto, independentemente da ferramenta | REQ-VID-LEG-008, REQ-VID-LEG-021 |
| RN1, RN10 | Permissões e segurança | REQ-VID-LEG-014 |
