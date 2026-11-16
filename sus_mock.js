// In-memory or simulated remote SUS Service (e-SUS PEC / SISREG Server)
// Allows bidirectional synchronization testing out-of-the-box

const mockSusData = {
  pacientes: [
    {
      sync_id: 'SUS-PAC-1001',
      uuid: 'remote-sus-uuid-1',
      cns: '700001234567890',
      cpf: '123.456.789-00',
      nome: 'Ana Clara Ferreira',
      nome_mae: 'Maria de Lurdes Ferreira',
      data_nascimento: '1988-04-12',
      sexo: 'F',
      telefone: '(11) 98765-4321',
      email: 'anaclara@email.com',
      endereco: 'Rua das Palmeiras, 142',
      bairro: 'Jardim Primavera',
      municipio: 'São Paulo',
      uf: 'SP',
      cep: '01310-100',
      alergias: 'Dipirona e Penicilina',
      observacoes: 'Hipertensa grau 1, acompanhamento contínuo no programa Hiperdia.',
      updated_at: new Date(Date.now() - 3600000).toISOString()
    },
    {
      sync_id: 'SUS-PAC-9005',
      uuid: 'remote-sus-uuid-5',
      cns: '700008899112233',
      cpf: '567.890.123-44',
      nome: 'Marcos Vinicius da Silva (Regulado SISREG)',
      nome_mae: 'Sônia Maria da Silva',
      data_nascimento: '1975-06-30',
      sexo: 'M',
      telefone: '(11) 94321-8765',
      email: 'marcos.vini@email.com',
      endereco: 'Rua Augusta, 1500',
      bairro: 'Consolação',
      municipio: 'São Paulo',
      uf: 'SP',
      cep: '01304-001',
      alergias: 'Nenhuma',
      observacoes: 'Encaminhado pela Central de Regulação de Vagas (SISREG) para consulta especializada.',
      updated_at: new Date(Date.now() - 1800000).toISOString()
    }
  ],
  agendamentos: [
    {
      sync_id: 'SUS-AG-901',
      uuid: 'remote-ag-uuid-1',
      paciente_cns: '700001234567890',
      paciente_nome: 'Ana Clara Ferreira',
      profissional_nome: 'Dr. Carlos Eduardo Ramos',
      especialidade: 'Clínica Médica / APS',
      sala: 'Consultório 1',
      data: new Date().toISOString().split('T')[0],
      hora_inicio: '08:30',
      hora_fim: '09:00',
      tipo_atendimento: 'Retorno Hiperdia',
      status: 'Confirmado',
      observacoes: 'Reavaliação de pressão arterial e renovação de receita.',
      origem: 'sus_pec',
      updated_at: new Date(Date.now() - 3600000).toISOString()
    },
    {
      sync_id: 'SUS-AG-950',
      uuid: 'remote-ag-uuid-50',
      paciente_cns: '700008899112233',
      paciente_nome: 'Marcos Vinicius da Silva (Regulado SISREG)',
      profissional_nome: 'Dr. Carlos Eduardo Ramos',
      especialidade: 'Clínica Médica / APS',
      sala: 'Consultório 1',
      data: new Date().toISOString().split('T')[0],
      hora_inicio: '15:00',
      hora_fim: '15:30',
      tipo_atendimento: 'Consulta Eletiva Regulada',
      status: 'Agendado',
      observacoes: 'Agendamento inserido via regulação SISREG / e-SUS.',
      origem: 'sisreg',
      updated_at: new Date(Date.now() - 1200000).toISOString()
    }
  ]
};

function getMockSusPacientes() {
  return mockSusData.pacientes;
}

function getMockSusAgendamentos() {
  return mockSusData.agendamentos;
}

function upsertMockSusPaciente(paciente) {
  const existing = mockSusData.pacientes.find(p => p.cns === paciente.cns || p.cpf === paciente.cpf);
  if (existing) {
    Object.assign(existing, paciente, { updated_at: new Date().toISOString() });
    return existing;
  } else {
    const newPac = {
      ...paciente,
      sync_id: paciente.sync_id || `SUS-PAC-${1000 + mockSusData.pacientes.length + 1}`,
      updated_at: new Date().toISOString()
    };
    mockSusData.pacientes.push(newPac);
    return newPac;
  }
}

function upsertMockSusAgendamento(agendamento) {
  const existing = mockSusData.agendamentos.find(a => a.sync_id === agendamento.sync_id || (a.data === agendamento.data && a.hora_inicio === agendamento.hora_inicio && a.profissional_nome === agendamento.profissional_nome));
  if (existing) {
    Object.assign(existing, agendamento, { updated_at: new Date().toISOString() });
    return existing;
  } else {
    const newAg = {
      ...agendamento,
      sync_id: agendamento.sync_id || `SUS-AG-${900 + mockSusData.agendamentos.length + 1}`,
      updated_at: new Date().toISOString()
    };
    mockSusData.agendamentos.push(newAg);
    return newAg;
  }
}

module.exports = {
  mockSusData,
  getMockSusPacientes,
  getMockSusAgendamentos,
  upsertMockSusPaciente,
  upsertMockSusAgendamento
};
