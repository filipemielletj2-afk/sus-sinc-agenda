// ============================================================
// e-SUS APS • Agenda PEC (Capítulo 4 - Formato Oficial do Manual)
// ============================================================

let state = {
  pacientes: [],
  agendamentos: [],
  profissionais: [],
  profissionalSelecionado: null,
  dataSelecionada: new Date().toISOString().split('T')[0],
  syncConfig: null,
  activeTab: 'tab-agenda',
  tipoModalAgendamento: 'consulta',
  ultimoAgendamentoSalvo: null
};

let autosavePacTimer = null;
let autosaveAgTimer = null;

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
  definirDataHoje();
  await carregarProfissionais();
  await carregarStatusGeral();
  await carregarPacientes();
  await carregarAgendamentos();
  await carregarConfigSync();
  await carregarSyncLogs();

  // Polling leve a cada 10 segundos para status em tempo real
  setInterval(async () => {
    await carregarStatusGeral();
    if (state.activeTab === 'tab-agenda') {
      await carregarAgendamentos(true);
    }
  }, 10000);
});

// -------------------------------------------------------------
// NAVEGAÇÃO DE ABAS
// -------------------------------------------------------------
function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active', 'text-emerald-800', 'bg-emerald-50', 'border-b-2', 'border-emerald-600', 'font-bold');
    btn.classList.add('text-slate-600', 'font-semibold');
  });

  const activeBtn = document.getElementById(`nav-${tabId.replace('tab-', '')}`);
  if (activeBtn) {
    activeBtn.classList.add('active', 'text-emerald-800', 'bg-emerald-50', 'border-b-2', 'border-emerald-600', 'font-bold');
    activeBtn.classList.remove('text-slate-600', 'font-semibold');
  }

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
    el.className = 'flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-900/80 text-amber-200 border border-amber-400/30 backdrop-blur-sm';
  } else {
    el.className = 'flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-900/80 text-emerald-200 border border-emerald-400/30 backdrop-blur-sm';
    setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }, 4000);
  }
}

// -------------------------------------------------------------
// PROFISSIONAIS & ACESSO RÁPIDO (SEÇÃO 4.8 DO MANUAL)
// -------------------------------------------------------------
async function carregarProfissionais() {
  try {
    const res = await fetch('/api/profissionais');
    const data = await res.json();
    state.profissionais = data;

    const filtroSelect = document.getElementById('filtro-profissional');
    const modalSelect = document.getElementById('ag-profissional-id');
    const modalConvidado = document.getElementById('ag-profissional-convidado-id');

    filtroSelect.innerHTML = '<option value="">Todos os Profissionais</option>';
    modalSelect.innerHTML = '<option value="">Selecione o profissional titular...</option>';
    modalConvidado.innerHTML = '<option value="">Selecione o profissional convidado...</option>';

    data.forEach(p => {
      const pinIcon = p.fixado ? ' ⭐' : '';
      const opt = `<option value="${p.id}" data-nome="${p.nome}" data-cbo="${p.cbo || ''}" data-esp="${p.especialidade}">${p.nome}${pinIcon} (${p.registro} - ${p.especialidade})</option>`;
      filtroSelect.innerHTML += opt;
      modalSelect.innerHTML += opt;
      modalConvidado.innerHTML += opt;
    });

    // Se houver profissional fixado (Seção 4.8), seleciona ele automaticamente
    const fixado = data.find(p => p.fixado === 1);
    if (fixado) {
      filtroSelect.value = fixado.id;
      state.profissionalSelecionado = fixado;
      atualizarSubtituloProfissional(fixado);
      document.getElementById('btn-fixar-prof').classList.add('text-amber-500', 'bg-amber-50');
    } else if (data.length > 0) {
      atualizarSubtituloProfissional(data[0]);
    }
  } catch (err) {
    console.error('Erro ao carregar profissionais:', err);
  }
}

function aoTrocarProfissionalAgenda() {
  const select = document.getElementById('filtro-profissional');
  const profId = select.value;
  const btnPin = document.getElementById('btn-fixar-prof');

  if (profId) {
    const prof = state.profissionais.find(p => p.id == profId);
    state.profissionalSelecionado = prof;
    atualizarSubtituloProfissional(prof);
    if (prof && prof.fixado) {
      btnPin.classList.add('text-amber-500', 'bg-amber-50');
    } else {
      btnPin.classList.remove('text-amber-500', 'bg-amber-50');
    }
  } else {
    state.profissionalSelecionado = null;
    document.getElementById('agenda-subtitulo-prof').textContent = 'UBS Imbuia • Equipe de Saúde da Família (Todos os Profissionais)';
    btnPin.classList.remove('text-amber-500', 'bg-amber-50');
  }

  carregarAgendamentos();
}

function atualizarSubtituloProfissional(prof) {
  if (!prof) return;
  document.getElementById('agenda-subtitulo-prof').textContent = 
    `UBS Imbuia • ${prof.nome} (${prof.cargo || prof.especialidade} • CBO: ${prof.cbo || '2251-42'}) • CNES: 2548920`;
}

async function fixarProfissionalAtual() {
  const select = document.getElementById('filtro-profissional');
  const profId = select.value;
  if (!profId) {
    showToast('Selecione um profissional para fixar no acesso rápido.', 'fa-triangle-exclamation', true);
    return;
  }

  try {
    const res = await fetch(`/api/profissionais/${profId}/fixar`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Profissional fixado! A agenda abrirá nele automaticamente.');
      await carregarProfissionais();
    }
  } catch (err) {
    showToast('Erro ao fixar profissional', 'fa-triangle-exclamation', true);
  }
}

// -------------------------------------------------------------
// CONTROLE DE DATAS
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
  document.getElementById('agenda-titulo-data').innerHTML = `
    <span>Agenda Diária • ${titulo.charAt(0).toUpperCase() + titulo.slice(1)}</span>
  `;
}

