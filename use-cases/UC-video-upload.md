.1. UC-VID-000 - Carregar um vídeo para um projeto 
## 4.1.1. Cabeçalho 
 
**Tabela 5: Caso de uso UC-VID-000 - Carregar um vídeo para um projeto**
 
| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-000 |
| Nome | Carregar um vídeo para um projeto |
| Versão | v1.2 |
| Autor | Luís Pires |
| Data | 2026-10-19 |
| Objetivo | Permitir a um utilizador Registado ou Premium adicionar um vídeo suportado a um projeto, guardando-o de forma íntegra e apresentando-o na biblioteca para reprodução e utilização posterior. |
| Âmbito | Interface de projetos do PictuRAS, API Gateway, Project Service, serviço de armazenamento de ficheiros (SeaweedFS / Image Storage), serviço de utilizadores para consulta do perfil e metadados de vídeo (ffprobe). |
| Ator Principal | Utilizador autenticado com perfil Registado ou Premium e permissão para editar o projeto. |
| Stakeholders e Interesses | Utilizador Registado: carregar vídeos dentro dos limites do plano e utilizá-los nas ferramentas disponíveis. Utilizador Premium: carregar vídeos de maior dimensão e duração. Proprietário do projeto: manter os ficheiros e metadados corretos, sem substituir conteúdos existentes. Equipa de Desenvolvimento/DevOps: validar entradas, preservar a consistência do projeto e limpar ficheiros temporários. Administrador do sistema: proteger os ficheiros e impedir acesso ou alterações não autorizados. |
| Pré-condições | O utilizador tem sessão iniciada e pode editar o projeto; o projeto existe e a sua versão atual é conhecida pela interface; o serviço de utilizadores, o serviço de projetos e o armazenamento estão disponíveis; o perfil do utilizador é Registado ou Premium. |
 
## 4.1.2. Fluxo Principal 
 
**Tabela 6: UC-VID-000 - Fluxo principal**
 
| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Abre um projeto e seleciona um ficheiro de vídeo (.mp4 ou .webm) na área de carregamento. | Apresenta o ficheiro na lista de itens a carregar, com o nome e uma pré-visualização. |
| 2 | Confirma o carregamento. | Verifica a sessão, a permissão de edição e a versão do projeto. Recebe o ficheiro como multipart/form-data e guarda-o temporariamente para validação. |
| 3 | - | Consulta o perfil do utilizador e valida a extensão, o tamanho máximo aplicável, a existência de uma pista de vídeo válida, a duração e os codecs permitidos (RN1-RN3). |
| 4 | - | Verifica se já existe no projeto um ficheiro com o mesmo nome. Se os controlos forem válidos, calcula o hash SHA-256 e envia o vídeo para o armazenamento, associado ao projeto e à área de origem (src). |
| 5 | - | Adiciona ao projeto a referência do ficheiro, o identificador no armazenamento, o hash e os metadados técnicos (duração, codecs, resolução, taxa de fotogramas, dimensão e formato). Gera e guarda uma miniatura do vídeo, correspondente a um fotograma a 10% da duração, no máximo a 1 segundo, para apresentação na biblioteca. Se a miniatura não puder ser gerada, o carregamento prossegue. Atualiza a versão do projeto de forma consistente (RN4, RN5). |
| 6 | - | Elimina o ficheiro temporário local e responde com sucesso e a nova versão do projeto. |
| 7 | Continua a utilizar o projeto. | Atualiza a biblioteca e disponibiliza o vídeo para reprodução e para as ferramentas de vídeo compatíveis. |
 
## 4.1.3. Fluxos Alternativos
 
**Tabela 7: UC-VID-000 - Fluxos alternativos**
 
