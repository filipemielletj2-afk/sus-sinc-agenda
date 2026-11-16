// ============================================================
// SUS-Sinc Agenda & Pacientes - Frontend Client Logic
// ============================================================

let state = {
  pacientes: [],
  agendamentos: [],
  profissionais: [],
  dataSelecionada: new Date().toISOString().split('T')[0],
  syncConfig: null,
  activeTab: 'tab-agenda'
};

let autosavePacTimer = null;
let autosaveAgTimer = null;

// Inicialização ao carregar a página
document.addEventListener('DOMContentLoaded', async () => {
  definirDataHoje();
  await carregarProfissionais();
  await carregarStatusGeral();
  await carregarAgendamentos();
  await carregarPacientes();
  await carregarConfigSync();
  await carregarSyncLogs();

  // Polling leve a cada 10 segundos para manter status em tempo real
  setInterval(async () => {
    await carregarStatusGeral();
    if (state.activeTab === 'tab-agenda') {
      await carregarAgendamentos(true); // silencioso
    }
  }, 10000);
});

// -------------------------------------------------------------
// NAVEGAÇÃO DE ABAS
// -------------------------------------------------------------
function switchTab(tabId) {
  state.activeTab = tabId;

  // Esconder todas as abas
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');

  // Atualizar estilo dos botões
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active', 'text-emerald-700', 'bg-emerald-50', 'border-b-2', 'border-emerald-600');
    btn.classList.add('text-slate-600');
  });

  const activeBtn = document.getElementById(`nav-${tabId.replace('tab-', '')}`);
  if (activeBtn) {
    activeBtn.classList.add('active', 'text-emerald-700', 'bg-emerald-50', 'border-b-2', 'border-emerald-600');
    activeBtn.classList.remove('text-slate-600');
  }

  // Ações específicas ao abrir cada aba
  if (tabId === 'tab-agenda') carregarAgendamentos();
  if (tabId === 'tab-pacientes') carregarPacientes();
  if (tabId === 'tab-sync') {
    carregarConfigSync();
    carregarSyncLogs();
  }
}

// -------------------------------------------------------------
// TOAST E INDICADORES DE AUTOSAVE
// -------------------------------------------------------------
function showToast(message, icon = 'fa-circle-check', isError = false) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');

  msgEl.textContent = message;
  iconEl.className = `fa-solid ${icon} ${isError ? 'text-red-400' : 'text-emerald-400'}`;

  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3500);
}

function showHeaderAutosave(texto, salvando = false) {
  const el = document.getElementById('autosave-indicator');
  const textEl = document.getElementById('autosave-text');

  el.classList.remove('hidden');
  el.classList.add('flex');
  textEl.textContent = texto;

  if (salvando) {
    el.className = 'flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-900/60 text-amber-200 border border-amber-400/30 backdrop-blur-sm';
  } else {
    el.className = 'flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-900/60 text-emerald-200 border border-emerald-400/30 backdrop-blur-sm';
    // Oculta suavemente após 4 segundos
    setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }, 4000);
  }
}

// -------------------------------------------------------------
// CARREGAMENTO DE DADOS & STATUS GERAL
// -------------------------------------------------------------
async function carregarStatusGeral() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.status === 'online') {
      document.getElementById('kpi-total-pacientes').textContent = data.stats.total_pacientes;
      document.getElementById('kpi-agendamentos-hoje').textContent = data.stats.agendamentos_hoje;
      document.getElementById('kpi-pendentes').textContent = data.stats.agendamentos_pendentes;
      document.getElementById('kpi-atendidos').textContent = data.stats.agendamentos_atendidos;
      document.getElementById('kpi-pendentes-sync').textContent = data.stats.pendentes_sync;

      const badgeCount = document.getElementById('badge-sync-count');
      if (data.stats.pendentes_sync > 0) {
        badgeCount.textContent = data.stats.pendentes_sync;
        badgeCount.classList.remove('hidden');
      } else {
        badgeCount.classList.add('hidden');
      }

      // Sync status text
      const syncStatusText = document.getElementById('sync-status-text');
      if (data.sync_config && data.sync_config.auto_sync_enabled) {
        syncStatusText.textContent = `Auto-Sync SUS (${data.sync_config.intervalo_segundos}s)`;
      } else {
        syncStatusText.textContent = 'Auto-Sync Pausado';
      }
    }
  } catch (err) {
    console.error('Erro ao buscar status geral:', err);
  }
}

