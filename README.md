# Waya

> Mapeador de Transporte Informal — uma PWA que mapea paragens e rotas de candongueiros, matatus, danfos e afins, construída pela própria comunidade que as usa.

- **Base de dados partilhada (Supabase/Postgres)** — paragens, ligações, confirmações e colaboradores agora vivem numa base de dados real e são visíveis para toda a gente que usa a mesma cidade.
- **Identidade sem conta** — cada dispositivo assina sessão anónima automaticamente (sem email nem password); é essa identidade que fica associada às contribuições.
- **Actualizações em tempo real** — quando alguém adiciona ou confirma uma paragem, quem tem a app aberta vê a alteração sem recarregar.
- **Fotografias em Supabase Storage** — em vez de imagens gigantes guardadas em Base64 no telemóvel.
- **Modo offline a sério** — os dados da cidade ficam em cache local; acções feitas sem ligação ficam numa fila e são enviadas automaticamente assim que a internet volta.
- **Interface redesenhada** — folhas inferiores em vez de janelas de confirmação do browser, ícones em vez de emojis, e uma paleta própria inspirada na sinalética de transporte.

## Arquitectura

```
waya/
├── index.html                 # estrutura da app
├── manifest.webmanifest       # metadados da PWA
├── sw.js                      # service worker (cache do "app shell")
├── css/
│   └── styles.css             # sistema de tokens de design
├── js/
│   ├── config.js              # URL e chave pública do Supabase
│   ├── supabase-client.js     # sessão anónima + perfil de colaborador
│   ├── data.js                # leitura/escrita, cache offline, fila, tempo real
│   ├── routing.js             # Dijkstra (independente da interface)
│   ├── map.js                 # MapLibre: camadas de paragens/ligações/rota
│   ├── ui.js                  # ícones, folhas inferiores, toasts, confirmação
│   └── app.js                 # estado da aplicação e ligação entre tudo
└── icons/
```


