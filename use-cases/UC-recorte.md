# UC-VID-002 — Recortar Vídeo

## 0. Identificação

| Campo | Valor |
|---|---|
| Grupo / Equipa | Grupo 1 |
| Autores | Eduardo Freitas, Francisco Contente, Luís Pires, Rui Castro |
| Data | 2026-10-06 |
| Versão do documento | v1.0 |
| Unidade Curricular | Requisitos e Arquiteturas de Software — MEI, Universidade do Minho |

## 1.2 Funcionalidade 2 — Recorte temporal de vídeo

| Campo | Valor |
|---|---|
| Funcionalidade | Recorte temporal de vídeo. |
| Perfil(s) de utilizador abrangidos | Registado (gratuito) e Premium, com limites diferentes de duração e quota. O perfil anónimo não tem acesso, uma vez que o processamento de vídeo consome recursos significativos e o anónimo está limitado a operações sobre imagens. A prioridade de escalonamento da fila permanece como questão futura (Q3) e não faz parte do MVP. |
| Justificação no contexto do MVP | O recorte temporal é uma funcionalidade simples, frequente e de valor imediato, permitindo reduzir vídeos ao excerto de interesse para partilha. A sua implementação valida o ciclo assíncrono completo do PictuRAS — carregamento, persistência, gestão de filas e produção do resultado final — constituindo a operação elementar adequada ao MVP. Sem esta funcionalidade, ficaria por validar o comportamento do sistema face ao processamento demorado de vídeo, ao acompanhamento do progresso e ao controlo de quotas. |

## 2.2 Caso de Uso 02 — Recortar Vídeo

### 2.2.1 Cabeçalho

| Secção | Detalhes |
|---|---|
| ID do Caso de Uso | UC-VID-002 |
| Nome | Recortar Vídeo |
| Versão | v1.0 |
| Autor | Francisco Contente |
| Data | 2026-10-05 |
| Objetivo | Permitir ao utilizador delimitar um intervalo temporal (início e fim) de um vídeo da sua biblioteca, gerando um novo vídeo apenas com esse intervalo, sem alterar o original. |
| Âmbito | PictuRAS: módulo de processamento de vídeo (novo), gestão de quotas por perfil e biblioteca de vídeos. |
| Ator Principal | Utilizador autenticado: Registado (gratuito) ou Premium. |
| Stakeholders e Interesses | - Utilizador Registado: encurtar vídeos para partilha rápida, dentro da sua quota gratuita.<br>- Utilizador Premium: recortar vídeos mais longos, sem limite diário.<br>- Proprietário do Sistema: proteger os recursos de computação com limites por perfil e incentivar a subscrição Premium.<br>- Equipa DevOps/Arquitetura: processamento desacoplado da interface web, sem esgotar CPU ou memória do servidor web. |
| Pré-condições | - O utilizador tem sessão iniciada com perfil Registado ou Premium.<br>- O vídeo de origem encontra-se na biblioteca do utilizador, já carregado e validado quanto a formato e limites (RN2).<br>- O serviço de processamento de vídeo está disponível. |
| Trigger | O utilizador seleciona um vídeo da sua biblioteca e aciona a opção Recortar vídeo. |

### 2.2.2 Fluxo Principal

`T_in` designa o instante de início e `T_out` o instante de fim do recorte.

| Passo | Ação do Ator | Resposta do Sistema |
|---|---|---|
| 1 | Seleciona o vídeo pretendido na biblioteca e aciona Recortar vídeo. | Apresenta o leitor com linha temporal e os metadados do vídeo (duração, resolução, formato). Para o perfil Registado, apresenta também as operações diárias restantes. Pré-preenche `T_in = 0` e `T_out = duração total` como ponto de partida (este intervalo ainda não é válido para submissão, RN3). |
| 2 | Define `T_in` e `T_out` na linha temporal ou por introdução manual (formato `mm:ss.d`). | Atualiza os marcadores. |
| 3 | Aciona Aplicar recorte. | — |
| 4 | — | Valida o pedido pela seguinte ordem: (a) intervalo temporal (RN3); (b) duração do recorte face ao limite do perfil (RN1); (c) inexistência de outra tarefa de recorte ativa do utilizador (RN5); (d) quota diária, no perfil Registado (RN4). Se tudo for válido, reserva 1 operação da quota (perfil Registado). |
| 5 | — | Cria uma tarefa de processamento assíncrona no estado Em Fila e devolve o identificador da tarefa ao utilizador. |
| 6 | — | Enquanto a tarefa está Em Fila ou Em Processamento, apresenta o estado, a percentagem de progresso (quando em processamento) e a opção Cancelar Processamento. O utilizador pode aguardar ou continuar a usar a aplicação. |
| 7 | — | Quando a tarefa começa a ser executada, passa a Em Processamento e processa o vídeo, gerando um novo vídeo com o intervalo pedido, no mesmo formato, codecs, resolução e taxa de fotogramas do original. |
| 8 | — | Ao concluir, marca a tarefa como Concluída, consome a operação reservada (perfil Registado) e adiciona o novo vídeo à biblioteca, com pré-visualização. |