async function carregarProfissionais() {
  try {
    const res = await fetch('/api/profissionais');
    const data = await res.json();
    state.profissionais = data;

    // Preenche selects
    const filtroSelect = document.getElementById('filtro-profissional');
    const modalSelect = document.getElementById('ag-profissional-id');

    filtroSelect.innerHTML = '<option value="">Todos os Profissionais</option>';
    modalSelect.innerHTML = '<option value="">Selecione o profissional...</option>';

    data.forEach(p => {
      const opt = `<option value="${p.id}" data-nome="${p.nome}" data-esp="${p.especialidade}">${p.nome} (${p.registro} - ${p.especialidade})</option>`;
      filtroSelect.innerHTML += opt;
      modalSelect.innerHTML += opt;
    });
  } catch (err) {
    console.error('Erro ao carregar profissionais:', err);
  }
}

// -------------------------------------------------------------
// AGENDA E AGENDAMENTOS
// -------------------------------------------------------------
function definirDataHoje() {
  const hoje = new Date().toISOString().split('T')[0];
  state.dataSelecionada = hoje;
  document.getElementById('filtro-data').value = hoje;
  atualizarTituloDataAgenda(hoje);
  carregarAgendamentos();
}

function mudarDataRelativa(dias) {
  const d = new Date(state.dataSelecionada + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  const novaData = d.toISOString().split('T')[0];
  state.dataSelecionada = novaData;
  document.getElementById('filtro-data').value = novaData;
  atualizarTituloDataAgenda(novaData);
  carregarAgendamentos();
}

function atualizarTituloDataAgenda(dataIso) {
  const partes = dataIso.split('-');
  const d = new Date(partes[0], partes[1] - 1, partes[2]);
  const formatador = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const titulo = formatador.format(d);
  document.getElementById('agenda-titulo-data').textContent = `Agendamentos • ${titulo.charAt(0).toUpperCase() + titulo.slice(1)}`;
}

async function carregarAgendamentos(silencioso = false) {
  const data = document.getElementById('filtro-data').value;
  state.dataSelecionada = data;
  atualizarTituloDataAgenda(data);

  const profId = document.getElementById('filtro-profissional').value;
  const status = document.getElementById('filtro-status').value;

  const url = new URL('/api/agendamentos', window.location.origin);
  if (data) url.searchParams.set('data', data);
  if (profId) url.searchParams.set('profissional_id', profId);
  if (status) url.searchParams.set('status', status);

  try {
    const res = await fetch(url);
    const agendamentos = await res.json();
    state.agendamentos = agendamentos;
    renderizarTabelaAgendamentos(agendamentos);
  } catch (err) {
    if (!silencioso) console.error('Erro ao carregar agendamentos:', err);
  }
}

function renderizarTabelaAgendamentos(lista) {
  const corpo = document.getElementById('tabela-agendamentos-corpo');
  if (!lista || lista.length === 0) {
    corpo.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-400">
          <i class="fa-regular fa-calendar-xmark text-3xl mb-2 text-slate-300"></i>
          <p class="font-medium text-slate-500">Nenhum agendamento para esta data ou filtro.</p>
          <p class="text-xs text-slate-400 mt-1">Clique em "+ Novo Agendamento" para marcar uma consulta.</p>
        </td>
      </tr>
    `;
    return;
  }

  corpo.innerHTML = lista.map(ag => {
    const statusClass = getStatusBadgeClass(ag.status);
    const syncDot = ag.sync_status === 'synced'
      ? `<span class="inline-flex items-center space-x-1 text-2xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full" title="Sincronizado com o SUS"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>SUS OK</span></span>`
      : `<span class="inline-flex items-center space-x-1 text-2xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse" title="Pendente de envio ao SUS"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Pendente Sync</span></span>`;

    const origemBadge = ag.origem === 'sisreg'
      ? `<span class="text-2xs bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded font-bold">SISREG</span>`
      : ag.origem === 'sus_pec'
      ? `<span class="text-2xs bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded font-bold">e-SUS PEC</span>`
      : `<span class="text-2xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Local</span>`;

    return `
      <tr class="hover:bg-slate-50/70 transition">
        <td class="px-5 py-3 font-mono font-bold text-slate-800 text-xs">
          <div class="flex items-center space-x-1">
            <i class="fa-regular fa-clock text-slate-400"></i>
            <span>${ag.hora_inicio} - ${ag.hora_fim}</span>
          </div>
        </td>
        <td class="px-5 py-3">
          <div class="font-bold text-slate-800">${ag.paciente_nome}</div>
          <div class="text-xs text-slate-400">${ag.tipo_atendimento || 'Consulta'}</div>
        </td>
        <td class="px-5 py-3 text-xs text-slate-600 font-mono">
          <div>${ag.paciente_cns || '<span class="text-slate-300">-</span>'}</div>
        </td>
        <td class="px-5 py-3">
          <div class="font-medium text-slate-700">${ag.profissional_nome}</div>
          <div class="text-xs text-slate-400">${ag.especialidade}</div>
        </td>
        <td class="px-5 py-3 text-xs text-slate-600">
          ${ag.sala || 'Consultório'}
        </td>
        <td class="px-5 py-3">
          <span class="badge-status ${statusClass}">
            ${ag.status}
          </span>
        </td>
        <td class="px-5 py-3">
          <div class="flex flex-col space-y-1">
            <div>${origemBadge}</div>
            <div>${syncDot}</div>
          </div>
        </td>
        <td class="px-5 py-3 text-right">
          <div class="flex items-center justify-end space-x-1.5">
            ${ag.status === 'Agendado' || ag.status === 'Aguardando' ? `
              <button onclick="mudarStatusAgendamentoRapido(${ag.id}, 'Em Atendimento')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Iniciar Atendimento">
                <i class="fa-solid fa-play"></i>
              </button>
            ` : ''}

            ${ag.status === 'Em Atendimento' ? `
              <button onclick="mudarStatusAgendamentoRapido(${ag.id}, 'Atendido')" class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded font-bold" title="Concluir Atendimento">
                <i class="fa-solid fa-check-double"></i>
              </button>
            ` : ''}

            <button onclick="abrirModalEditarAgendamento(${ag.id})" class="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded" title="Editar / Detalhes">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>

            <button onclick="excluirAgendamento(${ag.id})" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remover">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'Agendado': return 'badge-agendado';
    case 'Confirmado': return 'badge-confirmado';
    case 'Aguardando': return 'badge-aguardando';
    case 'Em Atendimento': return 'badge-em-atendimento';
    case 'Atendido': return 'badge-atendido';
    case 'Faltou': return 'badge-faltou';
    case 'Cancelado': return 'badge-cancelado';
    default: return 'badge-agendado';
  }
}

async function mudarStatusAgendamentoRapido(id, novoStatus) {
  try {
    showHeaderAutosave('Salvando status...', true);
    const res = await fetch(`/api/agendamentos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: novoStatus })
    });
    const result = await res.json();
    if (result.success) {
      showHeaderAutosave('Status salvo automaticamente!');
      showToast(`Status atualizado para: ${novoStatus}`);
      await carregarAgendamentos();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao atualizar status', 'fa-triangle-exclamation', true);
  }
}

