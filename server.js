const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');

const { db, initDatabase, validarCNS, validarCPF } = require('./database');
const { executeSync, startAutoSync, stopAutoSync, testarConexaoEsus } = require('./sync_engine');
const susMock = require('./sus_mock');

// Initialize database schema and seed data
initDatabase();

// Start background auto-sync worker
startAutoSync();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Helper to parse JSON body
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB limit
        reject(new Error('Corpo da requisição excede o limite máximo permitido.'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Formato JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost:3000');
  const pathname = parsedUrl.pathname;
  const searchParams = parsedUrl.searchParams;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // -------------------------------------------------------------
  // API ROUTES
  // -------------------------------------------------------------

  // Status & Health
  if (pathname === '/api/status' && method === 'GET') {
    const today = new Date().toISOString().split('T')[0];
    const totalPacientes = db.prepare('SELECT COUNT(*) as c FROM pacientes').get().c;
    const agendamentosHoje = db.prepare('SELECT COUNT(*) as c FROM agendamentos WHERE data = ?').get(today).c;
    const agendamentosPendentes = db.prepare("SELECT COUNT(*) as c FROM agendamentos WHERE data = ? AND status IN ('Agendado', 'Confirmado', 'Aguardando')").get(today).c;
    const agendamentosAtendidos = db.prepare("SELECT COUNT(*) as c FROM agendamentos WHERE data = ? AND status = 'Atendido'").get(today).c;
    const syncConfig = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    const pendentesSync = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM pacientes WHERE sync_status = 'pending_upload') +
        (SELECT COUNT(*) FROM agendamentos WHERE sync_status = 'pending_upload') as total
    `).get().total;

    return sendJson(res, 200, {
      status: 'online',
      data_atual: today,
      stats: {
        total_pacientes: totalPacientes,
        agendamentos_hoje: agendamentosHoje,
        agendamentos_pendentes: agendamentosPendentes,
        agendamentos_atendidos: agendamentosAtendidos,
        pendentes_sync: pendentesSync
      },
      sync_config: syncConfig
    });
  }

  // 1. PACIENTES
  if (pathname === '/api/pacientes') {
    if (method === 'GET') {
      const q = (searchParams.get('q') || '').trim();
      let pacientes;
      if (q) {
        const like = `%${q}%`;
        pacientes = db.prepare(`
          SELECT * FROM pacientes
          WHERE nome LIKE ? OR cpf LIKE ? OR cns LIKE ? OR telefone LIKE ?
          ORDER BY nome ASC
        `).all(like, like, like, like);
      } else {
        pacientes = db.prepare('SELECT * FROM pacientes ORDER BY nome ASC').all();
      }
      return sendJson(res, 200, pacientes);
    }

    if (method === 'POST') {
      try {
        const data = await parseRequestBody(req);
        if (!data.nome || data.nome.trim().length < 2) {
          return sendJson(res, 400, { error: 'O nome completo do paciente é obrigatório.' });
        }

        const now = new Date().toISOString();
        const uuid = data.uuid || crypto.randomUUID();

        const insert = db.prepare(`
          INSERT INTO pacientes (
            uuid, cns, cpf, nome, nome_mae, data_nascimento, sexo, telefone, email,
            endereco, bairro, municipio, uf, cep, alergias, observacoes,
            sync_id, sync_status, last_synced_at, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_upload', null, ?, ?)
        `);

        const result = insert.run(
          uuid,
          data.cns ? data.cns.trim() : null,
          data.cpf ? data.cpf.trim() : null,
          data.nome.trim(),
          data.nome_mae ? data.nome_mae.trim() : null,
          data.data_nascimento || null,
          data.sexo || 'Outro',
          data.telefone ? data.telefone.trim() : null,
          data.email ? data.email.trim() : null,
          data.endereco ? data.endereco.trim() : null,
          data.bairro ? data.bairro.trim() : null,
          data.municipio ? data.municipio.trim() : 'São Paulo',
          data.uf ? data.uf.trim() : 'SP',
          data.cep ? data.cep.trim() : null,
          data.alergias ? data.alergias.trim() : null,
          data.observacoes ? data.observacoes.trim() : null,
          data.sync_id || null,
          now,
          now
        );

        const newPac = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(result.lastInsertRowid);
        return sendJson(res, 201, { success: true, paciente: newPac, message: 'Paciente salvo automaticamente!' });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  // Single Paciente PUT / DELETE
  if (pathname.startsWith('/api/pacientes/')) {
    const id = parseInt(pathname.split('/')[3], 10);
    if (isNaN(id)) return sendJson(res, 400, { error: 'ID do paciente inválido.' });

    if (method === 'GET') {
      const pac = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
      if (!pac) return sendJson(res, 404, { error: 'Paciente não encontrado.' });
      const historico = db.prepare('SELECT * FROM agendamentos WHERE paciente_id = ? ORDER BY data DESC, hora_inicio DESC').all(id);
      return sendJson(res, 200, { ...pac, historico_agendamentos: historico });
    }

    if (method === 'PUT') {
      try {
        const data = await parseRequestBody(req);
        const existing = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
        if (!existing) return sendJson(res, 404, { error: 'Paciente não encontrado.' });

        const now = new Date().toISOString();
        db.prepare(`
          UPDATE pacientes SET
            cns = ?, cpf = ?, nome = ?, nome_mae = ?, data_nascimento = ?,
            sexo = ?, telefone = ?, email = ?, endereco = ?, bairro = ?,
            municipio = ?, uf = ?, cep = ?, alergias = ?, observacoes = ?,
            sync_status = 'pending_upload', updated_at = ?
          WHERE id = ?
        `).run(
          data.cns !== undefined ? data.cns : existing.cns,
          data.cpf !== undefined ? data.cpf : existing.cpf,
          data.nome !== undefined ? data.nome : existing.nome,
          data.nome_mae !== undefined ? data.nome_mae : existing.nome_mae,
          data.data_nascimento !== undefined ? data.data_nascimento : existing.data_nascimento,
          data.sexo !== undefined ? data.sexo : existing.sexo,
          data.telefone !== undefined ? data.telefone : existing.telefone,
          data.email !== undefined ? data.email : existing.email,
          data.endereco !== undefined ? data.endereco : existing.endereco,
          data.bairro !== undefined ? data.bairro : existing.bairro,
          data.municipio !== undefined ? data.municipio : existing.municipio,
          data.uf !== undefined ? data.uf : existing.uf,
          data.cep !== undefined ? data.cep : existing.cep,
          data.alergias !== undefined ? data.alergias : existing.alergias,
          data.observacoes !== undefined ? data.observacoes : existing.observacoes,
          now,
          id
        );

        const updated = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
        return sendJson(res, 200, { success: true, paciente: updated, message: 'Alterações salvas automaticamente!' });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM pacientes WHERE id = ?').run(id);
      return sendJson(res, 200, { success: true, message: 'Paciente excluído com sucesso.' });
    }
  }

  // 2. PROFISSIONAIS
  if (pathname === '/api/profissionais') {
    if (method === 'GET') {
      const profs = db.prepare('SELECT * FROM profissionais ORDER BY nome ASC').all();
      return sendJson(res, 200, profs);
    }
    if (method === 'POST') {
      try {
        const data = await parseRequestBody(req);
        if (!data.nome || !data.registro) return sendJson(res, 400, { error: 'Nome e registro profissional são obrigatórios.' });
        const resInsert = db.prepare(`
          INSERT INTO profissionais (nome, cargo, registro, especialidade, cor_agenda)
          VALUES (?, ?, ?, ?, ?)
        `).run(data.nome, data.cargo || 'Profissional da Saúde', data.registro, data.especialidade || 'Geral', data.cor_agenda || '#2563eb');
        const prof = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(resInsert.lastInsertRowid);
        return sendJson(res, 201, prof);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  // 3. AGENDAMENTOS
  if (pathname === '/api/agendamentos') {
    if (method === 'GET') {
      const dataFiltro = searchParams.get('data');
      const profissionalId = searchParams.get('profissional_id');
      const statusFiltro = searchParams.get('status');

      let query = 'SELECT * FROM agendamentos WHERE 1=1';
      const params = [];

      if (dataFiltro) {
        query += ' AND data = ?';
        params.push(dataFiltro);
      }
      if (profissionalId) {
        query += ' AND profissional_id = ?';
        params.push(profissionalId);
      }
      if (statusFiltro) {
        query += ' AND status = ?';
        params.push(statusFiltro);
      }

      query += ' ORDER BY data ASC, hora_inicio ASC';
      const agendamentos = db.prepare(query).all(...params);
      return sendJson(res, 200, agendamentos);
    }

    if (method === 'POST') {
      try {
        const data = await parseRequestBody(req);
        if (!data.paciente_nome || !data.data || !data.hora_inicio || !data.hora_fim) {
          return sendJson(res, 400, { error: 'Preencha todos os campos obrigatórios da consulta (Paciente, Data e Horário).' });
        }

        // Conflito de horário para o mesmo profissional
        if (data.profissional_nome) {
          const conflito = db.prepare(`
            SELECT id, paciente_nome, hora_inicio, hora_fim FROM agendamentos
            WHERE data = ? AND profissional_nome = ? AND status != 'Cancelado'
            AND ((hora_inicio < ? AND hora_fim > ?) OR (hora_inicio >= ? AND hora_inicio < ?))
          `).get(data.data, data.profissional_nome, data.hora_fim, data.hora_inicio, data.hora_inicio, data.hora_fim);

          if (conflito) {
            return sendJson(res, 409, {
              error: `Conflito de agenda: ${data.profissional_nome} já possui atendimento com ${conflito.paciente_nome} das ${conflito.hora_inicio} às ${conflito.hora_fim}.`
            });
          }
        }

        const now = new Date().toISOString();
        const uuid = data.uuid || crypto.randomUUID();

        const insert = db.prepare(`
          INSERT INTO agendamentos (
            uuid, paciente_id, paciente_nome, paciente_cns, profissional_id,
            profissional_nome, especialidade, sala, data, hora_inicio, hora_fim,
            tipo_atendimento, status, observacoes, origem, sync_id, sync_status,
            last_synced_at, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_upload', null, ?, ?)
        `);

        const result = insert.run(
          uuid,
          data.paciente_id || null,
          data.paciente_nome.trim(),
          data.paciente_cns ? data.paciente_cns.trim() : null,
          data.profissional_id || null,
          data.profissional_nome ? data.profissional_nome.trim() : 'Clínico Geral',
          data.especialidade || 'Consulta Médica',
          data.sala || 'Consultório 1',
          data.data,
          data.hora_inicio,
          data.hora_fim,
          data.tipo_atendimento || 'Consulta Eletiva',
          data.status || 'Agendado',
          data.observacoes || null,
          data.origem || 'local',
          data.sync_id || null,
          now,
          now
        );

        const newAg = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(result.lastInsertRowid);
        return sendJson(res, 201, { success: true, agendamento: newAg, message: 'Agendamento salvo e programado para sincronização com o SUS!' });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  // Single Agendamento PUT / DELETE
  if (pathname.startsWith('/api/agendamentos/')) {
    const id = parseInt(pathname.split('/')[3], 10);
    if (isNaN(id)) return sendJson(res, 400, { error: 'ID do agendamento inválido.' });

    if (method === 'GET') {
      const ag = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
      if (!ag) return sendJson(res, 404, { error: 'Agendamento não encontrado.' });
      return sendJson(res, 200, ag);
    }

    if (method === 'PUT') {
      try {
        const data = await parseRequestBody(req);
        const existing = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
        if (!existing) return sendJson(res, 404, { error: 'Agendamento não encontrado.' });

        const now = new Date().toISOString();
        db.prepare(`
          UPDATE agendamentos SET
            paciente_id = ?, paciente_nome = ?, paciente_cns = ?, profissional_id = ?,
            profissional_nome = ?, especialidade = ?, sala = ?, data = ?,
            hora_inicio = ?, hora_fim = ?, tipo_atendimento = ?, status = ?,
            observacoes = ?, sync_status = 'pending_upload', updated_at = ?
          WHERE id = ?
        `).run(
          data.paciente_id !== undefined ? data.paciente_id : existing.paciente_id,
          data.paciente_nome !== undefined ? data.paciente_nome : existing.paciente_nome,
          data.paciente_cns !== undefined ? data.paciente_cns : existing.paciente_cns,
          data.profissional_id !== undefined ? data.profissional_id : existing.profissional_id,
          data.profissional_nome !== undefined ? data.profissional_nome : existing.profissional_nome,
          data.especialidade !== undefined ? data.especialidade : existing.especialidade,
          data.sala !== undefined ? data.sala : existing.sala,
          data.data !== undefined ? data.data : existing.data,
          data.hora_inicio !== undefined ? data.hora_inicio : existing.hora_inicio,
          data.hora_fim !== undefined ? data.hora_fim : existing.hora_fim,
          data.tipo_atendimento !== undefined ? data.tipo_atendimento : existing.tipo_atendimento,
          data.status !== undefined ? data.status : existing.status,
          data.observacoes !== undefined ? data.observacoes : existing.observacoes,
          now,
          id
        );

        const updated = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
        return sendJson(res, 200, { success: true, agendamento: updated, message: 'Agendamento atualizado e salvo automaticamente!' });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM agendamentos WHERE id = ?').run(id);
      return sendJson(res, 200, { success: true, message: 'Agendamento removido.' });
    }
  }

  // 4. SINCRONIZAÇÃO
  if (pathname === '/api/sync/trigger' && method === 'POST') {
    const result = await executeSync('manual');
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/sync/testar-conexao' && method === 'POST') {
    try {
      const data = await parseRequestBody(req);
      const targetUrl = data.url || 'https://esus.imbuia.sc.gov.br/agenda';
      const result = await testarConexaoEsus(targetUrl);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { online: false, erro: err.message });
    }
  }

  if (pathname === '/api/sync/config') {
    if (method === 'GET') {
      const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
      return sendJson(res, 200, config);
    }
    if (method === 'POST') {
      try {
        const data = await parseRequestBody(req);
        db.prepare(`
          UPDATE sync_config SET
            sistema_origem_nome = ?, sistema_destino_tipo = ?, sistema_destino_url = ?,
            api_token = ?, usuario_esus = ?, senha_esus = ?, token_sessao_esus = ?,
            auto_sync_enabled = ?, intervalo_segundos = ?,
            politica_conflito = ?, simulador_sus_ativo = ?
          WHERE id = 1
        `).run(
          data.sistema_origem_nome || 'UBS Imbuia / Agenda Local',
          data.sistema_destino_tipo || 'sus_pec',
          data.sistema_destino_url || 'https://esus.imbuia.sc.gov.br/agenda',
          data.api_token || '',
          data.usuario_esus || '',
          data.senha_esus || '',
          data.token_sessao_esus || '',
          data.auto_sync_enabled ? 1 : 0,
          data.intervalo_segundos ? parseInt(data.intervalo_segundos, 10) : 60,
          data.politica_conflito || 'mais_recente',
          data.simulador_sus_ativo ? 1 : 0
        );

        // Restart background sync with new settings
        if (data.auto_sync_enabled) {
          startAutoSync();
        } else {
          stopAutoSync();
        }

        const updatedConfig = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        return sendJson(res, 200, { success: true, config: updatedConfig, message: 'Configurações de sincronização atualizadas!' });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  if (pathname === '/api/sync/logs' && method === 'GET') {
    const logs = db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 50').all();
    return sendJson(res, 200, logs);
  }

  // 5. SIMULADOR DO SUS (e-SUS PEC / SISREG)
  if (pathname === '/api/mock-sus/status' && method === 'GET') {
    return sendJson(res, 200, {
      service: 'Serviço Central e-SUS PEC / SISREG (Simulador Homologado)',
      version: 'v5.3.1-APS',
      online: true,
      pacientes_cadastrados: susMock.getMockSusPacientes().length,
      agendamentos_ativos: susMock.getMockSusAgendamentos().length
    });
  }

  if (pathname === '/api/mock-sus/pacientes' && method === 'GET') {
    return sendJson(res, 200, susMock.getMockSusPacientes());
  }

  if (pathname === '/api/mock-sus/agendamentos' && method === 'GET') {
    return sendJson(res, 200, susMock.getMockSusAgendamentos());
  }

  // Injetar consulta remota no SUS para teste de recebimento bidirecional
  if (pathname === '/api/mock-sus/injetar-consulta-sus' && method === 'POST') {
    const today = new Date().toISOString().split('T')[0];
    const newAg = susMock.upsertMockSusAgendamento({
      paciente_cns: '700008899112233',
      paciente_nome: 'Marcos Vinicius da Silva (Regulado SISREG)',
      profissional_nome: 'Dr. Carlos Eduardo Ramos',
      especialidade: 'Clínica Médica / APS',
      sala: 'Consultório 1',
      data: today,
      hora_inicio: '16:00',
      hora_fim: '16:30',
      tipo_atendimento: 'Encaminhamento Regulado SUS',
      status: 'Confirmado',
      observacoes: 'Vaga de retorno regulada pela Central Municipal do SUS.',
      origem: 'sisreg'
    });
    return sendJson(res, 200, { success: true, agendamento: newAg, message: 'Nova consulta criada no servidor SUS! Execute ou aguarde o sincronismo para vê-la aparecer na sua agenda local.' });
  }

  // 6. EXPORTAÇÃO DE DADOS
  if (pathname === '/api/export/json' && method === 'GET') {
    const pacientes = db.prepare('SELECT * FROM pacientes').all();
    const agendamentos = db.prepare('SELECT * FROM agendamentos').all();
    const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sus_agenda_export.json"'
    });
    return res.end(JSON.stringify({ gerado_em: new Date().toISOString(), config, pacientes, agendamentos }, null, 2));
  }

  // -------------------------------------------------------------
  // STATIC FILES (Frontend SPA)
  // -------------------------------------------------------------
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  
  // Security check: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Acesso Proibido');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Arquivo não encontrado');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  const localUrl = `http://localhost:${PORT}`;
  console.log(`=======================================================`);
  console.log(` 🏥 SUS-SINC: Sistema de Agenda e Pacientes Integrado`);
  console.log(` Servidor rodando com sucesso em: ${localUrl}`);
  console.log(` Sincronização automática e persistência SQLite ativas.`);
  console.log(`=======================================================`);

  // Abre o navegador automaticamente somente após o servidor estar 100% pronto
  if (process.env.AUTO_OPEN !== 'false') {
    const { exec } = require('node:child_process');
    const startCmd = process.platform === 'win32'
      ? `start "" "${localUrl}"`
      : process.platform === 'darwin'
      ? `open "${localUrl}"`
      : `xdg-open "${localUrl}"`;
    exec(startCmd, (err) => {
      if (err) console.log(`Acesse ${localUrl} no navegador.`);
    });
  }
});