### 2.2.3 Fluxos Alternativos

| Fluxo | Descrição |
|---|---|
| FA1 – Cancelamento do processamento | Durante o passo 6 ou 7, o utilizador aciona Cancelar Processamento. O sistema interrompe a tarefa, elimina quaisquer resultados parciais, liberta a operação reservada (a quota não é consumida), marca a tarefa como Cancelada e devolve o utilizador ao passo 2, com o vídeo e o intervalo anteriores mantidos. |
| FA2 – Utilizador abandona a página durante o processamento | Se, no passo 6, o utilizador fecha o separador ou termina a sessão, a tarefa continua no servidor. Ao concluir, o resultado fica na biblioteca e o utilizador é notificado no próximo acesso à aplicação. |

### 2.2.4 Exceções

| Condição | Comportamento do Sistema |
|---|---|
| E1 – Intervalo temporal inválido (passo 4a): `T_in ≥ T_out`, valores fora da duração do vídeo, valores que não são múltiplos de 0,1 s, intervalo inferior a 1 s, ou intervalo igual à duração total do vídeo (o recorte não alteraria o vídeo). | Bloqueia a submissão, destaca o campo inválido e indica a regra violada. O utilizador mantém-se no passo 2. |
| E2 – Duração do recorte acima do limite do perfil (passo 4b). | Rejeita o pedido e indica o limite do perfil. O utilizador mantém-se no passo 2. |
| E3 – Quota diária esgotada (passo 4d, perfil Registado): as 5 operações do dia estão consumidas ou reservadas. | Não cria a tarefa e informa que as 5 operações diárias já foram utilizadas ou estão reservadas e quando é reposta a quota. |
| E4 – Já existe uma tarefa de recorte ativa do utilizador, Em Fila ou Em Processamento (passo 4c). | Não cria a tarefa e informa que deve aguardar o fim da tarefa em curso. |
| E5 – Falha na criação ou no processamento da tarefa (passos 5 e 7): a tarefa não pôde ser criada (passo 5); ou o vídeo de origem é ilegível, corrompido ou tem codec não suportado, ou ocorre um erro interno durante o processamento (passo 7). | Se a tarefa não chegou a ser criada, não a cria; caso contrário, termina-a como Falhada e assegura que nenhum resultado parcial fica disponível na biblioteca. Em ambos os casos liberta a operação reservada e informa o utilizador do motivo (na falha de criação, de que deve tentar mais tarde). |
| E6 – Tempo máximo de processamento excedido (passo 7): a execução ultrapassa o limite do perfil (RN8). O tempo em fila não conta. Uma execução exatamente igual ao limite ainda é válida. | Termina a tarefa como Falhada por tempo excedido, assegura que nenhum resultado parcial fica disponível na biblioteca, liberta a operação reservada e informa o utilizador do motivo, sugerindo um recorte mais curto. |

### 2.2.5 Pós-condições

| Tipo | Resultado |
|---|---|
| Garantia de Sucesso | Existe, na biblioteca do utilizador, um novo vídeo, com o nome do original acrescido do sufixo `_recorte`, com duração = `T_out − T_in` (±1 fotograma), no mesmo formato, codecs, resolução e taxa de fotogramas do original, disponível para pré-visualização. O vídeo original está intacto. Para o perfil Registado, a quota diária foi consumida em exatamente 1 operação. |
| Garantia Mínima | Em caso de rejeição, falha, cancelamento ou tempo excedido:<br>- o vídeo original permanece inalterado;<br>- nenhum ficheiro parcial ou corrompido fica disponível na biblioteca do utilizador;<br>- a quota diária não é consumida (qualquer operação reservada é libertada);<br>- o estado final da tarefa (Falhada ou Cancelada) ou o motivo da rejeição do pedido são visíveis ao utilizador. |

