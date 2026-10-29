// Carga configuración local antes de crear conexiones o firmar sesiones.
require('dotenv').config();

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./db');

const app = express();
const SESSION_COOKIE = 'incas_session';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const SESSION_SECRET = process.env.SESSION_SECRET
    || (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error('Configura SESSION_SECRET con al menos 32 caracteres aleatorios.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    // Los paneles y la API son privados y no deben quedar guardados en cachés compartidas.
    if (req.path.startsWith('/api/') || req.path.startsWith('/panel_')
        || req.path === '/cambiar_contrasena.html') {
        res.setHeader('Cache-Control', 'no-store');
    }

    req.session = readSession(req);
    next();
});

// Una cookie firmada no sustituye la comprobación de que la cuenta siga activa.
async function loadActiveSession(req) {
    if (!req.session) {
        return null;
    }
    const result = await db.query(
        `SELECT u.id_usuario, u.correo, u.estado, u.debe_cambiar_contrasena, r.nombre_rol
         FROM usuarios AS u
         JOIN roles AS r ON r.id_rol = u.id_rol
         WHERE u.id_usuario = $1`,
        [req.session.id]
    );
    if (!result.rowCount || !result.rows[0].estado) {
        return null;
    }
    return {
        id: result.rows[0].id_usuario,
        role: result.rows[0].nombre_rol,
        email: result.rows[0].correo,
        mustChangePassword: result.rows[0].debe_cambiar_contrasena,
        exp: req.session.exp
    };
}

