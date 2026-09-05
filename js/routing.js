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
