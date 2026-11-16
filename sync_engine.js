const crypto = require('node:crypto');
const { db } = require('./database');
const susMock = require('./sus_mock');

let isSyncRunning = false;
let syncTimer = null;

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

    // -------------------------------------------------------------
    // FASE 1: SINCRONIZAÇÃO DE PACIENTES (Local -> Remoto / SUS)
    // -------------------------------------------------------------
    const pendingPacientes = db.prepare(`
      SELECT * FROM pacientes
      WHERE sync_status = 'pending_upload' OR last_synced_at IS NULL OR updated_at > last_synced_at
    `).all();

    for (const pac of pendingPacientes) {
      if (config.simulador_sus_ativo || config.sistema_destino_tipo === 'sus_pec') {
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
    }

    // -------------------------------------------------------------
    // FASE 2: RECEBER PACIENTES DO SUS (Remoto / SUS -> Local)
    // -------------------------------------------------------------
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
          rPac.municipio || 'São Paulo',
          rPac.uf || 'SP',
          rPac.cep,
          rPac.alergias,
          rPac.observacoes,
          rPac.sync_id,
          nowIso,
          rPac.updated_at || nowIso,
          nowIso
        );
        stats.pacientes_recebidos++;
      } else {
        // Se ambos foram modificados, verificar política de conflito
        if (localMatch.sync_status === 'pending_upload' && rPac.updated_at > localMatch.updated_at) {
          stats.conflitos_resolvidos++;
        }
      }
    }

    // -------------------------------------------------------------
    // FASE 3: SINCRONIZAÇÃO DE AGENDAMENTOS (Local -> Remoto / SUS)
    // -------------------------------------------------------------
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

    // -------------------------------------------------------------
    // FASE 4: RECEBER AGENDAMENTOS DO SUS (Remoto / SUS -> Local)
    // -------------------------------------------------------------
    const remoteAgendamentos = susMock.getMockSusAgendamentos();
    for (const rAg of remoteAgendamentos) {
      const localMatchAg = db.prepare(`
        SELECT * FROM agendamentos
        WHERE sync_id = ? OR (data = ? AND hora_inicio = ? AND profissional_nome = ?)
      `).get(rAg.sync_id, rAg.data, rAg.hora_inicio, rAg.profissional_nome);

      if (!localMatchAg) {
        // Encontrar paciente local pelo CNS ou nome
        const pacLocal = db.prepare(`
          SELECT id, nome, cns FROM pacientes WHERE (cns = ? AND cns IS NOT NULL AND cns != '') OR nome = ?
        `).get(rAg.paciente_cns, rAg.paciente_nome);

        // Encontrar profissional pelo nome
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
      } else {
        // Se já existe e a versão remota do SUS foi atualizada recentemente
        if (rAg.updated_at > localMatchAg.updated_at && localMatchAg.sync_status === 'synced') {
          db.prepare(`
            UPDATE agendamentos
            SET status = ?, observacoes = ?, last_synced_at = ?, updated_at = ?
            WHERE id = ?
          `).run(rAg.status, rAg.observacoes, nowIso, nowIso, localMatchAg.id);
          stats.agendamentos_recebidos++;
        }
      }
    }

    const duration = Date.now() - startTime.getTime();
    const resumo = `Sincronização concluída em ${duration}ms. Pacientes: +${stats.pacientes_enviados} env / +${stats.pacientes_recebidos} rec. Agendamentos: +${stats.agendamentos_enviados} env / +${stats.agendamentos_recebidos} rec.`;

    // Atualiza status global
    db.prepare(`
      UPDATE sync_config
      SET ultimo_sync = ?, ultimo_status = ?
      WHERE id = 1
    `).run(nowIso, resumo);

    // Registra log
    db.prepare(`
      INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes)
      VALUES (?, ?, 'sucesso', ?, ?)
    `).run(nowIso, tipo, resumo, JSON.stringify(stats));

    return {
      success: true,
      timestamp: nowIso,
      stats,
      message: resumo
    };

  } catch (error) {
    const errorMsg = `Erro no sincronismo: ${error.message}`;
    db.prepare(`
      UPDATE sync_config
      SET ultimo_status = ?
      WHERE id = 1
    `).run(errorMsg);

    db.prepare(`
      INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes)
      VALUES (?, ?, 'erro', ?, ?)
    `).run(nowIso, tipo, errorMsg, JSON.stringify({ error: error.message }));

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

  // Executa uma primeira vez após 3 segundos
  setTimeout(() => {
    executeSync('auto').catch(console.error);
  }, 3000);

  // Agenda periodicamente
  syncTimer = setInterval(() => {
    executeSync('auto').catch(console.error);
  }, intervalMs);

  console.log(`[Auto-Sync SUS] Ativado. Intervalo: a cada ${config.intervalo_segundos} segundos.`);
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
  stopAutoSync
};
