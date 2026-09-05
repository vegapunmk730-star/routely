# Waya

> Mapeador de Transporte Informal — uma PWA que mapea paragens e rotas de candongueiros, matatus, danfos e afins, construída pela própria comunidade que as usa.

## O que mudou nesta versão

A primeira versão do Waya era um único ficheiro HTML com tudo guardado em `localStorage` — o que significava que os dados de cada pessoa ficavam presos no telemóvel dela, sem nenhuma partilha real entre colaboradores. Esta versão resolve isso:

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

Sem framework, sem etapa de build — é só abrir o `index.html` num servidor estático (ou directamente no telemóvel).

## Base de dados

O esquema (tabelas `cities`, `stops`, `connections`, `collaborators`, `stop_verifications`, `activity_log`) já está criado no projecto Supabase ligado a esta conversa, com Row Level Security activo: qualquer pessoa pode ler os dados, mas só um colaborador autenticado (mesmo que anonimamente) pode escrever, e cada escrita fica sempre associada a quem a fez.

Se precisares de recriar isto noutro projecto Supabase, os ficheiros de migração usados estão descritos no histórico do projecto — pede-me e volto a gerar o SQL.

## Preparado para Android

- Ícones em 9 tamanhos (48 a 512px), incluindo variantes "maskable" com margem de segurança para os ícones adaptativos do Android.
- Atalhos no ícone da app (mantém premido o ícone no ecrã principal): "Adicionar paragem" e "Encontrar rota" abrem directamente nesse modo.
- Botão de retroceder do Android tratado correctamente: fecha a folha ou o ecrã actual em vez de sair da app de repente.
- `manifest.webmanifest` completo (`display_override`, `categories`, ícone e cor de splash) para uma instalação com aspecto nativo.

### Transformar num ficheiro instalável (APK/AAB)

Depois de publicado num domínio HTTPS, a forma mais simples é o **PWABuilder**:

1. Abre [pwabuilder.com](https://www.pwabuilder.com) e cola o URL da app publicada.
2. A ferramenta lê o `manifest.webmanifest` e o `sw.js` (já estão prontos) e mostra uma pontuação.
3. Escolhe "Android" e descarrega o pacote — dá um APK para instalar directamente num telemóvel, ou um AAB assinado pronto a submeter à Google Play Store.

Publicar na Play Store exige uma conta de programador Google (pagamento único de $25) — isso é sempre exigido pela Google, independentemente da ferramenta usada.

Alternativa com mais controlo: [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap) (`npm install -g @bubblewrap/cli`), que gera o mesmo tipo de pacote localmente.



Qualquer alojamento de ficheiros estáticos serve (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Basta publicar a pasta tal como está — não há passo de build.

## Como usar

1. Abre a app — assina sessão automaticamente, sem perguntas.
2. Escolhe ou cria a tua cidade no topo.
3. Toca no botão **+** no mapa para adicionar uma paragem, criar uma ligação ou encontrar uma rota.
4. Toca numa paragem no mapa (ou na lista de Paragens) para ver detalhes, confirmar que existe, editar ou apagar.
5. Em **Perfil**, define o teu nome e tipo de colaborador — é o que aparece no ranking de Colaboradores.

## Licença

MIT — livre para usar, modificar e distribuir.