// Exige sesión al abrir paneles, no solo al llamar a sus rutas de datos.
app.use(async (req, res, next) => {
    const panelRoles = {
        '/panel_admin.html': ['administrador', 'admin', 'secretaria'],
        '/panel_alumno.html': ['alumno', 'estudiante'],
        '/panel_docente.html': ['docente'],
        '/panel_encargado.html': ['encargado'],
        '/cambiar_contrasena.html': null
    };
    if (req.path === '/cambiar_contrasena.html') {
        try {
            const session = await loadActiveSession(req);
            if (!session) {
                clearSessionCookie(res);
                return res.redirect('/');
            }
            req.session = session;
            if (!session.mustChangePassword) {
                return res.redirect(rolePage(session.role) || '/');
            }
            return next();
        } catch (error) {
            console.error('Error verificando la sesión para cambiar contraseña:', error);
            return res.status(503).send('No fue posible verificar la sesión en este momento.');
        }
    }
    const requiredRoles = panelRoles[req.path];

    if (!requiredRoles) {
        return next();
    }
    try {
        const session = await loadActiveSession(req);
        if (!session) {
            clearSessionCookie(res);
            return res.redirect('/');
        }
        req.session = session;
        if (session.mustChangePassword) {
            return res.redirect('/cambiar_contrasena.html');
        }
        if (!requiredRoles.includes(normalizeRole(session.role))) {
            return res.status(403).send('Tu cuenta no tiene acceso a este portal.');
        }
        next();
    } catch (error) {
        console.error('Error verificando la sesión del portal:', error);
        res.status(503).send('No fue posible verificar la sesión en este momento.');
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Las mutaciones del sitio solo aceptan solicitudes del mismo origen.
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const origin = req.get('origin');
    if (origin) {
        let originHost;
        try {
            originHost = new URL(origin).host;
        } catch {
            return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
        }
        if (originHost !== req.get('host')) {
            return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
        }
    }
    next();
});

function signSession(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}

function readSession(req) {
    const cookieHeader = req.headers.cookie || '';
    const cookie = cookieHeader.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

    if (!cookie) {
        return null;
    }

    const token = cookie.slice(SESSION_COOKIE.length + 1);
    const [encoded, suppliedSignature] = token.split('.');
    if (!encoded || !suppliedSignature) {
        return null;
    }

    const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET)
        .update(encoded)
        .digest();
    let actualSignature;
    try {
        actualSignature = Buffer.from(suppliedSignature, 'base64url');
    } catch {
        return null;
    }
    if (actualSignature.length !== expectedSignature.length
        || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!Number.isInteger(payload.id) || typeof payload.role !== 'string'
            || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION_SECONDS}${secure}`
    );
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
    );
}

function normalizeRole(role) {
    return String(role || '').trim().toLocaleLowerCase('es');
}

function requireRole(...roles) {
    const allowed = new Set(roles.map(normalizeRole));
    return async (req, res, next) => {
        if (!req.session) {
            return res.status(401).json({ error: 'Inicia sesión para continuar.' });
        }
        try {
            const activeSession = await loadActiveSession(req);
            if (!activeSession) {
                clearSessionCookie(res);
                return res.status(401).json({ error: 'La sesión ya no está activa.' });
            }
            req.session = activeSession;
            if (!allowed.has(normalizeRole(activeSession.role))) {
                return res.status(403).json({ error: 'Tu cuenta no tiene permiso para esta acción.' });
            }
            if (activeSession.mustChangePassword) {
                return res.status(403).json({ error: 'Debes crear una contraseña personal antes de continuar.' });
            }
            next();
        } catch (error) {
            handleDatabaseError(error, res, 'Error verificando permisos de cuenta:');
        }
    };
}

const requireAdmin = requireRole('administrador', 'admin', 'secretaria');
const requireTeacher = requireRole('docente');
const requireStudent = requireRole('alumno', 'estudiante');
const requireGuardian = requireRole('encargado');

function normalizeDui(value) {
    if (typeof value !== 'string' || !/^\d{8}-?\d$/.test(value)) {
        return null;
    }
    const digits = value.replace('-', '');
    return `${digits.slice(0, 8)}-${digits.slice(8)}`;
}

function duiDigits(value) {
    const formattedDui = normalizeDui(value);
    return formattedDui ? formattedDui.replace(/\D/g, '') : null;
}

function rolePage(role) {
    const pages = {
        administrador: 'panel_admin.html',
        admin: 'panel_admin.html',
        secretaria: 'panel_admin.html',
        alumno: 'panel_alumno.html',
        estudiante: 'panel_alumno.html',
        docente: 'panel_docente.html',
        encargado: 'panel_encargado.html'
    };
    return pages[normalizeRole(role)];
}

function sessionIdentity(req) {
    return Number(req.session.id);
}

function handleDatabaseError(error, res, message) {
    console.error(message, error);
    if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
    }
    if (error.code === '23503') {
        return res.status(400).json({ error: 'La referencia seleccionada no existe.' });
    }
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
}

function withTransaction(work) {
    return async (req, res) => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client, req, res);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    };
}

// Valida tipos reales de archivo, tamaño y firma binaria antes de guardarlos en BYTEA.
const uploadDocuments = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 3, fields: 20, parts: 23, fieldSize: 16 * 1024 },
    fileFilter: (req, file, callback) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
            return callback(new Error('Adjunta únicamente imágenes JPG, PNG o WebP.'));
        }
        callback(null, true);
    }
}).fields([
    { name: 'partida_nacimiento', maxCount: 1 },
    { name: 'notas_grado_anterior', maxCount: 1 },
    { name: 'carta_conducta', maxCount: 1 }
]);

function verifiedImage(file) {
    if (!file) {
        return false;
    }
    const bytes = file.buffer;
    if (file.mimetype === 'image/jpeg') {
        return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (file.mimetype === 'image/png') {
        return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    return file.mimetype === 'image/webp'
        && bytes.toString('ascii', 0, 4) === 'RIFF'
        && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function missingDocuments(files) {
    const names = ['partida_nacimiento', 'notas_grado_anterior', 'carta_conducta'];
    return names.filter((name) => !files?.[name]?.[0] || !verifiedImage(files[name][0]));
}

// Confirma que el backend y PostgreSQL se pueden consultar.
app.get('/api/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
        console.error('Error verificando la conexión con PostgreSQL:', error);
        res.status(503).json({ status: 'error', database: 'unavailable' });
    }
});

app.get('/api/roles', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id_rol, nombre_rol FROM roles ORDER BY id_rol'
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando los roles:');
    }
});

app.get('/api/especialidades', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id_especialidad, nombre_especialidad FROM especialidades ORDER BY nombre_especialidad'
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando las especialidades:');
    }
});

// Valida la contraseña bcrypt y firma una cookie de sesión protegida.
app.post('/api/login', async (req, res) => {
    const { identificador, contraseña } = req.body || {};
    if (typeof identificador !== 'string' || typeof contraseña !== 'string'
        || !identificador.trim() || !contraseña) {
        return res.status(400).json({ error: 'Ingrese su identificador y contraseña.' });
    }

    try {
        const loginIdentifier = duiDigits(identificador.trim()) || identificador.trim();
        const result = await db.query(
            `SELECT u.id_usuario, u.correo,
                    COALESCE(to_jsonb(u)->>'contrasena', to_jsonb(u)->>$2, to_jsonb(u)->>$3) AS password_hash,
                    u.estado, u.debe_cambiar_contrasena, r.nombre_rol
             FROM usuarios AS u
             JOIN roles AS r ON r.id_rol = u.id_rol
             WHERE lower(u.correo) = lower($1)
                OR u.id_usuario IN (
                    SELECT id_usuario FROM secretaria
                    WHERE regexp_replace(dui_secretaria, '[^0-9]', '', 'g')
                          = regexp_replace($1, '[^0-9]', '', 'g')
                    UNION
                    SELECT id_usuario FROM docentes
                    WHERE regexp_replace(dui_docente, '[^0-9]', '', 'g')
                          = regexp_replace($1, '[^0-9]', '', 'g')
                    UNION
                    SELECT id_usuario FROM encargados
                    WHERE regexp_replace(dui_encargado, '[^0-9]', '', 'g')
                          = regexp_replace($1, '[^0-9]', '', 'g')
                    UNION
                    SELECT id_usuario FROM alumnos WHERE nie_alumno = $1
                )
             LIMIT 1`,
            [loginIdentifier, 'contraseña', 'contrase\u00a4a']
        );

        const usuario = result.rows[0];
        const loginPassword = ['docente', 'encargado'].includes(normalizeRole(usuario?.nombre_rol))
            ? duiDigits(contraseña) || contraseña
            : contraseña;
        if (!usuario || !usuario.estado
            || !await bcrypt.compare(loginPassword, usuario.password_hash || '')) {
            return res.status(401).json({ error: 'Credenciales incorrectas o cuenta inactiva.' });
        }

        const token = signSession({
            id: usuario.id_usuario,
            role: usuario.nombre_rol,
            email: usuario.correo,
            exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS
        });
        setSessionCookie(res, token);
        res.json({
            id_usuario: usuario.id_usuario,
            correo: usuario.correo,
            rol: usuario.nombre_rol,
            debe_cambiar_contrasena: usuario.debe_cambiar_contrasena
        });
    } catch (error) {
        handleDatabaseError(error, res, 'Error procesando el inicio de sesión:');
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session) {
        return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    }
    try {
        const session = await loadActiveSession(req);
        if (!session) {
            clearSessionCookie(res);
            return res.status(401).json({ error: 'La sesión ya no está activa.' });
        }
        req.session = session;
        res.json({
            id_usuario: sessionIdentity(req),
            rol: session.role,
            correo: session.email,
            debe_cambiar_contrasena: session.mustChangePassword
        });
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando la sesión:');
    }
});

// Solo la cuenta autenticada puede sustituir su clave temporal por una propia.
app.post('/api/cambiar-contrasena', async (req, res) => {
    if (!req.session) {
        return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    }
    const newPassword = req.body?.nueva_contrasena;
    const confirmation = req.body?.confirmar_contrasena;
    if (typeof newPassword !== 'string' || newPassword.length < 8
        || Buffer.byteLength(newPassword, 'utf8') > 72) {
        return res.status(400).json({ error: 'La contraseña personal debe tener entre 8 y 72 bytes.' });
    }
    if (newPassword !== confirmation) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }

    try {
        const session = await loadActiveSession(req);
        if (!session) {
            clearSessionCookie(res);
            return res.status(401).json({ error: 'La sesión ya no está activa.' });
        }
        if (!session.mustChangePassword) {
            return res.status(409).json({ error: 'Esta cuenta ya tiene una contraseña personal.' });
        }
        const currentPassword = await db.query(
            'SELECT contrasena FROM usuarios WHERE id_usuario = $1',
            [session.id]
        );
        if (!currentPassword.rowCount
            || await bcrypt.compare(newPassword, currentPassword.rows[0].contrasena)) {
            return res.status(400).json({ error: 'Elige una contraseña distinta de la temporal.' });
        }
        await db.query(
            `UPDATE usuarios
             SET contrasena = $1, debe_cambiar_contrasena = FALSE
             WHERE id_usuario = $2`,
            [await bcrypt.hash(newPassword, 12), session.id]
        );
        res.json({ mensaje: 'Contraseña actualizada. Ya puedes entrar a tu portal.', rol: session.role });
    } catch (error) {
        handleDatabaseError(error, res, 'Error cambiando la contraseña:');
    }
});

app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
});

// Matrícula se envía como multipart para guardar los datos y las tres imágenes.
app.post('/api/solicitudes-matricula', (req, res, next) => {
    uploadDocuments(req, res, (error) => {
        if (error) {
            if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'Cada documento puede pesar como máximo 5 MB.' });
            }
            return res.status(400).json({ error: error.message || 'No se pudieron leer los documentos.' });
        }
        next();
    });
}, withTransaction(async (client, req, res) => {
    const {
        nombre_est, apellido_est, fecha_nac_est, correo_est, telefono_est,
        direccion_est, tipo_bachillerato, id_especialidad, nombre_rep,
        apellido_rep, dui_rep, telefono_rep
    } = req.body || {};
    const missing = missingDocuments(req.files);
    if (missing.length) {
        return res.status(400).json({ error: 'Adjunta imágenes JPG, PNG o WebP válidas para los tres documentos.' });
    }

    const textFields = [
        ['nombre_est', nombre_est, 50], ['apellido_est', apellido_est, 50],
        ['correo_est', correo_est, 100], ['telefono_est', telefono_est, 20],
        ['direccion_est', direccion_est, null], ['tipo_bachillerato', tipo_bachillerato, 50],
        ['nombre_rep', nombre_rep, 50], ['apellido_rep', apellido_rep, 50],
        ['dui_rep', dui_rep, 10], ['telefono_rep', telefono_rep, 20]
    ];
    for (const [field, value, maxLength] of textFields) {
        if (typeof value !== 'string' || !value.trim()
            || (maxLength !== null && value.length > maxLength)) {
            return res.status(400).json({ error: `El campo ${field} es obligatorio o supera su longitud permitida.` });
        }
    }

    const birthDate = typeof fecha_nac_est === 'string'
        ? new Date(`${fecha_nac_est}T00:00:00.000Z`)
        : null;
    if (!birthDate || Number.isNaN(birthDate.getTime())
        || birthDate.toISOString().slice(0, 10) !== fecha_nac_est) {
        return res.status(400).json({ error: 'La fecha de nacimiento no es válida.' });
    }
    const specialtyId = /^\d+$/.test(String(id_especialidad))
        ? Number(id_especialidad)
        : Number.NaN;
    if (!Number.isSafeInteger(specialtyId) || specialtyId < 1 || specialtyId > 2147483647) {
        return res.status(400).json({ error: 'Seleccione una especialidad válida.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo_est.trim())) {
        return res.status(400).json({ error: 'Ingrese un correo electrónico válido.' });
    }
    if (!['General', 'Técnico'].includes(tipo_bachillerato.trim())) {
        return res.status(400).json({ error: 'El tipo de bachillerato seleccionado no es válido.' });
    }
    if (![telefono_est, telefono_rep].every((phone) => /^\+?[0-9]{7,15}$/.test(phone.trim()))) {
        return res.status(400).json({ error: 'Los teléfonos deben tener de 7 a 15 dígitos.' });
    }
    const normalizedDui = normalizeDui(dui_rep);
    if (!normalizedDui) {
        return res.status(400).json({ error: 'El DUI del encargado debe contener nueve dígitos.' });
    }

    const values = textFields.map(([, value]) => value.trim());
    const inserted = await client.query(
        `INSERT INTO solicitudes_matricula (
            nombre_est, apellido_est, fecha_nac_est, correo_est, telefono_est,
            direccion_est, tipo_bachillerato, id_especialidad, nombre_rep,
            apellido_rep, dui_rep, telefono_rep, estado_solicitud
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pendiente')
        RETURNING id_solicitud, fecha_solicitud`,
        [
            values[0], values[1], fecha_nac_est, values[2], values[3],
            values[4], values[5], specialtyId, values[6], values[7],
            normalizedDui, values[9]
        ]
    );
    const files = req.files;
    const file = (name) => files[name][0];
    const birth = file('partida_nacimiento');
    const grades = file('notas_grado_anterior');
    const conduct = file('carta_conducta');
    await client.query(
        `INSERT INTO solicitud_documentos (
            id_solicitud, partida_nacimiento, partida_nombre, partida_mime,
            notas_grado_anterior, notas_nombre, notas_mime,
            carta_conducta, carta_nombre, carta_mime
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            inserted.rows[0].id_solicitud,
            birth.buffer, path.basename(birth.originalname), birth.mimetype,
            grades.buffer, path.basename(grades.originalname), grades.mimetype,
            conduct.buffer, path.basename(conduct.originalname), conduct.mimetype
        ]
    );

    res.status(201).json({
        mensaje: 'Solicitud de matrícula recibida.',
        solicitud: inserted.rows[0]
    });
}));

