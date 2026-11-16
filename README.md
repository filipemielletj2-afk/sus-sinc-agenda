# 🏥 SUS-Sinc | Sistema Integrado de Agenda & Pacientes do SUS

Sistema completo para clínicas, Unidades Básicas de Saúde (UBS) e consultórios que necessitam de **sincronização bidirecional com os sistemas do SUS** (e-SUS PEC e SISREG) e **salvamento automático contínuo em tempo real**.

---

## 🚀 Como Executar no Windows

### Método 1: Clique Duplo (Recomendado)
Basta dar dois cliques no arquivo:
```
iniciar_sistema.bat
```
O sistema iniciará o servidor local e abrirá seu navegador padrão em `http://localhost:3000`.

### Método 2: Via Terminal / Linha de Comando
```powershell
node server.js
```
Acesse: [http://localhost:3000](http://localhost:3000)

---

## 🌟 Funcionalidades Principais

### 1. 💾 Salvamento Automático em Tempo Real (Auto-Save)
* **Sem perda de dados**: Cada caractere digitado na ficha do paciente ou no formulário de agendamento é salvo automaticamente com persistência imediata no SQLite (`sus_agenda.db`).
* **Feedback Visual**: Indicadores em tempo real no cabeçalho ("*Salvando...*", "*Salvo automaticamente às 14:32*").
* **Validação em Tempo Real**:
  * **Cartão Nacional de Saúde (CNS)**: Validação de 15 dígitos e prefixos do Ministério da Saúde (1, 2, 7, 8, 9).
  * **CPF**: Validação completa dos dígitos verificadores (DV1 e DV2) e formatação automática com máscara.

### 2. 🔄 Sincronização Bidirecional com o SUS
* **Envio Automático (Local ➔ SUS)**: Pacientes cadastrados e consultas agendadas localmente são enviados e marcados com o código de identificação do SUS (`sync_id`).
* **Recebimento Automático (SUS ➔ Local)**: Agendamentos feitos pela central de regulação (SISREG) ou pelo e-SUS PEC são inseridos na agenda local automaticamente.
* **Resolução de Conflitos**: Política de carimbo de data/hora (a versão mais recente prevalece ou prioridade configurável).
* **Frequência Configurável**: Sincronização em segundo plano a cada 30 segundos, 1 minuto ou 5 minutos.
* **Simulador SUS Integrado**: Permite testar a sincronização bidirecional e simular novas consultas do SUS imediatamente sem necessidade de credenciais de homologação externas.

### 3. 📅 Agenda Completa de Atendimentos
* Visualização por data com atalhos para *Hoje*, *Amanhã* e seletor de calendário.
* Filtros por profissional de saúde, especialidade médica e status.
* Ações rápidas de recepção:
  * Iniciar Atendimento
  * Marcar como Atendido / Concluído
  * Registrar Falta / Não Compareceu
  * Reagendar / Cancelar

### 4. 👥 Gestão e Prontuário Rápido de Pacientes
* Cadastro com campos oficiais do e-SUS: Nome da Mãe, CNS, CPF, Endereço, Bairro, CEP, Alergias conhecidas e histórico médico.
* Busca instantânea por Nome, CPF ou Cartão SUS.
* Histórico unificado de todas as consultas de cada cidadão.

### 5. 📊 Backup & Exportação Padrão SUS
* Exportação completa dos dados locais em formato **JSON** e dados compatíveis com e-SUS CDS.

---

## 🛠️ Tecnologias Utilizadas
* **Backend**: Node.js (v24 com motor nativo `node:sqlite` WAL mode)
* **Banco de Dados**: SQLite local persistente (`sus_agenda.db`)
* **Frontend**: HTML5, Tailwind CSS, FontAwesome, JavaScript Vanilla Reativo
* **Zero Dependências Externas**: Não requer compilação C++, containers ou instalações pesadas.