| Fluxo | Descrição |
|---|---|
| FA1 - Vários ficheiros selecionados | No passo 1, o utilizador seleciona vários ficheiros. A interface envia cada ficheiro individualmente e em sequência, atualizando a versão do projeto após cada carregamento aceite. Se um ficheiro falhar, apresenta o erro associado a esse ficheiro e permite repetir apenas os ficheiros falhados. Os carregamentos concluídos mantêm-se e não são reenviados. |
| FA2 - Vídeo sem áudio | No passo 3, o sistema deteta que o vídeo não possui pista de áudio. O vídeo é aceite se cumprir as restantes validações. Os metadados registam ausência de pista de áudio; ferramentas que necessitam de áudio, como a geração de legendas, aplicam as suas próprias regras. O carregamento prossegue no passo 4. |
| FA3 - Recuperação após falha de versão | No passo 2, se a versão do projeto enviada pelo cliente estiver desatualizada, o sistema rejeita o carregamento, informa da versão atual e permite atualizar o projeto antes de tentar novamente a partir do passo 1. |
| FA4 - Carregamento por projeto partilhado | Nos passos 1 e 2, um colaborador com permissão de edição pode carregar o vídeo conforme as permissões de partilha do projeto. A associação do ficheiro continua a ser feita ao projeto proprietário, prosseguindo o fluxo normal. |
| FA5 - Descarregar o vídeo | Na vista de um vídeo do projeto, o utilizador escolhe «Descarregar». Sem legendas guardadas, o sistema entrega o ficheiro original no formato em que está armazenado (MP4 ou WebM), sem conversão. Com legendas guardadas, apresenta as opções de UC-VID-001/FA4b: vídeo com legendas, vídeo sem legendas, legendas SRT ou WebVTT. O descarregamento não cria tarefa, não consome quota e não modifica o vídeo. |
 
## 4.1.4. Exceções 
 
**Orientação (esconder antes de entregar)** 
Incluam pelo menos uma exceção específica de vídeo (formato/codec não suportado, duração ou tamanho excedidos,  falha a meio do processamento, quota esgotada, …). 
 
**Tabela 8: UC-VID-000 - Exceções**
 
| Condição | Comportamento do Sistema |
|---|---|
| E1 - Utilizador anónimo ou perfil não elegível | Recusa o carregamento do vídeo, informa que é necessária uma conta Registada ou Premium e não altera o projeto. |
| E2 - Ficheiro ausente ou extensão não suportada | Rejeita o pedido e informa que deve ser selecionado um ficheiro MP4 ou WebM. Não altera o projeto. |
| E3 - Tamanho acima do limite do perfil | Rejeita o ficheiro antes de o guardar no armazenamento do projeto e indica o limite aplicável: 200 MB para Registado ou 2 GB para Premium. |
| E4 - Vídeo inválido, corrompido ou sem pista de vídeo | A inspeção falha; o sistema rejeita o ficheiro, informa que não foi possível ler um vídeo válido e limpa o ficheiro temporário. |
| E5 - Codec incompatível com a extensão | Rejeita o ficheiro e indica a combinação aceite: MP4 com H.264 e áudio AAC (ou sem áudio); WebM com VP8 e áudio Vorbis (ou sem áudio). |
| E6 - Duração acima do limite do perfil | Rejeita o ficheiro e indica o limite aplicável: 10 minutos para Registado ou 60 minutos para Premium. |
| E7 - Nome já utilizado no projeto | Rejeita o carregamento e informa que já existe um ficheiro com esse nome. O utilizador pode renomear o ficheiro e tentar novamente. |
| E8 - Projeto inexistente ou sem permissão de edição | Recusa o pedido e não grava o vídeo nem altera o projeto. |
| E9 - Conflito de versão do projeto | Não associa o vídeo ao projeto; se o ficheiro já tiver chegado ao armazenamento, elimina essa cópia. Devolve a versão atual para sincronização. |
| E10 - Armazenamento indisponível ou erro ao guardar | Informa que o carregamento falhou, elimina o temporário e qualquer objeto incompleto, e mantém o projeto inalterado. |
| E11 - Interrupção ou falha de rede durante o envio | Apresenta uma falha para o ficheiro afetado. O projeto não deve apresentar um item incompleto; o utilizador pode tentar novamente. |
 
## 4.1.5. Pós-condições 
 
**Tabela 9: UC-VID-000 - Pós-condições**
 
| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | O projeto contém uma nova referência ao vídeo validado, o objeto está guardado no armazenamento e os metadados e o hash correspondem ao ficheiro recebido. O vídeo aparece na biblioteca do projeto, disponível para reprodução e para as ferramentas de vídeo que aceitem o seu formato. A versão do projeto foi atualizada e o ficheiro temporário foi eliminado. |
| Garantia Mínima | Em caso de rejeição ou falha, nenhum vídeo incompleto fica disponível no projeto. Os itens existentes não são modificados, os temporários e objetos parciais são removidos e o utilizador recebe uma indicação do motivo e da ação possível. |
 
## 4.1.6. Regras de Negócio e Restrições 
 
**Tabela 10: UC-VID-000 - Regras de Negócio e Restrições**
 