// Lista solicitudes y muestra si los documentos están disponibles para revisión.
app.get('/api/admin/solicitudes', requireAdmin, async (req, res) => {
    const state = req.query.estado;
    if (state && !['pendiente', 'aprobada', 'rechazada'].includes(state)) {
        return res.status(400).json({ error: 'El filtro de estado no es válido.' });
    }
    try {
        const result = await db.query(
            `SELECT s.id_solicitud, s.nombre_est, s.apellido_est, s.fecha_nac_est,
                    s.correo_est, s.telefono_est, s.direccion_est, s.tipo_bachillerato,
                    s.id_especialidad, e.nombre_especialidad, s.nombre_rep,
                    s.apellido_rep, s.dui_rep, s.telefono_rep, s.nie_alumno,
                    s.estado_solicitud, s.fecha_solicitud,
                    (d.id_solicitud IS NOT NULL) AS tiene_documentos
             FROM solicitudes_matricula AS s
             JOIN especialidades AS e ON e.id_especialidad = s.id_especialidad
             LEFT JOIN solicitud_documentos AS d ON d.id_solicitud = s.id_solicitud
             WHERE ($1::text IS NULL OR s.estado_solicitud = $1)
             ORDER BY s.fecha_solicitud DESC NULLS LAST, s.id_solicitud DESC`,
            [state || null]
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando solicitudes de matrícula:');
    }
});

// Solo el personal administrativo puede abrir documentos recibidos.
app.get('/api/admin/solicitudes/:id/documentos/:tipo', requireAdmin, async (req, res) => {
    const documentColumns = {
        partida: ['partida_nacimiento', 'partida_nombre', 'partida_mime'],
        notas: ['notas_grado_anterior', 'notas_nombre', 'notas_mime'],
        conducta: ['carta_conducta', 'carta_nombre', 'carta_mime']
    };
    const columns = documentColumns[req.params.tipo];
    if (!columns || !/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'El documento solicitado no es válido.' });
    }
    try {
        const result = await db.query(
            `SELECT ${columns.map((column) => `"${column}"`).join(', ')}
             FROM solicitud_documentos WHERE id_solicitud = $1`,
            [Number(req.params.id)]
        );
        if (!result.rows[0]) {
            return res.status(404).json({ error: 'No se encontró el documento solicitado.' });
        }
        const [content, filename, mime] = columns.map((column) => result.rows[0][column]);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
        res.send(content);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando documento de matrícula:');
    }
});

