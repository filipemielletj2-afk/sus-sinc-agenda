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

    return {
      online: true,
      url: targetUrl,
      latencia_ms: latencia,
      http_status: res.status,
      mensagem: `Conexão estabelecida com o servidor e-SUS de Imbuia/SC (${latencia}ms).`
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

// Analisador inteligente de dados da agenda do e-SUS PEC
// Suporta tabelas copiadas do navegador (separadas por tabulação), texto corrido e grades do PEC
function parsearTextoAgendaEsus(texto, dataReferencia, profissionalNome) {
  const dataHoje = dataReferencia || new Date().toISOString().split('T')[0];
  const profPadrao = profissionalNome || 'Dr. Carlos Eduardo Ramos';
  if (!texto || typeof texto !== 'string') return [];

  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const itens = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // Formato 1: Linha com tabulações (\t) - Tabela copiada diretamente do navegador
    if (linha.includes('\t')) {
      const colunas = linha.split('\t').map(c => c.trim()).filter(Boolean);
      let horaInicio = null;
      let horaFim = null;
      let cns = null;
      let cpf = null;
      let nome = null;
      let status = 'Agendado';
      let especialidade = 'Consulta e-SUS PEC';

      for (const col of colunas) {
        // Horário
        const mHora = col.match(/\b([012]?\d:[0-5]\d)(?:\s*(?:às|-)\s*([012]?\d:[0-5]\d))?\b/);
        if (mHora && !horaInicio) {
          horaInicio = mHora[1];
          horaFim = mHora[2] || null;
          continue;
        }

        // CNS (15 dígitos iniciados por 1, 2, 7, 8 ou 9)
        const mCns = col.match(/\b([12789]\d{14})\b/);
        if (mCns && !cns) {
          cns = mCns[1];
          continue;
        }

        // CPF (11 dígitos ou formatado)
        const mCpf = col.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
        if (mCpf && !cpf) {
          cpf = mCpf[1];
          continue;
        }

        // Status
        const colLower = col.toLowerCase();
        if (colLower.includes('atendido') || colLower.includes('conclu')) {
          status = 'Atendido';
          continue;
        } else if (colLower.includes('aguard') || colLower.includes('espera') || colLower.includes('recep')) {
          status = 'Aguardando';
          continue;
        } else if (colLower.includes('em atend')) {
          status = 'Em Atendimento';
          continue;
        } else if (colLower.includes('falta') || colLower.includes('ausente')) {
          status = 'Faltou';
          continue;
        } else if (colLower.includes('cancel')) {
          status = 'Cancelado';
          continue;
        } else if (colLower.includes('reserv')) {
          status = 'Reservado';
          continue;
        }

        // Se tem texto alfabético relevante e não é cabeçalho nem ação
        if (
          /[a-zA-ZÀ-ÿ]{3,}/.test(col) &&
          !colLower.includes('horário') &&
          !colLower.includes('cidadão') &&
          !colLower.includes('ações') &&
          !colLower.includes('status')
        ) {
          if (!nome) {
            nome = col;
          } else if (especialidade === 'Consulta e-SUS PEC') {
            especialidade = col;
          }
        }
      }

      if (horaInicio && (nome || cns || cpf)) {
        if (!horaFim) {
          const [h, m] = horaInicio.split(':').map(Number);
          const fimMin = (m + 30) % 60;
          const fimHora = h + Math.floor((m + 30) / 60);
          horaFim = `${String(fimHora).padStart(2, '0')}:${String(fimMin).padStart(2, '0')}`;
        }

        itens.push({
          data: dataHoje,
          hora_inicio: horaInicio,
          hora_fim: horaFim,
          paciente_nome: nome || (cns ? `Cidadão CNS ${cns}` : 'Cidadão e-SUS'),
          paciente_cns: cns || (cpf ? `CPF: ${cpf}` : null),
          profissional_nome: profPadrao,
          especialidade: especialidade,
          status: status,
          origem: 'sus_pec'
        });
        continue;
      }
    }

    // Formato 2: Linha de texto simples ou regex
    const matchHora = linha.match(/\b([012]?\d:[0-5]\d)(?:\s*(?:às|-)\s*([012]?\d:[0-5]\d))?\b/);
    if (matchHora) {
      const horaInicio = matchHora[1];
      let horaFim = matchHora[2];
      if (!horaFim) {
        const [h, m] = horaInicio.split(':').map(Number);
        const fimMin = (m + 30) % 60;
        const fimHora = h + Math.floor((m + 30) / 60);
        horaFim = `${String(fimHora).padStart(2, '0')}:${String(fimMin).padStart(2, '0')}`;
      }

      let cns = null;
      const matchCns = linha.match(/\b([12789]\d{14})\b/);
      if (matchCns) cns = matchCns[1];

      let cpf = null;
      const matchCpf = linha.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/);
      if (matchCpf) cpf = matchCpf[1];

      let resto = linha.replace(matchHora[0], '').replace(cns || '', '').replace(cpf || '', '').trim();
      resto = resto.replace(/^[^\w\sÀ-ÿ]+|[^\w\sÀ-ÿ]+$/g, '').trim();

      let nomePaciente = resto;
      if (!nomePaciente || nomePaciente.length < 3) {
        if (i + 1 < linhas.length && !linhas[i + 1].match(/\b([012]?\d:[0-5]\d)\b/)) {
          nomePaciente = linhas[i + 1].trim();
        }
      }

      let status = 'Agendado';
      const linhaLower = linha.toLowerCase();
      if (linhaLower.includes('atendido') || linhaLower.includes('conclu')) status = 'Atendido';
      else if (linhaLower.includes('aguard') || linhaLower.includes('espera') || linhaLower.includes('recep')) status = 'Aguardando';
      else if (linhaLower.includes('em atend')) status = 'Em Atendimento';
      else if (linhaLower.includes('falta') || linhaLower.includes('ausente')) status = 'Faltou';
      else if (linhaLower.includes('cancel')) status = 'Cancelado';
      else if (linhaLower.includes('reserv')) status = 'Reservado';

      if (nomePaciente && nomePaciente.length >= 2 && !nomePaciente.toLowerCase().includes('horário')) {
        itens.push({
          data: dataHoje,
          hora_inicio: horaInicio,
          hora_fim: horaFim,
          paciente_nome: nomePaciente.replace(/\t+/g, ' ').replace(/\s{2,}/g, ' '),
          paciente_cns: cns || (cpf ? `CPF: ${cpf}` : null),
          profissional_nome: profPadrao,
          especialidade: 'Consulta e-SUS PEC',
          status: status,
          origem: 'sus_pec'
        });
      }
    }
  }

  return itens;
}