### 2.2.6 Regras de Negócio e Restrições

| ID | Regra |
|---|---|
| RN1 | Limites por perfil (duração do recorte). Registado: ≤ 60 s e máx. 5 operações por dia. Premium: ≤ 600 s e sem limite diário. Anónimo: sem acesso. |
| RN2 | Limites do vídeo de origem (verificados no carregamento). Registado: ≤ 200 MB e ≤ 10 min. Premium: ≤ 2 GB e ≤ 60 min. |
| RN3 | Intervalo temporal. `0 ≤ T_in < T_out ≤ duração do vídeo`; intervalo mínimo de 1 s; o intervalo não pode ser igual à duração total do vídeo (`T_out − T_in < duração do vídeo`); instantes múltiplos de 0,1 s (valores com outra resolução são rejeitados). |
| RN4 | Quota (perfil Registado). Cada recorte conta como 1 operação. A operação é reservada ao aceitar o pedido (passo 4), consumida apenas quando a tarefa termina com sucesso e libertada em qualquer outro desfecho (cancelamento, falha na criação ou no processamento, tempo excedido). A verificação da quota considera as operações consumidas e as reservadas, incluindo as de outras ferramentas do PictuRAS, e é feita antes de criar a tarefa. A verificação e a reserva são atómicas: duas ou mais operações concorrentes não podem ultrapassar as 5 operações diárias. As operações restantes são sempre visíveis ao utilizador. |
| RN5 | Uma tarefa ativa por utilizador. Cada utilizador pode ter, no máximo, 1 tarefa de recorte Em Fila ou Em Processamento. |
| RN6 | Formatos. Entrada aceite: MP4 (H.264/AAC) e WebM (VP8/Vorbis). O resultado mantém o formato, os codecs, a resolução e a taxa de fotogramas do original. A pista de áudio, se existir, é recortada em sincronia com o vídeo. |
| RN7 | Não destrutividade. O vídeo original nunca é alterado nem substituído; cada recorte gera um novo vídeo na biblioteca, com o nome do original acrescido do sufixo `_recorte` (ex.: `ferias.mp4` passa a `ferias_recorte.mp4`; se o nome já existir, acrescenta-se um número sequencial, `ferias_recorte_2.mp4`). |
| RN8 | Tempo máximo de processamento. Registado: 120 s. Premium: 900 s. Contados desde a transição da tarefa para Em Processamento até ao fim do processo (conclusão, falha ou cancelamento). O tempo em fila não conta. |
| RN9 | Privacidade. Apenas o utilizador proprietário tem acesso ao vídeo original e aos resultados gerados, protegidos por encriptação em trânsito e em repouso segundo as regras de RGPD da plataforma.  |

### 2.2.7 Assunções

| ID | Assunção |
|---|---|
| A1 | O perfil anónimo não tem acesso a funcionalidades de vídeo. |
| A2 | O vídeo original já está carregado na biblioteca e disponível no armazenamento de objetos após validação pela RN2, e não é eliminado durante a edição ou o processamento do recorte. |
| A3 | O utilizador usa um navegador moderno com reprodução de vídeo HTML5. |
| A4 | O PictuRAS já dispõe de uma arquitetura assíncrona por workers, que este caso de uso reutiliza e estende. Os workers atuais não executam subprocessos de vídeo (por exemplo, FFmpeg) nem gerem a monitorização, o cancelamento ou a limpeza de processos em execução; esse mecanismo é trabalho novo. |
| A5 | O recorte usa sempre recodificação, garantindo precisão ao fotograma (±1 fotograma). |
| A6 | O PictuRAS já tem autenticação, perfis e contagem de operações diárias, com reposição à meia-noite (hora de Lisboa) (RNF48 e T-07 do DR anterior), que este caso de uso reutiliza. A quota diária é partilhada por todas as ferramentas do PictuRAS. |
| A7 | Assume-se que a biblioteca passa a permitir exportar os vídeos nela existentes, funcionalidade fornecida pelo caso de uso de carregamento e gestão de vídeo e fora do âmbito deste; o recorte não acrescenta funcionalidade de exportação. |
| A8 | O utilizador possui espaço de armazenamento suficiente para guardar o novo vídeo; a gestão de quotas de disco não é tratada neste caso de uso. |
| A9 | Os limites numéricos (RN1, RN2, RN8), a confirmação do pedido em ≤ 2 s, o atraso máximo de 5 s na apresentação do progresso e o prazo de 5 s para terminar o processamento de uma tarefa cancelada ou excedida são valores de partida adequados ao MVP, sujeitos a validação (ver Q7). |