// La sección del alumno se valida y asigna dentro de la misma transacción de aprobación.
app.post('/api/admin/solicitudes/:id/aprobar', requireAdmin, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'El número de solicitud no es válido.' });
    }
    const nie = typeof req.body?.nie_alumno === 'string' ? req.body.nie_alumno.trim() : '';
    if (!nie || nie.length > 15) {
        return res.status(400).json({ error: 'Ingrese un NIE de hasta 15 caracteres.' });
    }
    const sectionId = Number(req.body?.id_seccion);
    if (!Number.isInteger(sectionId) || sectionId < 1) {
        return res.status(400).json({ error: 'Seleccione una sección para matricular al alumno.' });
    }

    try {
        await withTransaction(async (client, request, response) => {
            const found = await client.query(
                'SELECT * FROM solicitudes_matricula WHERE id_solicitud = $1 FOR UPDATE',
                [Number(request.params.id)]
            );
            const solicitud = found.rows[0];
            if (!solicitud) {
                return response.status(404).json({ error: 'No se encontró la solicitud.' });
            }
            if (solicitud.estado_solicitud !== 'pendiente') {
                return response.status(409).json({ error: 'La solicitud ya fue revisada.' });
            }
            const section = await client.query(
                `SELECT id_seccion
                 FROM secciones
                 WHERE id_seccion = $1 AND id_especialidad = $2`,
                [sectionId, solicitud.id_especialidad]
            );
            if (!section.rowCount) {
                return response.status(400).json({
                    error: 'La sección seleccionada no pertenece a la especialidad de esta solicitud.'
                });
            }
            const existingStudent = await client.query(
                'SELECT 1 FROM alumnos WHERE nie_alumno = $1',
                [nie]
            );
            if (existingStudent.rowCount) {
                return response.status(409).json({ error: 'Ya existe un alumno con ese NIE.' });
            }

            const emailUsed = await client.query(
                'SELECT 1 FROM usuarios WHERE lower(correo) = lower($1)',
                [solicitud.correo_est]
            );
            if (emailUsed.rowCount) {
                return response.status(409).json({ error: 'El correo del estudiante ya pertenece a otra cuenta.' });
            }

            const studentRole = await getOrCreateRole(client, ['alumno', 'estudiante'], 'Alumno');
            const studentPassword = nie;
            const studentUser = await client.query(
                `INSERT INTO usuarios (
                    correo, contrasena, id_rol, estado, debe_cambiar_contrasena
                 ) VALUES ($1, $2, $3, TRUE, TRUE) RETURNING id_usuario`,
                [solicitud.correo_est, await bcrypt.hash(studentPassword, 12), studentRole]
            );

            const guardianFound = await client.query(
                `SELECT dui_encargado, id_usuario FROM encargados
                 WHERE regexp_replace(dui_encargado, '[^0-9]', '', 'g') = $1`,
                [solicitud.dui_rep.replace(/\D/g, '')]
            );
            let guardianUserId;
            let guardianDui = solicitud.dui_rep;
            let guardianPassword = null;
            if (guardianFound.rowCount) {
                guardianUserId = guardianFound.rows[0].id_usuario;
                guardianDui = guardianFound.rows[0].dui_encargado;
            } else {
                const guardianRole = await getOrCreateRole(client, ['encargado'], 'Encargado');
                guardianDui = normalizeDui(solicitud.dui_rep) || solicitud.dui_rep;
                guardianPassword = guardianDui.replace(/\D/g, '');
                const guardianUser = await client.query(
                    `INSERT INTO usuarios (
                        correo, contrasena, id_rol, estado, debe_cambiar_contrasena
                     ) VALUES ($1, $2, $3, TRUE, TRUE) RETURNING id_usuario`,
                    [guardianDui.replace(/\D/g, ''), await bcrypt.hash(guardianPassword, 12), guardianRole]
                );
                guardianUserId = guardianUser.rows[0].id_usuario;
                await client.query(
                    `INSERT INTO encargados (
                        dui_encargado, nombre, apellido, id_usuario, telefono
                    ) VALUES ($1, $2, $3, $4, $5)`,
                    [
                        solicitud.dui_rep, solicitud.nombre_rep, solicitud.apellido_rep,
                        guardianUserId, solicitud.telefono_rep
                    ]
                );
            }

            await client.query(
                `INSERT INTO alumnos (
                    nie_alumno, nombre, apellido, correo, id_usuario,
                    fecha_nac, dui_encargado, id_seccion
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    nie, solicitud.nombre_est, solicitud.apellido_est,
                    solicitud.correo_est, studentUser.rows[0].id_usuario,
                    solicitud.fecha_nac_est, guardianDui, sectionId
                ]
            );
            await client.query(
                `UPDATE solicitudes_matricula
                 SET estado_solicitud = 'aprobada', nie_alumno = $1, estado = TRUE
                 WHERE id_solicitud = $2`,
                [nie, solicitud.id_solicitud]
            );
            response.json({
                mensaje: 'Solicitud aprobada, alumno matriculado en la sección seleccionada y perfil creado. La contraseña inicial del alumno es su NIE; la del encargado son los dígitos de su DUI, sin guion. Ambos deberán crear una contraseña personal al ingresar.',
                alumno: { nie, identificador: nie, correo: solicitud.correo_est, contraseña_temporal: studentPassword },
                encargado: guardianPassword
                    ? {
                        dui: guardianDui,
                        identificador: guardianDui.replace(/\D/g, ''),
                        contraseña_temporal: guardianPassword
                    }
                    : { dui: solicitud.dui_rep, cuenta_existente: true }
            });
        })(req, res);
    } catch (error) {
        handleDatabaseError(error, res, 'Error aprobando solicitud:');
    }
});

app.post('/api/admin/solicitudes/:id/rechazar', requireAdmin, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: 'El número de solicitud no es válido.' });
    }
    try {
        const result = await db.query(
            `UPDATE solicitudes_matricula
             SET estado_solicitud = 'rechazada', estado = FALSE
             WHERE id_solicitud = $1 AND estado_solicitud = 'pendiente'
             RETURNING id_solicitud`,
            [Number(req.params.id)]
        );
        if (!result.rowCount) {
            return res.status(409).json({ error: 'No existe la solicitud pendiente o ya fue revisada.' });
        }
        res.json({ mensaje: 'Solicitud rechazada.' });
    } catch (error) {
        handleDatabaseError(error, res, 'Error rechazando solicitud:');
    }
});

async function getOrCreateRole(client, aliases, displayName) {
    const existing = await client.query(
        'SELECT id_rol FROM roles WHERE lower(nombre_rol) = ANY($1::text[]) ORDER BY id_rol LIMIT 1',
        [aliases]
    );
    if (existing.rowCount) {
        return existing.rows[0].id_rol;
    }
    const created = await client.query(
        'INSERT INTO roles (nombre_rol) VALUES ($1) RETURNING id_rol',
        [displayName]
    );
    return created.rows[0].id_rol;
}

app.get('/api/admin/especialidades', requireAdmin, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id_especialidad, nombre_especialidad FROM especialidades ORDER BY nombre_especialidad'
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando especialidades para administración:');
    }
});

app.get('/api/admin/periodos', requireAdmin, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id_periodo, nombre_periodo, fecha_inicio, fecha_fin, estado FROM periodos ORDER BY fecha_inicio DESC'
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando períodos:');
    }
});

app.post('/api/admin/periodos', requireAdmin, async (req, res) => {
    const { nombre_periodo, fecha_inicio, fecha_fin } = req.body || {};
    if (typeof nombre_periodo !== 'string' || !nombre_periodo.trim() || nombre_periodo.length > 50
        || !validDate(fecha_inicio) || !validDate(fecha_fin) || fecha_inicio > fecha_fin) {
        return res.status(400).json({ error: 'Ingrese nombre y fechas válidas para el período.' });
    }
    try {
        const result = await db.query(
            `INSERT INTO periodos (nombre_periodo, fecha_inicio, fecha_fin, estado)
             VALUES ($1, $2, $3, TRUE)
             RETURNING id_periodo, nombre_periodo, fecha_inicio, fecha_fin, estado`,
            [nombre_periodo.trim(), fecha_inicio, fecha_fin]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error creando período:');
    }
});

app.patch('/api/admin/periodos/:id/estado', requireAdmin, async (req, res) => {
    if (!/^\d+$/.test(req.params.id) || typeof req.body?.estado !== 'boolean') {
        return res.status(400).json({ error: 'El estado debe ser verdadero o falso.' });
    }
    try {
        const result = await db.query(
            `UPDATE periodos SET estado = $1 WHERE id_periodo = $2
             RETURNING id_periodo, nombre_periodo, estado`,
            [req.body.estado, Number(req.params.id)]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'No se encontró el período.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error actualizando período:');
    }
});

app.get('/api/admin/secciones', requireAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT s.id_seccion, s.nombre_seccion, s.id_especialidad,
                    e.nombre_especialidad, COUNT(a.nie_alumno)::integer AS cantidad_alumnos
             FROM secciones AS s
             JOIN especialidades AS e ON e.id_especialidad = s.id_especialidad
             LEFT JOIN alumnos AS a ON a.id_seccion = s.id_seccion
             GROUP BY s.id_seccion, e.nombre_especialidad
             ORDER BY s.nombre_seccion`
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando secciones:');
    }
});

app.post('/api/admin/secciones', requireAdmin, async (req, res) => {
    const { nombre_seccion, id_especialidad } = req.body || {};
    const specialtyId = Number(id_especialidad);
    if (typeof nombre_seccion !== 'string' || !nombre_seccion.trim()
        || nombre_seccion.length > 100 || !Number.isInteger(specialtyId) || specialtyId < 1) {
        return res.status(400).json({ error: 'Ingrese nombre de sección y especialidad válidos.' });
    }
    try {
        const result = await db.query(
            `INSERT INTO secciones (nombre_seccion, id_especialidad)
             VALUES ($1, $2)
             RETURNING id_seccion, nombre_seccion, id_especialidad`,
            [nombre_seccion.trim(), specialtyId]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error creando sección:');
    }
});

app.get('/api/admin/docentes', requireAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT d.dui_docente,
                    regexp_replace(d.dui_docente, '[^0-9]', '', 'g') AS usuario,
                    d.nombre, d.apellido, d.correo, d.telefono, u.estado,
                    COALESCE(string_agg(DISTINCT a.nombre_materia, ', '), '') AS materias
             FROM docentes AS d
             JOIN usuarios AS u ON u.id_usuario = d.id_usuario
             LEFT JOIN asignacion_docente AS ad ON ad.dui_docente = d.dui_docente
             LEFT JOIN asignaturas AS a ON a.id_asignatura = ad.id_asignatura
             GROUP BY d.dui_docente, d.nombre, d.apellido, d.correo, d.telefono, u.estado
             ORDER BY d.nombre, d.dui_docente`
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando docentes:');
    }
});

app.get('/api/admin/catalogos-docente', requireAdmin, async (req, res) => {
    try {
        const [sections, subjects] = await Promise.all([
            db.query('SELECT id_seccion, nombre_seccion FROM secciones ORDER BY nombre_seccion'),
            db.query('SELECT id_asignatura, nombre_materia FROM asignaturas ORDER BY nombre_materia')
        ]);
        res.json({ secciones: sections.rows, asignaturas: subjects.rows });
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando asignaturas y secciones:');
    }
});

app.post('/api/admin/docentes', requireAdmin, async (req, res) => {
    const { dui, nombre, apellido, telefono, id_seccion, id_asignatura, año_lectivo } = req.body || {};
    const normalizedDui = typeof dui === 'string' ? normalizeDui(dui) : null;
    if (!normalizedDui || typeof nombre !== 'string' || !nombre.trim() || nombre.length > 50
        || typeof apellido !== 'string' || !apellido.trim() || apellido.length > 50
        || (telefono != null && (typeof telefono !== 'string' || telefono.length > 20))) {
        return res.status(400).json({ error: 'Revise DUI, nombre, apellido y teléfono.' });
    }

    const assignmentValues = [id_seccion, id_asignatura, año_lectivo];
    const hasAssignment = assignmentValues.some((value) => value !== undefined && value !== '');
    if (hasAssignment && (!Number.isInteger(Number(id_seccion))
        || !Number.isInteger(Number(id_asignatura)) || !validDate(año_lectivo))) {
        return res.status(400).json({ error: 'Para asignar al docente, seleccione sección, materia y año lectivo.' });
    }

    try {
        await withTransaction(async (client, request, response) => {
            const duplicate = await client.query(
                `SELECT 1 FROM docentes WHERE regexp_replace(dui_docente, '[^0-9]', '', 'g') = $1
                 UNION ALL SELECT 1 FROM usuarios WHERE lower(correo) = lower($2) LIMIT 1`,
                [normalizedDui.replace(/\D/g, ''), normalizedDui]
            );
            if (duplicate.rowCount) {
                return response.status(409).json({ error: 'Ya existe una cuenta con ese DUI.' });
            }
            const roleId = await getOrCreateRole(client, ['docente'], 'Docente');
            const password = normalizedDui.replace(/\D/g, '');
            const account = await client.query(
                `INSERT INTO usuarios (
                    correo, contrasena, id_rol, estado, debe_cambiar_contrasena
                 ) VALUES ($1, $2, $3, TRUE, TRUE) RETURNING id_usuario`,
                [normalizedDui.replace(/\D/g, ''), await bcrypt.hash(password, 12), roleId]
            );
            await client.query(
                `INSERT INTO docentes (
                    dui_docente, nombre, apellido, correo, id_usuario, telefono
                ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    normalizedDui, nombre.trim(), apellido.trim(), null,
                    account.rows[0].id_usuario, telefono?.trim() || null
                ]
            );
            if (hasAssignment) {
                await client.query(
                    `INSERT INTO asignacion_docente (
                        dui_docente, id_seccion, id_asignatura, anio_lectivo
                    ) VALUES ($1, $2, $3, $4)`,
                    [normalizedDui, Number(id_seccion), Number(id_asignatura), año_lectivo]
                );
            }
            response.status(201).json({
                mensaje: 'Docente creado. El DUI es su usuario y sus dígitos sin guion son la contraseña temporal; deberá cambiarla al iniciar sesión.',
                docente: {
                    dui: normalizedDui,
                    identificador: normalizedDui.replace(/\D/g, ''),
                    contraseña_temporal: password
                }
            });
        })(req, res);
    } catch (error) {
        handleDatabaseError(error, res, 'Error creando docente:');
    }
});