| ID | Regra |
|---|---|
| RN1 | O carregamento de vídeo está disponível apenas para utilizadores autenticados com perfil Registado (free) ou Premium. O perfil anónimo não pode carregar vídeos. |
| RN2 | Limites para vídeos externos: Registado - tamanho máximo de 200 MB e duração máxima de 10 minutos; Premium - tamanho máximo de 2 GB e duração máxima de 60 minutos. O ficheiro tem de cumprir ambos os limites. Estes limites são aplicados ao carregamento externo e não são reaplicados a vídeos gerados no projeto por outras operações. |
| RN3 | Formatos e codecs aceites: MP4 com vídeo H.264 e áudio AAC, ou sem áudio; WebM com vídeo VP8 e áudio Vorbis, ou sem áudio. A extensão e os codecs têm de corresponder. Tem de existir uma pista de vídeo legível e uma duração válida. |
| RN4 | Cada nome de ficheiro tem de ser único dentro do projeto. O sistema não substitui automaticamente ficheiros existentes. O nome original é preservado tal como foi enviado, incluindo acentos e outros caracteres não ASCII (UTF-8). |
| RN5 | Cada carregamento associa o vídeo ao projeto e guarda os metadados identificados, incluindo hash SHA-256, tamanho, formato, duração, codecs, resolução e taxa de fotogramas. A atualização do projeto respeita a versão esperada, evitando perda de alterações concorrentes. Para cada vídeo é guardada uma miniatura, apresentada na biblioteca com a duração; é apagada com o vídeo ou com o projeto. |
| RN6 | O acesso ao carregamento exige autenticação e permissão de edição no projeto, incluindo quando este é acedido através de partilha. Os vídeos ficam protegidos pelas regras de acesso do projeto e pela proteção de transporte e armazenamento definida para o sistema. |
| RN7 | O carregamento não conta como operação diária de processamento de vídeo e não cria uma tarefa assíncrona de processamento. Por isso, não está sujeito ao limite de uma operação de vídeo ativa por projeto (RNG-11) e é aceite mesmo com uma operação em curso no projeto. Cada ficheiro selecionado é carregado e validado individualmente. |
| RN8 | Ficheiros temporários locais são eliminados após sucesso ou falha. Se a gravação no armazenamento tiver sucesso mas a atualização do projeto falhar, o objeto órfão é removido. |
| RN9 | Um vídeo carregado com sucesso passa a poder ser selecionado pelas ferramentas de vídeo, que aplicam os seus próprios requisitos adicionais, limites e regras de acesso. |
 
## 4.1.7. Assunções 
 
**Tabela 11: UC-VID-000 - Assunções**
 
| ID | Assunção |
|---|---|
| A1 | A interface de carregamento existente, que aceita imagens, vídeos MP4/WebM e ficheiros ZIP de imagens, será reutilizada; este caso de uso trata especificamente do ramo de vídeo. |
| A2 | Os limites e codecs definidos em RN2 e RN3 refletem a implementação atual do Project Service e são a base do MVP. |
| A3 | A inspeção técnica do vídeo é efetuada no servidor com uma ferramenta equivalente a ffprobe; o cliente não é fonte de autoridade para duração ou codecs. |
| A4 | Os vídeos gerados por recorte, concatenação ou incorporação de legendas já são adicionados ao projeto pelas respetivas operações e não passam novamente pelo fluxo de carregamento externo. |
| A5 | A interface pode permitir selecionar vários ficheiros de uma vez, mas a API processa cada ficheiro numa chamada individual; não existe garantia de atomicidade para o conjunto. |
 
## 4.1.8. Questões em Aberto 
 
**Tabela 12: UC-VID-000 - Questões em Aberto**
 
| ID | Questão | Resolução |
|---|---|---|
| Q1 | Devem ser aceites outros formatos ou codecs de vídeo além de MP4 (H.264/AAC) e WebM (VP8/Vorbis)? | Decisão do MVP já refletida em RN3: apenas MP4 e WebM com os codecs indicados. A eventual expansão de formatos fica por decidir. |
| Q2 | Deve o sistema permitir retomar envios interrompidos de ficheiros grandes, em particular até 2 GB no perfil Premium? | Adiado.O UC atual prevê repetir o carregamento após uma falha de rede (E11), mas não define a recuperação parcial do envio. |
| Q3 | Deve existir uma quota de armazenamento por projeto ou utilizador além dos limites por ficheiro definidos por perfil? | Adiado. RN2 define limites por ficheiro, mas não quotas de armazenamento acumulado. |
| Q4 | A interface deve permitir carregar vídeos diretamente por arrasto para a área de carregamento? | Por decidir. O carregamento direto por arrasto não está especificado no MVP. A repetição seletiva dos ficheiros falhados está definida em FA1 e REQ-VID-UPLOAD-010. |