// -------------------------------------------------------------
// GRADE DA AGENDA (FORMATO OFICIAL DO e-SUS PEC CAPÍTULO 4)
// -------------------------------------------------------------
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
  const badgeTotal = document.getElementById('agenda-total-vagas-badge');
  badgeTotal.textContent = `${lista ? lista.length : 0} Agendamentos`;

  if (!lista || lista.length === 0) {
    corpo.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-400">
          <i class="fa-regular fa-calendar-xmark text-3xl mb-2 text-slate-300"></i>
          <p class="font-bold text-slate-600">Nenhum agendamento para esta data ou filtro.</p>
          <p class="text-2xs text-slate-400 mt-1">Utilize "Adicionar Agendamento" ou "Reservar Horário" para marcar.</p>
        </td>
      </tr>
    `;
    return;
  }

  corpo.innerHTML = lista.map(ag => {
    const isReserva = ag.tipo_agendamento === 'reserva' || ag.status === 'Reservado';
    const isEntreProf = ag.tipo_agendamento === 'entre_profissionais' || ag.profissional_convidado_nome;
    const isForaUbs = ag.fora_ubs == 1;

    // Badges de status oficial
    const statusClass = isReserva ? 'badge-reservado' : getStatusBadgeClass(ag.status);

    // Badges de Sincronização e-SUS APS (Seção 4.1.4.1 do manual)
    let syncBadge = '';
    if (!ag.paciente_cns && !isReserva) {
      syncBadge = `<span class="inline-flex items-center space-x-1 text-3xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full" title="Cidadão sem CNS cadastrado (Seção 4.1.4.1)"><span class="w-1.5 h-1.5 rounded-full bg-red-500"></span><span>Sem CNS</span></span>`;
    } else if (ag.paciente_cns && String(ag.paciente_cns).startsWith('7')) {
      syncBadge = `<span class="inline-flex items-center space-x-1 text-3xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full" title="Cidadão sem CNS definitivo / provisório (Seção 4.1.4.1)"><span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span><span>CNS Provisório</span></span>`;
    } else if (ag.sync_status === 'synced') {
      syncBadge = `<span class="inline-flex items-center space-x-1 text-3xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full" title="Sincronizado com e-SUS PEC (Seção 4.1.4.1)"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>Sincronizado</span></span>`;
    } else {
      syncBadge = `<span class="inline-flex items-center space-x-1 text-3xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse" title="Aguardando sincronização (Seção 4.1.4.1)"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Aguardando Sync</span></span>`;
    }

    // Sinalizador Entre Profissionais (Seção 4.7)
    const entreProfTag = isEntreProf 
      ? `<span class="text-3xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.2 rounded font-bold flex items-center space-x-1 w-max mt-0.5"><i class="fa-solid fa-users"></i><span>Entre Profissionais: ${ag.profissional_convidado_nome || ''}</span></span>`
      : '';

    // Sinalizador Fora da UBS (Seção 4.1.1)
    const foraUbsTag = isForaUbs
      ? `<span class="text-3xs bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded font-bold flex items-center space-x-1 w-max mt-0.5"><i class="fa-solid fa-house-user"></i><span>Fora da UBS: ${ag.local_fora_ubs || 'Visita Domiciliar'}</span></span>`
      : '';

    // Linha de Reserva de Horário (Seção 4.2)
    if (isReserva) {
      return `
        <tr class="bg-amber-50/40 hover:bg-amber-50/70 transition border-l-4 border-l-amber-400">
          <td class="px-4 py-2.5 font-mono font-bold text-amber-900 text-xs">
            <i class="fa-solid fa-lock text-amber-500 mr-1"></i>${ag.hora_inicio} - ${ag.hora_fim}
          </td>
          <td class="px-4 py-2.5">
            <div class="font-bold text-amber-900">${ag.paciente_nome}</div>
            <div class="text-2xs text-amber-700">${ag.observacoes || 'Horário reservado para atividade interna'}</div>
          </td>
          <td class="px-4 py-2.5 text-2xs text-slate-400 italic font-mono">-</td>
          <td class="px-4 py-2.5 text-xs text-slate-700 font-medium">${ag.profissional_nome}</td>
          <td class="px-4 py-2.5 text-xs text-slate-600">${ag.sala || 'Geral'}</td>
          <td class="px-4 py-2.5"><span class="badge-status badge-reservado">Reservado</span></td>
          <td class="px-4 py-2.5 text-2xs text-slate-400">Agenda Local</td>
          <td class="px-4 py-2.5 text-right">
            <button onclick="excluirAgendamento(${ag.id})" class="p-1.5 text-slate-400 hover:text-red-600 rounded" title="Liberar Horário">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `;
    }

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-3 font-mono font-bold text-slate-800 text-xs">
          <div class="flex items-center space-x-1">
            <i class="fa-regular fa-clock text-slate-400 text-2xs"></i>
            <span>${ag.hora_inicio} - ${ag.hora_fim}</span>
          </div>
        </td>
        <td class="px-4 py-3">
          <div class="font-bold text-slate-900 hover:text-emerald-700 cursor-pointer" onclick="visualizarDadosCidadao(${ag.paciente_id})">
            ${ag.paciente_nome}
          </div>
          <div class="text-2xs text-slate-500">${ag.tipo_atendimento || 'Consulta Eletiva'}</div>
          ${entreProfTag}
          ${foraUbsTag}
        </td>
        <td class="px-4 py-3 text-xs font-mono text-slate-700">
          <div>${ag.paciente_cns || '<span class="text-red-400 text-2xs">Não informado</span>'}</div>
        </td>
        <td class="px-4 py-3">
          <div class="font-medium text-slate-800">${ag.profissional_nome}</div>
          <div class="text-2xs text-slate-400">${ag.especialidade}</div>
        </td>
        <td class="px-4 py-3 text-xs text-slate-600">
          ${ag.sala || 'Consultório 1'}
        </td>
        <td class="px-4 py-3">
          <span class="badge-status ${statusClass}">
            ${ag.status}
          </span>
          ${ag.na_lista_atendimento ? '<span class="block text-3xs text-emerald-700 font-bold mt-0.5"><i class="fa-solid fa-check"></i> Na Lista</span>' : ''}
        </td>
        <td class="px-4 py-3">
          ${syncBadge}
        </td>
        <td class="px-4 py-3 text-right">
          <!-- Ações Oficiais do Capítulo 4 do Manual e-SUS PEC -->
          <div class="flex items-center justify-end space-x-1">
            
            <!-- 4.1.2 Adicionar à Lista de Atendimentos -->
            ${ag.status === 'Agendado' && !ag.na_lista_atendimento ? `
              <button onclick="adicionarAListaDeAtendimentos(${ag.id})" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Adicionar à Lista de Atendimentos da Recepção (Seção 4.1.2)">
                <i class="fa-solid fa-clipboard-list"></i>
              </button>
            ` : ''}

            <!-- Iniciar Atendimento no Consultório -->
            ${ag.status === 'Aguardando' ? `
              <button onclick="mudarStatusAgendamentoRapido(${ag.id}, 'Em Atendimento')" class="p-1.5 text-purple-600 hover:bg-purple-50 rounded" title="Chamar para o Consultório">
                <i class="fa-solid fa-play"></i>
              </button>
            ` : ''}

            ${ag.status === 'Em Atendimento' ? `
              <button onclick="mudarStatusAgendamentoRapido(${ag.id}, 'Atendido')" class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded font-bold" title="Finalizar Atendimento">
                <i class="fa-solid fa-check-double"></i>
              </button>
            ` : ''}

            <!-- 4.4 Imprimir Comprovante de Agendamento -->
            <button onclick="imprimirComprovanteAgendamento(${ag.id})" class="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded" title="Imprimir Comprovante do Cidadão (Seção 4.4)">
              <i class="fa-solid fa-print"></i>
            </button>

            <!-- 4.1.3 Visualizar Dados / Editar -->
            <button onclick="abrirModalEditarAgendamento(${ag.id})" class="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded" title="Visualizar / Editar Agendamento (Seção 4.1.3)">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>

            <!-- 4.1.6 Informar Falta -->
            ${ag.status === 'Agendado' || ag.status === 'Aguardando' ? `
              <button onclick="informarFaltaCidadao(${ag.id})" class="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded" title="Informar que o Cidadão Faltou (Seção 4.1.6)">
                <i class="fa-solid fa-user-xmark"></i>
              </button>
            ` : ''}

            <!-- 4.1.5 Cancelar com Justificativa -->
            ${ag.status !== 'Cancelado' && ag.status !== 'Atendido' ? `
              <button onclick="abrirModalCancelamento(${ag.id})" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Cancelar Agendamento (Seção 4.1.5)">
                <i class="fa-solid fa-ban"></i>
              </button>
            ` : ''}

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
    case 'Reservado': return 'badge-reservado';
    default: return 'badge-agendado';
  }
}

// -------------------------------------------------------------
// AÇÕES DO MANUAL e-SUS PEC (CAPÍTULO 4)
// -------------------------------------------------------------

// 4.1.2 Adicionar Cidadão na Lista de Atendimentos
async function adicionarAListaDeAtendimentos(id) {
  try {
    const res = await fetch(`/api/agendamentos/${id}/lista-atendimentos`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Cidadão adicionado à Lista de Atendimentos da Recepção!');
      await carregarAgendamentos();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao adicionar à lista', 'fa-triangle-exclamation', true);
  }
}

// 4.1.6 Informar que o Cidadão Faltou
async function informarFaltaCidadao(id) {
  if (!confirm('Registrar que o cidadão não compareceu à consulta?')) return;
  try {
    const res = await fetch(`/api/agendamentos/${id}/faltou`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Falta registrada na agenda!');
      await carregarAgendamentos();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao registrar falta', 'fa-triangle-exclamation', true);
  }
}

// 4.1.5 Cancelar Agendamento com Justificativa
function abrirModalCancelamento(id) {
  document.getElementById('cancel-ag-id').value = id;
  document.getElementById('cancel-justificativa').value = '';
  document.getElementById('modal-cancelamento').classList.remove('hidden');
}

function fecharModalCancelamento() {
  document.getElementById('modal-cancelamento').classList.add('hidden');
}

async function confirmarCancelamentoAgendamento() {
  const id = document.getElementById('cancel-ag-id').value;
  const motivo = document.getElementById('cancel-justificativa').value || document.getElementById('cancel-motivo-select').value;

  try {
    const res = await fetch(`/api/agendamentos/${id}/cancelar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ justificativa: motivo })
    });
    const data = await res.json();
    if (data.success) {
      fecharModalCancelamento();
      showToast('Agendamento cancelado com justificativa registrada.');
      await carregarAgendamentos();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao cancelar agendamento', 'fa-triangle-exclamation', true);
  }
}

