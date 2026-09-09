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

## 2. Subir el proyecto e instalar

```bash
# sube esta carpeta al VPS (scp, git, rsync, lo que prefieras), luego:
cd casa-en-orden
npm install
npm run build      # genera la carpeta dist/ (el frontend ya compilado)
```

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

Cuando quieras que te agregue o ajuste algo, te paso el archivo
`src/App.jsx` actualizado. Solo tienes que:

```bash
# reemplaza src/App.jsx por el nuevo archivo, luego:
npm run build
pm2 restart casa-en-orden
```

Tus datos en `data/data.json` no se tocan al actualizar el código.

## Estructura del proyecto

```
casa-en-orden/
├── data/
│   ├── data.json        ← aquí viven todos los datos reales
│   └── backups/         ← copias de seguridad diarias automáticas
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