app.get('/api/admin/busqueda', requireAdmin, async (req, res) => {
    const identifier = typeof req.query.identificador === 'string'
        ? req.query.identificador.trim()
        : '';
    if (!identifier || identifier.length > 20) {
        return res.status(400).json({ error: 'Ingrese un NIE o DUI válido.' });
    }
    try {
        const student = await db.query(
            `SELECT a.nie_alumno AS identificador, 'alumno' AS tipo, a.nombre,
                    a.apellido, a.correo, s.id_seccion, s.nombre_seccion, a.dui_encargado
             FROM alumnos AS a
             LEFT JOIN secciones AS s ON s.id_seccion = a.id_seccion
             WHERE a.nie_alumno = $1`,
            [identifier]
        );
        if (student.rowCount) {
            return res.json(student.rows[0]);
        }
        const guardian = await db.query(
            `SELECT regexp_replace(e.dui_encargado, '[^0-9]', '', 'g') AS identificador,
                    'encargado' AS tipo,
                    e.nombre, e.apellido, u.correo, e.telefono
             FROM encargados AS e
             JOIN usuarios AS u ON u.id_usuario = e.id_usuario
             WHERE regexp_replace(e.dui_encargado, '[^0-9]', '', 'g')
                   = regexp_replace($1, '[^0-9]', '', 'g')`,
            [identifier]
        );
        if (!guardian.rowCount) {
            const teacher = await db.query(
                `SELECT regexp_replace(d.dui_docente, '[^0-9]', '', 'g') AS identificador,
                        'docente' AS tipo,
                        d.nombre, d.apellido, u.correo, d.telefono
                 FROM docentes AS d
                 JOIN usuarios AS u ON u.id_usuario = d.id_usuario
                 WHERE regexp_replace(d.dui_docente, '[^0-9]', '', 'g')
                       = regexp_replace($1, '[^0-9]', '', 'g')`,
                [identifier]
            );
            if (!teacher.rowCount) {
                return res.status(404).json({ error: 'No se encontró el alumno, encargado o docente.' });
            }
            return res.json(teacher.rows[0]);
        }
        res.json(guardian.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error buscando alumno, encargado o docente:');
    }
});

app.post('/api/admin/cuentas/restablecer', requireAdmin, async (req, res) => {
    const identifier = typeof req.body?.identificador === 'string' ? req.body.identificador.trim() : '';
    if (!identifier || identifier.length > 20) {
        return res.status(400).json({ error: 'Ingrese un NIE o DUI válido.' });
    }
    try {
        const result = await db.query(
            `SELECT matched.id_usuario, matched.identificador, matched.tipo
             FROM (
                 SELECT a.id_usuario, a.nie_alumno AS identificador, 'alumno' AS tipo, 1 AS prioridad
                 FROM alumnos AS a
                 WHERE a.nie_alumno = $1
                 UNION ALL
                 SELECT e.id_usuario, e.dui_encargado AS identificador, 'encargado' AS tipo, 2 AS prioridad
                 FROM encargados AS e
                 WHERE regexp_replace(e.dui_encargado, '[^0-9]', '', 'g') = $2
                 UNION ALL
                 SELECT d.id_usuario, d.dui_docente AS identificador, 'docente' AS tipo, 3 AS prioridad
                 FROM docentes AS d
                 WHERE regexp_replace(d.dui_docente, '[^0-9]', '', 'g') = $2
             ) AS matched
             ORDER BY matched.prioridad
             LIMIT 1`,
            [identifier, (normalizeDui(identifier) || identifier).replace(/\D/g, '')]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'No se encontró la cuenta.' });
        }
        const { id_usuario: userId, identificador: credential, tipo } = result.rows[0];
        const temporaryPassword = tipo === 'alumno'
            ? credential
            : credential.replace(/\D/g, '');
        const loginIdentifier = tipo === 'alumno'
            ? credential
            : credential.replace(/\D/g, '');
        await db.query(
            `UPDATE usuarios
             SET correo = CASE WHEN $3 IN ('encargado', 'docente') THEN $4 ELSE correo END,
                 contrasena = $1,
                 debe_cambiar_contrasena = TRUE
             WHERE id_usuario = $2`,
            [await bcrypt.hash(temporaryPassword, 12), userId, tipo, loginIdentifier]
        );
        res.json({
            mensaje: `Credencial restablecida. ${tipo === 'alumno' ? 'El NIE' : 'Los dígitos del DUI, sin guion'} son la contraseña temporal; deberá cambiarla al iniciar sesión.`,
            identificador: loginIdentifier,
            contraseña_temporal: temporaryPassword
        });
    } catch (error) {
        handleDatabaseError(error, res, 'Error restableciendo cuenta:');
    }
});

