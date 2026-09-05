// Waya — camada de dados
//
// Responsável por: ler/escrever no Supabase, manter uma cópia local para
// modo offline, e colocar em fila as acções feitas sem ligação para as
// enviar assim que a ligação voltar.

const client = window.wayaClient;
const { DEFAULT_CITY, DEFAULT_AVG_COST } = window.WAYA_CONFIG;

const CACHE_KEY = (cityId) => `waya_cache_${cityId}`;
const QUEUE_KEY = 'waya_queue';

// ---------------------------------------------------------------- cidades

async function getOrCreateCity(name) {
  const { data: existing, error: selectError } = await client
    .from('cities').select('*').eq('name', name).maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await client
    .from('cities')
    .insert({ name, avg_transfer_cost: DEFAULT_AVG_COST })
    .select('*').single();
  if (insertError) throw insertError;

  if (name === DEFAULT_CITY) await seedDemoData(created.id);
  return created;
}

async function listCities() {
  const { data, error } = await client.from('cities').select('*').order('name');
  if (error) throw error;
  return data;
}

async function updateCityCost(cityId, avgCost) {
  const { error } = await client.from('cities').update({ avg_transfer_cost: avgCost }).eq('id', cityId);
  if (error) throw error;
}

// ------------------------------------------------------------- paragens

async function fetchCityDataset(cityId) {
  const [stopsRes, connsRes, activityRes, collabsRes, verifRes] = await Promise.all([
    client.from('stops').select('*').eq('city_id', cityId),
    client.from('connections').select('*').eq('city_id', cityId),
    client.from('activity_log').select('*').eq('city_id', cityId).order('created_at', { ascending: false }).limit(30),
    client.from('collaborators').select('*').order('contributions', { ascending: false }),
    client.from('stop_verifications').select('*')
  ]);
  for (const r of [stopsRes, connsRes, activityRes, collabsRes, verifRes]) {
    if (r.error) throw r.error;
  }
  const dataset = {
    stops: stopsRes.data,
    connections: connsRes.data,
    activity: activityRes.data,
    collaborators: collabsRes.data,
    verifications: verifRes.data,
    cachedAt: new Date().toISOString()
  };
  localStorage.setItem(CACHE_KEY(cityId), JSON.stringify(dataset));
  return dataset;
}

function loadCachedDataset(cityId) {
  const raw = localStorage.getItem(CACHE_KEY(cityId));
  return raw ? JSON.parse(raw) : null;
}

async function insertStop(stop) {
  const { data, error } = await client.from('stops').insert(stop).select('*').single();
  if (error) throw error;
  await logActivity(stop.city_id, stop.created_by, 'add_stop', `Adicionou a paragem "${stop.name}"`);
  return data;
}

async function updateStop(stopId, fields, cityId, collaboratorId, name) {
  const { data, error } = await client.from('stops')
    .update({ ...fields, updated_by: collaboratorId, updated_at: new Date().toISOString() })
    .eq('id', stopId).select('*').single();
  if (error) throw error;
  await logActivity(cityId, collaboratorId, 'edit_stop', `Editou a paragem "${name}"`);
  return data;
}

async function deleteStop(stopId, cityId, collaboratorId, name) {
  const { error } = await client.from('stops').delete().eq('id', stopId);
  if (error) throw error;
  await logActivity(cityId, collaboratorId, 'delete_stop', `Apagou a paragem "${name}"`);
}

async function verifyStop(stopId, collaboratorId, cityId, name) {
  const { error } = await client.from('stop_verifications').insert({ stop_id: stopId, collaborator_id: collaboratorId });
  if (error) {
    if (error.code === '23505') throw new Error('ALREADY_VERIFIED');
    throw error;
  }
  await logActivity(cityId, collaboratorId, 'verify_stop', `Confirmou a paragem "${name}"`);
}

// ------------------------------------------------------------ ligações

async function insertConnection(conn) {
  const { data, error } = await client.from('connections').insert(conn).select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error('DUPLICATE_CONNECTION');
    throw error;
  }
  return data;
}

async function updateConnection(connId, fields) {
  const { data, error } = await client.from('connections').update(fields).eq('id', connId).select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error('DUPLICATE_CONNECTION');
    throw error;
  }
  return data;
}

async function deleteConnection(connId) {
  const { error } = await client.from('connections').delete().eq('id', connId);
  if (error) throw error;
}

async function logActivity(cityId, collaboratorId, type, description) {
  const { error } = await client.from('activity_log').insert({ city_id: cityId, collaborator_id: collaboratorId, type, description });
  if (error) throw error;
}

// ------------------------------------------------------------- storage

