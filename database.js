const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, 'sus_agenda.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency and performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pacientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      cns TEXT,
      cpf TEXT,
      nome TEXT NOT NULL,
      nome_mae TEXT,
      data_nascimento TEXT,
      sexo TEXT,
      telefone TEXT,
      email TEXT,
      endereco TEXT,
      bairro TEXT,
      municipio TEXT DEFAULT 'São Paulo',
      uf TEXT DEFAULT 'SP',
      cep TEXT,
      alergias TEXT,
      observacoes TEXT,
      sync_id TEXT,
      sync_status TEXT DEFAULT 'pending_upload',
      last_synced_at TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profissionais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cargo TEXT NOT NULL,
      registro TEXT NOT NULL,
      especialidade TEXT NOT NULL,
      cor_agenda TEXT DEFAULT '#2563eb'
    );

    CREATE TABLE IF NOT EXISTS agendamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      paciente_id INTEGER,
      paciente_nome TEXT NOT NULL,
      paciente_cns TEXT,
      profissional_id INTEGER,
      profissional_nome TEXT NOT NULL,
      especialidade TEXT NOT NULL,
      sala TEXT DEFAULT 'Consultório 1',
      data TEXT NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fim TEXT NOT NULL,
      tipo_atendimento TEXT DEFAULT 'Consulta Eletiva',
      status TEXT DEFAULT 'Agendado',
      observacoes TEXT,
      origem TEXT DEFAULT 'local',
      sync_id TEXT,
      sync_status TEXT DEFAULT 'pending_upload',
      last_synced_at TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE SET NULL,
      FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sync_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sistema_origem_nome TEXT DEFAULT 'UBS Imbuia / Agenda Local',
      sistema_destino_tipo TEXT DEFAULT 'sus_pec',
      sistema_destino_url TEXT DEFAULT 'https://esus.imbuia.sc.gov.br/agenda',
      api_token TEXT DEFAULT 'SUS-TOKEN-SECURE-2026',
      usuario_esus TEXT,
      senha_esus TEXT,
      token_sessao_esus TEXT,
      auto_sync_enabled INTEGER DEFAULT 1,
      intervalo_segundos INTEGER DEFAULT 60,
      politica_conflito TEXT DEFAULT 'mais_recente',
      simulador_sus_ativo INTEGER DEFAULT 0,
      ultimo_sync TEXT,
      ultimo_status TEXT DEFAULT 'Conectado a https://esus.imbuia.sc.gov.br/agenda'
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      tipo TEXT NOT NULL,
      status TEXT NOT NULL,
      mensagem TEXT NOT NULL,
      detalhes TEXT
    );
  `);

  // Migrações dinâmicas para campos do e-SUS PEC
  try { db.exec('ALTER TABLE sync_config ADD COLUMN usuario_esus TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE sync_config ADD COLUMN senha_esus TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE sync_config ADD COLUMN token_sessao_esus TEXT;'); } catch (e) {}

  // Migrações do Capítulo 4 do Manual e-SUS PEC (PEC_04_agenda)
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN tipo_agendamento TEXT DEFAULT 'consulta';"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN fora_ubs INTEGER DEFAULT 0;"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN local_fora_ubs TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN profissional_convidado_id INTEGER;"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN profissional_convidado_nome TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN motivo_reserva TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN justificativa_cancelamento TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN sync_pec_status TEXT DEFAULT 'Sincronizado';"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN na_lista_atendimento INTEGER DEFAULT 0;"); } catch (e) {}
  try { db.exec("ALTER TABLE agendamentos ADD COLUMN data_hora_chegada_lista TEXT;"); } catch (e) {}

  try { db.exec("ALTER TABLE profissionais ADD COLUMN cbo TEXT DEFAULT '2251-42';"); } catch (e) {}
  try { db.exec("ALTER TABLE profissionais ADD COLUMN equipe_ine TEXT DEFAULT '0001234567';"); } catch (e) {}
  try { db.exec("ALTER TABLE profissionais ADD COLUMN fixado INTEGER DEFAULT 0;"); } catch (e) {}

  // Atualiza destino para o servidor oficial de Imbuia
  db.prepare(`
    UPDATE sync_config
    SET sistema_destino_url = 'https://esus.imbuia.sc.gov.br/agenda',
        sistema_origem_nome = 'UBS Imbuia / Agenda Local',
        simulador_sus_ativo = 0
    WHERE id = 1
  `).run();

  // Ensure default sync config exists
  const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
  if (!config) {
    db.prepare(`
      INSERT INTO sync_config (
        id, sistema_origem_nome, sistema_destino_tipo, sistema_destino_url,
        api_token, auto_sync_enabled, intervalo_segundos, politica_conflito,
        simulador_sus_ativo, ultimo_status
      ) VALUES (
        1, 'UBS Imbuia / Agenda Local', 'sus_pec', 'https://esus.imbuia.sc.gov.br/agenda',
        'SUS-TOKEN-SECURE-2026', 1, 60, 'mais_recente',
        0, 'Conectado a https://esus.imbuia.sc.gov.br/agenda'
      )
    `).run();
  }

  seedInitialDataIfEmpty();
}

function seedInitialDataIfEmpty() {
  const countPacientes = db.prepare('SELECT COUNT(*) as total FROM pacientes').get().total;
  if (countPacientes === 0) {
    const now = new Date().toISOString();

    // 1. Seed Profissionais
    const insertProf = db.prepare(`
      INSERT INTO profissionais (nome, cargo, registro, especialidade, cor_agenda)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertProf.run('Dr. Carlos Eduardo Ramos', 'Médico de Família', 'CRM-SP 148920', 'Clínica Médica / APS', '#0284c7');
    insertProf.run('Dra. Mariana Costa Silva', 'Médica Pediatra', 'CRM-SP 189211', 'Pediatria', '#16a34a');
    insertProf.run('Enf. Roberta Albuquerque', 'Enfermeira Chefe', 'COREN-SP 245100', 'Enfermagem & Pré-Natal', '#d97706');
    insertProf.run('Dr. Fernando Gusmão', 'Cirurgião Dentista', 'CRO-SP 84920', 'Odontologia Básica', '#9333ea');

    // 2. Seed Pacientes
    const insertPac = db.prepare(`
      INSERT INTO pacientes (
        uuid, cns, cpf, nome, nome_mae, data_nascimento, sexo, telefone, email,
        endereco, bairro, municipio, uf, cep, alergias, observacoes,
        sync_id, sync_status, last_synced_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const p1 = insertPac.run(
      crypto.randomUUID(), '700001234567890', '123.456.789-00', 'Ana Clara Ferreira',
      'Maria de Lurdes Ferreira', '1988-04-12', 'F', '(11) 98765-4321', 'anaclara@email.com',
      'Rua das Palmeiras, 142', 'Jardim Primavera', 'São Paulo', 'SP', '01310-100',
      'Dipirona e Penicilina', 'Hipertensa grau 1, acompanhamento contínuo no programa Hiperdia.',
      'SUS-PAC-1001', 'synced', now, now, now
    );

    const p2 = insertPac.run(
      crypto.randomUUID(), '700009876543210', '234.567.890-11', 'João Pedro Albuquerque',
      'Helena Albuquerque', '2019-08-22', 'M', '(11) 97654-3210', 'helena.alb@email.com',
      'Av. Brasil, 850, Apto 32', 'Vila Nova', 'São Paulo', 'SP', '04500-000',
      'Nenhuma alergia relatada', 'Criança em vacinação de rotina do PNI (calendário infantil).',
      'SUS-PAC-1002', 'synced', now, now, now
    );

    const p3 = insertPac.run(
      crypto.randomUUID(), '700005544332211', '345.678.901-22', 'Maria Francisca dos Santos',
      'Tereza Cristina dos Santos', '1955-11-03', 'F', '(11) 96543-2109', 'francisca.santos@email.com',
      'Rua Goiás, 45', 'Bela Vista', 'São Paulo', 'SP', '01305-000',
      'AAS, Anti-inflamatórios não-esteroides', 'Diabética tipo 2 e dislipidemia. Retirada de medicação regular.',
      'SUS-PAC-1003', 'synced', now, now, now
    );

    const p4 = insertPac.run(
      crypto.randomUUID(), '700007788990011', '456.789.012-33', 'Lucas Gabriel Oliveira',
      'Patricia Silva Oliveira', '1995-02-17', 'M', '(11) 95432-1098', 'lucas.oliveira@email.com',
      'Alameda Santos, 1200', 'Cerqueira César', 'São Paulo', 'SP', '01419-002',
      'Não possui', 'Exames admissionais e encaminhamento para fisioterapia SUS.',
      null, 'pending_upload', null, now, now
    );

    // 3. Seed Agendamentos for Today and Tomorrow
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const insertAg = db.prepare(`
      INSERT INTO agendamentos (
        uuid, paciente_id, paciente_nome, paciente_cns, profissional_id,
        profissional_nome, especialidade, sala, data, hora_inicio, hora_fim,
        tipo_atendimento, status, observacoes, origem, sync_id, sync_status,
        last_synced_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertAg.run(
      crypto.randomUUID(), 1, 'Ana Clara Ferreira', '700001234567890', 1,
      'Dr. Carlos Eduardo Ramos', 'Clínica Médica / APS', 'Consultório 1',
      todayStr, '08:30', '09:00', 'Retorno Hiperdia', 'Confirmado',
      'Reavaliação de pressão arterial e renovação de receita.', 'local', 'SUS-AG-901', 'synced', now, now, now
    );

    insertAg.run(
      crypto.randomUUID(), 2, 'João Pedro Albuquerque', '700009876543210', 2,
      'Dra. Mariana Costa Silva', 'Pediatria', 'Consultório 2 - Pediátrico',
      todayStr, '09:30', '10:00', 'Puericultura', 'Aguardando',
      'Acompanhamento de desenvolvimento pondero-estatural.', 'local', 'SUS-AG-902', 'synced', now, now, now
    );

    insertAg.run(
      crypto.randomUUID(), 3, 'Maria Francisca dos Santos', '700005544332211', 3,
      'Enf. Roberta Albuquerque', 'Enfermagem & Pré-Natal', 'Sala de Procedimentos',
      todayStr, '10:30', '11:00', 'Consulta de Enfermagem', 'Agendado',
      'Verificação de glicemia capilar e curativo.', 'local', 'SUS-AG-903', 'synced', now, now, now
    );

    insertAg.run(
      crypto.randomUUID(), 4, 'Lucas Gabriel Oliveira', '456.789.012-33', 1,
      'Dr. Carlos Eduardo Ramos', 'Clínica Médica / APS', 'Consultório 1',
      tomorrowStr, '14:00', '14:30', 'Consulta Eletiva', 'Agendado',
      'Avaliação lombar e solicitação de Raio-X.', 'local', null, 'pending_upload', null, now, now
    );
  }
}

// Validation helpers
function validarCNS(cns) {
  if (!cns) return false;
  const clean = String(cns).replace(/\D/g, '');
  if (clean.length !== 15) return false;
  // Basic SUS CNS prefix check (1, 2, 7, 8, 9)
  const firstDigit = clean[0];
  return ['1', '2', '7', '8', '9'].includes(firstDigit);
}

function validarCPF(cpf) {
  if (!cpf) return false;
  const clean = String(cpf).replace(/\D/g, '');
  if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(clean.charAt(i)) * (10 - i);
  let resto = 11 - (soma % 11);
  let dv1 = resto === 10 || resto === 11 ? 0 : resto;
  if (dv1 !== parseInt(clean.charAt(9))) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(clean.charAt(i)) * (11 - i);
  resto = 11 - (soma % 11);
  let dv2 = resto === 10 || resto === 11 ? 0 : resto;
  return dv2 === parseInt(clean.charAt(10));
}

module.exports = {
  db,
  initDatabase,
  validarCNS,
  validarCPF
};
