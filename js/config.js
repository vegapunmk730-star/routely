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