async function excluirAgendamento(id) {
  if (!confirm('Deseja realmente remover este agendamento?')) return;
  try {
    const res = await fetch(`/api/agendamentos/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Agendamento removido.');
      await carregarAgendamentos();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao remover agendamento', 'fa-triangle-exclamation', true);
  }
}

// -------------------------------------------------------------
// MODAL AGENDAMENTO & AUTOSAVE
// -------------------------------------------------------------
function abrirModalAgendamento() {
  document.getElementById('modal-agendamento-titulo').textContent = 'Novo Agendamento SUS';
  document.getElementById('form-agendamento').reset();
  document.getElementById('ag-id').value = '';
  document.getElementById('ag-data').value = state.dataSelecionada || new Date().toISOString().split('T')[0];
  document.getElementById('ag-hora-inicio').value = '08:00';
  document.getElementById('ag-hora-fim').value = '08:30';

  // Popula pacientes no select
  atualizarSelectPacientesNoAgendamento();

  // Seleciona primeiro profissional se disponível
  const profSelect = document.getElementById('ag-profissional-id');
  if (profSelect.options.length > 1) {
    profSelect.selectedIndex = 1;
    aoSelecionarProfissional(profSelect);
  }

  document.getElementById('modal-ag-status-save').textContent = 'Salvamento automático ativo enquanto você preenche.';
  document.getElementById('modal-agendamento').classList.remove('hidden');
}

function abrirModalEditarAgendamento(id) {
  const ag = state.agendamentos.find(a => a.id === id);
  if (!ag) return;

  document.getElementById('modal-agendamento-titulo').textContent = `Editar Agendamento #${ag.id}`;
  document.getElementById('ag-id').value = ag.id;

  atualizarSelectPacientesNoAgendamento();
  document.getElementById('ag-paciente-id').value = ag.paciente_id || '';
  document.getElementById('ag-profissional-id').value = ag.profissional_id || '';
  document.getElementById('ag-especialidade').value = ag.especialidade || '';
  document.getElementById('ag-data').value = ag.data;
  document.getElementById('ag-hora-inicio').value = ag.hora_inicio;
  document.getElementById('ag-hora-fim').value = ag.hora_fim;
  document.getElementById('ag-sala').value = ag.sala || '';
  document.getElementById('ag-tipo').value = ag.tipo_atendimento || 'Consulta Eletiva';
  document.getElementById('ag-status').value = ag.status || 'Agendado';
  document.getElementById('ag-obs').value = ag.observacoes || '';

  document.getElementById('modal-ag-status-save').textContent = `Salvo no SQLite. Sincronizado: ${ag.sync_status === 'synced' ? 'Sim' : 'Pendente'}`;
  document.getElementById('modal-agendamento').classList.remove('hidden');
}

function fecharModalAgendamento() {
  document.getElementById('modal-agendamento').classList.add('hidden');
  carregarAgendamentos();
  carregarStatusGeral();
}

function atualizarSelectPacientesNoAgendamento() {
  const sel = document.getElementById('ag-paciente-id');
  sel.innerHTML = '<option value="">Selecione um paciente cadastrado...</option>';
  state.pacientes.forEach(p => {
    sel.innerHTML += `<option value="${p.id}" data-nome="${p.nome}" data-cns="${p.cns || ''}">${p.nome} (CNS: ${p.cns || 'S/N'})</option>`;
  });
}

function aoSelecionarPacienteParaAgendamento(selectEl) {
  // Chamado ao trocar o paciente no modal
}

function aoSelecionarProfissional(selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  if (opt && opt.dataset.esp) {
    document.getElementById('ag-especialidade').value = opt.dataset.esp;
  }
}

// Autosave debounced para agendamento
function triggerAutosaveAgendamento() {
  clearTimeout(autosaveAgTimer);
  const statusEl = document.getElementById('modal-ag-status-save');
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-amber-500"></i> Salvando agendamento...';
  showHeaderAutosave('Salvando agendamento...', true);

  autosaveAgTimer = setTimeout(async () => {
    await executarAutosaveAgendamento();
  }, 400);
}

async function executarAutosaveAgendamento() {
  const id = document.getElementById('ag-id').value;
  const pacienteSelect = document.getElementById('ag-paciente-id');
  const profSelect = document.getElementById('ag-profissional-id');

  const pacienteOpt = pacienteSelect.options[pacienteSelect.selectedIndex];
  const pacienteNome = pacienteOpt ? pacienteOpt.dataset.nome : '';
  const pacienteCns = pacienteOpt ? pacienteOpt.dataset.cns : '';

  const profOpt = profSelect.options[profSelect.selectedIndex];
  const profNome = profOpt ? profOpt.dataset.nome : '';

  const dataAg = document.getElementById('ag-data').value;
  const horaInicio = document.getElementById('ag-hora-inicio').value;
  const horaFim = document.getElementById('ag-hora-fim').value;

  // Validação mínima para permitir auto-save
  if (!pacienteNome || !dataAg || !horaInicio || !horaFim) {
    document.getElementById('modal-ag-status-save').textContent = 'Preencha Paciente, Data e Horário para salvar automaticamente.';
    return;
  }

  const payload = {
    paciente_id: pacienteSelect.value ? parseInt(pacienteSelect.value, 10) : null,
    paciente_nome: pacienteNome,
    paciente_cns: pacienteCns,
    profissional_id: profSelect.value ? parseInt(profSelect.value, 10) : null,
    profissional_nome: profNome,
    especialidade: document.getElementById('ag-especialidade').value,
    sala: document.getElementById('ag-sala').value,
    data: dataAg,
    hora_inicio: horaInicio,
    hora_fim: horaFim,
    tipo_atendimento: document.getElementById('ag-tipo').value,
    status: document.getElementById('ag-status').value,
    observacoes: document.getElementById('ag-obs').value
  };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/agendamentos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/agendamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const result = await res.json();
    if (res.ok && (result.agendamento || result.success)) {
      const nowStr = new Date().toLocaleTimeString('pt-BR');
      if (!id && result.agendamento) {
        document.getElementById('ag-id').value = result.agendamento.id;
      }
      document.getElementById('modal-ag-status-save').innerHTML = `<span class="text-emerald-600 font-medium"><i class="fa-solid fa-circle-check"></i> Salvo automaticamente às ${nowStr}</span>`;
      showHeaderAutosave(`Agendamento salvo às ${nowStr}`);
    } else {
      document.getElementById('modal-ag-status-save').innerHTML = `<span class="text-amber-600 font-medium">${result.error || 'Aguardando dados...'}</span>`;
    }
  } catch (err) {
    document.getElementById('modal-ag-status-save').textContent = 'Erro ao salvar automaticamente.';
  }
}

async function salvarAgendamentoManual() {
  await executarAutosaveAgendamento();
  fecharModalAgendamento();
  showToast('Agendamento confirmado e salvo com sucesso!');
}

// -------------------------------------------------------------
// PACIENTES (CADASTRO & AUTOSAVE EM TEMPO REAL)
// -------------------------------------------------------------
async function carregarPacientes(busca = '') {
  try {
    const url = new URL('/api/pacientes', window.location.origin);
    if (busca) url.searchParams.set('q', busca);

    const res = await fetch(url);
    const pacientes = await res.json();
    state.pacientes = pacientes;
    renderizarTabelaPacientes(pacientes);
  } catch (err) {
    console.error('Erro ao carregar pacientes:', err);
  }
}

function pesquisarPacientes() {
  const q = document.getElementById('busca-paciente').value.trim();
  carregarPacientes(q);
}

function renderizarTabelaPacientes(lista) {
  const corpo = document.getElementById('tabela-pacientes-corpo');
  const badge = document.getElementById('contador-pacientes-badge');
  badge.textContent = `${lista.length} Pacientes`;

  if (!lista || lista.length === 0) {
    corpo.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-12 text-slate-400">
          <i class="fa-solid fa-users-slash text-3xl mb-2 text-slate-300"></i>
          <p class="font-medium text-slate-500">Nenhum paciente encontrado.</p>
          <p class="text-xs text-slate-400 mt-1">Clique em "Cadastrar Novo Paciente" para iniciar o registro.</p>
        </td>
      </tr>
    `;
    return;
  }

  corpo.innerHTML = lista.map(p => {
    const idade = calcularIdade(p.data_nascimento);
    const syncStatusBadge = p.sync_status === 'synced'
      ? `<span class="inline-flex items-center space-x-1 text-2xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>Sincronizado SUS</span></span>`
      : `<span class="inline-flex items-center space-x-1 text-2xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Pendente Envio</span></span>`;

    return `
      <tr class="hover:bg-slate-50/70 transition">
        <td class="px-5 py-3">
          <div class="font-bold text-slate-800">${p.nome}</div>
          <div class="text-xs text-slate-400">${p.nome_mae ? `Mãe: ${p.nome_mae}` : 'Mãe não informada'}</div>
        </td>
        <td class="px-5 py-3 font-mono text-xs text-slate-700">
          ${p.cns || '<span class="text-slate-300">Não informado</span>'}
        </td>
        <td class="px-5 py-3 font-mono text-xs text-slate-700">
          ${p.cpf || '<span class="text-slate-300">Não informado</span>'}
        </td>
        <td class="px-5 py-3 text-xs text-slate-600">
          <div>${p.data_nascimento ? formatarDataBr(p.data_nascimento) : '-'}</div>
          <div class="text-2xs text-slate-400">${idade ? `${idade} anos` : ''} • ${p.sexo === 'F' ? 'Fem' : p.sexo === 'M' ? 'Masc' : 'Outro'}</div>
        </td>
        <td class="px-5 py-3 text-xs text-slate-600">
          <div>${p.telefone || '-'}</div>
          <div class="text-2xs text-slate-400 truncate max-w-[150px]">${p.bairro ? `${p.bairro}, ${p.municipio}` : ''}</div>
        </td>
        <td class="px-5 py-3">
          ${syncStatusBadge}
        </td>
        <td class="px-5 py-3 text-right">
          <div class="flex items-center justify-end space-x-1.5">
            <button onclick="agendarDiretoParaPaciente(${p.id})" class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded" title="Agendar Consulta para este Paciente">
              <i class="fa-regular fa-calendar-plus"></i>
            </button>
            <button onclick="abrirModalEditarPaciente(${p.id})" class="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded" title="Editar Ficha / Auto-save">
              <i class="fa-solid fa-user-pen"></i>
            </button>
            <button onclick="excluirPaciente(${p.id})" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remover Paciente">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function calcularIdade(dataNasc) {
  if (!dataNasc) return null;
  const d = new Date(dataNasc);
  const diff = Date.now() - d.getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

function formatarDataBr(isoDate) {
  if (!isoDate) return '';
  const partes = isoDate.split('-');
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

// -------------------------------------------------------------
// MODAL PACIENTE COM AUTOSAVE
// -------------------------------------------------------------
function abrirModalPaciente() {
  document.getElementById('modal-paciente-titulo').textContent = 'Ficha do Cidadão / Paciente SUS';
  document.getElementById('form-paciente').reset();
  document.getElementById('pac-id').value = '';
  document.getElementById('modal-paciente-status-save').textContent = 'Digite os dados. O salvamento acontece automaticamente.';
  document.getElementById('modal-paciente').classList.remove('hidden');
}

async function abrirModalEditarPaciente(id) {
  try {
    const res = await fetch(`/api/pacientes/${id}`);
    const pac = await res.json();
    if (!pac) return;

    document.getElementById('modal-paciente-titulo').textContent = `Ficha do Paciente • ${pac.nome}`;
    document.getElementById('pac-id').value = pac.id;
    document.getElementById('pac-nome').value = pac.nome || '';
    document.getElementById('pac-nome-mae').value = pac.nome_mae || '';
    document.getElementById('pac-cns').value = pac.cns || '';
    document.getElementById('pac-cpf').value = pac.cpf || '';
    document.getElementById('pac-data-nasc').value = pac.data_nascimento || '';
    document.getElementById('pac-sexo').value = pac.sexo || 'F';
    document.getElementById('pac-telefone').value = pac.telefone || '';
    document.getElementById('pac-endereco').value = pac.endereco || '';
    document.getElementById('pac-bairro').value = pac.bairro || '';
    document.getElementById('pac-alergias').value = pac.alergias || '';
    document.getElementById('pac-obs').value = pac.observacoes || '';

    validarEConsistirCNS(document.getElementById('pac-cns'));
    formatarEConsistirCPF(document.getElementById('pac-cpf'));

    document.getElementById('modal-paciente-status-save').textContent = `Registro ativo. Sincronismo SUS: ${pac.sync_status === 'synced' ? 'Sincronizado' : 'Pendente de envio'}`;
    document.getElementById('modal-paciente').classList.remove('hidden');
  } catch (err) {
    showToast('Erro ao abrir paciente', 'fa-triangle-exclamation', true);
  }
}

function fecharModalPaciente() {
  document.getElementById('modal-paciente').classList.add('hidden');
  carregarPacientes();
  carregarStatusGeral();
}

function agendarDiretoParaPaciente(pacienteId) {
  abrirModalAgendamento();
  document.getElementById('ag-paciente-id').value = pacienteId;
}

// Autosave debounced para paciente
function triggerAutosavePaciente() {
  clearTimeout(autosavePacTimer);
  const statusEl = document.getElementById('modal-paciente-status-save');
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-amber-500"></i> Salvando dados do paciente...';
  showHeaderAutosave('Salvando paciente...', true);

  autosavePacTimer = setTimeout(async () => {
    await executarAutosavePaciente();
  }, 400);
}

async function executarAutosavePaciente() {
  const id = document.getElementById('pac-id').value;
  const nome = document.getElementById('pac-nome').value.trim();

  if (!nome || nome.length < 2) {
    document.getElementById('modal-paciente-status-save').textContent = 'Digite ao menos o Nome Completo para salvar automaticamente.';
    return;
  }

  const payload = {
    nome: nome,
    nome_mae: document.getElementById('pac-nome-mae').value.trim(),
    cns: document.getElementById('pac-cns').value.trim(),
    cpf: document.getElementById('pac-cpf').value.trim(),
    data_nascimento: document.getElementById('pac-data-nasc').value,
    sexo: document.getElementById('pac-sexo').value,
    telefone: document.getElementById('pac-telefone').value.trim(),
    endereco: document.getElementById('pac-endereco').value.trim(),
    bairro: document.getElementById('pac-bairro').value.trim(),
    alergias: document.getElementById('pac-alergias').value.trim(),
    observacoes: document.getElementById('pac-obs').value.trim()
  };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/pacientes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/pacientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const result = await res.json();
    if (res.ok && (result.paciente || result.success)) {
      const nowStr = new Date().toLocaleTimeString('pt-BR');
      if (!id && result.paciente) {
        document.getElementById('pac-id').value = result.paciente.id;
      }
      document.getElementById('modal-paciente-status-save').innerHTML = `<span class="text-emerald-600 font-medium"><i class="fa-solid fa-circle-check"></i> Salvo automaticamente às ${nowStr}</span>`;
      showHeaderAutosave(`Paciente salvo às ${nowStr}`);
    } else {
      document.getElementById('modal-paciente-status-save').innerHTML = `<span class="text-red-500 font-medium">${result.error || 'Erro ao salvar'}</span>`;
    }
  } catch (err) {
    document.getElementById('modal-paciente-status-save').textContent = 'Erro ao persistir paciente.';
  }
}

async function salvarPacienteManual() {
  await executarAutosavePaciente();
  fecharModalPaciente();
  showToast('Paciente salvo com sucesso!');
}

async function excluirPaciente(id) {
  if (!confirm('Deseja excluir este paciente? Agendamentos vinculados poderão ser afetados.')) return;
  try {
    const res = await fetch(`/api/pacientes/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Paciente excluído com sucesso.');
      await carregarPacientes();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao excluir paciente', 'fa-triangle-exclamation', true);
  }
}

// -------------------------------------------------------------
// VALIDAÇÕES CNS E CPF
// -------------------------------------------------------------
function validarEConsistirCNS(input) {
  const badge = document.getElementById('cns-valido-badge');
  const clean = input.value.replace(/\D/g, '');
  input.value = clean;

  if (clean.length === 15) {
    const firstDigit = clean[0];
    if (['1', '2', '7', '8', '9'].includes(firstDigit)) {
      badge.innerHTML = '<span class="text-emerald-600 font-bold"><i class="fa-solid fa-check"></i> CNS Válido</span>';
    } else {
      badge.innerHTML = '<span class="text-amber-500 font-bold">Prefixo SUS incomum</span>';
    }
  } else {
    badge.textContent = `${clean.length}/15 dígitos`;
  }
}

function formatarEConsistirCPF(input) {
  const badge = document.getElementById('cpf-valido-badge');
  let v = input.value.replace(/\D/g, '');
  if (v.length > 11) v = v.substring(0, 11);

  if (v.length <= 11) {
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  input.value = v;

  const raw = v.replace(/\D/g, '');
  if (raw.length === 11) {
    if (validarAlgoritmoCPF(raw)) {
      badge.innerHTML = '<span class="text-emerald-600 font-bold"><i class="fa-solid fa-check"></i> CPF Válido</span>';
    } else {
      badge.innerHTML = '<span class="text-red-500 font-bold">CPF Inválido</span>';
    }
  } else {
    badge.textContent = `${raw.length}/11 dígitos`;
  }
}

function validarAlgoritmoCPF(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i)) * (10 - i);
  let resto = 11 - (soma % 11);
  let dv1 = resto === 10 || resto === 11 ? 0 : resto;
  if (dv1 !== parseInt(cpf.charAt(9))) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i)) * (11 - i);
  resto = 11 - (soma % 11);
  let dv2 = resto === 10 || resto === 11 ? 0 : resto;
  return dv2 === parseInt(cpf.charAt(10));
}

