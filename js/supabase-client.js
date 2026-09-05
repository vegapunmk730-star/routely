// Waya — ligação ao Supabase e identidade do colaborador
//
// Cada dispositivo assina sessão anónima uma única vez (sem email/password).
// Essa sessão dá um auth.uid() estável, usado como identidade do colaborador
// em toda a base de dados — sem recolher nenhum dado pessoal.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.WAYA_CONFIG;

window.wayaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

const client = window.wayaClient;

/**
 * Garante que existe uma sessão (anónima) activa e devolve o utilizador.
 */
async function ensureSession() {
  const { data: { session } } = await client.auth.getSession();
  if (session) return session.user;

  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

/**
 * Garante que existe uma linha de colaborador ligada a este utilizador.
 * Cria uma na primeira vez, com valores por omissão.
 */
async function ensureCollaboratorRow(userId) {
  const { data: existing, error: selectError } = await client
    .from('collaborators')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const cachedName = localStorage.getItem('waya_profile_name') || 'Anónimo';
  const cachedType = localStorage.getItem('waya_profile_type') || 'passageiro';

  const { data: created, error: insertError } = await client
    .from('collaborators')
    .insert({ id: userId, display_name: cachedName, collab_type: cachedType })
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

/**
 * Ponto de entrada único: assina sessão + garante perfil de colaborador.
 * Devolve o registo do colaborador (id, display_name, collab_type, stats).
 */
window.waya_getOrCreateCollaborator = async function () {
  const user = await ensureSession();
  const collaborator = await ensureCollaboratorRow(user.id);
  localStorage.setItem('waya_profile_name', collaborator.display_name);
  localStorage.setItem('waya_profile_type', collaborator.collab_type);
  return collaborator;
};

window.waya_updateProfile = async function (userId, fields) {
  const { data, error } = await client
    .from('collaborators')
    .update(fields)
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  if (fields.display_name) localStorage.setItem('waya_profile_name', fields.display_name);
  if (fields.collab_type) localStorage.setItem('waya_profile_type', fields.collab_type);
  return data;
};