### 2.2.8 Questões em Aberto

| ID | Questão em aberto |
|---|---|
| Q1 | O recorte deve poder ser encadeado com outras ferramentas e aplicado em lote (`.zip`/diretoria)? |
| Q2 | Devem ser suportados mais formatos de vídeo? |
| Q3 | Em fases futuras, o perfil Premium deve ter prioridade de escalonamento na fila face ao perfil Registado? (No MVP, a RN5 fixa 1 tarefa ativa por utilizador.) |
| Q4 | O utilizador anónimo deve ter um acesso de demonstração (p. ex., 10 s e marca de água)? |
| Q5 | Os vídeos resultantes ficam guardados até o utilizador os apagar ou expiram após um prazo? |
| Q6 | A conclusão do processamento deve gerar uma notificação (na aplicação ou por e-mail), em vez de apenas atualizar o estado da tarefa? |
| Q7 | O tempo máximo do perfil Premium (900 s) é suficiente para recodificar um recorte de 600 s? A confirmar com um teste de recodificação. |

## 4. Esboço de requisitos derivados

### 4.1 Requisitos de Sistema

| ID | Requisito | Tipo | Prioridade | Novo/Alt | Origem | Como verificar |
|---|---|---|---|---|---|---|
| REQ-TRIM-001 | O sistema deve apresentar, ao acionar Recortar vídeo, um leitor com linha temporal, os metadados do vídeo (duração, resolução e formato) e, ao utilizador Registado, as operações diárias restantes. | F | Deve ter | ALT | Passo 1, RN4 | Dado um Registado com 2 operações consumidas hoje, quando abre o editor, então vê o leitor, os metadados corretos e 3 operações restantes. |
| REQ-TRIM-002 | O sistema deve permitir ao utilizador definir `T_in` e `T_out` na linha temporal e por introdução manual no formato `mm:ss.d`. | F | Deve ter | NOVO | Passo 2, RN3 | Dado o editor aberto, quando o utilizador define os instantes por qualquer dos dois modos, então os marcadores assumem os valores definidos. |
| REQ-TRIM-003 | O sistema deve rejeitar o pedido com intervalo inválido, destacando o campo em erro e indicando a regra violada. | F | Deve ter | NOVO | Passo 4a, RN3, E1 | Dado um vídeo de 30 s, quando o utilizador submete `T_out = 31,0 s`, `T_in ≥ T_out`, `00:10.25`, um intervalo de 0,5 s ou o vídeo completo (`T_in = 0` e `T_out = 30,0 s`), então o pedido é bloqueado, o campo é destacado e a regra é indicada. |
| REQ-TRIM-004 | O sistema deve rejeitar o pedido cuja duração do recorte exceda o limite do perfil (60 s Registado, 600 s Premium), indicando esse limite. | F | Deve ter | NOVO | Passo 4b, RN1, E2 | Dado um Registado, quando submete um recorte de 75 s, então o pedido é rejeitado e a mensagem indica 60 s; dado um Premium com 650 s, a mensagem indica 600 s. |
| REQ-TRIM-005 | O sistema deve restringir a funcionalidade de recorte a utilizadores autenticados com perfil Registado ou Premium. | F | Deve ter | ALT | RN1, A1 | Dado um visitante sem sessão iniciada, então a opção Recortar vídeo não aparece e o acesso direto ao editor ou ao pedido de recorte é recusado. |
| REQ-TRIM-006 | O sistema deve rejeitar o pedido do utilizador que já tenha uma tarefa de recorte Em Fila ou Em Processamento. | F | Deve ter | NOVO | Passo 4c, RN5, E4 | Dado um utilizador com uma tarefa em curso, quando submete novo pedido, então este é rejeitado e a tarefa em curso não é afetada. |
| REQ-TRIM-007 | O sistema deve rejeitar o pedido do utilizador Registado cujas operações diárias, consumidas ou reservadas, já somem 5, informando quando a quota é reposta; o utilizador Premium não está sujeito a este limite. | F | Deve ter | ALT | Passo 4d, RN1, RN4, E3 | Dado um Registado com 4 operações consumidas e 1 reservada (por qualquer ferramenta), então o pedido é rejeitado com a hora de reposição; dado um Premium com 10 recortes concluídos no dia, então o pedido é aceite. |
| REQ-TRIM-008 | O sistema deve reservar 1 operação da quota diária do utilizador Registado quando o pedido é aceite, de forma atómica com a verificação da quota. | F | Deve ter | ALT | Passo 4, RN4 | Dado um Registado com 3 operações disponíveis, quando submete um pedido válido, então o saldo passa imediatamente a 2; dado um Registado com 1 operação disponível, quando duas ferramentas pedem uma operação em simultâneo, então só um dos pedidos é aceite e o outro é rejeitado, sem saldo negativo. |
| REQ-TRIM-009 | O sistema deve devolver o identificador da tarefa assíncrona, no estado Em Fila, em ≤ 2 s após aceitar um pedido, independentemente da duração do vídeo. | NF (Desempenho) | Deveria ter | ALT | Passo 5, A9 | Dados vídeos de 10 s e de 60 min, quando um pedido válido é aceite, então o identificador é devolvido em ≤ 2 s em ambos os casos. |
| REQ-TRIM-010 | O sistema deve apresentar o estado mais recente da tarefa (Em Fila, Em Processamento, Concluída, Falhada, Cancelada) e a percentagem de progresso, com um atraso máximo de 5 s face ao progresso real, incluindo quando o utilizador regressa à aplicação ou inicia nova sessão. | F | Deve ter | ALT | Passo 6, FA2, A9 | Dada uma tarefa com mais de 30 s, quando o progresso real muda, então o valor apresentado muda em ≤ 5 s; dado um utilizador que terminou a sessão e iniciou nova, então vê o estado atual da tarefa (e, se concluída, o vídeo na biblioteca). |
| REQ-TRIM-011 | O sistema deve permitir ao utilizador cancelar uma tarefa Em Fila ou Em Processamento, marcando-a como Cancelada, terminando o processamento associado em ≤ 5 s e devolvendo o utilizador ao passo 2 com o vídeo e o intervalo mantidos. | F | Deve ter | ALT | Passos 6 e 7, FA1, A4, A9 | Dada uma tarefa Em Fila e outra Em Processamento, quando o utilizador aciona Cancelar Processamento, então cada tarefa fica Cancelada, em ≤ 5 s não existe nenhum processo de vídeo ativo para ela e o editor mostra os mesmos `T_in` e `T_out`. |
| REQ-TRIM-012 | O sistema deve garantir que nenhum ficheiro parcial ou corrompido de uma tarefa Cancelada ou Falhada fica disponível na biblioteca do utilizador. | NF (Integridade) | Deve ter | NOVO | FA1, E5, E6, Garantia Mínima | Dada uma tarefa Cancelada e outra Falhada, então nenhum item dessas tarefas aparece na biblioteca nem pode ser reproduzido ou descarregado. |
| REQ-TRIM-013 | O sistema deve gerar o vídeo resultante com duração igual a `T_out − T_in`, com tolerância de ±1 fotograma. | NF (Precisão) | Deve ter | NOVO | Passo 7, A5, Garantia de Sucesso | Dado um recorte de 7,5 s, então a duração do ficheiro difere de 7,5 s em no máximo 1 fotograma. |
| REQ-TRIM-014 | O sistema deve preservar no vídeo resultante o formato (MP4 ou WebM), os codecs, a resolução e a taxa de fotogramas do vídeo original, e recortar a pista de áudio, quando existir, com desfasamento ≤ 1 fotograma face ao vídeo. | NF (Compatibilidade) | Deve ter | NOVO | Passo 7, RN6, Garantia de Sucesso | Dado um MP4 1280×720 a 30 fps com áudio, então o resultado é MP4 1280×720 a 30 fps, com os mesmos codecs e desfasamento áudio/vídeo ≤ 1 fotograma; repetir com um WebM. |
| REQ-TRIM-015 | O sistema deve adicionar o vídeo resultante à biblioteca do utilizador como novo item, com o nome do original acrescido do sufixo `_recorte` (e de um número sequencial se o nome já existir), disponível para pré-visualização. | F | Deve ter | ALT | Passo 8, RN7 | Concluída a tarefa sobre `ferias.mp4`, então a biblioteca tem `ferias_recorte.mp4`, que pode ser reproduzido; um segundo recorte gera `ferias_recorte_2.mp4`. |
| REQ-TRIM-016 | O sistema deve manter o vídeo original inalterado após o recorte. | NF (Integridade) | Deve ter | NOVO | RN7, Garantia de Sucesso | Dado um original, antes e depois de um recorte concluído, falhado e cancelado, então o hash do ficheiro é idêntico. |
| REQ-TRIM-017 | O sistema deve consumir a operação reservada do utilizador Registado apenas quando a tarefa termina com sucesso e libertá-la quando o pedido não resulta numa tarefa Concluída. | F | Deve ter | ALT | Passo 8, FA1, RN4, E5, E6, Garantia de Sucesso e Mínima | Dada uma tarefa Concluída, então o saldo diminui exatamente 1 face ao saldo antes do pedido; dada uma tarefa Cancelada, uma Falhada, uma por tempo excedido e um pedido cuja tarefa não chegou a ser criada, então o saldo volta ao valor anterior ao pedido. |
| REQ-TRIM-018 | O sistema deve terminar como Falhada a tarefa cujo vídeo de origem seja ilegível, corrompido ou com codec não suportado, ou que sofra erro interno, e informar o utilizador do motivo; se a tarefa não puder ser criada, o sistema não a cria e informa que deve tentar mais tarde. | F | Deve ter | NOVO | Passos 5 e 7, E5 | Dado um ficheiro corrompido, quando é processado, então a tarefa fica Falhada e o motivo é apresentado; dada uma falha simulada na criação da tarefa, então não existe tarefa e a mensagem pede para tentar mais tarde. |
| REQ-TRIM-019 | O sistema deve terminar como Falhada por tempo excedido a tarefa cujo processamento ultrapasse o tempo máximo do perfil (120 s Registado, 900 s Premium), contado desde a transição para Em Processamento e sem incluir o tempo em fila, terminando o processamento associado em ≤ 5 s e sugerindo um recorte mais curto. | NF (Fiabilidade) | Deve ter | NOVO | Passo 7, RN8, E6, A4, A9 | Dado um Registado, uma execução simulada de 125 s termina Falhada por tempo excedido com a sugestão e uma de 115 s conclui; uma tarefa que espera 200 s em fila e executa 100 s conclui; dado um Premium, 905 s termina Falhada e 895 s conclui; nos casos Falhada, em ≤ 5 s não existe nenhum processo de vídeo ativo para a tarefa. |
| REQ-TRIM-020 | O sistema deve permitir o acesso aos vídeos originais e recortados apenas ao utilizador proprietário e protegê-los com encriptação em trânsito e em repouso. | NF (Segurança) | Deve ter | ALT | RN9 | Dado o URL de um vídeo, quando outro utilizador autenticado tenta aceder, então é recusado; dada uma transferência, então usa canal cifrado e o ficheiro armazenado não é legível sem as chaves da plataforma. |

