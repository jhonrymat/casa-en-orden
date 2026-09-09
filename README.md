# Casa en orden

App de finanzas del hogar para 2 personas (ingresos, gastos, deudas a cuotas,
servicios fijos con fecha de vencimiento, y metas de ahorro).

**Cómo se guardan los datos:** en un archivo `data/data.json` en el propio
servidor. No hay base de datos. Cada vez que alguien guarda algo, el servidor:

1. Hace una copia de seguridad fechada en `data/backups/` (conserva los
   últimos 14 días).
2. Escribe el archivo de forma "atómica" (primero en un archivo temporal y
   luego lo renombra), para que nunca quede a medias si el servidor se cae
   justo en ese instante.

---

## 1. Requisitos en el VPS

- Node.js 18 o superior (`node -v` para verificar).
- npm (viene con Node).

## 2. Descargar el proyecto e instalar

```bash
git clone https://github.com/jhonrymat/casa-en-orden.git
cd casa-en-orden
npm install
npm run build      # genera la carpeta dist/ (el frontend ya compilado)
```

El repositorio es **público**, así que solo contiene código — nunca los
datos reales de la casa. La primera vez que arranques el servidor (paso 3),
él mismo crea `data/data.json` vacío en el VPS a partir de la plantilla
`data/data.example.json`. Ese archivo con los datos reales nunca se sube a
GitHub (está en `.gitignore`).

## 3. Probar que funciona

```bash
npm start           # equivale a: node server/index.js
```

Abre `http://IP_DE_TU_VPS:3001` en el navegador. Deberías ver la pantalla de
creación de los dos perfiles. Cuando confirmes que funciona, detén el proceso
(Ctrl+C) y sigue al paso 4 para dejarlo corriendo permanentemente.

## 4. Dejarlo corriendo siempre (pm2)

```bash
npm install -g pm2
pm2 start server/index.js --name casa-en-orden
pm2 save
pm2 startup        # sigue la instrucción que te imprime, para que arranque
                    # automáticamente si el VPS se reinicia
```

Comandos útiles después:
```bash
pm2 logs casa-en-orden     # ver qué está pasando
pm2 restart casa-en-orden  # reiniciar (por ejemplo, tras actualizar código)
```

## 5. Exponerlo con tu dominio y HTTPS (Nginx + Certbot)

Instala Nginx y Certbot, y crea un archivo de configuración, por ejemplo
`/etc/nginx/sites-available/casa-en-orden`:

```nginx
server {
    listen 80;
    server_name finanzas.tudominio.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/casa-en-orden /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d finanzas.tudominio.com
```

## 6. Importante: protege el acceso

El PIN de 4 dígitos dentro de la app es solo para diferenciar quién registró
cada movimiento — **no es una contraseña de verdad** (no está pensado para
resistir a alguien que intente adivinarlo a propósito). Como esta app va a
quedar expuesta en internet con datos financieros reales, te recomiendo
agregar una contraseña compartida a nivel de Nginx (Basic Auth), para que
nadie más pueda ni siquiera cargar la página:

```bash
apt install apache2-utils
htpasswd -c /etc/nginx/.htpasswd hogar
```

Y dentro del bloque `location /` en el archivo de Nginx, agrega:

```nginx
auth_basic "Casa en orden";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Recarga Nginx (`systemctl reload nginx`) y listo: el navegador pedirá esa
contraseña compartida antes de mostrar la app, y luego cada quien entra con
su perfil y PIN dentro de la app.

## 7. Respaldos fuera del servidor

Los respaldos automáticos en `data/backups/` te protegen de errores dentro
de la app, pero no de que el disco del VPS falle. Te recomiendo copiar
`data/data.json` a otro lugar de vez en cuando (tu computador, Google
Drive, etc.). Un cron simple semanal:

```bash
crontab -e
# agrega esta línea (ajusta la ruta de destino a donde prefieras):
0 3 * * 0 cp /ruta/a/casa-en-orden/data/data.json /ruta/de/respaldo/data-$(date +\%F).json
```

## 8. Cómo actualizar la app más adelante

Cuando quieras que te agregue o ajuste algo, súbelo a tu repositorio de
GitHub desde tu computador (`git add`, `git commit`, `git push`), y luego
en el VPS:

```bash
cd casa-en-orden
git pull
npm install     # solo hace falta si cambiaron las dependencias
npm run build
pm2 restart casa-en-orden
```

Como `data/data.json` está en `.gitignore`, el `git pull` nunca lo toca —
tus datos reales quedan intactos en el VPS y nunca pasan por GitHub.

## 9. Si ya habías subido `data.json` con datos reales al repositorio

Como el repositorio es público, si el `data.json` con información real
alcanzó a subirse antes de aplicar el `.gitignore`, hay que quitarlo del
repositorio (y, para dejarlo completamente limpio, de su historial). Desde
tu computador, dentro de la carpeta del proyecto:

```bash
git rm --cached data/data.json
git add .gitignore
git commit -m "No rastrear datos reales del hogar"
git push
```

Con esto, la próxima subida ya no lo incluye. Pero **ojo**: si el
repositorio ya es público y ese archivo tuvo información financiera real
en algún commit anterior, técnicamente sigue quedando visible en el
historial de GitHub para quien sepa buscarlo, hasta que se reescriba ese
historial. Si llegaste a subir datos reales (no solo la plantilla vacía),
avísame y te doy los comandos exactos para limpiar el historial por
completo (`git filter-repo` o similar) — es un paso más delicado y mejor
hacerlo con cuidado.

## Estructura del proyecto

```
casa-en-orden/
├── data/
│   ├── data.example.json ← plantilla vacía, esta sí va al repositorio
│   ├── data.json          ← datos reales, solo existe en el VPS (ignorado por git)
│   └── backups/           ← copias de seguridad diarias (ignorado por git)
├── server/
│   └── index.js         ← servidor Express (API + sirve la app)
├── src/
│   ├── App.jsx           ← toda la app (pantallas, formularios, lógica)
│   ├── lib/
│   │   ├── storage.js     ← habla con la API del servidor
│   │   └── defaultData.js
│   ├── main.jsx
│   └── index.css
├── dist/                 ← se genera con `npm run build` (no se sube a git)
└── package.json
```
