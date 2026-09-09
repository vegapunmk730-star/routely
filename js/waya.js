// ============================================================
// Waya — aplicação completa num único ficheiro
// Cada secção corre no seu próprio âmbito (IIFE) para nunca haver
// colisões de nomes entre módulos; a comunicação entre secções
// passa sempre por objectos expostos em `window`.
// ============================================================


// ------------------------------------------------------------
// Configuração  (antigo js/config.js)
// ------------------------------------------------------------
(function () {
// Waya — configuração
//
// SUPABASE_ANON_KEY é uma chave pública (anon/publishable) — é normal e seguro
// que fique visível no código do cliente. A segurança dos dados é garantida
// pelas políticas de Row Level Security definidas na base de dados, não pelo
// sigilo desta chave.

window.WAYA_CONFIG = {
  SUPABASE_URL: 'https://otcexinwztizwewubqyu.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90Y2V4aW53enRpendld3VicXl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NDMwNjYsImV4cCI6MjEwNDAxOTA2Nn0.7838JZ88d1fRH9gEic_hoaSvooLE6BSUhrF-6-oNXmo',
  DEFAULT_CITY: 'Luanda',
  DEFAULT_AVG_COST: 150,
  MAP_STYLE: 'https://tiles.openfreemap.org/styles/liberty',
  MAP_CENTER: [13.2344, -8.8383],
  MAP_ZOOM: 12
};
})();

// ------------------------------------------------------------
// Supabase — cliente e identidade  (antigo js/supabase-client.js)
// ------------------------------------------------------------
(function () {
// Waya — ligação ao Supabase e identidade do colaborador
//
// Cada dispositivo assina sessão anónima uma única vez (sem email/password).
// Essa sessão dá um auth.uid() estável, usado como identidade do colaborador
// em toda a base de dados — sem recolher nenhum dado pessoal.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.WAYA_CONFIG;

try {
  window.wayaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
} catch (err) {
  console.error('Waya: não foi possível iniciar o cliente Supabase (a biblioteca pode não ter carregado)', err);
  window.wayaClient = null;
}

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
})();

// ------------------------------------------------------------
// Camada de dados  (antigo js/data.js)
// ------------------------------------------------------------
(function () {
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
})();

// ------------------------------------------------------------
// Routing (Dijkstra)  (antigo js/routing.js)
// ------------------------------------------------------------
(function () {
// Waya — cálculo de rota (Dijkstra sobre o grafo de paragens/ligações)

/**
 * Encontra o caminho de menor tempo entre duas paragens.
 * @returns {null | { path: string[], stopNames: string[], totalMinutes: number, transfers: number, estimatedCost: number, legMinutes: number[] }}
 */
function findRoute(stops, connections, startId, endId, avgCost) {
  const dist = {};
  const prev = {};
  const visited = new Set();
  stops.forEach((s) => { dist[s.id] = Infinity; prev[s.id] = null; });
  dist[startId] = 0;

  const queue = [{ id: startId, d: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.id === endId) break;

    connections.forEach((c) => {
      let neighbor = null;
      if (c.from_stop === current.id) neighbor = c.to_stop;
      else if (c.to_stop === current.id) neighbor = c.from_stop;
      if (neighbor && !visited.has(neighbor)) {
        const candidate = dist[current.id] + c.time_minutes;
        if (candidate < dist[neighbor]) {
          dist[neighbor] = candidate;
          prev[neighbor] = current.id;
          queue.push({ id: neighbor, d: candidate });
        }
      }
    });
  }

  if (dist[endId] === Infinity) return null;

  const path = [];
  let cursor = endId;
  while (cursor) { path.unshift(cursor); cursor = prev[cursor]; }

  const stopById = Object.fromEntries(stops.map((s) => [s.id, s]));
  const legMinutes = [];
  for (let i = 0; i < path.length - 1; i++) {
    const conn = connections.find((c) =>
      (c.from_stop === path[i] && c.to_stop === path[i + 1]) ||
      (c.to_stop === path[i] && c.from_stop === path[i + 1]));
    legMinutes.push(conn ? conn.time_minutes : 0);
  }

  const transfers = path.length - 2;
  return {
    path,
    stopNames: path.map((id) => stopById[id].name),
    totalMinutes: legMinutes.reduce((a, b) => a + b, 0),
    transfers: Math.max(transfers, 0),
    estimatedCost: (Math.max(transfers, 0) + 1) * avgCost,
    legMinutes
  };
}

window.wayaRouting = { findRoute };
})();

// ------------------------------------------------------------
// Mapa  (antigo js/map.js)
// ------------------------------------------------------------
(function () {
// Waya — mapa
//
// Usa o estilo "liberty" da OpenFreeMap (livre, sem chave) com um filtro
// duotone aplicado por cima para dar uma identidade visual própria de mapa
// de transporte, em vez do aspecto genérico de mapa turístico.

const { MAP_STYLE, MAP_CENTER, MAP_ZOOM } = window.WAYA_CONFIG;

const PALETTE = {
  ink: '#13213C',
  inkMid: '#3A4E76',
  signal: '#F2B705',
  confirm: '#2F7A4D',
  paper: '#FFFFFF'
};

function createMap(container, handlers) {
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE,
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    attributionControl: true
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'bottom-right');

  map.getCanvas().style.filter = 'saturate(0.35) contrast(1.05) brightness(1.04)';

  map.on('load', () => handlers.onLoad && handlers.onLoad());
  map.on('click', (e) => handlers.onMapClick && handlers.onMapClick(e.lngLat));

  // Bound once: the "stops-layer" id survives being removed/re-added on every
  // data refresh, so a single delegated listener keeps working across all of
  // them — re-binding on each render would stack up duplicate listeners.
  map.on('click', 'stops-layer', (e) => handlers.onStopClick && handlers.onStopClick(e.features[0].properties.id));
  map.on('mouseenter', 'stops-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'stops-layer', () => { map.getCanvas().style.cursor = ''; });

  return map;
}

function renderStopsAndConnections(map, { stops, connections, verifications, routeStartId, routeEndId }) {
  // "route-layer" is intentionally excluded here: it's managed separately by
  // renderRouteLine/clearRouteLine so a found route survives incidental
  // re-renders (e.g. another collaborator's edit arriving over realtime).
  ['connections-layer', 'stops-layer', 'stops-labels'].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  ['connections-layer', 'stops-layer'].forEach((id) => {
    if (map.getSource(id)) map.removeSource(id);
  });

  const stopById = Object.fromEntries(stops.map((s) => [s.id, s]));
  const verifCountByStop = {};
  verifications.forEach((v) => { verifCountByStop[v.stop_id] = (verifCountByStop[v.stop_id] || 0) + 1; });

  const connFeatures = connections.map((c) => {
    const from = stopById[c.from_stop];
    const to = stopById[c.to_stop];
    if (!from || !to) return null;
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
      properties: { id: c.id }
    };
  }).filter(Boolean);

  map.addSource('connections-layer', { type: 'geojson', data: { type: 'FeatureCollection', features: connFeatures } });
  map.addLayer({
    id: 'connections-layer', type: 'line', source: 'connections-layer',
    paint: { 'line-color': PALETTE.inkMid, 'line-width': 2, 'line-opacity': 0.55 }
  });

  const stopFeatures = stops.map((s) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: { id: s.id, name: s.name, type: s.type, verifCount: verifCountByStop[s.id] || 0 }
  }));
  map.addSource('stops-layer', { type: 'geojson', data: { type: 'FeatureCollection', features: stopFeatures } });

  map.addLayer({
    id: 'stops-layer', type: 'circle', source: 'stops-layer',
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'id'], routeStartId || ''], 15,
        ['==', ['get', 'id'], routeEndId || ''], 15,
        ['==', ['get', 'type'], 'principal'], 11,
        8
      ],
      'circle-color': [
        'case',
        ['==', ['get', 'id'], routeStartId || ''], PALETTE.signal,
        ['==', ['get', 'id'], routeEndId || ''], PALETTE.confirm,
        PALETTE.ink
      ],
      'circle-stroke-color': PALETTE.paper,
      'circle-stroke-width': 3
    }
  });

  map.addLayer({
    id: 'stops-labels', type: 'symbol', source: 'stops-layer',
    layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': PALETTE.ink, 'text-halo-color': PALETTE.paper, 'text-halo-width': 1.6 }
  });
}

