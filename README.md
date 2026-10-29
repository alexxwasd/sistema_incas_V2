# Sistema INCAS

## Backend y PostgreSQL

1. Instala las dependencias con `npm install`.
2. Crea una base de datos PostgreSQL.
3. Para una base nueva, ejecuta una sola vez `database/schema_completo.sql`; este archivo ya contiene el esquema actual y los catálogos iniciales. No ejecutes también las migraciones sobre esa base.
4. Si ya tienes una base creada con el DDL original, no ejecutes `schema_completo.sql`: aplica una sola vez y en orden las migraciones `database/migrations/001_paneles.sql` a `004_anio_lectivo.sql`. En `psql`, desde la raíz, ejecuta `\i database/migrations/<archivo>.sql` para cada migración.
5. Copia `.env.example` a `.env` y configura los datos reales de conexión. Sustituye `SESSION_SECRET` por una cadena aleatoria larga y privada. `.env` no debe compartirse ni subirse al repositorio.
6. Inicia el servidor con `npm start` o en desarrollo con `npm run dev`.
7. Abre `http://localhost:3000`. La API comprueba la conexión al iniciar; `GET /api/health` permite verificarla después.

Se puede usar `DATABASE_URL` en lugar de `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`. Para una conexión que requiera TLS, configura `DB_SSL=true` y usa un certificado válido.

La API gestiona sesiones firmadas en cookies HTTP-only, valida que las cuentas estén activas y autoriza cada operación según el rol. Las rutas administrativas y los paneles requieren sesión. Cambia `SESSION_SECRET` en producción y sirve el sitio detrás de HTTPS.

El DDL crea las tablas, pero no agrega registros iniciales: inserta especialidades, materias y períodos que utilizará el sistema antes de probar los flujos. Al aprobar una matrícula, el NIE del alumno es su contraseña inicial; para el encargado, los dígitos del DUI sin guion son la contraseña inicial y el usuario. Al crear un docente, también se usa el DUI sin guion como usuario y contraseña inicial. El inicio de sesión acepta el DUI con o sin guion tanto en el usuario como en la contraseña temporal. Al restablecer una cuenta, secretaría devuelve la clave temporal al NIE o a los dígitos del DUI sin guion y el usuario debe crear una contraseña personal al volver a ingresar. Cada cuenta nueva debe elegir una contraseña personal de 8 a 72 bytes al iniciar sesión antes de usar su portal. La migración 002 también pide a los perfiles existentes elegir una contraseña personal; la migración 003 quita los guiones de los usuarios de encargado/docente existentes. Las solicitudes guardan sus tres imágenes en PostgreSQL, con un máximo de 5 MB por archivo. Cada una de las cuatro calificaciones docentes vale 25% del período.

Al revisar una solicitud pendiente, secretaría ingresa el NIE y selecciona una sección de la especialidad solicitada; la aprobación valida y asigna esa sección al alumno en la misma transacción. En la vista Usuarios, la búsqueda queda destinada a restablecer credenciales. Se puede finalizar un período desde el panel administrativo para publicar sus calificaciones a alumnos y encargados.

## Organización del código

- `server.js`: configuración de Express, rutas de la API y arranque del servidor.
- `db.js`: configuración y ciclo de vida del pool de PostgreSQL.
- `public/JS/index.js`: envío del login y redirección por rol.
- `public/JS/matricula.js`: pasos del formulario, carga de especialidades y envío de solicitudes.
- `public/JS/portal_navigation.js`: navegación compartida por los paneles existentes.
- `public/JS/panel_admin.js`: operaciones del panel administrativo.
- `public/JS/panel_alumno.js`: perfil y calificaciones del alumno.
- `public/JS/panel_docente.js`: asignaciones, listas y captura de calificaciones.
- `public/JS/panel_encargado.js`: perfil, alumnos vinculados y notas familiares.
- `database/migrations/001_paneles.sql`: cambios adicionales de esquema que requieren ejecutarse en PostgreSQL.
- `database/migrations/002_credenciales_iniciales.sql`: habilita cambio obligatorio de contraseña y credenciales por DUI.
- `database/migrations/003_dui_sin_guion.sql`: normaliza usuarios existentes de docentes y encargados para guardar el DUI sin guion.
- `database/migrations/004_anio_lectivo.sql`: normaliza el nombre de la columna del año lectivo en `asignacion_docente`.
- `database/schema_completo.sql`: esquema consolidado para instalar el sistema desde cero, incluyendo cambios de las cuatro migraciones y catálogos iniciales.

Cada panel ya tiene su propio HTML (`panel_admin.html`, `panel_docente.html`, `panel_alumno.html` y `panel_encargado.html`). Se mantiene un solo script de navegación para ellos porque comparten el mismo comportamiento; separarlo duplicaría lógica. `package.json` se describe en esta guía porque el formato JSON no admite comentarios.