### 4.2 Impacto no sistema existente

| Elemento existente afetado | Impacto (Manter / Estender / Alterar) | Descrição do impacto | Requisitos relacionados |
|---|---|---|---|
| Controlo de quotas diárias (5 operações/dia) | Alterar | A contagem passa a ter reserva prévia no pedido, atómica com a verificação, consumo no sucesso e libertação nos restantes desfechos, partilhada com as outras ferramentas. | REQ-TRIM-001, REQ-TRIM-007, REQ-TRIM-008, REQ-TRIM-017 |
| Perfis de utilização (anónimo, registado, premium) | Estender | Passam a ter limites de duração de vídeo e de tempo de processamento; o anónimo fica sem acesso e o premium sem limite diário. | REQ-TRIM-004, REQ-TRIM-005, REQ-TRIM-007, REQ-TRIM-019 |
| Arquitetura assíncrona por workers (tarefas, estado, progresso e cancelamento) | Estender | A noção de tarefa, estado, progresso e cancelamento passa a aplicar-se a vídeo, com no máximo uma tarefa ativa por utilizador. Os workers têm de passar a lançar, acompanhar, interromper e limpar o processamento de vídeo (p. ex., FFmpeg), a gerar o vídeo recortado com a duração e as características exigidas e a aplicar um tempo máximo por perfil, o que não existe hoje. | REQ-TRIM-006, REQ-TRIM-009, REQ-TRIM-010, REQ-TRIM-011, REQ-TRIM-013, REQ-TRIM-014, REQ-TRIM-018, REQ-TRIM-019 |
| Biblioteca do utilizador e armazenamento de objetos (SeaweedFS) | Estender | Passa a conter vídeos derivados, com o original intacto. O armazenamento atual não tem limpeza atómica, pelo que impedir que parciais fiquem disponíveis é trabalho novo. | REQ-TRIM-012, REQ-TRIM-015, REQ-TRIM-016 |
| Interface de edição | Estender | Novo editor de recorte com leitor, linha temporal e validação de campos. | REQ-TRIM-001, REQ-TRIM-002, REQ-TRIM-003 |
| Segurança e privacidade | Estender | Propriedade e encriptação aplicadas aos novos vídeos. | REQ-TRIM-020 |