// -------------------------------------------------------------
// CENTRAL DE SINCRONISMO SUS
// -------------------------------------------------------------
async function triggerManualSync() {
  const btnIcon = document.getElementById('btn-sync-icon');
  btnIcon.classList.add('fa-spin');

  showHeaderAutosave('Sincronizando com o SUS...', true);

  try {
    const res = await fetch('/api/sync/trigger', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(data.message || 'Sincronização com o SUS concluída!');
      showHeaderAutosave('SUS Sincronizado!');
      await carregarAgendamentos(true);
      await carregarPacientes();
      await carregarStatusGeral();
      await carregarConfigSync();
      await carregarSyncLogs();
    } else {
      showToast(data.error || 'Erro na sincronização', 'fa-triangle-exclamation', true);
    }
  } catch (err) {
    showToast('Falha na comunicação com o sincronizador', 'fa-triangle-exclamation', true);
  } finally {
    btnIcon.classList.remove('fa-spin');
  }
}

async function injetarConsultaSusTeste() {
  try {
    const res = await fetch('/api/mock-sus/injetar-consulta-sus', { method: 'POST' });
    const data = await res.json();
    showToast('Consulta simulada criada no SUS! Executando sincronismo para puxar para sua agenda...');
    // Dispara o sync imediatamente para que o usuário veja a consulta chegar
    setTimeout(() => {
      triggerManualSync();
    }, 600);
  } catch (err) {
    showToast('Erro ao simular consulta do SUS', 'fa-triangle-exclamation', true);
  }
}