// 4.4 Imprimir Comprovante de Agendamento Oficial
function imprimirComprovanteAgendamento(id) {
  const ag = state.agendamentos.find(a => a.id === id);
  if (!ag) return;

  document.getElementById('comp-unidade').textContent = 'UBS Imbuia / SC';
  document.getElementById('comp-cnes').textContent = '2548920';
  document.getElementById('comp-emissao').textContent = new Date().toLocaleString('pt-BR');
  document.getElementById('comp-status').textContent = ag.status || 'Confirmado';
  document.getElementById('comp-paciente-nome').textContent = ag.paciente_nome;
  document.getElementById('comp-paciente-cns').textContent = ag.paciente_cns || 'Não informado';
  document.getElementById('comp-paciente-nasc').textContent = formatarDataBr(ag.data_nascimento) || '-';
  document.getElementById('comp-data').textContent = formatarDataBr(ag.data);
  document.getElementById('comp-hora').textContent = `${ag.hora_inicio} às ${ag.hora_fim}`;
  document.getElementById('comp-profissional').textContent = ag.profissional_nome;
  document.getElementById('comp-especialidade').textContent = ag.especialidade;
  document.getElementById('comp-sala').textContent = ag.sala || 'Consultório 1';

  document.getElementById('modal-comprovante').classList.remove('hidden');
}

