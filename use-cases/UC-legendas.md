# UC-VID-001 - Adicionar legendas manualmente a um vídeo

## 0. Identificação

| Campo | Valor |
|---|---|
| Grupo / Equipa | Grupo 1 |
| Autores | Eduardo Freitas, Francisco Contente, Luís Pires, Rui Castro |
| Data | 2026-10-18 |
| Versão do documento | v1.0 |
| Unidade Curricular | Requisitos e Arquiteturas de Software - MEI, Universidade do Minho |

## 1.1 Funcionalidade 1 - Adicionar legendas manualmente a um vídeo

| Campo | Valor |
|---|---|
| Funcionalidade | Criar, sincronizar e editar manualmente legendas de um vídeo, guardá-las no projeto, descarregá-las como SRT/WebVTT ou incorporá-las numa nova versão do vídeo. |
| Perfil(s) de utilizador abrangidos | Utilizador Registado e Premium, sujeitos aos limites de utilização e processamento do respetivo perfil. O Anónimo não inicia operações de vídeo no MVP. |
| Justificação no contexto do MVP | A funcionalidade melhora a acessibilidade dos vídeos sem exigir um editor completo ou um serviço externo de transcrição. Exercita a edição de dados associados a um vídeo, a exportação e o processamento assíncrono de um novo resultado. |

## 2.1 Caso de Uso 01 - Adicionar legendas manualmente a um vídeo

### 2.1.1 Cabeçalho

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-001 |
| Nome | Adicionar legendas manualmente a um vídeo |
| Versão | v1.0 |
| Autor | Luís Pires |
| Data | 2026-10-18 |
| Objetivo | Permitir ao utilizador escrever e sincronizar legendas para um vídeo, guardá-las e, opcionalmente, descarregá-las ou incorporá-las num novo vídeo. |
| Âmbito | PictuRAS - projetos e processamento de vídeo: leitor, editor de legendas, persistência, exportação e incorporação assíncrona. |
| Ator Principal | Utilizador autenticado: Registado ou Premium. |
| Stakeholders e Interesses | - Utilizador Registado ou Premium: criar legendas sincronizadas e controlar o resultado.<br>- Audiência do vídeo: ler legendas legíveis e sincronizadas.<br>- Proprietário do projeto: manter o vídeo original e as legendas guardadas.<br>- Equipa de Desenvolvimento/DevOps: processar a incorporação sem bloquear outras operações e limpar temporários.<br>- Administrador do sistema: proteger vídeos, legendas e resultados. |
| Pré-condições | - O utilizador está autenticado e autorizado a editar o projeto.<br>- O projeto contém um vídeo disponível, carregado ou produzido por uma operação concluída.<br>- Para iniciar incorporação, não existe outra operação de processamento de vídeo Em Fila ou Em Processamento no mesmo projeto (RN7). |
| Trigger | O utilizador seleciona um vídeo e abre a ferramenta “Legendas”. |

### 2.1.2 Fluxo Principal

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona um vídeo do projeto. | Apresenta o vídeo no leitor com nome, duração, formato e controlos de reprodução. |
| 2 | Seleciona “Legendas”. | Abre o editor e carrega as legendas existentes para essa versão do vídeo ou apresenta uma lista vazia. |
| 3 | Escolhe “Adicionar legenda”. | Cria um segmento editável com campos para texto, início e fim. |
| 4 | Escreve o texto e define os tempos, usando a reprodução do vídeo para sincronizar o segmento. | Atualiza a lista e a sobreposição de pré-visualização e valida os valores segundo RN3. |
| 5 | Repete os passos 3 e 4 até terminar e escolhe “Guardar”. | Valida e guarda os segmentos no projeto, associados à versão do vídeo, e confirma a gravação. |
| 6 | Escolhe “Descarregar legendas” ou “Incorporar no vídeo”. | Para descarregar, oferece SRT e WebVTT e gera o ficheiro. Para incorporar, valida acesso, limites, quota e concorrência e cria uma tarefa assíncrona. |
| 7 | Aguarda o processamento, podendo continuar a utilizar a aplicação. | Apresenta o estado e o progresso da incorporação e permite cancelar. |
| 8 | Pré-visualiza ou descarrega o resultado. | Disponibiliza o ficheiro de legendas ou o novo vídeo. O vídeo original permanece inalterado. |

### 2.1.3 Fluxos Alternativos