function renderRouteLine(map, coordinates) {
  const data = { type: 'Feature', geometry: { type: 'LineString', coordinates } };
  if (map.getSource('route-layer')) {
    map.getSource('route-layer').setData(data);
  } else {
    map.addSource('route-layer', { type: 'geojson', data });
    map.addLayer({
      id: 'route-layer', type: 'line', source: 'route-layer',
      paint: { 'line-color': PALETTE.signal, 'line-width': 5, 'line-opacity': 0.9 }
    }, 'stops-layer');
  }
}

function clearRouteLine(map) {
  if (map.getSource('route-layer')) {
    map.getSource('route-layer').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  }
}

window.wayaMap = { createMap, renderStopsAndConnections, renderRouteLine, clearRouteLine, PALETTE };
})();

// ------------------------------------------------------------
// Geocodificação inversa  (antigo js/geocode.js)
// ------------------------------------------------------------
(function () {
// Waya — geocodificação inversa
//
// Usa a API pública do Nominatim (OpenStreetMap) para sugerir o bairro/zona
// a partir do ponto tocado no mapa. É gratuita e não precisa de chave, mas
// tem um limite de utilização (cerca de 1 pedido/segundo, uso leve) — por
// isso só é chamada uma vez por paragem nova, nunca em massa, e uma falha
// é sempre silenciosa (o campo fica simplesmente por preencher).
//
// https://operations.osmfoundation.org/policies/nominatim/

async function reverseGeocodeZone(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    return addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district
      || addr.town || addr.village || addr.county || null;
  } catch (err) {
    return null; // sem ligação, ou o serviço está indisponível — não é crítico
  }
}

window.wayaGeocode = { reverseGeocodeZone };
})();

// ------------------------------------------------------------
// Interface: ícones, folhas, toasts  (antigo js/ui.js)
// ------------------------------------------------------------
(function () {
// Waya — utilitários de interface
// Ícones em SVG (sem emojis), folhas inferiores, toasts e confirmação.

const icons = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7a5 5 0 010-10h2M15 7h2a5 5 0 010 10h-2M8 12h8"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M5 8v4a4 4 0 004 4h6"/></svg>',
  ranking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V12M12 20V4M20 20v-7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 000-3l-1-.2a6.9 6.9 0 00-.7-1.6l.6-.9a1.7 1.7 0 00-2.4-2.4l-.9.6a6.9 6.9 0 00-1.6-.7l-.2-1a1.7 1.7 0 00-3 0l-.2 1a6.9 6.9 0 00-1.6.7l-.9-.6a1.7 1.7 0 00-2.4 2.4l.6.9a6.9 6.9 0 00-.7 1.6l-1 .2a1.7 1.7 0 000 3l1 .2a6.9 6.9 0 00.7 1.6l-.6.9a1.7 1.7 0 002.4 2.4l.9-.6a6.9 6.9 0 001.6.7l.2 1a1.7 1.7 0 003 0l.2-1a6.9 6.9 0 001.6-.7l.9.6a1.7 1.7 0 002.4-2.4l-.6-.9a6.9 6.9 0 00.7-1.6z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l6 6L20 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l11-11-4-4L4 16v4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.4-4.4"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  cloudOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M9.5 7A5 5 0 0119 11.2 3.6 3.6 0 0118 18H8a4.3 4.3 0 01-1.7-8.2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 9a3 3 0 110-6M15 14a5.5 5.5 0 015.5 6"/></svg>'
};

function icon(name, extraClass) {
  return `<span class="icon ${extraClass || ''}">${icons[name] || ''}</span>`;
}

// ---------------------------------------------------------------- toasts

function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// ------------------------------------------------------------ bottom sheets
//
// Comportamento do botão de retroceder do Android: abrir uma folha empurra
// uma entrada no histórico do browser; fechar (por botão ou pelo próprio
// retroceder) consome essa entrada. Isto evita que o retroceder feche a app
// inteira quando só se queria fechar uma folha.

let overlayHistoryPushed = false;

function openSheet(id) {
  document.getElementById('backdrop').classList.add('show');
  document.getElementById(id).classList.add('open');
  if (!overlayHistoryPushed) {
    overlayHistoryPushed = true;
    history.pushState({ wayaOverlay: true }, '');
  }
}

function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  scheduleOverlayHistoryCheck();
}

function closeAllSheets() {
  document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
  scheduleOverlayHistoryCheck();
}

// Espera um instante antes de decidir se deve "consumir" a entrada do
// histórico — assim, trocar directamente de uma folha para outra (fechar A,
// abrir B na mesma acção) não gera um vaivém desnecessário no histórico.
function scheduleOverlayHistoryCheck() {
  setTimeout(() => {
    if (document.querySelector('.sheet.open')) {
      document.getElementById('backdrop').classList.add('show');
      return;
    }
    document.getElementById('backdrop').classList.remove('show');
    if (overlayHistoryPushed) {
      overlayHistoryPushed = false;
      history.back();
    }
  }, 0);
}