function fecharModalComprovante() {
  document.getElementById('modal-comprovante').classList.add('hidden');
}

function imprimirElementoComprovante() {
  window.print();
}

// 4.3 Imprimir a Agenda do Profissional
function imprimirAgendaProfissional() {
  const profSelect = document.getElementById('filtro-profissional');
  const profNome = profSelect.options[profSelect.selectedIndex].text;
  const dataFiltro = document.getElementById('filtro-data').value;

  showToast(`Gerando folha de impressão da agenda de ${profNome}...`);
  window.print();
}

// 4.1.7 Pesquisar por Cidadão na Agenda
function abrirModalPesquisaCidadaoAgenda() {
  document.getElementById('campo-pesquisa-cidadao-agenda').value = '';
  document.getElementById('tabela-pesquisa-cidadao-corpo').innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400">Digite o nome ou CNS para buscar agendamentos.</td></tr>';
  document.getElementById('modal-pesquisa-cidadao').classList.remove('hidden');
}

function fecharModalPesquisaCidadao() {
  document.getElementById('modal-pesquisa-cidadao').classList.add('hidden');
}

async function executarPesquisaCidadaoAgenda() {
  const q = document.getElementById('campo-pesquisa-cidadao-agenda').value.trim();
  const corpo = document.getElementById('tabela-pesquisa-cidadao-corpo');
  if (q.length < 2) return;

  try {
    const res = await fetch(`/api/pesquisa-cidadao-agenda?q=${encodeURIComponent(q)}`);
    const ags = await res.json();

    if (!ags || ags.length === 0) {
      corpo.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">Nenhum agendamento encontrado para este cidadão.</td></tr>';
      return;
    }

    corpo.innerHTML = ags.map(a => `
      <tr class="hover:bg-slate-50">
        <td class="p-2 font-mono font-bold">${formatarDataBr(a.data)} ${a.hora_inicio}</td>
        <td class="p-2 font-bold">${a.paciente_nome}</td>
        <td class="p-2">${a.profissional_nome}</td>
        <td class="p-2"><span class="badge-status ${getStatusBadgeClass(a.status)}">${a.status}</span></td>
        <td class="p-2 text-right">
          <button onclick="imprimirComprovanteAgendamento(${a.id})" class="text-emerald-700 hover:underline">Comprovante</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    corpo.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Erro na busca.</td></tr>';
  }
}

// 4.6 Facilidades no Agendamento de Consultas de Pré-Natal
function abrirModalPreNatal() {
  const sel = document.getElementById('pn-paciente-id');
  sel.innerHTML = '<option value="">Selecione a gestante...</option>';
  state.pacientes.filter(p => p.sexo === 'F').forEach(p => {
    sel.innerHTML += `<option value="${p.id}" data-nome="${p.nome}" data-cns="${p.cns || ''}">${p.nome} (CNS: ${p.cns || 'S/N'})</option>`;
  });

  const hoje = new Date();
  hoje.setDate(hoje.getDate() - 56); // ~8 semanas atrás como sugestão de DUM
  document.getElementById('pn-dum').value = hoje.toISOString().split('T')[0];
  calcularCronogramaPreNatal();
  document.getElementById('modal-prenatal').classList.remove('hidden');
}

function fecharModalPreNatal() {
  document.getElementById('modal-prenatal').classList.add('hidden');
}

async function calcularCronogramaPreNatal() {
  const dum = document.getElementById('pn-dum').value;
  if (!dum) return;

  try {
    const res = await fetch('/api/pre-natal/cronograma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dum })
    });
    const data = await res.json();
    const corpo = document.getElementById('pn-cronograma-corpo');

    if (data.cronograma) {
      state.cronogramaPreNatalAtual = data.cronograma;
      corpo.innerHTML = data.cronograma.map(c => `
        <tr class="hover:bg-pink-50/50">
          <td class="p-2 font-bold text-pink-900">${c.semana_gestacional}</td>
          <td class="p-2 font-mono font-bold">${formatarDataBr(c.data_sugerida)}</td>
          <td class="p-2">${c.tipo_profissional}</td>
          <td class="p-2 text-slate-700">${c.tipo_consulta}</td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error('Erro ao calcular pré-natal:', e);
  }
}

async function agendarLotePreNatal() {
  const pacSelect = document.getElementById('pn-paciente-id');
  const pacId = pacSelect.value;
  if (!pacId) {
    showToast('Selecione uma gestante.', 'fa-triangle-exclamation', true);
    return;
  }
  const pacOpt = pacSelect.options[pacSelect.selectedIndex];
  const pacNome = pacOpt.dataset.nome;
  const pacCns = pacOpt.dataset.cns;

  if (!state.cronogramaPreNatalAtual || state.cronogramaPreNatalAtual.length === 0) return;

  showToast('Criando consultas programadas de pré-natal...');
  fecharModalPreNatal();

  // Agenda os primeiros 3 atendimentos sugeridos
  for (const item of state.cronogramaPreNatalAtual.slice(0, 3)) {
    await fetch('/api/agendamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paciente_id: parseInt(pacId, 10),
        paciente_nome: pacNome,
        paciente_cns: pacCns,
        profissional_nome: item.tipo_profissional.includes('Médico') ? 'Dr. Carlos Eduardo Ramos' : 'Enf. Roberta Albuquerque',
        especialidade: item.tipo_consulta,
        data: item.data_sugerida,
        hora_inicio: '09:00',
        hora_fim: '09:30',
        tipo_atendimento: item.tipo_consulta,
        status: 'Agendado'
      })
    });
  }

  showToast('Consultas de pré-natal agendadas com sucesso!');
  await carregarAgendamentos();
  await carregarStatusGeral();
}

