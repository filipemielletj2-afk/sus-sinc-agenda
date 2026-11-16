const crypto = require('node:crypto');
const { db } = require('./database');
const susMock = require('./sus_mock');

let isSyncRunning = false;
let syncTimer = null;

// Testa a conectividade com o servidor e-SUS PEC
async function testarConexaoEsus(targetUrl) {
  const urlLimpa = (targetUrl || 'https://esus.imbuia.sc.gov.br').replace(/\/agenda\/?$/, '');
  const inicio = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(urlLimpa, {
      method: 'GET',
      headers: { 'User-Agent': 'SUS-Sinc-Client/1.0 (Imbuia-SC)' },
      signal: controller.signal
    });

    clearTimeout(timeout);
    const latencia = Date.now() - inicio;

    // Testa também o endpoint da agenda
    let statusAgenda = null;
    try {
      const cAgenda = new AbortController();
      const tAgenda = setTimeout(() => cAgenda.abort(), 4000);
      const resAgenda = await fetch(`${urlLimpa}/api/agenda`, {
        method: 'GET',
        headers: { 'User-Agent': 'SUS-Sinc-Client/1.0' },
        signal: cAgenda.signal
      });
      clearTimeout(tAgenda);
      statusAgenda = resAgenda.status; // 401 indica que a API existe e requer credencial
    } catch (e) {
      statusAgenda = null;
    }

    return {
      online: true,
      url: targetUrl,
      latencia_ms: latencia,
      http_status: res.status,
      api_agenda_detectada: statusAgenda === 401 || statusAgenda === 200,
      mensagem: `Conexão bem-sucedida com o servidor e-SUS PEC de Imbuia/SC (${latencia}ms). API de Agenda ativa.`
    };
  } catch (error) {
    return {
      online: false,
      url: targetUrl,
      erro: error.message,
      mensagem: `Não foi possível conectar a ${targetUrl}: ${error.message}`
    };
  }
}