async function uploadStopPhoto(file, collaboratorId) {
  const resized = await resizeImage(file, 900, 0.72);
  const path = `${collaboratorId}/${Date.now()}.jpg`;
  const { error } = await client.storage.from('stop-photos').upload(path, resized, { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = client.storage.from('stop-photos').getPublicUrl(path);
  return data.publicUrl;
}

function resizeImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// -------------------------------------------------------------- fila offline

function getQueue() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}

function pushToQueue(action) {
  const queue = getQueue();
  queue.push(action);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function flushQueue(onProgress) {
  let queue = getQueue();
  if (!queue.length) return { sent: 0, remaining: 0 };
  let sent = 0;
  while (queue.length) {
    const action = queue[0];
    try {
      await dispatchQueuedAction(action);
      queue.shift();
      sent++;
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      if (onProgress) onProgress(sent, queue.length);
    } catch (err) {
      break; // stop at first failure, keep the rest queued for later
    }
  }
  return { sent, remaining: queue.length };
}

async function dispatchQueuedAction(action) {
  switch (action.type) {
    case 'add_stop': return insertStop(action.payload);
    case 'edit_stop': return updateStop(action.payload.stopId, action.payload.fields, action.payload.cityId, action.payload.collaboratorId, action.payload.name);
    case 'delete_stop': return deleteStop(action.payload.stopId, action.payload.cityId, action.payload.collaboratorId, action.payload.name);
    case 'verify_stop': return verifyStop(action.payload.stopId, action.payload.collaboratorId, action.payload.cityId, action.payload.name);
    case 'add_connection': return insertConnection(action.payload);
    case 'edit_connection': return updateConnection(action.payload.connId, action.payload.fields);
    case 'delete_connection': return deleteConnection(action.payload.connId);
    case 'save_profile': return window.waya_updateProfile(action.payload.userId, action.payload.fields);
    default: return Promise.resolve();
  }
}

// ------------------------------------------------------------ tempo real

function subscribeToCity(cityId, onChange) {
  const channel = client.channel(`waya-city-${cityId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stops', filter: `city_id=eq.${cityId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'connections', filter: `city_id=eq.${cityId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_log', filter: `city_id=eq.${cityId}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stop_verifications' }, onChange)
    .subscribe();
  return () => client.removeChannel(channel);
}

// -------------------------------------------------------------- dados demo

async function seedDemoData(cityId) {
  const stops = [
    ['Aeroporto 4 de Fevereiro', 'Viana', 'principal', -8.8583, 13.2312, 'Terminal principal'],
    ['Cazenga', 'Cazenga', 'principal', -8.8383, 13.2344, 'Hub central'],
    ['Mercado Roque Santeiro', 'Sambizanga', 'principal', -8.8183, 13.2444, 'Grande mercado'],
    ['Benfica', 'Benfica', 'secundaria', -8.8283, 13.2244, ''],
    ['Kilamba', 'Kilamba', 'principal', -8.8083, 13.2544, 'Novo bairro'],
    ['Viana Centro', 'Viana', 'principal', -8.8783, 13.2644, ''],
    ['Talatona', 'Talatona', 'principal', -8.8483, 13.2144, 'Zona residencial'],
    ['Camama', 'Camama', 'secundaria', -8.8183, 13.2044, ''],
    ['Zango', 'Zango', 'secundaria', -8.7883, 13.2744, ''],
    ['Golfe', 'Golfe', 'secundaria', -8.8283, 13.2444, '']
  ];
  const { data: insertedStops, error } = await client.from('stops').insert(
    stops.map(([name, zone, type, lat, lng, notes]) => ({ city_id: cityId, name, zone, type, lat, lng, notes }))
  ).select('*');
  if (error || !insertedStops) return;

  const byName = Object.fromEntries(insertedStops.map((s) => [s.name, s.id]));
  const pairs = [
    ['Aeroporto 4 de Fevereiro', 'Cazenga', 20], ['Cazenga', 'Mercado Roque Santeiro', 15],
    ['Cazenga', 'Benfica', 10], ['Benfica', 'Golfe', 12], ['Golfe', 'Kilamba', 18],
    ['Mercado Roque Santeiro', 'Viana Centro', 25], ['Kilamba', 'Zango', 15],
    ['Benfica', 'Talatona', 20], ['Talatona', 'Camama', 15], ['Camama', 'Kilamba', 10],
    ['Aeroporto 4 de Fevereiro', 'Talatona', 30], ['Viana Centro', 'Zango', 15]
  ];
  await client.from('connections').insert(
    pairs.map(([a, b, time]) => ({ city_id: cityId, from_stop: byName[a], to_stop: byName[b], time_minutes: time }))
  );
}

window.wayaData = {
  getOrCreateCity, listCities, updateCityCost,
  fetchCityDataset, loadCachedDataset,
  insertStop, updateStop, deleteStop, verifyStop,
  insertConnection, updateConnection, deleteConnection, logActivity,
  uploadStopPhoto,
  getQueue, pushToQueue, flushQueue,
  subscribeToCity
};
