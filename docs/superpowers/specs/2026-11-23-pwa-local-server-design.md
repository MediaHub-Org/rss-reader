# PWA sin preview ni proxies de terceros — diseño

Fecha: 2026-11-23. Estado: pendiente de aprobación del dueño.

## Por qué

El dueño decidió que el lector es **solo local**. Hoy la PWA instalada refresca
feeds con: fetch directo (casi siempre bloqueado por CORS) → `/proxy` del
servidor `vite preview` (solo si alguien lo arrancó) → tres proxies públicos
(allorigins, corsproxy.io, r.jina.ai). Sin `npm run preview`, cada URL de feed
pasa por terceros. Objetivo: que la PWA refresque **sin arrancar nada a mano y
sin terceros**.

Límite físico: un navegador no puede leer la mayoría de feeds por CORS, así que
hace falta un proceso propio en el equipo. Se acepta un servidor local pequeño
que arranca solo al iniciar sesión.

## Objetivos

- La PWA refresca todos los feeds sin `npm run preview` y sin intervención.
- Ningún salto a terceros en la build web: se eliminan los proxies públicos.
- El servidor solo es accesible desde este equipo y solo desde la propia app.
- Se conservan los datos de la PWA ya instalada.

## No objetivos

- Refresco en segundo plano con la app cerrada.
- Cambios en la app de escritorio/Android (ya hace fetch nativo).
- Autoarranque en macOS/Linux (solo se documenta el comando).

## Anti-objetivos (fallaría aunque funcione)

- Cualquier petición de feed a un servicio ajeno.
- Un puerto abierto a la red local o usable por otras webs como proxy.
- Que la PWA instalada pierda suscripciones/estado por cambiar de origen.

## Enfoques considerados

- **A. Servidor local propio con autoarranque — elegido por el dueño.** Sirve
  `dist/` y `/proxy` en el mismo origen; solo loopback; tarea programada al
  iniciar sesión. Coste: requiere Node y un proceso residente ligero.
- B. PWA sin servidor: solo feeds con CORS; el resto remite a la app de
  escritorio. Descartado: muchos feeds dejarían de refrescar.
- C. La app de escritorio expone un endpoint para la PWA. Descartado: exige
  tenerla abierta y entonces la PWA sobra.

## Diseño

1. **`server/app-server.mjs` (nuevo).** Servidor Node sin dependencias que sirve
   `dist/` y monta `proxyFeedRequest` en `/proxy`.
   - Puerto **4173** (el mismo de `vite preview`), así el origen
     `http://localhost:4173` de la PWA instalada no cambia y sus datos siguen.
   - Escucha solo en loopback (`127.0.0.1` y `::1`); nunca en `0.0.0.0`.
   - Rechaza peticiones cuyo `Host` no sea `localhost:4173`/`127.0.0.1:4173`
     (anti DNS-rebinding).
   - `/proxy` sin cabeceras CORS y rechaza peticiones de otro origen
     (`Origin` ajeno o `Sec-Fetch-Site: cross-site`), así otra web no puede
     usarlo.
   - Estáticos: protección contra path traversal, tipos MIME, fallback SPA a
     `index.html`, `sw.js` y `index.html` con `no-cache`, `assets/` inmutables.
   - Sin `dist/` arranca con un error legible ("ejecuta `npm run build`").
2. **`npm start` / `scripts/launch.mjs`** arranca `app-server.mjs` en vez de
   `vite preview`. `npm run serve` lo lanza en primer plano.
3. **`src/lib/fetchFeed.ts`:** se borran `PUBLIC_PROXIES` y el `Via`
   `public-proxy`. Cadena web: directo → `/proxy` (o `VITE_PROXY_URL`). Si el
   proxy no responde, el error dice que el servidor local no está en marcha y
   cómo arrancarlo.
4. **`server/proxy.mjs` (independiente):** escucha solo en `127.0.0.1`; el
   origen permitido por defecto pasa de `*` a `http://localhost:4173`.
5. **Autoarranque Windows:** `scripts/windows/install-autostart.ps1` y
   `uninstall-autostart.ps1` crean/quitan una tarea programada del usuario al
   iniciar sesión que lanza el servidor sin ventana visible y lo reinicia si
   cae. Instalarla en este equipo se hace al final, con el visto bueno del dueño.
6. **UI:** la nota de Ajustes → Servicios → "Feed fetching" pasa por `t()` con
   su entrada en español y explica que la app usa su propio servidor local, sin
   terceros.
7. **Docs:** README, AGENTS.md y `docs/RELEASING.md` dejan de pedir
   `npm run preview` para usar la PWA; `test:pwa` corre contra el nuevo servidor.

## Verificación

- Unit: `fetchFeed` nunca llama a un host público; mensaje de servidor caído.
- Tests del servidor: traversal, `Host` ajeno, `/proxy` cross-site rechazado,
  loopback, fallback SPA, cabeceras de caché.
- e2e: texto nuevo de Servicios; `test:pwa` (instalable + offline) contra
  `app-server.mjs`.
- Manual: con la tarea instalada, cerrar todo, iniciar sesión, abrir la PWA y
  refrescar; comprobar en DevTools que ninguna petición sale a terceros.

## Decisiones del implementador

Nombres de archivos/scripts, la forma exacta de ocultar la ventana de Node en
la tarea programada, y si CI usa `app-server.mjs` o sigue con `vite preview`
para e2e.