| Fluxo | Descrição |
|---|---|
| FA1 - Editar legendas existentes | No passo 2, o vídeo já tem segmentos guardados. O utilizador pode editar, adicionar ou apagar segmentos. |
| FA2 - Usar a posição atual do leitor | No passo 4, o utilizador define início ou fim do segmento a partir do instante atual de reprodução. |
| FA3 - Descarregar apenas o ficheiro | No passo 6, escolhe SRT ou WebVTT. Não é criada tarefa de vídeo nem consumida quota de processamento. |
| FA4 - Retomar a edição | Depois de guardar, o utilizador sai do editor. Ao regressar, o sistema carrega os segmentos persistidos. Alterações por guardar são sinalizadas antes de sair. |
| FA5 - Alterar legendas depois da incorporação | O utilizador edita e guarda os segmentos e pede nova incorporação. O sistema cria outro vídeo derivado, sem substituir os resultados anteriores. |
| FA6 - Legendas após recorte | No recorte UC-VID-002, o novo vídeo recebe uma cópia independente dos segmentos que intersectem o intervalo, com tempos limitados e reajustados segundo UC-VID-002 - RN7. |
| FA7 - Cancelar incorporação | Durante o passo 7, o utilizador cancela. O sistema interrompe a tarefa, remove resultados parciais, liberta a quota reservada e preserva o vídeo e as legendas guardadas. |
| FA8 - Retomar após perder ligação | A tarefa continua no servidor. Ao regressar, o utilizador consulta o estado atual e acede ao resultado se já tiver terminado. |

### 2.1.4 Exceções

| Condição | Comportamento do Sistema |
|---|---|
| E1 - Utilizador Anónimo | Encaminha para registo ou início de sessão e não cria tarefa. |
| E2 - Vídeo removido, inacessível ou sem metadados válidos | Informa o utilizador e impede a edição ou operação. |
| E3 - Segmentos inválidos | Identifica o problema e impede guardar, descarregar ou incorporar até à correção. |
| E4 - Utilizador sem permissão de edição | Recusa a alteração sem expor nem modificar os dados do projeto. |
| E5 - Limite do perfil excedido | Recusa a incorporação antes de criar tarefa e informa o limite aplicável. |
| E6 - Quota diária esgotada | Para Registado, recusa o pedido sem criar tarefa ou reserva adicional e informa quando a quota será reposta. |
| E7 - Outra operação de vídeo ativa | Não cria segunda tarefa no projeto e informa que é necessário aguardar ou cancelar a tarefa ativa. |
| E8 - Falha, tempo excedido ou falta de espaço | Marca a tarefa como Falhada, remove resultados parciais e temporários, liberta a reserva e preserva vídeo e legendas. |
| E9 - Link expirado ou ficheiro indisponível | Renova o URL se o objeto existir; caso contrário, informa que é necessário exportar ou incorporar novamente. |

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
| RN6 | A incorporação cria um novo MP4 (H.264/AAC) e nunca substitui o vídeo de origem. |
| RN7 | Cada utilizador pode ter no máximo uma operação de vídeo Em Fila ou Em Processamento, de acordo com UC-VID-002 - RN5 e UC-VID-003 - RN18. Resultados tardios de tarefas canceladas ou falhadas não são consolidados. |
| RN8 | Cada incorporação conta como uma operação para Registado e usa a quota diária partilhada entre ferramentas (UC-VID-002 - RN4; UC-VID-003 - RN16). A operação é reservada ao aceitar, consumida no sucesso e libertada em qualquer outro desfecho. Premium não tem limite diário. Editar, guardar ou exportar SRT/WebVTT não consome quota de processamento. |
| RN9 | A incorporação é assíncrona, apresenta estado e progresso e pode ser cancelada. Falhas e cancelamentos removem ficheiros parciais e temporários. |
| RN10 | Vídeos, legendas e resultados são protegidos em trânsito e em repouso e acessíveis apenas a utilizadores com permissão válida no projeto. |
| RN11 | No recorte, os segmentos que intersectam o intervalo são copiados independentemente, limitados e reajustados segundo UC-VID-002 - RN7. A cópia não altera o original. |

### 2.1.7 Assunções

| ID | Assunção |
|---|---|
| A1 | O carregamento e a validação inicial dos vídeos pertencem ao caso de uso de carregamento de vídeo. |
| A2 | O utilizador escreve o texto e define manualmente a sincronização. Transcrição, tradução e geração automática por IA estão fora do âmbito. |
| A3 | Os segmentos são guardados como dados do projeto, com texto, tempos e versão de vídeo; não é necessário carregar um ficheiro para começar. |
| A4 | A pré-visualização ocorre no cliente. A incorporação é processada no servidor pelo mecanismo assíncrono das operações de vídeo. |
| A5 | O MVP usa estilo fixo por omissão para as legendas incorporadas. |