### 4.3 Matriz de Rastreabilidade

| Elemento do Caso de Uso | Descrição abreviada | Requisito(s) de Sistema |
|---|---|---|
| Passo 1 | Editor, metadados e saldo | REQ-TRIM-001 |
| Passo 2 | Definição de `T_in` e `T_out` | REQ-TRIM-002 |
| Passo 3 | Acionar Aplicar recorte | (Ação exclusiva do ator; conduz ao passo 4) |
| Passo 4 | Validação do pedido e reserva da quota | REQ-TRIM-003, REQ-TRIM-004, REQ-TRIM-006, REQ-TRIM-007, REQ-TRIM-008 |
| Passo 5 | Criação da tarefa assíncrona | REQ-TRIM-009, REQ-TRIM-018 |
| Passo 6 | Estado, progresso e cancelamento | REQ-TRIM-010, REQ-TRIM-011 |
| Passo 7 | Geração do vídeo | REQ-TRIM-013, REQ-TRIM-014 |
| Passo 8 | Conclusão, biblioteca e quota | REQ-TRIM-015, REQ-TRIM-017 |
| FA1 | Cancelamento (Em Fila ou Em Processamento) | REQ-TRIM-011, REQ-TRIM-012, REQ-TRIM-017 |
| FA2 | Abandono da página | REQ-TRIM-010 |
| E1 | Intervalo inválido | REQ-TRIM-003 |
| E2 | Duração acima do limite do perfil | REQ-TRIM-004 |
| E3 | Quota esgotada | REQ-TRIM-007 |
| E4 | Tarefa ativa existente | REQ-TRIM-006 |
| E5 | Falha na criação ou no processamento | REQ-TRIM-012, REQ-TRIM-017, REQ-TRIM-018 |
| E6 | Tempo excedido | REQ-TRIM-012, REQ-TRIM-017, REQ-TRIM-019 |
| RN1 | Limites por perfil | REQ-TRIM-004, REQ-TRIM-005, REQ-TRIM-007 |
| RN2 | Limites do vídeo de origem | (Sem requisito neste caso de uso: validado no carregamento, coberto por A2) |
| RN3 | Intervalo temporal | REQ-TRIM-002, REQ-TRIM-003 |
| RN4 | Quota (reserva atómica, consumo e libertação) | REQ-TRIM-001, REQ-TRIM-007, REQ-TRIM-008, REQ-TRIM-017 |
| RN5 | Uma tarefa ativa por utilizador | REQ-TRIM-006 |
| RN6 | Formatos e características | REQ-TRIM-014, REQ-TRIM-018 |
| RN7 | Não destrutividade | REQ-TRIM-015, REQ-TRIM-016 |
| RN8 | Tempo máximo por perfil | REQ-TRIM-019 |
| RN9 | Acesso restrito e encriptação | REQ-TRIM-020 |
| Garantia de Sucesso | Novo vídeo íntegro e quota consumida | REQ-TRIM-013, REQ-TRIM-014, REQ-TRIM-015, REQ-TRIM-016, REQ-TRIM-017 |
| Garantia Mínima | Original intacto, sem parciais, quota libertada, motivo visível | REQ-TRIM-003, REQ-TRIM-004, REQ-TRIM-006, REQ-TRIM-007, REQ-TRIM-010, REQ-TRIM-012, REQ-TRIM-016, REQ-TRIM-017, REQ-TRIM-018, REQ-TRIM-019 |