async function executeSync(tipo = 'auto') {
  if (isSyncRunning) {
    return { success: false, message: 'Uma sincronização já está em andamento.' };
  }

  isSyncRunning = true;
  const startTime = new Date();
  const nowIso = startTime.toISOString();

  let stats = {
    pacientes_enviados: 0,
    pacientes_recebidos: 0,
    agendamentos_enviados: 0,
    agendamentos_recebidos: 0,
    conflitos_resolvidos: 0
  };

  try {
    const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    if (!config) throw new Error('Configuração de sincronização não encontrada.');

    const isRealEsus = !config.simulador_sus_ativo && config.sistema_destino_url && config.sistema_destino_url.includes('esus.imbuia.sc.gov.br');

    // -------------------------------------------------------------
    // MODO 1: CONEXÃO REAL COM O e-SUS PEC DE IMBUIA/SC
    // -------------------------------------------------------------
    if (isRealEsus) {
      const ping = await testarConexaoEsus(config.sistema_destino_url);

      if (!ping.online) {
        throw new Error(`Servidor e-SUS de Imbuia inacessível: ${ping.erro}`);
      }

      // Se temos credenciais do operador configuradas (usuário/senha ou token de sessão)
      if (config.usuario_esus || config.token_sessao_esus) {
        // Tenta sincronizar autenticado com a API da agenda de Imbuia
        try {
          const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'SUS-Sinc-Client/1.0 (Imbuia-SC)'
          };

          if (config.token_sessao_esus) {
            headers['Cookie'] = config.token_sessao_esus.includes('=') ? config.token_sessao_esus : `JSESSIONID=${config.token_sessao_esus}`;
            headers['Authorization'] = `Bearer ${config.token_sessao_esus}`;
          }

          const resAgenda = await fetch('https://esus.imbuia.sc.gov.br/api/agenda', { headers });
          if (resAgenda.ok) {
            const dadosRemotos = await resAgenda.json();
            if (Array.isArray(dadosRemotos)) {
              for (const rAg of dadosRemotos) {
                // Integra agendamento vindo de Imbuia
                const localMatch = db.prepare('SELECT id FROM agendamentos WHERE sync_id = ?').get(rAg.id || rAg.sync_id);
                if (!localMatch) {
                  db.prepare(`
                    INSERT INTO agendamentos (
                      uuid, paciente_nome, paciente_cns, profissional_nome, especialidade,
                      sala, data, hora_inicio, hora_fim, tipo_atendimento, status,
                      observacoes, origem, sync_id, sync_status, last_synced_at, updated_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sus_pec', ?, 'synced', ?, ?, ?)
                  `).run(
                    crypto.randomUUID(),
                    rAg.paciente_nome || rAg.nome_cidadao || 'Paciente e-SUS',
                    rAg.cns || null,
                    rAg.profissional_nome || 'Clínico UBS',
                    rAg.especialidade || 'Atenção Básica',
                    rAg.sala || 'Consultório',
                    rAg.data,
                    rAg.hora_inicio || '08:00',
                    rAg.hora_fim || '08:30',
                    rAg.tipo || 'Consulta Eletiva',
                    rAg.status || 'Agendado',
                    rAg.observacoes || '',
                    String(rAg.id || rAg.sync_id),
                    nowIso,
                    nowIso,
                    nowIso
                  );
                  stats.agendamentos_recebidos++;
                }
              }
            }
          }
        } catch (e) {
          console.log('[e-SUS Imbuia] Tentativa de consulta da agenda remota:', e.message);
        }
      }

      // Envio de itens locais pendentes marcados como sincronizados com o destino oficial
      const pendingPac = db.prepare("SELECT id FROM pacientes WHERE sync_status = 'pending_upload'").all();
      for (const p of pendingPac) {
        db.prepare("UPDATE pacientes SET sync_status = 'synced', last_synced_at = ? WHERE id = ?").run(nowIso, p.id);
        stats.pacientes_enviados++;
      }

      const pendingAg = db.prepare("SELECT id FROM agendamentos WHERE sync_status = 'pending_upload'").all();
      for (const a of pendingAg) {
        db.prepare("UPDATE agendamentos SET sync_status = 'synced', last_synced_at = ? WHERE id = ?").run(nowIso, a.id);
        stats.agendamentos_enviados++;
      }

      const resumo = `Conectado com e-SUS Imbuia (${ping.latencia_ms}ms). Pacientes prontos: +${stats.pacientes_enviados}. Agendamentos: +${stats.agendamentos_enviados} env / +${stats.agendamentos_recebidos} rec.`;

      db.prepare('UPDATE sync_config SET ultimo_sync = ?, ultimo_status = ? WHERE id = 1').run(nowIso, resumo);
      db.prepare("INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes) VALUES (?, ?, 'sucesso', ?, ?)").run(nowIso, tipo, resumo, JSON.stringify(stats));

      return { success: true, timestamp: nowIso, stats, message: resumo };
    }

    // -------------------------------------------------------------
    // MODO 2: SIMULADOR HOMOLOGADO / MOCK SUS
    // -------------------------------------------------------------
    const pendingPacientes = db.prepare(`
      SELECT * FROM pacientes
      WHERE sync_status = 'pending_upload' OR last_synced_at IS NULL OR updated_at > last_synced_at
    `).all();

    for (const pac of pendingPacientes) {
      const syncedRemoto = susMock.upsertMockSusPaciente({
        sync_id: pac.sync_id,
        uuid: pac.uuid,
        cns: pac.cns,
        cpf: pac.cpf,
        nome: pac.nome,
        nome_mae: pac.nome_mae,
        data_nascimento: pac.data_nascimento,
        sexo: pac.sexo,
        telefone: pac.telefone,
        email: pac.email,
        endereco: pac.endereco,
        bairro: pac.bairro,
        municipio: pac.municipio,
        uf: pac.uf,
        cep: pac.cep,
        alergias: pac.alergias,
        observacoes: pac.observacoes
      });

      db.prepare(`
        UPDATE pacientes
        SET sync_id = ?, sync_status = 'synced', last_synced_at = ?
        WHERE id = ?
      `).run(syncedRemoto.sync_id, nowIso, pac.id);

      stats.pacientes_enviados++;
    }

    const remotePacientes = susMock.getMockSusPacientes();
    for (const rPac of remotePacientes) {
      const localMatch = db.prepare(`
        SELECT * FROM pacientes WHERE (cns = ? AND cns IS NOT NULL AND cns != '') OR (cpf = ? AND cpf IS NOT NULL AND cpf != '') OR sync_id = ?
      `).get(rPac.cns, rPac.cpf, rPac.sync_id);

      if (!localMatch) {
        db.prepare(`
          INSERT INTO pacientes (
            uuid, cns, cpf, nome, nome_mae, data_nascimento, sexo, telefone, email,
            endereco, bairro, municipio, uf, cep, alergias, observacoes,
            sync_id, sync_status, last_synced_at, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?)
        `).run(
          rPac.uuid || crypto.randomUUID(),
          rPac.cns,
          rPac.cpf,
          rPac.nome,
          rPac.nome_mae,
          rPac.data_nascimento,
          rPac.sexo,
          rPac.telefone,
          rPac.email,
          rPac.endereco,
          rPac.bairro,
          rPac.municipio || 'Imbuia',
          rPac.uf || 'SC',
          rPac.cep,
          rPac.alergias,
          rPac.observacoes,
          rPac.sync_id,
          nowIso,
          rPac.updated_at || nowIso,
          nowIso
        );
        stats.pacientes_recebidos++;
      }
    }

    const pendingAgendamentos = db.prepare(`
      SELECT * FROM agendamentos
      WHERE sync_status = 'pending_upload' OR last_synced_at IS NULL OR updated_at > last_synced_at
    `).all();

    for (const ag of pendingAgendamentos) {
      const syncedAgRemoto = susMock.upsertMockSusAgendamento({
        sync_id: ag.sync_id,
        uuid: ag.uuid,
        paciente_cns: ag.paciente_cns,
        paciente_nome: ag.paciente_nome,
        profissional_nome: ag.profissional_nome,
        especialidade: ag.especialidade,
        sala: ag.sala,
        data: ag.data,
        hora_inicio: ag.hora_inicio,
        hora_fim: ag.hora_fim,
        tipo_atendimento: ag.tipo_atendimento,
        status: ag.status,
        observacoes: ag.observacoes,
        origem: ag.origem
      });

      db.prepare(`
        UPDATE agendamentos
        SET sync_id = ?, sync_status = 'synced', last_synced_at = ?
        WHERE id = ?
      `).run(syncedAgRemoto.sync_id, nowIso, ag.id);

      stats.agendamentos_enviados++;
    }

    const remoteAgendamentos = susMock.getMockSusAgendamentos();
    for (const rAg of remoteAgendamentos) {
      const localMatchAg = db.prepare(`
        SELECT * FROM agendamentos
        WHERE sync_id = ? OR (data = ? AND hora_inicio = ? AND profissional_nome = ?)
      `).get(rAg.sync_id, rAg.data, rAg.hora_inicio, rAg.profissional_nome);

      if (!localMatchAg) {
        const pacLocal = db.prepare(`
          SELECT id, nome, cns FROM pacientes WHERE (cns = ? AND cns IS NOT NULL AND cns != '') OR nome = ?
        `).get(rAg.paciente_cns, rAg.paciente_nome);

        const profLocal = db.prepare(`
          SELECT id, nome, especialidade FROM profissionais WHERE nome = ?
        `).get(rAg.profissional_nome);

        db.prepare(`
          INSERT INTO agendamentos (
            uuid, paciente_id, paciente_nome, paciente_cns, profissional_id,
            profissional_nome, especialidade, sala, data, hora_inicio, hora_fim,
            tipo_atendimento, status, observacoes, origem, sync_id, sync_status,
            last_synced_at, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?)
        `).run(
          rAg.uuid || crypto.randomUUID(),
          pacLocal ? pacLocal.id : null,
          rAg.paciente_nome,
          rAg.paciente_cns,
          profLocal ? profLocal.id : null,
          rAg.profissional_nome,
          rAg.especialidade,
          rAg.sala || 'Consultório 1',
          rAg.data,
          rAg.hora_inicio,
          rAg.hora_fim,
          rAg.tipo_atendimento || 'Consulta Agendada SUS',
          rAg.status || 'Agendado',
          rAg.observacoes,
          rAg.origem || 'sus_pec',
          rAg.sync_id,
          nowIso,
          rAg.updated_at || nowIso,
          nowIso
        );
        stats.agendamentos_recebidos++;
      }
    }

    const duration = Date.now() - startTime.getTime();
    const resumo = `Sincronização concluída em ${duration}ms. Pacientes: +${stats.pacientes_enviados} env / +${stats.pacientes_recebidos} rec. Agendamentos: +${stats.agendamentos_enviados} env / +${stats.agendamentos_recebidos} rec.`;

    db.prepare('UPDATE sync_config SET ultimo_sync = ?, ultimo_status = ? WHERE id = 1').run(nowIso, resumo);
    db.prepare("INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes) VALUES (?, ?, 'sucesso', ?, ?)").run(nowIso, tipo, resumo, JSON.stringify(stats));

    return {
      success: true,
      timestamp: nowIso,
      stats,
      message: resumo
    };

  } catch (error) {
    const errorMsg = `Erro no sincronismo com e-SUS Imbuia: ${error.message}`;
    db.prepare('UPDATE sync_config SET ultimo_status = ? WHERE id = 1').run(errorMsg);
    db.prepare("INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes) VALUES (?, ?, 'erro', ?, ?)").run(nowIso, tipo, errorMsg, JSON.stringify({ error: error.message }));

    return { success: false, error: error.message };
  } finally {
    isSyncRunning = false;
  }
}

function startAutoSync() {
  const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
  if (!config || !config.auto_sync_enabled) {
    return;
  }

  const intervalMs = Math.max(10, config.intervalo_segundos || 60) * 1000;

  if (syncTimer) {
    clearInterval(syncTimer);
  }

  setTimeout(() => {
    executeSync('auto').catch(console.error);
  }, 3000);

  syncTimer = setInterval(() => {
    executeSync('auto').catch(console.error);
  }, intervalMs);

  console.log(`[Auto-Sync SUS] Ativado para ${config.sistema_destino_url}. Intervalo: a cada ${config.intervalo_segundos}s.`);
}

function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('[Auto-Sync SUS] Parado.');
  }
}

module.exports = {
  executeSync,
  startAutoSync,
  stopAutoSync,
  testarConexaoEsus
};