### 3.2 Impacto no sistema existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Interface de carregamento do projeto | Manter | Reutiliza a área de seleção atual, que aceita vídeos MP4 e WebM e mostra pré-visualizações. | REQ-VID-UPLOAD-001, REQ-VID-UPLOAD-010 |
| API do Project Service | Manter | Reutiliza o endpoint de carregamento multipart, permissões do projeto, controlo de versão e associação do item ao projeto. | REQ-VID-UPLOAD-001, REQ-VID-UPLOAD-006, REQ-VID-UPLOAD-008, REQ-VID-UPLOAD-002 |
| Validação técnica e perfil de utilização | Manter | Reutiliza a consulta do perfil, limites por perfil, inspeção com ffprobe e validação de codecs. | REQ-VID-UPLOAD-002, REQ-VID-UPLOAD-004, REQ-VID-UPLOAD-003 |
| Image Storage / SeaweedFS | Manter | Reutiliza o armazenamento de objetos na área de origem (`src`) e a referência do objeto guardada no projeto. | REQ-VID-UPLOAD-007, REQ-VID-QUAL-001 |
| Ferramentas de vídeo | Estender | Passam a consumir vídeos externos após carregamento validado, mantendo os requisitos próprios de cada operação. | REQ-VID-UPLOAD-009 |

### 3.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição abreviada | Requisito(s) de Sistema |
|---|---|---|
| Trigger / Passos 1–2 | Seleção e envio do vídeo | REQ-VID-UPLOAD-001, REQ-VID-UPLOAD-002 |
| Passo 3 | Perfil, formato, tamanho, codecs e duração | REQ-VID-UPLOAD-002, REQ-VID-UPLOAD-004, REQ-VID-UPLOAD-003 |
| Passo 4 | Nome único e armazenamento do objeto | REQ-VID-UPLOAD-006, REQ-VID-UPLOAD-007, REQ-VID-QUAL-001, REQ-VID-UPLOAD-014 |
| Passos 5–6 | Associação ao projeto, miniatura, versão e limpeza | REQ-VID-UPLOAD-007, REQ-VID-UPLOAD-008, REQ-VID-QUAL-001, REQ-VID-UPLOAD-013 |
| Passo 7 | Disponibilização na biblioteca | REQ-VID-UPLOAD-009 |
| FA1 | Vários carregamentos independentes | REQ-VID-UPLOAD-010 |
| FA2 | Vídeo sem áudio | REQ-VID-UPLOAD-003 |
| FA3 / E9 | Conflito de versão | REQ-VID-UPLOAD-008, REQ-VID-QUAL-001 |
| FA4 / E8 | Permissões de projeto partilhado | REQ-VID-UPLOAD-002 |
| FA5 | Descarregar o vídeo no formato original | REQ-VID-UPLOAD-015 |
| E1 | Perfil sem acesso | REQ-VID-UPLOAD-002 |
| E2–E6 | Formato, tamanho, codec, vídeo inválido ou duração | REQ-VID-UPLOAD-004, REQ-VID-UPLOAD-003 |
| E7 | Nome duplicado | REQ-VID-UPLOAD-006 |
| E10–E11 | Falha de armazenamento ou rede | REQ-VID-QUAL-001 |
| RN1–RN2 | Perfis e limites do carregamento externo | REQ-VID-UPLOAD-002, REQ-VID-UPLOAD-004 |
| RN3–RN4 | Formatos e unicidade do nome | REQ-VID-UPLOAD-003, REQ-VID-UPLOAD-006 |
| RN5–RN6 | Metadados, consistência e permissões | REQ-VID-UPLOAD-007, REQ-VID-UPLOAD-008, REQ-VID-UPLOAD-002 |
| RN7–RN9 | Sem quota de processamento; vídeo disponível para ferramentas | REQ-VID-UPLOAD-009, REQ-VID-UPLOAD-012 |
| Garantia de Sucesso | Vídeo íntegro e utilizável no projeto | REQ-VID-UPLOAD-007, REQ-VID-UPLOAD-009 |
| Garantia Mínima | Sem ficheiros incompletos ou alterações indevidas | REQ-VID-UPLOAD-006, REQ-VID-UPLOAD-008, REQ-VID-QUAL-001 |