app.get('/api/teacher/profile', requireTeacher, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT d.dui_docente, d.nombre, d.apellido, d.correo, d.telefono,
                    COALESCE(string_agg(DISTINCT a.nombre_materia, ', '), '') AS materias,
                    COALESCE(string_agg(DISTINCT s.nombre_seccion, ', '), '') AS secciones
             FROM docentes AS d
             JOIN usuarios AS u ON u.id_usuario = d.id_usuario
             LEFT JOIN asignacion_docente AS ad ON ad.dui_docente = d.dui_docente
             LEFT JOIN asignaturas AS a ON a.id_asignatura = ad.id_asignatura
             LEFT JOIN secciones AS s ON s.id_seccion = ad.id_seccion
             WHERE u.id_usuario = $1
             GROUP BY d.dui_docente, d.nombre, d.apellido, d.correo, d.telefono`,
            [sessionIdentity(req)]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'No hay perfil docente asociado a esta cuenta.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando perfil docente:');
    }
});

app.get('/api/teacher/assignments', requireTeacher, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT ad.id_asignacion, ad.id_seccion, s.nombre_seccion,
                    ad.id_asignatura, a.nombre_materia,
                    ad.anio_lectivo AS "año_lectivo"
             FROM asignacion_docente AS ad
             JOIN docentes AS d ON d.dui_docente = ad.dui_docente
             JOIN usuarios AS u ON u.id_usuario = d.id_usuario
             JOIN secciones AS s ON s.id_seccion = ad.id_seccion
             JOIN asignaturas AS a ON a.id_asignatura = ad.id_asignatura
             WHERE u.id_usuario = $1
             ORDER BY s.nombre_seccion, a.nombre_materia`,
            [sessionIdentity(req)]
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando asignaciones docentes:');
    }
});

app.get('/api/teacher/assignments/:id/alumnos', requireTeacher, async (req, res) => {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId)) {
        return res.status(400).json({ error: 'Seleccione una asignación válida.' });
    }
    try {
        const assignment = await checkTeacherAssignment(sessionIdentity(req), assignmentId);
        if (!assignment.rowCount) {
            return res.status(403).json({ error: 'La asignación no pertenece a esta cuenta docente.' });
        }
        const students = await db.query(
            `SELECT nie_alumno, nombre, apellido
             FROM alumnos WHERE id_seccion = $1 ORDER BY apellido, nombre`,
            [assignment.rows[0].id_seccion]
        );
        res.json(students.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando lista de alumnos:');
    }
});

