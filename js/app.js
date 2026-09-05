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

async function boot() {
  console.log('[WAYA] Boot iniciado');
  try {
    wireStaticIcons();
    wireNav();
    wireFab();
    wireSheets();
    wireForms();
    setupOfflineIndicator();

    // Diagnóstico imediato no console (F12 → Console)
    if (typeof maplibregl === 'undefined') {
      console.error('[WAYA] ERRO: maplibregl não carregou. Verifica CDN ou bloqueadores.');
    }
    if (typeof supabase === 'undefined') {
      console.error('[WAYA] ERRO: supabase não carregou. Verifica CDN ou bloqueadores.');
    }
    if (!window.wayaData) {
      console.error('[WAYA] ERRO: data.js não está disponível (wayaData undefined).');
    }
    if (!window.wayaMap) {
      console.error('[WAYA] ERRO: map.js não está disponível (wayaMap undefined).');
    }

    try {
      if (window.waya_getOrCreateCollaborator) {
        state.collaborator = await window.waya_getOrCreateCollaborator();
      } else {
        console.warn('[WAYA] waya_getOrCreateCollaborator não encontrado');
      }
    } catch (err) {
      console.warn('[WAYA] Colaborador offline:', err.message);
      state.collaborator = null;
    }
    updateProfileChip();

    const cityName = localStorage.getItem('waya_current_city') || window.WAYA_CONFIG.DEFAULT_CITY;
    await loadCity(cityName);

    consumeLaunchAction();
  } catch (err) {
    console.error('[WAYA] Erro fatal no arranque:', err);
    showToast('Erro ao iniciar: ' + (err?.message || 'desconhecido'));
  } finally {
    // GARANTE que o splash desaparece mesmo em caso de erro grave
    console.log('[WAYA] Boot terminado — a esconder splash');
    const veil = document.getElementById('loadingVeil');
    if (veil) veil.classList.add('hidden');
  }
}

async function loadCity(name) {
  console.log('[WAYA] loadCity:', name);
  let city;
  try {
    if (!window.wayaData?.getOrCreateCity) throw new Error('Dados indisponíveis');
    city = await wayaData.getOrCreateCity(name);
    localStorage.setItem('waya_current_city_meta', JSON.stringify(city));
  } catch (err) {
    console.warn('[WAYA] getOrCreateCity falhou:', err.message);
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
    if (window.wayaData?.fetchCityDataset) {
      dataset = await wayaData.fetchCityDataset(city.id);
    } else {
      throw new Error('fetchCityDataset indisponível');
    }
  } catch (err) {
    console.warn('[WAYA] fetchCityDataset falhou:', err.message);
    try {
      dataset = window.wayaData?.loadCachedDataset ? wayaData.loadCachedDataset(city.id) : null;
    } catch (e2) {
      dataset = null;
    }
    if (!dataset) {
      dataset = { stops: [], connections: [], activity: [], collaborators: [], verifications: [] };
      showToast('Sem ligação — a mostrar dados guardados neste dispositivo.');
    }
  }
  applyDataset(dataset);

  // Criação do mapa com protecção total
  if (typeof maplibregl !== 'undefined' && window.wayaMap) {
    try {
      if (!state.map) {
        state.map = wayaMap.createMap('map', {
          onLoad: () => renderMap(),
          onMapClick: (lngLat) => { if (state.mode === 'addStop') openStopForm(null, lngLat); },
          onStopClick: handleStopClickOnMap
        });
      } else if (state.map.isStyleLoaded && state.map.isStyleLoaded()) {
        renderMap();
        fitToStops();
      } else if (state.map.once) {
        state.map.once('load', () => { renderMap(); fitToStops(); });
      }
    } catch (mapErr) {
      console.error('[WAYA] Erro no mapa:', mapErr);
      showToast('Erro ao carregar o mapa.');
    }
  } else {
    console.warn('[WAYA] MapLibre indisponível — mapa omitido');
    showToast('Biblioteca do mapa não carregou.');
  }

  if (state.unsubscribeRealtime) state.unsubscribeRealtime();
  if (navigator.onLine && window.wayaData?.subscribeToCity) {
    try {
      state.unsubscribeRealtime = wayaData.subscribeToCity(city.id, debounce(refreshFromServer, 700));
    } catch (err) {
      console.warn('[WAYA] Realtime indisponível:', err.message);
    }
  }

  renderAllLists();
  console.log('[WAYA] loadCity concluído');
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
  }
  openSheet('stopFormSheet');
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