// -------------------------------------------------------------
// MODAL AGENDAMENTO COM 3 ABAS (CONSULTA, RESERVA, ENTRE PROFISSIONAIS)
// -------------------------------------------------------------
function abrirModalAgendamento(tipo = 'consulta') {
  document.getElementById('form-agendamento').reset();
  document.getElementById('ag-id').value = '';
  document.getElementById('ag-data').value = state.dataSelecionada || new Date().toISOString().split('T')[0];
  document.getElementById('ag-hora-inicio').value = '08:00';
  document.getElementById('ag-hora-fim').value = '08:30';

  atualizarSelectPacientesNoAgendamento();

  // Seleciona profissional titular ativo na tela
  const profSelect = document.getElementById('ag-profissional-id');
  if (state.profissionalSelecionado) {
    profSelect.value = state.profissionalSelecionado.id;
    aoSelecionarProfissional(profSelect);
  } else if (profSelect.options.length > 1) {
    profSelect.selectedIndex = 1;
    aoSelecionarProfissional(profSelect);
  }

  trocarAbaModalAgendamento(tipo);
  document.getElementById('modal-ag-status-save').textContent = 'Preencha os campos para salvar no padrão e-SUS PEC.';
  document.getElementById('modal-agendamento').classList.remove('hidden');
}

function abrirModalReservaHorario() {
  abrirModalAgendamento('reserva');
}

function trocarAbaModalAgendamento(tipo) {
  state.tipoModalAgendamento = tipo;
  document.getElementById('ag-tipo-modal').value = tipo;

  const pConsulta = document.getElementById('painel-modal-consulta');
  const pReserva = document.getElementById('painel-modal-reserva');
  const pEntre = document.getElementById('painel-modal-entre');

  const bConsulta = document.getElementById('tab-modal-consulta');
  const bReserva = document.getElementById('tab-modal-reserva');
  const bEntre = document.getElementById('tab-modal-entre');

  // Reset classes das abas
  [bConsulta, bReserva, bEntre].forEach(b => {
    b.className = 'px-4 py-2 rounded-t-lg text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 flex items-center space-x-1.5 transition';
  });

  pConsulta.classList.add('hidden');
  pReserva.classList.add('hidden');
  pEntre.classList.add('hidden');

  if (tipo === 'reserva') {
    pReserva.classList.remove('hidden');
    bReserva.className = 'px-4 py-2 rounded-t-lg bg-white border-t border-l border-r border-slate-300 text-amber-800 font-bold flex items-center space-x-1.5 transition';
    document.getElementById('modal-agendamento-titulo').textContent = 'Reservar Horário na Agenda (Seção 4.2)';
  } else if (tipo === 'entre_profissionais') {
    pEntre.classList.remove('hidden');
    bEntre.className = 'px-4 py-2 rounded-t-lg bg-white border-t border-l border-r border-slate-300 text-indigo-800 font-bold flex items-center space-x-1.5 transition';
    document.getElementById('modal-agendamento-titulo').textContent = 'Agendamento Entre Profissionais (Seção 4.7)';
  } else {
    pConsulta.classList.remove('hidden');
    bConsulta.className = 'px-4 py-2 rounded-t-lg bg-white border-t border-l border-r border-slate-300 text-emerald-800 font-bold flex items-center space-x-1.5 transition';
    document.getElementById('modal-agendamento-titulo').textContent = 'Agendar Consulta (Seção 4.1)';
  }
}

function toggleForaUbs(check) {
  const div = document.getElementById('div-local-fora-ubs');
  if (check.checked) {
    div.classList.remove('hidden');
  } else {
    div.classList.add('hidden');
  }
}

function fecharModalAgendamento() {
  document.getElementById('modal-agendamento').classList.add('hidden');
  carregarAgendamentos();
  carregarStatusGeral();
}

function atualizarSelectPacientesNoAgendamento() {
  const sel1 = document.getElementById('ag-paciente-id');
  const sel2 = document.getElementById('ag-paciente-id-entre');

  sel1.innerHTML = '<option value="">Selecione o cidadão cadastrado...</option>';
  sel2.innerHTML = '<option value="">Selecione o cidadão cadastrado...</option>';

  state.pacientes.forEach(p => {
    const opt = `<option value="${p.id}" data-nome="${p.nome}" data-cns="${p.cns || ''}">${p.nome} (CNS: ${p.cns || 'S/N'} • Nasc: ${formatarDataBr(p.data_nascimento)})</option>`;
    sel1.innerHTML += opt;
    sel2.innerHTML += opt;
  });
}

function aoSelecionarPacienteParaAgendamento(selectEl) {}

function aoSelecionarProfissional(selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  if (opt && opt.dataset.esp) {
    document.getElementById('ag-especialidade').value = opt.dataset.esp;
  }
}

// Autosave debounced para agendamento
function triggerAutosaveAgendamento() {
  clearTimeout(autosaveAgTimer);
  showHeaderAutosave('Salvando agendamento...', true);

  autosaveAgTimer = setTimeout(async () => {
    await executarAutosaveAgendamento();
  }, 400);
}

