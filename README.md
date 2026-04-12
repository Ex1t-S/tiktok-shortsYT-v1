# Panel de Shorts

Aplicacion para rastrear videos de TikTok, guardarlos en biblioteca y publicarlos en YouTube Shorts desde una cola visible.

## Stack

- Backend: Node.js + Express
- Frontend: HTML + CSS + JavaScript vanilla
- Base de datos: PostgreSQL
- Scraping: Playwright + yt-dlp
- Publicacion: YouTube Data API

## Que hace

- Rastrea perfiles o hashtags de TikTok
- Muestra los resultados en un flujo corto inicial
- Permite guardar videos en biblioteca
- Permite enviar videos a una cola de publicacion
- Publica Shorts en canales de YouTube conectados
- Muestra jobs, workers, metricas y actividad reciente

## Flujo principal

1. Rastrear un perfil o hashtag
2. Revisar resultados
3. Guardar en biblioteca
4. Elegir canal
5. Enviar a cola
6. Publicar o sincronizar desde la cola

## Desarrollo local

Instalar dependencias:

```bash
npm install
```

Levantar la app web:

```bash
npm start
```

Levantar worker de publicaciones:

```bash
npm run worker:publications
```

Levantar worker de discovery:

```bash
npm run worker:discovery
```

Chequeo sintactico:

```bash
npm run check
```

## Variables principales

Copiar `.env.example` y completar al menos:

- `DATABASE_URL`
- `APP_BASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Variables utiles para scraping:

- `YT_DLP_PATH`
- `YT_DLP_PROFILE_LIMIT`
- `SCRAPER_SESSION_DIR`
- `SCRAPER_PROXY_SERVER`
- `SCRAPER_PROXY_USERNAME`
- `SCRAPER_PROXY_PASSWORD`

Variables utiles para almacenamiento:

- `LIBRARY_STORAGE_MODE`
- `LIBRARY_CLOUD_BUCKET`
- `LIBRARY_CLOUD_ENDPOINT`
- `LIBRARY_CLOUD_ACCESS_KEY_ID`
- `LIBRARY_CLOUD_SECRET_ACCESS_KEY`

## Deploy

### Railway

Este proyecto puede servir el frontend directamente desde Express. No hace falta separar frontend y backend para verlo en internet.

La URL publica de Railway serviria:

- `/` -> frontend
- `/api/*` -> API

Servicios recomendados:

1. `web`
   comando: `npm start`
2. `worker-publications`
   comando: `npm run worker:publications`
3. `worker-discovery`
   comando: `npm run worker:discovery`

Notas:

- El repo ya incluye `railway.json` y `Dockerfile`
- Railway requiere login previo en CLI para linkear y desplegar
- Si quieres scraping y publicacion reales, el entorno debe tener Playwright y yt-dlp disponibles

### Vercel

No es el despliegue recomendado para esta app completa porque usa Playwright, yt-dlp y workers persistentes.

## Estado actual

- El servidor arranca correctamente
- La navegacion principal del panel funciona
- El flujo de publicacion real a YouTube ya fue probado
- El tracking inicial ahora trabaja con un barrido corto y permite pedir mas resultados