window.addEventListener('popstate', () => {
  if (document.querySelector('.sheet.open')) {
    document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
    document.getElementById('backdrop').classList.remove('show');
    overlayHistoryPushed = false;
  } else if (typeof window.wayaBackToMapScreen === 'function') {
    window.wayaBackToMapScreen();
  }
});

// -------------------------------------------------------------- confirmação

function confirmAction(message, confirmLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const sheet = document.getElementById('confirmSheet');
    sheet.querySelector('.confirm-message').textContent = message;
    const confirmBtn = sheet.querySelector('.confirm-yes');
    const cancelBtn = sheet.querySelector('.confirm-no');
    confirmBtn.textContent = confirmLabel;

    const cleanup = (result) => {
      confirmBtn.removeEventListener('click', onYes);
      cancelBtn.removeEventListener('click', onNo);
      closeSheet('confirmSheet');
      resolve(result);
    };
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    confirmBtn.addEventListener('click', onYes);
    cancelBtn.addEventListener('click', onNo);
    openSheet('confirmSheet');
  });
}

window.wayaUI = { icon, icons, showToast, openSheet, closeSheet, closeAllSheets, confirmAction };
})();

// ------------------------------------------------------------
// Aplicação principal  (antigo js/app.js)
// ------------------------------------------------------------
(function () {
// Waya — aplicação principal
// Liga o estado da app à interface: ecrãs, folhas inferiores, mapa e dados.

const { icon, icons, showToast, openSheet, closeSheet, closeAllSheets, confirmAction } = window.wayaUI;
const wayaData = window.wayaData;
const wayaMap = window.wayaMap;
const wayaRouting = window.wayaRouting;

const state = {
  collaborator: null,
  city: null,
  stops: [], connections: [], activity: [], collaborators: [], verifications: [],
  mode: 'view',
  tempMarker: null,
  editingStopId: null,
  editingConnectionId: null,
  selectedStopId: null,
  routeStart: null,
  routeEnd: null,
  map: null,
  unsubscribeRealtime: null,
  pendingPhotoFile: null
};

const COLLAB_TYPE_LABELS = {
  passageiro: 'Passageiro', taxista: 'Taxista / motorista',
  comerciante: 'Comerciante local', estudante: 'Estudante', outro: 'Outro'
};

// ---------------------------------------------------------------- arranque

document.addEventListener('DOMContentLoaded', boot);

// Rede de segurança: se algo inesperado impedir o arranque normal, o ecrã de
// carregamento é escondido de qualquer forma ao fim de 10 segundos, com um
// aviso, em vez de a app ficar presa para sempre.
setTimeout(() => {
  const veil = document.getElementById('loadingVeil');
  if (veil && !veil.classList.contains('hidden')) {
    veil.classList.add('hidden');
    showToast('Algo demorou mais do que o esperado a carregar. Verifica a tua ligação.');
  }
}, 10000);

async function boot() {
  try {
    wireStaticIcons();
    wireNav();
    wireFab();
    wireSheets();
    wireForms();
    setupOfflineIndicator();

    if (typeof maplibregl === 'undefined') {
      showToast('Não foi possível carregar o mapa. Verifica a tua ligação à internet e recarrega a página.');
    }

    try {
      state.collaborator = await window.waya_getOrCreateCollaborator();
    } catch (err) {
      state.collaborator = null;
    }
    updateProfileChip();

    const cityName = localStorage.getItem('waya_current_city') || window.WAYA_CONFIG.DEFAULT_CITY;
    await loadCity(cityName);

    consumeLaunchAction();
  } catch (err) {
    console.error('Waya: falha no arranque', err);
    showToast('Não foi possível carregar a app correctamente. Tenta recarregar a página.');
  } finally {
    document.getElementById('loadingVeil').classList.add('hidden');
  }
}

// Trata o lançamento a partir dos atalhos do ícone da app (long-press no
// Android): "Adicionar paragem" e "Encontrar rota" abrem já no modo certo.
function consumeLaunchAction() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  if (!action) return;
  history.replaceState({}, '', location.pathname);

  if (action === 'add-stop') {
    switchScreen('screenMap');
    setMode('addStop');
  } else if (action === 'find-route') {
    if (state.stops.length >= 2) {
      switchScreen('screenMap');
      setMode('route');
    } else {
      showToast('Adiciona pelo menos duas paragens primeiro.');
    }
  }
}

// ------------------------------------------------------------------ cidade

async function loadCity(name) {
  let city;
  try {
    city = await wayaData.getOrCreateCity(name);
    localStorage.setItem('waya_current_city_meta', JSON.stringify(city));
  } catch (err) {
    const cached = localStorage.getItem('waya_current_city_meta');
    city = cached ? JSON.parse(cached) : null;
    if (!city) {
      showToast('Sem ligação e sem dados guardados para esta cidade.');
      return;
    }
  }

  state.city = city;
  localStorage.setItem('waya_current_city', city.name);
  document.getElementById('cityPillLabel').textContent = city.name;
  document.getElementById('cityCostInput').value = city.avg_transfer_cost;

  let dataset;
  try {
    dataset = await wayaData.fetchCityDataset(city.id);
  } catch (err) {
    dataset = wayaData.loadCachedDataset(city.id) || { stops: [], connections: [], activity: [], collaborators: [], verifications: [] };
    showToast('Sem ligação — a mostrar dados guardados neste dispositivo.');
  }
  applyDataset(dataset);

  try {
    if (!state.map) {
      state.map = wayaMap.createMap('map', {
        onLoad: () => renderMap(),
        onMapClick: (lngLat) => { if (state.mode === 'addStop') openStopForm(null, lngLat); },
        onStopClick: handleStopClickOnMap
      });
    } else if (state.map.isStyleLoaded()) {
      renderMap();
      fitToStops();
    } else {
      state.map.once('load', () => { renderMap(); fitToStops(); });
    }
  } catch (err) {
    console.error('Waya: não foi possível iniciar o mapa', err);
    showToast('O mapa não pôde ser carregado, mas o resto da app continua a funcionar.');
  }

  try {
    if (state.unsubscribeRealtime) state.unsubscribeRealtime();
    if (navigator.onLine) {
      state.unsubscribeRealtime = wayaData.subscribeToCity(city.id, debounce(refreshFromServer, 700));
    }
  } catch (err) {
    console.error('Waya: tempo real indisponível', err);
  }

  renderAllLists();
}

async function refreshFromServer() {
  if (!state.city) return;
  try {
    const dataset = await wayaData.fetchCityDataset(state.city.id);
    applyDataset(dataset);
    renderMap();
    renderAllLists();
  } catch (err) { /* keep current view if the refresh fails */ }
}

function applyDataset(dataset) {
  state.stops = dataset.stops;
  state.connections = dataset.connections;
  state.activity = dataset.activity;
  state.collaborators = dataset.collaborators;
  state.verifications = dataset.verifications;
}

function persistCacheSnapshot() {
  if (!state.city) return;
  localStorage.setItem(`waya_cache_${state.city.id}`, JSON.stringify({
    stops: state.stops, connections: state.connections, activity: state.activity,
    collaborators: state.collaborators, verifications: state.verifications,
    cachedAt: new Date().toISOString()
  }));
}

// --------------------------------------------------------------- colaborador

async function requireCollaborator() {
  if (state.collaborator) return state.collaborator;
  try {
    state.collaborator = await window.waya_getOrCreateCollaborator();
    updateProfileChip();
    return state.collaborator;
  } catch (err) {
    showToast('É preciso ligação à internet para contribuíres pela primeira vez.');
    return null;
  }
}

function updateProfileChip() {
  const chip = document.getElementById('profileChipBtn');
  if (state.collaborator) {
    chip.textContent = initialsOf(state.collaborator.display_name);
    document.getElementById('profileNameInput').value = state.collaborator.display_name;
    document.getElementById('profileTypeSelect').value = state.collaborator.collab_type;
  } else {
    chip.textContent = '?';
  }
}

function initialsOf(name) {
  const initials = (name || '').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return initials || 'A';
}

// ------------------------------------------------------------------- mapa

function renderMap() {
  if (!state.map) return;
  wayaMap.renderStopsAndConnections(state.map, {
    stops: state.stops, connections: state.connections, verifications: state.verifications,
    routeStartId: state.routeStart, routeEndId: state.routeEnd
  });
}

function fitToStops() {
  if (!state.stops.length) return;
  const bounds = new maplibregl.LngLatBounds();
  state.stops.forEach((s) => bounds.extend([s.lng, s.lat]));
  state.map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 400 });
}

