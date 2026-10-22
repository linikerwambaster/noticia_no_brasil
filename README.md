# Panorama — Notícias do Brasil e do Mundo

Site estático (HTML/CSS/JS puro), sem build.

- `index.html` — landing page com captura de email
- `unsubscribe.html` — cancelamento de inscrição
- `privacidade.html` — política de privacidade
- `vercel.json` — força a Vercel a servir como site estático (sem `vite build`)

## Antes de publicar
1. Trocar `GTM-XXXXXXX` no `index.html` pelo ID real do GTM.
2. Conferir `SIGNUP_WEBHOOK_URL` no `index.html` e no `unsubscribe.html`.