app.get('/api/teacher/periodos', requireTeacher, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id_periodo, nombre_periodo, fecha_inicio, fecha_fin
             FROM periodos WHERE estado = TRUE ORDER BY fecha_inicio DESC`
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando períodos activos:');
    }
});

async function ensureEvaluations(client, assignmentId, periodId) {
    const labels = ['Actividad 1', 'Actividad 2', 'Actividad 3', 'Examen'];
    const existing = await client.query(
        `SELECT id_evaluacion, nombre_evaluacion
         FROM evaluaciones
         WHERE id_asignacion = $1 AND id_periodo = $2
           AND nombre_evaluacion = ANY($3::text[])
         ORDER BY id_evaluacion`,
        [assignmentId, periodId, labels]
    );
    const byName = new Map(existing.rows.map((row) => [row.nombre_evaluacion, row.id_evaluacion]));
    for (const label of labels) {
        if (!byName.has(label)) {
            const result = await client.query(
                `INSERT INTO evaluaciones (
                    id_asignacion, id_periodo, nombre_evaluacion, porcentaje
                ) VALUES ($1, $2, $3, 25.00)
                RETURNING id_evaluacion`,
                [assignmentId, periodId, label]
            );
            byName.set(label, result.rows[0].id_evaluacion);
        }
    }
    await client.query(
        `UPDATE evaluaciones SET porcentaje = 25.00
         WHERE id_asignacion = $1 AND id_periodo = $2
           AND nombre_evaluacion = ANY($3::text[])`,
        [assignmentId, periodId, labels]
    );
    return labels.map((label) => ({ id_evaluacion: byName.get(label), nombre_evaluacion: label }));
}

async function checkTeacherAssignment(userId, assignmentId) {
    return db.query(
        `SELECT ad.id_asignacion, ad.id_seccion, ad.id_asignatura
         FROM asignacion_docente AS ad
         JOIN docentes AS d ON d.dui_docente = ad.dui_docente
         WHERE d.id_usuario = $1 AND ad.id_asignacion = $2`,
        [userId, assignmentId]
    );
}

app.get('/api/teacher/assignments/:id/roster', requireTeacher, async (req, res) => {
    const assignmentId = Number(req.params.id);
    const periodId = Number(req.query.periodo);
    if (!Number.isInteger(assignmentId) || !Number.isInteger(periodId)) {
        return res.status(400).json({ error: 'Seleccione una asignación y período válidos.' });
    }
    try {
        const assignment = await checkTeacherAssignment(sessionIdentity(req), assignmentId);
        if (!assignment.rowCount) {
            return res.status(403).json({ error: 'La asignación no pertenece a esta cuenta docente.' });
        }
        const period = await db.query(
            'SELECT 1 FROM periodos WHERE id_periodo = $1 AND estado = TRUE',
            [periodId]
        );
        if (!period.rowCount) {
            return res.status(400).json({ error: 'El período no está activo para ingresar notas.' });
        }
        const client = await db.connect();
        let evaluations;
        try {
            await client.query('BEGIN');
            evaluations = await ensureEvaluations(client, assignmentId, periodId);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        const students = await db.query(
            `SELECT a.nie_alumno, a.nombre, a.apellido
             FROM alumnos AS a
             WHERE a.id_seccion = $1
             ORDER BY a.apellido, a.nombre`,
            [assignment.rows[0].id_seccion]
        );
        const notes = await db.query(
            `SELECT DISTINCT ON (dn.id_evaluacion, dn.nie_alumno)
                    dn.id_evaluacion, dn.nie_alumno, dn.calificacion
             FROM detalle_notas AS dn
             JOIN evaluaciones AS ev ON ev.id_evaluacion = dn.id_evaluacion
             WHERE ev.id_asignacion = $1 AND ev.id_periodo = $2
             ORDER BY dn.id_evaluacion, dn.nie_alumno, dn.id_nota DESC`,
            [assignmentId, periodId]
        );
        res.json({
            asignacion: assignment.rows[0],
            evaluaciones: evaluations,
            alumnos: students.rows,
            notas: notes.rows
        });
    } catch (error) {
        handleDatabaseError(error, res, 'Error cargando alumnos y calificaciones:');
    }
});

app.put('/api/teacher/assignments/:id/notas', requireTeacher, async (req, res) => {
    const assignmentId = Number(req.params.id);
    const periodId = Number(req.body?.id_periodo);
    const grades = req.body?.notas;
    if (!Number.isInteger(assignmentId) || !Number.isInteger(periodId)
        || !Array.isArray(grades) || grades.length > 500) {
        return res.status(400).json({ error: 'El envío de calificaciones no tiene un formato válido.' });
    }

    try {
        const assignment = await checkTeacherAssignment(sessionIdentity(req), assignmentId);
        if (!assignment.rowCount) {
            return res.status(403).json({ error: 'La asignación no pertenece a esta cuenta docente.' });
        }
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const period = await client.query(
                'SELECT 1 FROM periodos WHERE id_periodo = $1 AND estado = TRUE',
                [periodId]
            );
            if (!period.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'El período no está activo para ingresar notas.' });
            }
            const evaluations = await ensureEvaluations(client, assignmentId, periodId);
            const students = await client.query(
                'SELECT nie_alumno FROM alumnos WHERE id_seccion = $1',
                [assignment.rows[0].id_seccion]
            );
            const studentIds = new Set(students.rows.map((student) => student.nie_alumno));
            const evaluationIds = evaluations.map((evaluation) => evaluation.id_evaluacion);

            for (const entry of grades) {
                if (!entry || !studentIds.has(entry.nie_alumno)
                    || !Array.isArray(entry.calificaciones) || entry.calificaciones.length !== 4
                    || entry.calificaciones.some((grade) => grade !== null
                        && (typeof grade !== 'number' || !Number.isFinite(grade) || grade < 0 || grade > 10))) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'Una o más notas no son válidas (rango permitido: 0 a 10).' });
                }
                for (let index = 0; index < 4; index++) {
                    const grade = entry.calificaciones[index];
                    if (grade === null) {
                        continue;
                    }
                    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
                        evaluationIds[index], hashDui(entry.nie_alumno)
                    ]);
                    await client.query(
                        `DELETE FROM detalle_notas
                         WHERE id_evaluacion = $1 AND nie_alumno = $2`,
                        [evaluationIds[index], entry.nie_alumno]
                    );
                    await client.query(
                        `INSERT INTO detalle_notas (id_evaluacion, nie_alumno, calificacion)
                         VALUES ($1, $2, $3)`,
                        [evaluationIds[index], entry.nie_alumno, grade]
                    );
                }
            }
            await client.query('COMMIT');
            res.json({ mensaje: 'Calificaciones guardadas.', total_alumnos: grades.length });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        handleDatabaseError(error, res, 'Error guardando calificaciones:');
    }
});

function hashDui(value) {
    return crypto.createHash('sha256').update(value).digest().readInt32BE(0);
}

app.get('/api/alumno/perfil', requireStudent, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT a.nie_alumno, a.nombre, a.apellido, a.correo, a.fecha_nac,
                    s.nombre_seccion
             FROM alumnos AS a
             JOIN usuarios AS u ON u.id_usuario = a.id_usuario
             LEFT JOIN secciones AS s ON s.id_seccion = a.id_seccion
             WHERE u.id_usuario = $1`,
            [sessionIdentity(req)]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'No se encontró un perfil de alumno para esta cuenta.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando perfil de alumno:');
    }
});