async function executarAutosaveAgendamento() {
  const id = document.getElementById('ag-id').value;
  const tipoModal = state.tipoModalAgendamento || 'consulta';

  let pacienteNome = '';
  let pacienteId = null;
  let pacienteCns = '';

  if (tipoModal === 'reserva') {
    pacienteNome = `[RESERVA] ${document.getElementById('ag-motivo-reserva').value}`;
  } else if (tipoModal === 'entre_profissionais') {
    const selEntre = document.getElementById('ag-paciente-id-entre');
    const optEntre = selEntre.options[selEntre.selectedIndex];
    pacienteNome = optEntre ? optEntre.dataset.nome : '';
    pacienteId = selEntre.value ? parseInt(selEntre.value, 10) : null;
    pacienteCns = optEntre ? optEntre.dataset.cns : '';
  } else {
    const selPac = document.getElementById('ag-paciente-id');
    const optPac = selPac.options[selPac.selectedIndex];
    pacienteNome = optPac ? optPac.dataset.nome : '';
    pacienteId = selPac.value ? parseInt(selPac.value, 10) : null;
    pacienteCns = optPac ? optPac.dataset.cns : '';
  }

  const profSelect = document.getElementById('ag-profissional-id');
  const profOpt = profSelect.options[profSelect.selectedIndex];
  const profNome = profOpt ? profOpt.dataset.nome : 'Médico de Família';

  const profConvidadoSelect = document.getElementById('ag-profissional-convidado-id');
  const profConvidadoOpt = profConvidadoSelect.options[profConvidadoSelect.selectedIndex];
  const profConvidadoNome = profConvidadoOpt ? profConvidadoOpt.dataset.nome : null;

  const dataAg = document.getElementById('ag-data').value;
  const horaInicio = document.getElementById('ag-hora-inicio').value;
  const horaFim = document.getElementById('ag-hora-fim').value;

  if (tipoModal !== 'reserva' && !pacienteNome) return;
  if (!dataAg || !horaInicio || !horaFim) return;

  const payload = {
    tipo_agendamento: tipoModal,
    paciente_id: pacienteId,
    paciente_nome: pacienteNome,
    paciente_cns: pacienteCns,
    profissional_id: profSelect.value ? parseInt(profSelect.value, 10) : null,
    profissional_nome: profNome,
    profissional_convidado_id: profConvidadoSelect.value ? parseInt(profConvidadoSelect.value, 10) : null,
    profissional_convidado_nome: profConvidadoNome,
    especialidade: document.getElementById('ag-especialidade').value,
    sala: document.getElementById('ag-sala').value,
    data: dataAg,
    hora_inicio: horaInicio,
    hora_fim: horaFim,
    tipo_atendimento: document.getElementById('ag-tipo').value,
    status: tipoModal === 'reserva' ? 'Reservado' : 'Agendado',
    observacoes: document.getElementById('ag-obs').value,
    fora_ubs: document.getElementById('ag-fora-ubs').checked ? 1 : 0,
    local_fora_ubs: document.getElementById('ag-local-fora-ubs').value,
    motivo_reserva: document.getElementById('ag-motivo-reserva').value
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
        state.ultimoAgendamentoSalvo = result.agendamento;
      }
      document.getElementById('modal-ag-status-save').innerHTML = `<span class="text-emerald-700 font-bold"><i class="fa-solid fa-circle-check"></i> Salvo automaticamente às ${nowStr}</span>`;
      showHeaderAutosave(`Salvo às ${nowStr}`);
    }
  } catch (err) {
    document.getElementById('modal-ag-status-save').textContent = 'Erro ao salvar.';
  }
}

async function salvarAgendamentoManual() {
  await executarAutosaveAgendamento();
  const deveImprimir = document.getElementById('ag-check-imprimir').checked;
  const agSalvo = state.ultimoAgendamentoSalvo;

  fecharModalAgendamento();
  showToast('Agendamento confirmado e salvo com sucesso!');

  // Se a opção oficial "Imprimir comprovante de agendamento" estiver marcada, abre o comprovante (Seção 4.4)
  if (deveImprimir && agSalvo && agSalvo.tipo_agendamento !== 'reserva') {
    setTimeout(() => {
      imprimirComprovanteAgendamento(agSalvo.id);
    }, 400);
  }
}

function abrirModalEditarAgendamento(id) {
  const ag = state.agendamentos.find(a => a.id === id);
  if (!ag) return;

  document.getElementById('ag-id').value = ag.id;
  trocarAbaModalAgendamento(ag.tipo_agendamento || 'consulta');

  atualizarSelectPacientesNoAgendamento();
  if (ag.tipo_agendamento === 'reserva') {
    document.getElementById('ag-motivo-reserva').value = ag.motivo_reserva || 'Reunião de Equipe';
  } else if (ag.tipo_agendamento === 'entre_profissionais') {
    document.getElementById('ag-paciente-id-entre').value = ag.paciente_id || '';
    document.getElementById('ag-profissional-convidado-id').value = ag.profissional_convidado_id || '';
  } else {
    document.getElementById('ag-paciente-id').value = ag.paciente_id || '';
  }

  document.getElementById('ag-profissional-id').value = ag.profissional_id || '';
  document.getElementById('ag-especialidade').value = ag.especialidade || '';
  document.getElementById('ag-data').value = ag.data;
  document.getElementById('ag-hora-inicio').value = ag.hora_inicio;
  document.getElementById('ag-hora-fim').value = ag.hora_fim;
  document.getElementById('ag-sala').value = ag.sala || '';
  document.getElementById('ag-tipo').value = ag.tipo_atendimento || 'Consulta Eletiva';
  document.getElementById('ag-obs').value = ag.observacoes || '';

  if (ag.fora_ubs) {
    document.getElementById('ag-fora-ubs').checked = true;
    document.getElementById('div-local-fora-ubs').classList.remove('hidden');
    document.getElementById('ag-local-fora-ubs').value = ag.local_fora_ubs || '';
  }

  document.getElementById('modal-agendamento').classList.remove('hidden');
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
      showHeaderAutosave('Status salvo!');
      showToast(`Status atualizado para: ${novoStatus}`);
      await carregarAgendamentos();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao atualizar status', 'fa-triangle-exclamation', true);
  }
}

