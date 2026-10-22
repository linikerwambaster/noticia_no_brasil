# Panorama — Notícias do Brasil e do Mundo

Site estático (HTML/CSS/JS puro, sem build) + uma função serverless na Vercel que reúne as manchetes do dia.

## Estrutura

```
index.html          página principal (manchetes + cadastro de email)
unsubscribe.html    cancelamento de inscrição
privacidade.html    política de privacidade
api/news.js         função que busca os feeds RSS, agrupa por assunto e ordena o que está em alta
news-fallback.json  cópia de segurança das manchetes (usada se a API falhar)
vercel.json         força a Vercel a servir como site estático, sem "vite build"
```

> A pasta `api/` precisa ficar na raiz do repositório. É assim que a Vercel reconhece a função.

## Como as notícias funcionam

- A página chama `/api/news` ao abrir e a cada 10 minutos.
- A função lê os feeds RSS oficiais de g1, Folha de S.Paulo, Agência Brasil, CNN Brasil, Poder360 e BBC News Brasil.
- **Em alta** = quantos veículos diferentes cobrem o mesmo assunto + destaque no feed + recência. Não é número de leitores nem de compartilhamentos.
- A faixa amarela "Buscado agora" vem do Google Trends (Brasil).
- Só aparecem título, resumo curto, imagem e link. O clique leva ao site do veículo.
- Resultado fica em cache por 10 minutos na Vercel, então não sobrecarrega os veículos.
- Se a API falhar, a página mostra o `news-fallback.json` com o aviso "edição salva das HH:MM".

## Antes de publicar

1. Trocar `GTM-XXXXXXX` no `index.html` (aparece 2 vezes) pelo ID real do GTM.
2. Conferir `SIGNUP_WEBHOOK_URL` no `index.html` e no `unsubscribe.html` (URL do seu webhook n8n).

## Trocar a fonte de destaque

No `index.html`, procure `--font-display` no começo do CSS e troque o nome da fonte. Depois ajuste o link do Google Fonts no `<head>` para carregar a nova.
Ela controla o logo, os números do ranking e os títulos "BRASIL" / "MUNDO".

## Cores

Definidas no começo do CSS (`--verde` Brasil, `--azul` Mundo, `--brasa` destaque, `--sol` amarelo).
