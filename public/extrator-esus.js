// ============================================================
// SUS-SINC • Extrator 1-Clique de Agenda do e-SUS PEC
// Executado diretamente na página https://esus.imbuia.sc.gov.br/agenda
// ============================================================

(async function () {
  const SCRIPT_VER = '2.0-PEC';
  console.log(`[SUS-SINC] Iniciando extração da agenda do e-SUS PEC (${SCRIPT_VER})...`);

  // Remove notificação anterior se existir
  const antigaNotif = document.getElementById('sus-sinc-notif');
  if (antigaNotif) antigaNotif.remove();

  // Cria banner flutuante no e-SUS PEC
  const banner = document.createElement('div');
  banner.id = 'sus-sinc-notif';
  banner.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999999;
    background: #065f46;
    color: #ffffff;
    padding: 16px 22px;
    border-radius: 12px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    max-width: 420px;
    line-height: 1.5;
    border: 2px solid #34d399;
    animation: susSincSlideIn 0.3s ease-out;
  `;

  // Animação CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes susSincSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <div style="font-size:22px;">⏳</div>
      <div>
        <strong style="font-size:14px; display:block; color:#a7f3d0;">SUS-SINC: Sincronizando Agenda</strong>
        <span>Lendo horários e pacientes da tela do e-SUS Imbuia...</span>
      </div>
    </div>
  `;
  document.body.appendChild(banner);

  try {
    // 1. Detectar Data da Agenda na tela
    let dataHoje = new Date().toISOString().split('T')[0];
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      const v = (inp.value || '').trim();
      const mBr = v.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
      if (mBr) {
        dataHoje = `${mBr[3]}-${mBr[2]}-${mBr[1]}`;
        break;
      }
      const mIso = v.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (mIso) {
        dataHoje = v;
        break;
      }
    }

    // 2. Detectar Profissional
    let profissionalNome = 'Médico(a) UBS Imbuia';
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      if (sel.selectedOptions && sel.selectedOptions[0]) {
        const txt = sel.selectedOptions[0].innerText.trim();
        if (txt.length >= 3 && !txt.toLowerCase().includes('selecione') && !txt.toLowerCase().includes('todos')) {
          profissionalNome = txt;
          break;
        }
      }
    }

    // 3. Extrair Linhas e Células da Agenda
    const agendamentos = [];
    const rows = document.querySelectorAll('tr, .agenda-item, [role="row"], .table-row');

    rows.forEach(row => {
      const rowText = row.innerText || '';
      const matchHora = rowText.match(/\b([012]?\d:[0-5]\d)(?:\s*(?:às|-)\s*([012]?\d:[0-5]\d))?\b/);
      if (!matchHora) return;

      const horaInicio = matchHora[1];
      let horaFim = matchHora[2];
      if (!horaFim) {
        const [h, m] = horaInicio.split(':').map(Number);
        const fimMin = (m + 30) % 60;
        const fimHora = h + Math.floor((m + 30) / 60);
        horaFim = `${String(fimHora).padStart(2, '0')}:${String(fimMin).padStart(2, '0')}`;
      }

      // Procura CNS (15 dígitos) ou CPF
      let cns = null;
      const matchCns = rowText.match(/\b([12789]\d{14})\b/);
      if (matchCns) cns = matchCns[1];

      let cpf = null;
      const matchCpf = rowText.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/);
      if (matchCpf) cpf = matchCpf[1];

      // Procura Nome do Cidadão nas células
      let nome = '';
      const cells = row.querySelectorAll('td, [role="cell"]');
      if (cells.length > 0) {
        for (const cell of cells) {
          const cText = cell.innerText.trim();
          if (
            cText &&
            !cText.match(/\b([012]?\d:[0-5]\d)\b/) &&
            !cText.match(/\b\d{11,15}\b/) &&
            /[a-zA-ZÀ-ÿ]{3,}/.test(cText)
          ) {
            const lower = cText.toLowerCase();
            if (
              !lower.includes('agendado') &&
              !lower.includes('atendido') &&
              !lower.includes('cancelado') &&
              !lower.includes('aguardando') &&
              !lower.includes('consulta') &&
              !lower.includes('ações')
            ) {
              nome = cText;
              break;
            }
          }
        }
      }

      if (!nome) {
        let resto = rowText.replace(matchHora[0], '').replace(cns || '', '').replace(cpf || '', '').trim();
        resto = resto.replace(/^[^\w\sÀ-ÿ]+|[^\w\sÀ-ÿ]+$/g, '').trim();
        const linhas = resto.split('\n').map(l => l.trim()).filter(l => l.length >= 3);
        if (linhas.length > 0) nome = linhas[0];
      }

      // Status
      let status = 'Agendado';
      const rowLower = rowText.toLowerCase();
      if (rowLower.includes('atendido') || rowLower.includes('conclu')) status = 'Atendido';
      else if (rowLower.includes('aguard') || rowLower.includes('espera') || rowLower.includes('recep')) status = 'Aguardando';
      else if (rowLower.includes('em atend')) status = 'Em Atendimento';
      else if (rowLower.includes('falta') || rowLower.includes('ausente')) status = 'Faltou';
      else if (rowLower.includes('cancel')) status = 'Cancelado';
      else if (rowLower.includes('reserv')) status = 'Reservado';

      if (nome && nome.length >= 2 && !nome.toLowerCase().includes('horário')) {
        agendamentos.push({
          data: dataHoje,
          hora_inicio: horaInicio,
          hora_fim: horaFim,
          paciente_nome: nome.replace(/\s+/g, ' ').trim(),
          paciente_cns: cns || (cpf ? `CPF: ${cpf}` : null),
          profissional_nome: profissionalNome,
          status: status,
          especialidade: 'Consulta e-SUS PEC',
          origem: 'sus_pec'
        });
      }
    });

    console.log(`[SUS-SINC] Extraídos ${agendamentos.length} horários da tela do e-SUS.`);

    // 4. Envia para o servidor local SUS-Sinc via POST
    const targetUrl = 'http://localhost:3000/api/agenda/importar-esus';
    const payload = {
      data: dataHoje,
      profissional: profissionalNome,
      agendamentos: agendamentos,
      texto: document.body.innerText
    };

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resData = await res.json();

    if (res.ok && resData.success) {
      banner.style.background = '#047857';
      banner.style.borderColor = '#10b981';
      banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:26px;">✅</div>
          <div>
            <strong style="font-size:15px; display:block; color:#ffffff;">Agenda Sincronizada com Sucesso!</strong>
            <span style="color:#d1fae5; font-size:12px;">
              ${resData.count || agendamentos.length} consultas transferidas para o SUS-Sinc (${dataHoje}).
            </span>
          </div>
        </div>
      `;
    } else {
      banner.style.background = '#b45309';
      banner.style.borderColor = '#f59e0b';
      banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:24px;">⚠️</div>
          <div>
            <strong style="font-size:14px; display:block; color:#ffffff;">Atenção no Sincronismo</strong>
            <span style="color:#fef3c7; font-size:12px;">${resData.message || 'Verifique o SUS-Sinc em http://localhost:3000.'}</span>
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.error('[SUS-SINC] Erro na extração:', err);
    banner.style.background = '#991b1b';
    banner.style.borderColor = '#ef4444';
    banner.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="font-size:24px;">❌</div>
        <div>
          <strong style="font-size:14px; display:block; color:#ffffff;">Falha ao Conectar com o SUS-Sinc</strong>
          <span style="color:#fee2e2; font-size:12px; display:block; margin-top:2px;">
            Certifique-se de que o programa SUS-Sinc está aberto no seu computador (<a href="http://localhost:3000" target="_blank" style="color:#ffffff; text-decoration:underline;">http://localhost:3000</a>).
          </span>
          <span style="font-size:11px; color:#fca5a5; display:block; margin-top:4px;">Erro: ${err.message}</span>
        </div>
      </div>
    `;
  }

  // Auto-remover o banner após 7 segundos
  setTimeout(() => {
    if (banner && banner.parentNode) {
      banner.style.opacity = '0';
      banner.style.transition = 'opacity 0.5s ease-out';
      setTimeout(() => banner.remove(), 500);
    }
  }, 7000);
})();