async function excluirAgendamento(id) {
  if (!confirm('Deseja realmente remover este agendamento/reserva?')) return;
  try {
    const res = await fetch(`/api/agendamentos/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Registro removido da agenda.');
      await carregarAgendamentos();
      await carregarStatusGeral();
    }
  } catch (err) {
    showToast('Erro ao remover', 'fa-triangle-exclamation', true);
  }
}

// -------------------------------------------------------------
// CIDADÃOS / CADASTROS (AUTOSAVE EM TEMPO REAL)
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
  badge.textContent = `${lista.length} Cidadãos`;

  if (!lista || lista.length === 0) {
    corpo.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">Nenhum cidadão cadastrado.</td></tr>`;
    return;
  }

  corpo.innerHTML = lista.map(p => {
    const idade = calcularIdade(p.data_nascimento);
    const syncStatusBadge = p.sync_status === 'synced'
      ? `<span class="text-2xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full"><i class="fa-solid fa-circle-check text-emerald-600"></i> Sincronizado</span>`
      : `<span class="text-2xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full animate-pulse"><i class="fa-solid fa-cloud-arrow-up text-amber-600"></i> Pendente</span>`;

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-2.5 font-bold text-slate-800">
          <div>${p.nome}</div>
          <div class="text-2xs text-slate-400 font-normal">${p.nome_mae ? `Mãe: ${p.nome_mae}` : 'Mãe não informada'}</div>
        </td>
        <td class="px-4 py-2.5 font-mono text-xs text-slate-700">${p.cns || '-'}</td>
        <td class="px-4 py-2.5 font-mono text-xs text-slate-700">${p.cpf || '-'}</td>
        <td class="px-4 py-2.5 text-xs text-slate-700">${p.data_nascimento ? formatarDataBr(p.data_nascimento) : '-'} (${idade ? `${idade} anos` : ''})</td>
        <td class="px-4 py-2.5 text-xs text-slate-600">${p.telefone || '-'}</td>
        <td class="px-4 py-2.5">${syncStatusBadge}</td>
        <td class="px-4 py-2.5 text-right">
          <button onclick="agendarDiretoParaPaciente(${p.id})" class="p-1 text-emerald-700 hover:bg-emerald-50 rounded" title="Agendar"><i class="fa-solid fa-calendar-plus"></i></button>
          <button onclick="abrirModalEditarPaciente(${p.id})" class="p-1 text-slate-500 hover:text-slate-800 rounded" title="Editar"><i class="fa-solid fa-user-pen"></i></button>
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
  const partes = String(isoDate).split('T')[0].split('-');
  if (partes.length !== 3) return isoDate;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function abrirModalPaciente() {
  document.getElementById('form-paciente').reset();
  document.getElementById('pac-id').value = '';
  document.getElementById('modal-paciente').classList.remove('hidden');
}

async function abrirModalEditarPaciente(id) {
  try {
    const res = await fetch(`/api/pacientes/${id}`);
    const pac = await res.json();
    if (!pac) return;

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

    document.getElementById('modal-paciente').classList.remove('hidden');
  } catch (err) {
    showToast('Erro ao abrir paciente', 'fa-triangle-exclamation', true);
  }
}

function fecharModalPaciente() {
  document.getElementById('modal-paciente').classList.add('hidden');
  carregarPacientes();
}

function agendarDiretoParaPaciente(pacienteId) {
  abrirModalAgendamento('consulta');
  document.getElementById('ag-paciente-id').value = pacienteId;
}

function triggerAutosavePaciente() {
  clearTimeout(autosavePacTimer);
  showHeaderAutosave('Salvando paciente...', true);

  autosavePacTimer = setTimeout(async () => {
    await executarAutosavePaciente();
  }, 400);
}

async function executarAutosavePaciente() {
  const id = document.getElementById('pac-id').value;
  const nome = document.getElementById('pac-nome').value.trim();
  if (!nome || nome.length < 2) return;

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
      if (!id && result.paciente) {
        document.getElementById('pac-id').value = result.paciente.id;
      }
      showHeaderAutosave('Paciente salvo!');
    }
  } catch (err) {}
}

async function salvarPacienteManual() {
  await executarAutosavePaciente();
  fecharModalPaciente();
  showToast('Cidadão salvo com sucesso!');
}

function validarEConsistirCNS(input) {
  const badge = document.getElementById('cns-valido-badge');
  const clean = input.value.replace(/\D/g, '');
  input.value = clean;
  if (clean.length === 15) {
    const firstDigit = clean[0];
    if (['1', '2', '7', '8', '9'].includes(firstDigit)) {
      badge.innerHTML = '<span class="text-emerald-700 font-bold"><i class="fa-solid fa-check"></i> CNS Válido</span>';
    } else {
      badge.innerHTML = '<span class="text-amber-600 font-bold">Prefixo incomum</span>';
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
  badge.textContent = raw.length === 11 ? 'CPF 11 dígitos' : `${raw.length}/11 dígitos`;
}

// -------------------------------------------------------------
// STATUS GERAL & SINCRONISMO COM e-SUS IMBUIA
// -------------------------------------------------------------
async function carregarStatusGeral() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.status === 'online') {
      const syncStatusText = document.getElementById('sync-status-text');
      if (data.sync_config && data.sync_config.sistema_destino_url.includes('imbuia')) {
        syncStatusText.textContent = `e-SUS Imbuia (${data.sync_config.intervalo_segundos}s)`;
      } else {
        syncStatusText.textContent = 'Auto-Sync SUS Ativo';
      }
    }
  } catch (err) {}
}

async function triggerManualSync() {
  const btnIcon = document.getElementById('btn-sync-icon');
  btnIcon.classList.add('fa-spin');
  showHeaderAutosave('Sincronizando com e-SUS...', true);

  try {
    const res = await fetch('/api/sync/trigger', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Sincronização concluída!');
      showHeaderAutosave('Sincronizado!');
      await carregarAgendamentos(true);
      await carregarPacientes();
      await carregarConfigSync();
      await carregarSyncLogs();
    } else {
      showToast(data.error || 'Erro na sincronização', 'fa-triangle-exclamation', true);
    }
  } catch (err) {
    showToast('Falha na comunicação', 'fa-triangle-exclamation', true);
  } finally {
    btnIcon.classList.remove('fa-spin');
  }
}

async function testarConexaoEsusImbuia() {
  const btn = document.getElementById('btn-testar-imbuia');
  const card = document.getElementById('card-diagnostico-imbuia');
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Testando...</span>';

  const url = document.getElementById('cfg-url').value || 'https://esus.imbuia.sc.gov.br/agenda';
  try {
    const res = await fetch('/api/sync/testar-conexao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (data.online) {
      showToast(`e-SUS Imbuia respondendo! (${data.latencia_ms}ms)`);
      card.className = 'p-3 bg-emerald-50 rounded-lg border border-emerald-300 space-y-1';
      card.innerHTML = `
        <div class="font-bold text-emerald-800 flex items-center space-x-1.5 text-xs">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>e-SUS PEC Imbuia: ONLINE (${data.latencia_ms}ms)</span>
        </div>
        <p class="text-emerald-700 text-2xs leading-relaxed">${data.mensagem}</p>
      `;
    } else {
      showToast('Falha ao conectar com e-SUS Imbuia', 'fa-triangle-exclamation', true);
    }
  } catch (e) {
    showToast('Erro no teste de conexão', 'fa-triangle-exclamation', true);
  } finally {
    btn.innerHTML = orig;
  }
}

async function carregarConfigSync() {
  try {
    const res = await fetch('/api/sync/config');
    const cfg = await res.json();
    state.syncConfig = cfg;

    document.getElementById('cfg-sistema-origem').value = cfg.sistema_origem_nome || 'UBS Imbuia / Agenda Local';
    document.getElementById('cfg-sistema-destino').value = cfg.sistema_destino_tipo || 'sus_pec';
    document.getElementById('cfg-url').value = cfg.sistema_destino_url || 'https://esus.imbuia.sc.gov.br/agenda';
    document.getElementById('cfg-usuario-esus').value = cfg.usuario_esus || '';
    document.getElementById('cfg-senha-esus').value = cfg.senha_esus || '';
    document.getElementById('cfg-token-sessao').value = cfg.token_sessao_esus || '';
    document.getElementById('cfg-intervalo').value = cfg.intervalo_segundos || 60;
    document.getElementById('cfg-politica').value = cfg.politica_conflito || 'mais_recente';
    document.getElementById('cfg-auto-sync').checked = Boolean(cfg.auto_sync_enabled);

    document.getElementById('cfg-ultimo-sync').textContent = cfg.ultimo_sync ? new Date(cfg.ultimo_sync).toLocaleString('pt-BR') : 'Nunca';
    document.getElementById('cfg-ultimo-status').textContent = cfg.ultimo_status || 'Pronto';
  } catch (err) {}
}

async function salvarConfigSync(e) {
  e.preventDefault();
  const payload = {
    sistema_origem_nome: document.getElementById('cfg-sistema-origem').value,
    sistema_destino_tipo: document.getElementById('cfg-sistema-destino').value,
    sistema_destino_url: document.getElementById('cfg-url').value,
    usuario_esus: document.getElementById('cfg-usuario-esus').value,
    senha_esus: document.getElementById('cfg-senha-esus').value,
    token_sessao_esus: document.getElementById('cfg-token-sessao').value,
    intervalo_segundos: parseInt(document.getElementById('cfg-intervalo').value, 10),
    politica_conflito: document.getElementById('cfg-politica').value,
    auto_sync_enabled: document.getElementById('cfg-auto-sync').checked ? 1 : 0,
    simulador_sus_ativo: document.getElementById('cfg-url').value.includes('localhost') ? 1 : 0
  };

  try {
    const res = await fetch('/api/sync/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Configurações salvas!');
      await carregarConfigSync();
    }
  } catch (err) {
    showToast('Erro ao salvar', 'fa-triangle-exclamation', true);
  }
}

