# Continuidad

## Estado actual

- Backend con `yt-dlp` funcionando para trackear perfiles y descargar videos.
- Dashboard nuevo con sidebar y look más moderno en `public/`.
- Discovery seeds, candidatos, cola editorial y cuentas de YouTube implementados.
- OAuth real de YouTube integrado en código.
- Subida real de Shorts implementada por API de YouTube con resumable upload.
- Sync de métricas de publicaciones implementado.

## Falta para la primera prueba real de YouTube

- Configurar `GOOGLE_CLIENT_ID`
- Configurar `GOOGLE_CLIENT_SECRET`
- Configurar `GOOGLE_REDIRECT_URI`
- Probar callback OAuth real
- Probar primera subida real a YouTube Shorts
- Ajustar errores reales del publish si aparecen

## Variables nuevas

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `YOUTUBE_DEFAULT_PRIVACY_STATUS`

## Ruta callback

- `/api/youtube/oauth/callback`

## Flujo esperado mañana

1. Crear credenciales OAuth en Google Cloud Console
2. Cargar variables en `.env`
3. Ejecutar `npm.cmd start`
4. Abrir `http://localhost:3000`
5. Agregar cuenta de YouTube
6. Conectar cuenta con `Connect OAuth`
7. Trackear perfil TikTok
8. Elegir video
9. Crear job
10. Publicar Short real

## Nota

- `npm.cmd run check` está pasando.
- El flujo OAuth/upload está implementado, pero no fue validado end-to-end porque faltan credenciales Google reales.
