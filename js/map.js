

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