async function alternarModoSimulador() {
  const isSimulador = state.syncConfig && state.syncConfig.simulador_sus_ativo;
  const novoModo = isSimulador ? 0 : 1;
  const urlInput = document.getElementById('cfg-url');
  if (novoModo === 1) {
    urlInput.value = 'http://localhost:3000/api/mock-sus';
    showToast('Modo: Simulador Local');
  } else {
    urlInput.value = 'https://esus.imbuia.sc.gov.br/agenda';
    showToast('Modo: e-SUS Oficial Imbuia / SC');
  }
}

async function carregarSyncLogs() {
  try {
    const res = await fetch('/api/sync/logs');
    const logs = await res.json();
    const corpo = document.getElementById('tabela-logs-corpo');

    if (!logs || logs.length === 0) {
      corpo.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-slate-400">Nenhum registro.</td></tr>';
      return;
    }

    corpo.innerHTML = logs.map(l => `
      <tr class="hover:bg-slate-50">
        <td class="p-2 font-mono text-slate-600">${new Date(l.timestamp).toLocaleString('pt-BR')}</td>
        <td class="p-2 uppercase font-bold text-slate-500">${l.tipo}</td>
        <td class="p-2"><span class="${l.status === 'sucesso' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'} px-2 py-0.5 rounded font-bold">${l.status}</span></td>
        <td class="p-2 text-slate-700">${l.mensagem}</td>
      </tr>
    `).join('');
  } catch (err) {}
}