function handleStopClickOnMap(stopId) {
  if (state.mode === 'route') {
    handleRouteSelection(stopId);
  } else {
    openStopDetail(stopId);
  }
}

// ---------------------------------------------------------------- modos

function setMode(mode) {
  state.mode = mode;
  const chip = document.getElementById('modeChip');
  const fab = document.getElementById('fabBtn');
  const fabIcon = document.getElementById('fabIcon');

  if (mode === 'view') {
    chip.textContent = 'Modo: visualizar';
    chip.className = 'mode-chip';
    fabIcon.innerHTML = icons.plus;
    fab.classList.remove('cancel');
    return;
  }

  fabIcon.innerHTML = icons.close;
  fab.classList.add('cancel');

  if (mode === 'addStop') {
    chip.textContent = 'Toca no mapa para marcar a paragem';
    chip.className = 'mode-chip adding';
  } else if (mode === 'route') {
    chip.textContent = 'Toca na paragem de origem';
    chip.className = 'mode-chip routing';
    state.routeStart = null;
    state.routeEnd = null;
    wayaMap.clearRouteLine(state.map);
    renderMap();
  }
}

function resetMode() {
  setMode('view');
  state.tempMarker = null;
}

// ------------------------------------------------------------- routing

function handleRouteSelection(stopId) {
  const stop = state.stops.find((s) => s.id === stopId);
  if (!stop) return;

  if (!state.routeStart) {
    state.routeStart = stopId;
    document.getElementById('modeChip').textContent = `Origem: ${stop.name}. Toca no destino.`;
    renderMap();
  } else if (state.routeStart !== stopId) {
    state.routeEnd = stopId;
    computeRoute();
  }
}

function computeRoute() {
  const result = wayaRouting.findRoute(state.stops, state.connections, state.routeStart, state.routeEnd, state.city.avg_transfer_cost);
  if (!result) {
    showToast('Não existe rota directa entre estas duas paragens ainda.');
    setMode('route');
    return;
  }

  const coords = result.path.map((id) => {
    const s = state.stops.find((x) => x.id === id);
    return [s.lng, s.lat];
  });
  renderMap();
  wayaMap.renderRouteLine(state.map, coords);
  renderRouteResult(result);
  setMode('view');
  state.mode = 'view';
  openSheet('routeResultSheet');
}

function renderRouteResult(result) {
  const html = `
    <div class="route-card">
      <div class="route-title">${escapeHtml(result.stopNames.join(' → '))}</div>
      <div class="route-meta">
        <span>${icon('route')} ~${result.totalMinutes} min</span>
        <span>${icon('link')} ${result.transfers} troca${result.transfers === 1 ? '' : 's'}</span>
        <span>~${result.estimatedCost} Kz</span>
      </div>
      <div class="route-steps">
        ${result.stopNames.map((n, i) => `
          <div class="route-step">
            <span class="step-dot"></span>
            <span>${escapeHtml(n)}</span>
            ${i < result.stopNames.length - 1 ? `<span class="step-time">${result.legMinutes[i]} min</span>` : ''}
          </div>
          ${i < result.stopNames.length - 1 ? '<div class="step-line"></div>' : ''}
        `).join('')}
      </div>
    </div>`;
  document.getElementById('routeResultContent').innerHTML = html;
}

// ------------------------------------------------------------ folha: paragem

function openStopForm(editId, lngLat) {
  state.editingStopId = editId;
  state.pendingPhotoFile = null;
  document.getElementById('stopFormTitle').textContent = editId ? 'Editar paragem' : 'Nova paragem';
  document.getElementById('stopPhotoPreview').classList.remove('show');
  document.getElementById('stopPhotoPreview').src = '';
  document.getElementById('stopPhotoInput').value = '';
  document.getElementById('stopNameInput').value = '';
  document.getElementById('stopZoneInput').value = '';
  document.getElementById('stopTypeInput').value = 'principal';
  document.getElementById('stopNotesInput').value = '';
  document.getElementById('zoneAutoHint').style.display = 'none';

  if (editId) {
    const s = state.stops.find((x) => x.id === editId);
    if (s) {
      document.getElementById('stopNameInput').value = s.name;
      document.getElementById('stopZoneInput').value = s.zone || '';
      document.getElementById('stopTypeInput').value = s.type || 'principal';
      document.getElementById('stopNotesInput').value = s.notes || '';
      if (s.photo_url) {
        document.getElementById('stopPhotoPreview').src = s.photo_url;
        document.getElementById('stopPhotoPreview').classList.add('show');
      }
    }
  } else if (lngLat) {
    state.tempMarker = { lat: lngLat.lat, lng: lngLat.lng };
    suggestZoneFromLocation(lngLat.lat, lngLat.lng);
  }
  openSheet('stopFormSheet');
}