app.get('/api/alumno/periodos', requireStudent, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT DISTINCT p.id_periodo, p.nombre_periodo, p.fecha_inicio, p.fecha_fin
             FROM alumnos AS al
             JOIN asignacion_docente AS ad ON ad.id_seccion = al.id_seccion
             JOIN evaluaciones AS ev ON ev.id_asignacion = ad.id_asignacion
             JOIN periodos AS p ON p.id_periodo = ev.id_periodo
             JOIN detalle_notas AS dn ON dn.id_evaluacion = ev.id_evaluacion
                 AND dn.nie_alumno = al.nie_alumno
             WHERE al.id_usuario = $1 AND p.estado = FALSE
             ORDER BY p.fecha_inicio DESC`,
            [sessionIdentity(req)]
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando períodos con notas:');
    }
});

app.get('/api/alumno/notas/:periodo', requireStudent, async (req, res) => {
    const periodId = Number(req.params.periodo);
    if (!Number.isInteger(periodId)) {
        return res.status(400).json({ error: 'Seleccione un período válido.' });
    }
    try {
        const result = await db.query(
            `SELECT a.nombre_materia,
                    ROUND(SUM(dn.calificacion * ev.porcentaje / 100), 2) AS calificacion
             FROM alumnos AS al
             JOIN asignacion_docente AS ad ON ad.id_seccion = al.id_seccion
             JOIN asignaturas AS a ON a.id_asignatura = ad.id_asignatura
             JOIN evaluaciones AS ev ON ev.id_asignacion = ad.id_asignacion
             JOIN detalle_notas AS dn ON dn.id_evaluacion = ev.id_evaluacion
                 AND dn.nie_alumno = al.nie_alumno
             JOIN periodos AS p ON p.id_periodo = ev.id_periodo
             WHERE al.id_usuario = $1 AND p.id_periodo = $2 AND p.estado = FALSE
             GROUP BY ad.id_asignacion, a.nombre_materia
             ORDER BY a.nombre_materia`,
            [sessionIdentity(req), periodId]
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando calificaciones del alumno:');
    }
});

app.get('/api/encargado/perfil', requireGuardian, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT e.dui_encargado, e.nombre, e.apellido, e.telefono, u.correo
             FROM encargados AS e
             JOIN usuarios AS u ON u.id_usuario = e.id_usuario
             WHERE u.id_usuario = $1`,
            [sessionIdentity(req)]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'No se encontró un perfil de encargado para esta cuenta.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando perfil de encargado:');
    }
});

app.get('/api/encargado/alumnos', requireGuardian, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT a.nie_alumno, a.nombre, a.apellido, s.nombre_seccion
             FROM encargados AS e
             JOIN usuarios AS u ON u.id_usuario = e.id_usuario
             JOIN alumnos AS a ON a.dui_encargado = e.dui_encargado
             LEFT JOIN secciones AS s ON s.id_seccion = a.id_seccion
             WHERE u.id_usuario = $1
             ORDER BY a.apellido, a.nombre`,
            [sessionIdentity(req)]
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando alumnos del encargado:');
    }
});

app.get('/api/encargado/alumnos/:nie', requireGuardian, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT a.nie_alumno, a.nombre, a.apellido, a.correo, a.fecha_nac,
                    s.nombre_seccion
             FROM encargados AS e
             JOIN usuarios AS u ON u.id_usuario = e.id_usuario
             JOIN alumnos AS a ON a.dui_encargado = e.dui_encargado
             LEFT JOIN secciones AS s ON s.id_seccion = a.id_seccion
             WHERE u.id_usuario = $1 AND a.nie_alumno = $2`,
            [sessionIdentity(req), req.params.nie]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'Ese alumno no está vinculado a esta cuenta.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando información familiar:');
    }
});

app.get('/api/encargado/alumnos/:nie/periodos', requireGuardian, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT DISTINCT p.id_periodo, p.nombre_periodo, p.fecha_inicio, p.fecha_fin
             FROM encargados AS e
             JOIN usuarios AS u ON u.id_usuario = e.id_usuario
             JOIN alumnos AS al ON al.dui_encargado = e.dui_encargado
             JOIN asignacion_docente AS ad ON ad.id_seccion = al.id_seccion
             JOIN evaluaciones AS ev ON ev.id_asignacion = ad.id_asignacion
             JOIN periodos AS p ON p.id_periodo = ev.id_periodo
             JOIN detalle_notas AS dn ON dn.id_evaluacion = ev.id_evaluacion
                 AND dn.nie_alumno = al.nie_alumno
             WHERE u.id_usuario = $1 AND al.nie_alumno = $2 AND p.estado = FALSE
             ORDER BY p.fecha_inicio DESC`,
            [sessionIdentity(req), req.params.nie]
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando períodos del alumno:');
    }
});

app.get('/api/encargado/alumnos/:nie/notas/:periodo', requireGuardian, async (req, res) => {
    const periodId = Number(req.params.periodo);
    if (!Number.isInteger(periodId)) {
        return res.status(400).json({ error: 'Seleccione un período válido.' });
    }
    try {
        const result = await db.query(
            `SELECT a.nombre_materia,
                    ROUND(SUM(dn.calificacion * ev.porcentaje / 100), 2) AS calificacion
             FROM encargados AS e
             JOIN usuarios AS u ON u.id_usuario = e.id_usuario
             JOIN alumnos AS al ON al.dui_encargado = e.dui_encargado
             JOIN asignacion_docente AS ad ON ad.id_seccion = al.id_seccion
             JOIN asignaturas AS a ON a.id_asignatura = ad.id_asignatura
             JOIN evaluaciones AS ev ON ev.id_asignacion = ad.id_asignacion
             JOIN detalle_notas AS dn ON dn.id_evaluacion = ev.id_evaluacion
                 AND dn.nie_alumno = al.nie_alumno
             JOIN periodos AS p ON p.id_periodo = ev.id_periodo
             WHERE u.id_usuario = $1 AND al.nie_alumno = $2
               AND p.id_periodo = $3 AND p.estado = FALSE
             GROUP BY ad.id_asignacion, a.nombre_materia
             ORDER BY a.nombre_materia`,
            [sessionIdentity(req), req.params.nie, periodId]
        );
        res.json(result.rows);
    } catch (error) {
        handleDatabaseError(error, res, 'Error consultando notas del alumno:');
    }
});

// Reporta errores de carga o tamaño en las solicitudes multipart.
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({
            error: error.code === 'LIMIT_FILE_SIZE'
                ? 'Cada documento puede pesar como máximo 5 MB.'
                : 'No se pudieron procesar los documentos enviados.'
        });
    }
    if (res.headersSent) {
        return next(error);
    }
    console.error('Error inesperado en una ruta:', error);
    res.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
});

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function startServer() {
    await db.query('SELECT 1');
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('PORT debe ser un puerto válido entre 0 y 65535.');
    }
    const server = app.listen(port);
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    console.log(`Servidor listo en http://localhost:${typeof address === 'object' ? address.port : port}`);

    const shutdown = () => {
        server.close(() => {
            db.end().then(() => process.exit(0)).catch((error) => {
                console.error('Error cerrando PostgreSQL:', error);
                process.exitCode = 1;
            });
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return server;
}

if (require.main === module) {
    startServer().catch(async (error) => {
        console.error('No fue posible iniciar el servidor o conectar con PostgreSQL:', error);
        try {
            await db.end();
        } catch (closeError) {
            console.error('Error cerrando PostgreSQL:', closeError);
        }
        process.exitCode = 1;
    });
}

module.exports = { app, startServer };