async function carregarConfigSync() {
  try {
    const res = await fetch('/api/sync/config');
    const cfg = await res.json();
    state.syncConfig = cfg;

    document.getElementById('cfg-sistema-origem').value = cfg.sistema_origem_nome || '';
    document.getElementById('cfg-sistema-destino').value = cfg.sistema_destino_tipo || 'sus_pec';
    document.getElementById('cfg-url').value = cfg.sistema_destino_url || '';
    document.getElementById('cfg-token').value = cfg.api_token || '';
    document.getElementById('cfg-intervalo').value = cfg.intervalo_segundos || 60;
    document.getElementById('cfg-politica').value = cfg.politica_conflito || 'mais_recente';
    document.getElementById('cfg-auto-sync').checked = Boolean(cfg.auto_sync_enabled);

    document.getElementById('cfg-ultimo-sync').textContent = cfg.ultimo_sync ? formatarTimestamp(cfg.ultimo_sync) : 'Nunca';
    document.getElementById('cfg-ultimo-status').textContent = cfg.ultimo_status || 'Aguardando sincronismo';
  } catch (err) {
    console.error('Erro ao carregar configurações de sync:', err);
  }
}

async function salvarConfigSync(e) {
  e.preventDefault();
  const payload = {
    sistema_origem_nome: document.getElementById('cfg-sistema-origem').value,
    sistema_destino_tipo: document.getElementById('cfg-sistema-destino').value,
    sistema_destino_url: document.getElementById('cfg-url').value,
    api_token: document.getElementById('cfg-token').value,
    intervalo_segundos: parseInt(document.getElementById('cfg-intervalo').value, 10),
    politica_conflito: document.getElementById('cfg-politica').value,
    auto_sync_enabled: document.getElementById('cfg-auto-sync').checked ? 1 : 0,
    simulador_sus_ativo: 1
  };

  try {
    const res = await fetch('/api/sync/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Configurações de sincronização salvas com sucesso!');
      await carregarConfigSync();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao salvar configurações', 'fa-triangle-exclamation', true);
  }
}

async function carregarSyncLogs() {
  try {
    const res = await fetch('/api/sync/logs');
    const logs = await res.json();
    const corpo = document.getElementById('tabela-logs-corpo');

    if (!logs || logs.length === 0) {
      corpo.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-slate-400">Nenhum registro de sincronização.</td></tr>';
      return;
    }

    corpo.innerHTML = logs.map(l => {
      const statusBadge = l.status === 'sucesso'
        ? '<span class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">Sucesso</span>'
        : '<span class="text-red-700 bg-red-50 px-2 py-0.5 rounded font-bold">Erro</span>';

      return `
        <tr class="hover:bg-slate-50">
          <td class="px-4 py-2 font-mono text-slate-600">${formatarTimestamp(l.timestamp)}</td>
          <td class="px-4 py-2 uppercase font-bold text-slate-500">${l.tipo}</td>
          <td class="px-4 py-2">${statusBadge}</td>
          <td class="px-4 py-2 text-slate-700">${l.mensagem}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
}

function formatarTimestamp(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  return d.toLocaleString('pt-BR');
}