// Sugere o bairro/zona a partir do ponto tocado no mapa (Nominatim/OpenStreetMap).
// Só preenche se o campo continuar vazio quando a resposta chegar — nunca
// substitui o que a pessoa já tiver escrito entretanto.
async function suggestZoneFromLocation(lat, lng) {
  const suggestion = await window.wayaGeocode.reverseGeocodeZone(lat, lng);
  if (!suggestion) return;
  const zoneInput = document.getElementById('stopZoneInput');
  const stillEditingSameStop = !state.editingStopId && state.tempMarker && state.tempMarker.lat === lat && state.tempMarker.lng === lng;
  if (stillEditingSameStop && !zoneInput.value.trim()) {
    zoneInput.value = suggestion;
    document.getElementById('zoneAutoHint').style.display = 'block';
  }
}

async function saveStop() {
  const name = document.getElementById('stopNameInput').value.trim();
  if (!name) { showToast('O nome da paragem é obrigatório.'); return; }

  const collaborator = await requireCollaborator();
  if (!collaborator) return;

  const zone = document.getElementById('stopZoneInput').value.trim();
  const type = document.getElementById('stopTypeInput').value;
  const notes = document.getElementById('stopNotesInput').value.trim();

  let photoUrl = null;
  if (state.pendingPhotoFile) {
    if (navigator.onLine) {
      try {
        photoUrl = await wayaData.uploadStopPhoto(state.pendingPhotoFile, collaborator.id);
      } catch (err) {
        showToast('Não foi possível enviar a fotografia agora.');
      }
    } else {
      showToast('Sem ligação — a paragem vai ficar sem fotografia por agora.');
    }
  }

  if (state.editingStopId) {
    const stop = state.stops.find((s) => s.id === state.editingStopId);
    const fields = { name, zone, type, notes, ...(photoUrl ? { photo_url: photoUrl } : {}) };
    if (navigator.onLine) {
      try {
        const updated = await wayaData.updateStop(stop.id, fields, state.city.id, collaborator.id, name);
        Object.assign(stop, updated);
      } catch (err) {
        queueAndApplyLocally('edit_stop', { stopId: stop.id, fields, cityId: state.city.id, collaboratorId: collaborator.id, name });
        Object.assign(stop, fields, { updated_by: collaborator.id, updated_at: new Date().toISOString() });
      }
    } else {
      queueAndApplyLocally('edit_stop', { stopId: stop.id, fields, cityId: state.city.id, collaboratorId: collaborator.id, name });
      Object.assign(stop, fields, { updated_by: collaborator.id, updated_at: new Date().toISOString() });
    }
  } else {
    if (!state.tempMarker) { showToast('Não foi possível obter a localização no mapa.'); return; }
    const payload = {
      city_id: state.city.id, name, zone, type, notes,
      lat: state.tempMarker.lat, lng: state.tempMarker.lng,
      photo_url: photoUrl, created_by: collaborator.id
    };
    if (navigator.onLine) {
      try {
        const created = await wayaData.insertStop(payload);
        state.stops.push(created);
      } catch (err) {
        queueAndApplyLocally('add_stop', payload);
        state.stops.push({ ...payload, id: `local_${Date.now()}`, created_at: new Date().toISOString() });
      }
    } else {
      queueAndApplyLocally('add_stop', payload);
      state.stops.push({ ...payload, id: `local_${Date.now()}`, created_at: new Date().toISOString() });
    }
    state.tempMarker = null;
  }

  closeSheet('stopFormSheet');
  persistCacheSnapshot();
  renderMap();
  renderAllLists();
  resetMode();
  showToast('Paragem guardada.');
}

function queueAndApplyLocally(type, payload) {
  wayaData.pushToQueue({ type, payload });
  showToast('Sem ligação — guardado neste dispositivo e será enviado depois.');
  updateQueueStatusText();
}

// -------------------------------------------------------- folha: detalhe

function openStopDetail(stopId) {
  const stop = state.stops.find((s) => s.id === stopId);
  if (!stop) return;
  state.selectedStopId = stopId;

  document.getElementById('detailTitle').textContent = stop.name;
  const photo = document.getElementById('detailPhoto');
  if (stop.photo_url) { photo.src = stop.photo_url; photo.classList.add('show'); }
  else { photo.classList.remove('show'); photo.src = ''; }

  const creator = state.collaborators.find((c) => c.id === stop.created_by);
  const updater = state.collaborators.find((c) => c.id === stop.updated_by);
  const verifCount = state.verifications.filter((v) => v.stop_id === stop.id).length;
  const connCount = state.connections.filter((c) => c.from_stop === stop.id || c.to_stop === stop.id).length;

  const rows = [
    ['Zona', stop.zone || 'Não definida'],
    ['Tipo', stop.type === 'principal' ? 'Principal (terminal)' : 'Secundária'],
    ['Notas', stop.notes || 'Sem notas'],
    ['Coordenadas', `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`],
    ['Ligações', String(connCount)],
    ['Confirmações', String(verifCount)],
    ['Adicionado por', creator ? `${creator.display_name} (${COLLAB_TYPE_LABELS[creator.collab_type] || creator.collab_type})` : 'Desconhecido']
  ];
  if (updater) rows.push(['Última edição', `${updater.display_name} em ${new Date(stop.updated_at).toLocaleDateString('pt')}`]);

  document.getElementById('detailContent').innerHTML = rows.map(([label, value]) =>
    `<div class="detail-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`
  ).join('');

  renderStopConnections(stop.id);

  const recentVerifs = state.verifications
    .filter((v) => v.stop_id === stop.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);
  const verifHtml = recentVerifs.map((v) => {
    const c = state.collaborators.find((x) => x.id === v.collaborator_id);
    return `<div class="activity-item"><span class="activity-dot"></span><span>${escapeHtml(c ? c.display_name : 'Alguém')} confirmou — ${new Date(v.created_at).toLocaleDateString('pt')}</span></div>`;
  }).join('');
  document.getElementById('detailVerifications').innerHTML = verifHtml ? `<div class="activity-list">${verifHtml}</div>` : '';

  openSheet('stopDetailSheet');
}