### 2.1.8 Questões em Aberto

| ID | Questão em aberto |
|---|---|
| Q1 | O estilo de incorporação deve ser configurável no MVP ou basta um estilo por omissão? |
| Q2 | Utilizadores com link de partilha podem editar legendas ou apenas visualizá-las? |

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
| REQ-VID-LEG-008 | Validar perfil, limites, quota e concorrência antes de aceitar incorporação. | F | Deve ter | NOVO | Pedidos inválidos são recusados sem criar tarefa nem reservar quota. |
| REQ-VID-LEG-009 | Incorporar legendas num novo MP4 (H.264/AAC), sem alterar o original. | F | Deve ter | NOVO | O vídeo derivado reproduz-se e o original permanece igual. |
| REQ-VID-LEG-010 | Mostrar estado/progresso, permitir cancelar e ignorar resultados tardios. | F | Deve ter | NOVO | Cancelar remove parciais e impede consolidar um resultado tardio. |
| REQ-VID-LEG-011 | Consumir quota Registado apenas no sucesso e libertar reserva nos restantes desfechos. | F | Deve ter | NOVO | Sucesso consome uma operação; falha e cancelamento libertam-na. |
| REQ-VID-LEG-012 | Copiar legendas para o vídeo recortado com tempos ajustados segundo UC-VID-002 - RN7. | F | Deve ter | NOVO | O recorte recebe cópia independente com os tempos esperados. |
| REQ-VID-LEG-013 | Limpar temporários e resultados parciais após sucesso, falha ou cancelamento. | NF (Integridade) | Deve ter | NOVO | Apenas resultados consolidados permanecem após cada desfecho. |
| REQ-VID-LEG-014 | Proteger vídeos e legendas e aplicar permissões do projeto. | NF (Segurança) | Deve ter | NOVO | Acesso sem autorização é recusado. |

### 4.2 Impacto no Sistema Existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Frontend: página do projeto e leitor | Estender | Adicionar ferramenta “Legendas”, editor manual e pré-visualização sincronizada. | REQ-VID-LEG-001 a REQ-VID-007 |
| API Gateway | Estender | Adicionar rotas para ler/gravar legendas e iniciar incorporação, aplicando autenticação e permissões. | REQ-VID-LEG-006 a REQ-VID-011, REQ-VID-014 |
| Project Service: modelo de dados | Alterar | Guardar segmentos associados à versão de vídeo e referências a vídeos derivados. | REQ-VID-LEG-006, REQ-VID-009, REQ-VID-012 |
| Processamento de vídeo | Estender | Incorporar legendas por tarefa assíncrona, com progresso, cancelamento e limpeza. | REQ-VID-LEG-008 a REQ-VID-013 |
| Quotas e perfis | Estender | Reservar, consumir e libertar operações segundo a quota partilhada com outras ferramentas. | REQ-VID-LEG-008, REQ-VID-LEG-011 |
| Armazenamento | Estender | Guardar exports e vídeos derivados com controlo de acesso e limpeza de temporários. | REQ-VID-LEG-007, REQ-VID-LEG-009, REQ-VID-LEG-013, REQ-VID-LEG-014 |
| Interação com recorte | Estender | Copiar segmentos para o vídeo recortado com tempos reajustados, sem alterar a origem. | REQ-VID-LEG-012 |

### 4.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição do Elemento | Requisitos Mapeados |
|---|---|---|
| Passos 1–2 | Selecionar vídeo e abrir editor | REQ-VID-LEG-001, REQ-VID-LEG-002 |
| Passos 3–5 / FA1–FA2 | Criar, editar, validar e guardar segmentos | REQ-VID-LEG-003 a REQ-VID-LEG-006 |
| Passo 6 / FA3 | Exportar SRT/WebVTT | REQ-VID-LEG-007 |
| Passos 6–8 / FA5, FA7–FA8 | Validar, incorporar, monitorizar e cancelar | REQ-VID-LEG-008 a REQ-VID-LEG-011, REQ-VID-LEG-013 |
| FA6 / RN11 | Copiar legendas para o recorte | REQ-VID-LEG-012 |
| RN1, RN10 | Permissões e segurança | REQ-VID-LEG-014 |