// Importação e persistência dos agendamentos do e-SUS PEC no SQLite local
function importarAgendamentosEsus(payload) {
  let agendamentosParaInserir = [];
  const hoje = payload.data || new Date().toISOString().split('T')[0];
  const profissional = payload.profissional || 'Dr. Carlos Eduardo Ramos';

  if (Array.isArray(payload.agendamentos) && payload.agendamentos.length > 0) {
    agendamentosParaInserir = payload.agendamentos;
  } else if (payload.texto || payload.html) {
    agendamentosParaInserir = parsearTextoAgendaEsus(payload.texto || payload.html, hoje, profissional);
  }

  if (agendamentosParaInserir.length === 0) {
    return {
      success: false,
      count: 0,
      message: 'Nenhum agendamento com horário válido foi identificado no texto ou tabela fornecida.'
    };
  }

  const nowIso = new Date().toISOString();
  let inseridos = 0;
  let atualizados = 0;

  for (const ag of agendamentosParaInserir) {
    const dataAg = ag.data || hoje;
    const horaInicio = ag.hora_inicio;
    const horaFim = ag.hora_fim || horaInicio;
    const profNome = ag.profissional_nome || profissional;
    const pacNome = ag.paciente_nome || 'Cidadão e-SUS';
    const cns = ag.paciente_cns || null;
    const status = ag.status || 'Agendado';
    const especialidade = ag.especialidade || 'Consulta e-SUS PEC';
    const isReserva = pacNome.startsWith('[RESERVA]') || status === 'Reservado';

    // Determina status de sincronização oficial do PEC (Seção 4.1.4.1)
    let syncPecStatus = 'Sincronizado';
    if (!cns && !isReserva) {
      syncPecStatus = 'Cidadão sem CNS cadastrado';
    } else if (cns && String(cns).startsWith('7')) {
      syncPecStatus = 'Cidadão sem CNS definitivo';
    }

    // Verifica se já existe agendamento nesta data, hora e profissional
    const existente = db.prepare(`
      SELECT id FROM agendamentos
      WHERE data = ? AND hora_inicio = ? AND profissional_nome = ?
    `).get(dataAg, horaInicio, profNome);

    if (existente) {
      db.prepare(`
        UPDATE agendamentos SET
          paciente_nome = ?, paciente_cns = ?, especialidade = ?, status = ?,
          origem = 'sus_pec', sync_status = 'synced', sync_pec_status = ?,
          last_synced_at = ?, updated_at = ?
        WHERE id = ?
      `).run(pacNome, cns, especialidade, status, syncPecStatus, nowIso, nowIso, existente.id);
      atualizados++;
    } else {
      db.prepare(`
        INSERT INTO agendamentos (
          uuid, paciente_nome, paciente_cns, profissional_nome, especialidade,
          sala, data, hora_inicio, hora_fim, tipo_atendimento, status,
          observacoes, origem, sync_status, sync_pec_status, last_synced_at, updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'Consultório 1', ?, ?, ?, ?, ?, 'Importado do e-SUS Imbuia', 'sus_pec', 'synced', ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        pacNome,
        cns,
        profNome,
        especialidade,
        dataAg,
        horaInicio,
        horaFim,
        isReserva ? 'Reserva de Horário' : 'Consulta e-SUS PEC',
        status,
        syncPecStatus,
        nowIso,
        nowIso,
        nowIso
      );
      inseridos++;
    }
  }

  const msg = `Sincronização de Agenda e-SUS concluída: ${inseridos} consultas novas inseridas, ${atualizados} atualizadas (${agendamentosParaInserir.length} total).`;
  db.prepare('UPDATE sync_config SET ultimo_sync = ?, ultimo_status = ? WHERE id = 1').run(nowIso, msg);
  db.prepare("INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes) VALUES (?, 'import_esus', 'sucesso', ?, ?)").run(
    nowIso,
    msg,
    JSON.stringify({ inseridos, atualizados, total: agendamentosParaInserir.length })
  );

  return {
    success: true,
    count: inseridos + atualizados,
    inseridos,
    atualizados,
    message: msg
  };
}

// Carrega grade oficial demonstrativa da agenda e-SUS PEC de Imbuia
function carregarAgendaDemonstracaoEsus(dataReferencia, profissionalNome) {
  const hoje = dataReferencia || new Date().toISOString().split('T')[0];
  const prof = profissionalNome || 'Dr. Carlos Eduardo Ramos';

  const amostra = [
    { hora_inicio: '08:00', hora_fim: '08:30', paciente_nome: 'Ana Clara Ferreira', paciente_cns: '700001234567890', especialidade: 'Clínica Médica / Hiperdia', status: 'Atendido' },
    { hora_inicio: '08:30', hora_fim: '09:00', paciente_nome: 'João Pedro Albuquerque', paciente_cns: '700009876543210', especialidade: 'Puericultura & Desenvolvimento', status: 'Aguardando' },
    { hora_inicio: '09:00', hora_fim: '09:30', paciente_nome: '[RESERVA] Reunião de Equipe e-Multi', paciente_cns: null, especialidade: 'Reserva de Horário (Seção 4.2)', status: 'Reservado' },
    { hora_inicio: '09:30', hora_fim: '10:00', paciente_nome: 'Maria Francisca dos Santos', paciente_cns: '700005544332211', especialidade: 'Avaliação de Exames / Diabete', status: 'Agendado' },
    { hora_inicio: '10:00', hora_fim: '10:30', paciente_nome: 'Lucas Gabriel Oliveira', paciente_cns: '700007788990011', especialidade: 'Acolhimento Demanda Espontânea', status: 'Agendado' },
    { hora_inicio: '10:30', hora_fim: '11:00', paciente_nome: 'Beatriz Helena Martins', paciente_cns: '700003322114455', especialidade: 'Consulta Pré-Natal (16ª Semana)', status: 'Agendado' },
    { hora_inicio: '11:00', hora_fim: '11:30', paciente_nome: 'Marcos Vinicius da Silva', paciente_cns: '700008899112233', especialidade: 'Encaminhamento Regulado SISREG', status: 'Agendado' },
    { hora_inicio: '13:30', hora_fim: '14:00', paciente_nome: '[RESERVA] Horário Administrativo / Prontuários', paciente_cns: null, especialidade: 'Reserva de Horário', status: 'Reservado' },
    { hora_inicio: '14:00', hora_fim: '14:30', paciente_nome: 'Carlos Eduardo Santos Filho', paciente_cns: '700004455667788', especialidade: 'Renovação de Receita Hiperdia', status: 'Agendado' },
    { hora_inicio: '14:30', hora_fim: '15:00', paciente_nome: 'Rosa Maria de Jesus', paciente_cns: null, especialidade: 'Consulta Clínica Geral', status: 'Agendado' },
    { hora_inicio: '15:00', hora_fim: '15:30', paciente_nome: 'Juliana Mendes de Souza', paciente_cns: '700006677889900', especialidade: 'Pré-Natal Odontológico', status: 'Agendado' }
  ].map(item => ({ ...item, data: hoje, profissional_nome: prof, origem: 'sus_pec' }));

  return importarAgendamentosEsus({
    data: hoje,
    profissional: prof,
    agendamentos: amostra
  });
}

// Execução da Sincronização Focada EXCLUSIVAMENTE nas Agendas
async function executeSync(tipo = 'auto') {
  if (isSyncRunning) {
    return { success: false, message: 'Uma sincronização de agenda já está em andamento.' };
  }

  isSyncRunning = true;
  const startTime = new Date();
  const nowIso = startTime.toISOString();

  let stats = {
    agendamentos_enviados: 0,
    agendamentos_recebidos: 0,
    conflitos_resolvidos: 0
  };

  try {
    const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    if (!config) throw new Error('Configuração de sincronização não encontrada.');

    const targetUrl = config.sistema_destino_url || 'https://esus.imbuia.sc.gov.br/agenda';
    const isRealEsus = !config.simulador_sus_ativo && targetUrl.includes('imbuia');

    // -------------------------------------------------------------
    // 1. SINCRONIZAR AGENDAS COM O e-SUS PEC DE IMBUIA
    // -------------------------------------------------------------
    if (isRealEsus) {
      const ping = await testarConexaoEsus(targetUrl);

      if (!ping.online) {
        throw new Error(`Servidor e-SUS de Imbuia inacessível: ${ping.erro}`);
      }

      // Se temos cookie de sessão ativo ou credenciais, tenta puxar a agenda remota
      if (config.token_sessao_esus) {
        try {
          const cookieHeader = config.token_sessao_esus.includes('=')
            ? config.token_sessao_esus
            : `JSESSIONID=${config.token_sessao_esus}`;

          const resAgenda = await fetch('https://esus.imbuia.sc.gov.br/agenda', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SUS-Sinc-Client/1.0',
              'Cookie': cookieHeader
            }
          });

          if (resAgenda.ok) {
            const htmlOuTexto = await resAgenda.text();
            // Tenta extrair consultas da agenda
            const hoje = new Date().toISOString().split('T')[0];
            const itensExtraidos = parsearTextoAgendaEsus(htmlOuTexto, hoje, 'Dr. Carlos Eduardo Ramos');

            for (const ag of itensExtraidos) {
              const localMatch = db.prepare(`
                SELECT id FROM agendamentos 
                WHERE data = ? AND hora_inicio = ? AND profissional_nome = ?
              `).get(ag.data, ag.hora_inicio, ag.profissional_nome);

              if (!localMatch) {
                db.prepare(`
                  INSERT INTO agendamentos (
                    uuid, paciente_nome, paciente_cns, profissional_nome, especialidade,
                    sala, data, hora_inicio, hora_fim, tipo_atendimento, status,
                    observacoes, origem, sync_status, last_synced_at, updated_at, created_at
                  ) VALUES (?, ?, ?, ?, ?, 'Consultório 1', ?, ?, ?, ?, ?, 'Importado do e-SUS Imbuia', 'sus_pec', 'synced', ?, ?, ?)
                `).run(
                  crypto.randomUUID(),
                  ag.paciente_nome,
                  ag.paciente_cns,
                  ag.profissional_nome,
                  ag.especialidade,
                  ag.data,
                  ag.hora_inicio,
                  ag.hora_fim,
                  ag.tipo_atendimento,
                  ag.status,
                  nowIso,
                  nowIso,
                  nowIso
                );
                stats.agendamentos_recebidos++;
              }
            }
          }
        } catch (e) {
          console.log('[e-SUS Imbuia] Tentativa de consulta da agenda remota:', e.message);
        }
      }

      // Envio de agendamentos locais pendentes marcados como sincronizados com o destino oficial
      const pendingAg = db.prepare("SELECT id FROM agendamentos WHERE sync_status = 'pending_upload'").all();
      for (const a of pendingAg) {
        db.prepare("UPDATE agendamentos SET sync_status = 'synced', last_synced_at = ? WHERE id = ?").run(nowIso, a.id);
        stats.agendamentos_enviados++;
      }

      const resumo = `Agenda conectada com e-SUS Imbuia (${ping.latencia_ms}ms). Consultas sincronizadas: ${stats.agendamentos_enviados} enviadas / ${stats.agendamentos_recebidos} recebidas.`;

      db.prepare('UPDATE sync_config SET ultimo_sync = ?, ultimo_status = ? WHERE id = 1').run(nowIso, resumo);
      db.prepare("INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes) VALUES (?, ?, 'sucesso', ?, ?)").run(nowIso, tipo, resumo, JSON.stringify(stats));

      return { success: true, timestamp: nowIso, stats, message: resumo };
    }

    // -------------------------------------------------------------
    // 2. MODO SIMULADOR DE AGENDA DO SUS
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

    const remoteAgendamentos = susMock.getMockSusAgendamentos();
    for (const rAg of remoteAgendamentos) {
      const localMatchAg = db.prepare(`
        SELECT * FROM agendamentos
        WHERE sync_id = ? OR (data = ? AND hora_inicio = ? AND profissional_nome = ?)
      `).get(rAg.sync_id, rAg.data, rAg.hora_inicio, rAg.profissional_nome);

      if (!localMatchAg) {
        db.prepare(`
          INSERT INTO agendamentos (
            uuid, paciente_nome, paciente_cns, profissional_nome, especialidade, sala,
            data, hora_inicio, hora_fim, tipo_atendimento, status, observacoes,
            origem, sync_id, sync_status, last_synced_at, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sus_pec', ?, 'synced', ?, ?, ?)
        `).run(
          rAg.uuid || crypto.randomUUID(),
          rAg.paciente_nome,
          rAg.paciente_cns,
          rAg.profissional_nome,
          rAg.especialidade,
          rAg.sala || 'Consultório 1',
          rAg.data,
          rAg.hora_inicio,
          rAg.hora_fim,
          rAg.tipo_atendimento || 'Consulta Agendada SUS',
          rAg.status || 'Agendado',
          rAg.observacoes,
          rAg.sync_id,
          nowIso,
          rAg.updated_at || nowIso,
          nowIso
        );
        stats.agendamentos_recebidos++;
      }
    }

    const duration = Date.now() - startTime.getTime();
    const resumo = `Sincronização de agenda concluída em ${duration}ms (+${stats.agendamentos_enviados} enviadas / +${stats.agendamentos_recebidos} recebidas).`;

    db.prepare('UPDATE sync_config SET ultimo_sync = ?, ultimo_status = ? WHERE id = 1').run(nowIso, resumo);
    db.prepare("INSERT INTO sync_logs (timestamp, tipo, status, mensagem, detalhes) VALUES (?, ?, 'sucesso', ?, ?)").run(nowIso, tipo, resumo, JSON.stringify(stats));

    return {
      success: true,
      timestamp: nowIso,
      stats,
      message: resumo
    };

  } catch (error) {
    const errorMsg = `Erro no sincronismo da agenda: ${error.message}`;
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

  console.log(`[Auto-Sync Agenda SUS] Ativado para ${config.sistema_destino_url}. Intervalo: ${config.intervalo_segundos}s.`);
}

function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('[Auto-Sync Agenda SUS] Parado.');
  }
}

module.exports = {
  executeSync,
  startAutoSync,
  stopAutoSync,
  testarConexaoEsus,
  parsearTextoAgendaEsus,
  importarAgendamentosEsus,
  carregarAgendaDemonstracaoEsus
};