function renderStopConnections(stopId) {
  const container = document.getElementById('detailConnections');
  const related = state.connections.filter((c) => c.from_stop === stopId || c.to_stop === stopId);

  if (!related.length) {
    container.innerHTML = `<div class="conn-section"><h4>Ligações</h4><p class="hint">Ainda sem ligações a partir desta paragem.</p></div>`;
    return;
  }

  const rows = related.map((c) => {
    const otherId = c.from_stop === stopId ? c.to_stop : c.from_stop;
    const other = state.stops.find((s) => s.id === otherId);
    return `
      <div class="conn-row" data-conn-id="${c.id}">
        <span class="conn-name">${escapeHtml(other ? other.name : 'Paragem removida')}</span>
        <span class="conn-time">${c.time_minutes} min</span>
        <button type="button" class="conn-edit" aria-label="Editar ligação">${icon('edit')}</button>
        <button type="button" class="conn-delete" aria-label="Apagar ligação">${icon('trash')}</button>
      </div>`;
  }).join('');
  container.innerHTML = `<div class="conn-section"><h4>Ligações (${related.length})</h4>${rows}</div>`;

  container.querySelectorAll('.conn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const connId = btn.closest('.conn-row').dataset.connId;
      closeSheet('stopDetailSheet');
      openConnectionForm({ editConnId: connId });
    });
  });
  container.querySelectorAll('.conn-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      const connId = btn.closest('.conn-row').dataset.connId;
      deleteConnectionById(connId);
    });
  });
}

async function deleteConnectionById(connId) {
  const ok = await confirmAction('Apagar esta ligação?', 'Apagar');
  if (!ok) return;

  if (navigator.onLine) {
    try {
      await wayaData.deleteConnection(connId);
    } catch (err) {
      queueAndApplyLocally('delete_connection', { connId });
    }
  } else {
    queueAndApplyLocally('delete_connection', { connId });
  }

  state.connections = state.connections.filter((c) => c.id !== connId);
  persistCacheSnapshot();
  renderMap();
  renderAllLists();
  if (state.selectedStopId) renderStopConnections(state.selectedStopId);
  showToast('Ligação apagada.');
}

async function verifyCurrentStop() {
  const stop = state.stops.find((s) => s.id === state.selectedStopId);
  if (!stop) return;
  const collaborator = await requireCollaborator();
  if (!collaborator) return;

  const already = state.verifications.some((v) => v.stop_id === stop.id && v.collaborator_id === collaborator.id);
  if (already) { showToast('Já confirmaste esta paragem.'); return; }

  const record = { stop_id: stop.id, collaborator_id: collaborator.id, created_at: new Date().toISOString() };
  if (navigator.onLine) {
    try {
      await wayaData.verifyStop(stop.id, collaborator.id, state.city.id, stop.name);
    } catch (err) {
      if (err.message === 'ALREADY_VERIFIED') { showToast('Já confirmaste esta paragem.'); return; }
      queueAndApplyLocally('verify_stop', { stopId: stop.id, collaboratorId: collaborator.id, cityId: state.city.id, name: stop.name });
    }
  } else {
    queueAndApplyLocally('verify_stop', { stopId: stop.id, collaboratorId: collaborator.id, cityId: state.city.id, name: stop.name });
  }
  state.verifications.push(record);
  persistCacheSnapshot();
  renderAllLists();
  renderMap();
  closeSheet('stopDetailSheet');
  showToast('Paragem confirmada — obrigado pela contribuição.');
}

async function deleteCurrentStop() {
  const stop = state.stops.find((s) => s.id === state.selectedStopId);
  if (!stop) return;
  const ok = await confirmAction('Apagar esta paragem e todas as suas ligações? Esta acção não pode ser desfeita.', 'Apagar');
  if (!ok) return;

  const collaborator = await requireCollaborator();
  if (!collaborator) return;

  if (navigator.onLine) {
    try {
      await wayaData.deleteStop(stop.id, state.city.id, collaborator.id, stop.name);
    } catch (err) {
      queueAndApplyLocally('delete_stop', { stopId: stop.id, cityId: state.city.id, collaboratorId: collaborator.id, name: stop.name });
    }
  } else {
    queueAndApplyLocally('delete_stop', { stopId: stop.id, cityId: state.city.id, collaboratorId: collaborator.id, name: stop.name });
  }

  state.stops = state.stops.filter((s) => s.id !== stop.id);
  state.connections = state.connections.filter((c) => c.from_stop !== stop.id && c.to_stop !== stop.id);
  persistCacheSnapshot();
  closeSheet('stopDetailSheet');
  renderMap();
  renderAllLists();
  showToast('Paragem apagada.');
}

// ----------------------------------------------------------- folha: ligação

function openConnectionForm(options = {}) {
  const optionsHtml = state.stops.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('connFromSelect').innerHTML = optionsHtml;
  document.getElementById('connToSelect').innerHTML = optionsHtml;

  state.editingConnectionId = options.editConnId || null;

  if (state.editingConnectionId) {
    const conn = state.connections.find((c) => c.id === state.editingConnectionId);
    document.getElementById('connFormTitle').textContent = 'Editar ligação';
    document.getElementById('connFromSelect').value = conn.from_stop;
    document.getElementById('connToSelect').value = conn.to_stop;
    document.getElementById('connTimeInput').value = conn.time_minutes;
  } else {
    document.getElementById('connFormTitle').textContent = 'Nova ligação';
    document.getElementById('connTimeInput').value = 15;
    if (options.prefillFrom) document.getElementById('connFromSelect').value = options.prefillFrom;
  }
  openSheet('connectionFormSheet');
}

async function saveConnection() {
  const from = document.getElementById('connFromSelect').value;
  const to = document.getElementById('connToSelect').value;
  const time = parseInt(document.getElementById('connTimeInput').value, 10) || 15;

  if (from === to) { showToast('Escolhe duas paragens diferentes.'); return; }
  const duplicate = state.connections.some((c) =>
    c.id !== state.editingConnectionId &&
    ((c.from_stop === from && c.to_stop === to) || (c.from_stop === to && c.to_stop === from)));
  if (duplicate) { showToast('Já existe uma ligação entre estas paragens.'); return; }

  const collaborator = await requireCollaborator();
  if (!collaborator) return;

  if (state.editingConnectionId) {
    const conn = state.connections.find((c) => c.id === state.editingConnectionId);
    const fields = { from_stop: from, to_stop: to, time_minutes: time };
    if (navigator.onLine) {
      try {
        const updated = await wayaData.updateConnection(conn.id, fields);
        Object.assign(conn, updated);
      } catch (err) {
        if (err.message === 'DUPLICATE_CONNECTION') { showToast('Já existe uma ligação entre estas paragens.'); return; }
        queueAndApplyLocally('edit_connection', { connId: conn.id, fields });
        Object.assign(conn, fields);
      }
    } else {
      queueAndApplyLocally('edit_connection', { connId: conn.id, fields });
      Object.assign(conn, fields);
    }
  } else {
    const fromStop = state.stops.find((s) => s.id === from);
    const toStop = state.stops.find((s) => s.id === to);
    const payload = { city_id: state.city.id, from_stop: from, to_stop: to, time_minutes: time, created_by: collaborator.id };

    if (navigator.onLine) {
      try {
        const created = await wayaData.insertConnection(payload);
        state.connections.push(created);
        wayaData.logActivity(state.city.id, collaborator.id, 'add_connection', `Ligou "${fromStop.name}" → "${toStop.name}"`).catch(() => {});
      } catch (err) {
        if (err.message === 'DUPLICATE_CONNECTION') { showToast('Já existe uma ligação entre estas paragens.'); return; }
        queueAndApplyLocally('add_connection', payload);
        state.connections.push({ ...payload, id: `local_${Date.now()}` });
      }
    } else {
      queueAndApplyLocally('add_connection', payload);
      state.connections.push({ ...payload, id: `local_${Date.now()}` });
    }
  }

  closeSheet('connectionFormSheet');
  persistCacheSnapshot();
  renderMap();
  renderAllLists();
  if (state.selectedStopId) renderStopConnections(state.selectedStopId);
  resetMode();
  showToast(state.editingConnectionId ? 'Ligação actualizada.' : 'Ligação criada.');
  state.editingConnectionId = null;
}

// -------------------------------------------------------------- listagens

function renderStopsList() {
  const container = document.getElementById('stopsList');
  const query = (document.getElementById('searchInput').value || '').toLowerCase();
  const filtered = state.stops.filter((s) => s.name.toLowerCase().includes(query) || (s.zone || '').toLowerCase().includes(query));

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">Nenhuma paragem encontrada.<br>Toca em + no mapa para adicionar a primeira.</div>`;
    return;
  }

  container.innerHTML = filtered.map((s) => {
    const verifCount = state.verifications.filter((v) => v.stop_id === s.id).length;
    const connCount = state.connections.filter((c) => c.from_stop === s.id || c.to_stop === s.id).length;
    return `
      <div class="stop-card" data-id="${s.id}">
        <div class="stop-thumb">${s.photo_url ? `<img src="${s.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" alt="">` : icon('pin')}</div>
        <div class="stop-info">
          <h4>${escapeHtml(s.name)} ${verifCount > 0 ? `<span class="verify-badge">${icon('check')} ${verifCount}</span>` : ''}</h4>
          <p>${escapeHtml(s.zone || 'Sem zona')} · ${connCount} ligação${connCount === 1 ? '' : 'ões'}</p>
        </div>
        <span class="type-badge">${s.type === 'principal' ? 'Principal' : 'Secundária'}</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.stop-card').forEach((card) => {
    card.addEventListener('click', () => flyToStop(card.dataset.id));
  });
}

function flyToStop(id) {
  const stop = state.stops.find((s) => s.id === id);
  if (!stop) return;
  switchScreen('screenMap');
  state.map.flyTo({ center: [stop.lng, stop.lat], zoom: 16 });
  setTimeout(() => openStopDetail(id), 650);
}

function renderCollabList() {
  const container = document.getElementById('collabList');
  if (!state.collaborators.length) {
    container.innerHTML = `<div class="empty-state">Ainda não há colaboradores.<br>Adiciona uma paragem ou confirma uma existente para apareceres aqui.</div>`;
    return;
  }

  const sorted = [...state.collaborators].sort((a, b) => (b.contributions || 0) - (a.contributions || 0));
  container.innerHTML = sorted.map((c) => {
    const acts = state.activity.filter((a) => a.collaborator_id === c.id).slice(0, 3);
    const isYou = state.collaborator && c.id === state.collaborator.id;
    return `
      <div class="collab-card">
        <div class="collab-top">
          <div class="collab-avatar">${initialsOf(c.display_name)}</div>
          <div>
            <div class="collab-name">${escapeHtml(c.display_name)}${isYou ? '<span class="you-tag">Tu</span>' : ''}</div>
            <div class="collab-role">${COLLAB_TYPE_LABELS[c.collab_type] || c.collab_type} · desde ${new Date(c.created_at).toLocaleDateString('pt')}</div>
          </div>
        </div>
        <div class="collab-stats">
          <span>${icon('pin')} ${c.contributions || 0} contribuições</span>
          <span>${icon('check')} ${c.verifications || 0} confirmações</span>
        </div>
        ${acts.length ? `<div class="activity-list">${acts.map((a) => `
          <div class="activity-item">
            <span class="activity-dot"></span>
            <span>${escapeHtml(a.description)}</span>
            <span class="activity-time">${new Date(a.created_at).toLocaleDateString('pt')}</span>
          </div>`).join('')}</div>` : ''}
      </div>`;
  }).join('');
}

function updateStats() {
  document.getElementById('statStops').textContent = state.stops.length;
  document.getElementById('statConnections').textContent = state.connections.length;
  document.getElementById('statCollaborators').textContent = state.collaborators.length;
}

function updateQueueStatusText() {
  const queue = wayaData.getQueue();
  document.getElementById('queueStatus').textContent = queue.length
    ? `${queue.length} acção${queue.length === 1 ? '' : 'ões'} por enviar assim que houver ligação.`
    : 'Tudo sincronizado.';
}

function renderAllLists() {
  renderStopsList();
  renderCollabList();
  updateStats();
  updateQueueStatusText();
}

// -------------------------------------------------------------- cidades

async function renderCityList() {
  const container = document.getElementById('cityList');
  container.innerHTML = `<div class="empty-state">A carregar cidades…</div>`;
  let cities = [];
  try {
    cities = await wayaData.listCities();
  } catch (err) {
    cities = state.city ? [state.city] : [];
  }
  container.innerHTML = cities.map((c) => `
    <button class="city-item ${state.city && c.id === state.city.id ? 'active' : ''}" data-name="${escapeHtml(c.name)}" type="button">
      ${escapeHtml(c.name)}
    </button>`).join('');
  container.querySelectorAll('.city-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      closeAllSheets();
      if (btn.dataset.name !== state.city?.name) await loadCity(btn.dataset.name);
    });
  });
}

// ---------------------------------------------------------------- ecrãs
//
// Ver nota em ui.js: o mesmo princípio aplica-se aqui — sair do ecrã Mapa
// empurra uma entrada no histórico, para o retroceder do Android voltar ao
// Mapa em vez de fechar a app.

let screenHistoryPushed = false;
let handlingBackNavigation = false;

function switchScreen(screenId) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === screenId));
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screenId));
  if (screenId === 'screenCollab') renderCollabList();
  if (screenId === 'screenStops') renderStopsList();

  if (screenId !== 'screenMap') {
    if (!screenHistoryPushed && !handlingBackNavigation) {
      screenHistoryPushed = true;
      history.pushState({ wayaScreen: true }, '');
    }
  } else if (screenHistoryPushed && !handlingBackNavigation) {
    screenHistoryPushed = false;
    history.back();
  } else {
    screenHistoryPushed = false;
  }
}

window.wayaBackToMapScreen = function () {
  handlingBackNavigation = true;
  switchScreen('screenMap');
  handlingBackNavigation = false;
};

// -------------------------------------------------------------- wiring

function wireStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon] || ''; });
  document.getElementById('fabIcon').innerHTML = icons.plus;
  document.getElementById('cityPillChevron').innerHTML = icons.chevronDown;
  document.getElementById('searchIcon').innerHTML = icons.search;
  document.getElementById('offlineIcon').innerHTML = icons.cloudOff;
}

function wireNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });
  document.getElementById('profileChipBtn').addEventListener('click', () => switchScreen('screenProfile'));
}

function wireFab() {
  document.getElementById('fabBtn').addEventListener('click', () => {
    if (state.mode === 'view') openSheet('fabSheet');
    else resetMode();
  });
  document.getElementById('actionAddStop').addEventListener('click', () => {
    closeAllSheets();
    switchScreen('screenMap');
    setMode('addStop');
  });
  document.getElementById('actionAddConnection').addEventListener('click', () => {
    if (state.stops.length < 2) { showToast('Adiciona pelo menos duas paragens primeiro.'); return; }
    closeAllSheets();
    openConnectionForm();
  });
  document.getElementById('actionFindRoute').addEventListener('click', () => {
    if (state.stops.length < 2) { showToast('Adiciona pelo menos duas paragens primeiro.'); return; }
    closeAllSheets();
    switchScreen('screenMap');
    setMode('route');
  });
}

function wireSheets() {
  document.getElementById('backdrop').addEventListener('click', () => { closeAllSheets(); resetMode(); });
  document.getElementById('cancelStopBtn').addEventListener('click', () => { closeSheet('stopFormSheet'); resetMode(); });
  document.getElementById('cancelConnBtn').addEventListener('click', () => { closeSheet('connectionFormSheet'); state.editingConnectionId = null; });
  document.getElementById('closeRouteBtn').addEventListener('click', () => {
    closeSheet('routeResultSheet');
    state.routeStart = null;
    state.routeEnd = null;
    wayaMap.clearRouteLine(state.map);
    renderMap();
  });
  document.getElementById('closeDetailBtn').addEventListener('click', () => closeSheet('stopDetailSheet'));

  document.getElementById('cityPillBtn').addEventListener('click', () => { renderCityList(); openSheet('citySheet'); });
  document.getElementById('addCityBtn').addEventListener('click', async () => {
    const name = document.getElementById('newCityInput').value.trim();
    if (!name) return;
    document.getElementById('newCityInput').value = '';
    closeAllSheets();
    await loadCity(name);
    showToast(`Cidade "${name}" pronta a mapear.`);
  });
}

function wireForms() {
  document.getElementById('stopPhotoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.pendingPhotoFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('stopPhotoPreview').src = ev.target.result;
      document.getElementById('stopPhotoPreview').classList.add('show');
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('saveStopBtn').addEventListener('click', saveStop);
  document.getElementById('saveConnBtn').addEventListener('click', saveConnection);
  document.getElementById('verifyStopBtn').addEventListener('click', verifyCurrentStop);
  document.getElementById('editStopBtn').addEventListener('click', () => { closeSheet('stopDetailSheet'); openStopForm(state.selectedStopId); });
  document.getElementById('deleteStopBtn').addEventListener('click', deleteCurrentStop);
  document.getElementById('searchInput').addEventListener('input', renderStopsList);
  document.getElementById('stopZoneInput').addEventListener('input', () => {
    document.getElementById('zoneAutoHint').style.display = 'none';
  });

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const collaborator = await requireCollaborator();
    if (!collaborator) return;
    const name = document.getElementById('profileNameInput').value.trim() || 'Anónimo';
    const type = document.getElementById('profileTypeSelect').value;
    try {
      state.collaborator = await window.waya_updateProfile(collaborator.id, { display_name: name, collab_type: type });
      updateProfileChip();
      showToast('Perfil actualizado.');
    } catch (err) {
      showToast('Sem ligação — não foi possível guardar o perfil agora.');
    }
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = {
      city: state.city?.name, avgCost: state.city?.avg_transfer_cost,
      stops: state.stops, connections: state.connections,
      collaborators: state.collaborators, activity: state.activity,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waya_${(state.city?.name || 'cidade').toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Dados exportados.');
  });

  document.getElementById('clearCacheBtn').addEventListener('click', async () => {
    const ok = await confirmAction('Limpar a cópia local guardada neste telemóvel? Os dados partilhados na nuvem não são afectados.', 'Limpar');
    if (!ok) return;
    if (state.city) localStorage.removeItem(`waya_cache_${state.city.id}`);
    showToast('Cópia local limpa.');
  });

  document.getElementById('saveCostBtn').addEventListener('click', async () => {
    if (!state.city) return;
    const value = parseInt(document.getElementById('cityCostInput').value, 10) || window.WAYA_CONFIG.DEFAULT_AVG_COST;
    if (!navigator.onLine) { showToast('É preciso ligação à internet para alterar isto.'); return; }
    try {
      await wayaData.updateCityCost(state.city.id, value);
      state.city.avg_transfer_cost = value;
      localStorage.setItem('waya_current_city_meta', JSON.stringify(state.city));
      showToast('Custo actualizado.');
    } catch (err) {
      showToast('Não foi possível guardar agora.');
    }
  });

  document.getElementById('syncNowBtn').addEventListener('click', async () => {
    if (!navigator.onLine) { showToast('Sem ligação à internet.'); return; }
    const { sent } = await wayaData.flushQueue();
    if (sent > 0) await refreshFromServer();
    updateQueueStatusText();
    showToast(sent > 0 ? `${sent} acção${sent === 1 ? '' : 'ões'} sincronizada${sent === 1 ? '' : 's'}.` : 'Tudo já estava sincronizado.');
  });
}

function setupOfflineIndicator() {
  const strip = document.getElementById('offlineStrip');
  function reflect() { strip.classList.toggle('show', !navigator.onLine); }

  window.addEventListener('offline', reflect);
  window.addEventListener('online', async () => {
    reflect();
    const { sent } = await wayaData.flushQueue();
    if (sent > 0) {
      showToast(`${sent} alteração${sent === 1 ? '' : 'ões'} sincronizada${sent === 1 ? '' : 's'}.`);
      await refreshFromServer();
    }
    updateQueueStatusText();
  });
  reflect();
}

// --------------------------------------------------------------- utils

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
})();
