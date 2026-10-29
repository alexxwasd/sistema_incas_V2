// Pruebas HTTP del servidor usando un pool simulado para no modificar PostgreSQL.
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const bcrypt = require('bcrypt');
const dbPath = require.resolve('../db');

// Usuarios de prueba con contraseñas bcrypt válidas para recorrer el inicio de sesión.
const accounts = new Map();
const passwordHash = bcrypt.hashSync('correct-password', 4);
accounts.set('admin@example.test', {
    id_usuario: 1,
    correo: 'admin@example.test',
    password_hash: passwordHash,
    estado: true,
    debe_cambiar_contrasena: false,
    nombre_rol: 'Secretaria'
});
accounts.set('student@example.test', {
    id_usuario: 2,
    correo: 'student@example.test',
    password_hash: passwordHash,
    estado: true,
    debe_cambiar_contrasena: false,
    nombre_rol: 'Alumno'
});
accounts.set('teacher-profile@example.test', {
    id_usuario: 6,
    correo: 'teacher-profile@example.test',
    login_identifier: '111222333',
    password_hash: passwordHash,
    estado: true,
    debe_cambiar_contrasena: false,
    nombre_rol: 'Docente'
});
accounts.set('newstudent@example.test', {
    id_usuario: 3,
    correo: 'newstudent@example.test',
    login_identifier: 'NEWNIE123',
    password_hash: bcrypt.hashSync('A123456', 4),
    estado: true,
    debe_cambiar_contrasena: true,
    nombre_rol: 'Alumno'
});
const resettableAccounts = [
    {
        id_usuario: 4,
        correo: 'guardian@example.test',
        login_identifier: '12345678-9',
        credential: '12345678-9',
        tipo: 'encargado',
        password_hash: bcrypt.hashSync('old-guardian', 4),
        estado: true,
        debe_cambiar_contrasena: false,
        nombre_rol: 'Encargado'
    },
    {
        id_usuario: 5,
        correo: 'teacher@example.test',
        login_identifier: '87654321-0',
        credential: '87654321-0',
        tipo: 'docente',
        password_hash: bcrypt.hashSync('old-teacher', 4),
        estado: true,
        debe_cambiar_contrasena: false,
        nombre_rol: 'Docente'
    }
];
resettableAccounts.forEach((account) => accounts.set(account.correo, account));
const restorableProfiles = [
    {
        id_usuario: accounts.get('newstudent@example.test').id_usuario,
        identificador: 'NEWNIE123',
        tipo: 'alumno'
    },
    ...resettableAccounts.map((account) => ({
        id_usuario: account.id_usuario,
        identificador: account.credential,
        tipo: account.tipo
    }))
];

// Solicitud y documentos ficticios que el pool devuelve a las rutas administrativas.
const pendingApplication = {
    id_solicitud: 12,
    nombre_est: 'Ana',
    apellido_est: 'López',
    fecha_nac_est: '2010-03-20',
    correo_est: 'ana@example.test',
    telefono_est: '70000000',
    direccion_est: 'San Salvador',
    tipo_bachillerato: 'Técnico',
    id_especialidad: 1,
    nombre_especialidad: 'Informática',
    nombre_rep: 'Luis',
    apellido_rep: 'López',
    dui_rep: '12345678-9',
    telefono_rep: '70000001',
    nie_alumno: null,
    estado_solicitud: 'pendiente',
    fecha_solicitud: '2026-10-28T12:00:00.000Z',
    tiene_documentos: true
};

const calls = [];
let nextRequestId = 50;
let nextUserId = 10;

// Reemplazo mínimo de PostgreSQL: responde únicamente a las consultas usadas por estas pruebas.
const fakePool = {
    async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.includes('COALESCE(to_jsonb(u)')) {
            const identifier = String(params[0]).toLowerCase();
            const user = accounts.get(identifier)
                || [...accounts.values()].find((account) =>
                    String(account.login_identifier || '').toLowerCase() === identifier
                    || (account.tipo !== 'alumno'
                        && String(account.login_identifier || '').replace(/\D/g, '') === identifier.replace(/\D/g, ''))
                );
            return { rows: user ? [user] : [] };
        }
        if (sql.includes('SELECT u.id_usuario, u.correo, u.estado, u.debe_cambiar_contrasena')) {
            const user = [...accounts.values()].find((account) => account.id_usuario === Number(params[0]));
            return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
        }
        if (sql.includes('FROM docentes AS d') && sql.includes('WHERE u.id_usuario = $1')) {
            return {
                rows: [{
                    dui_docente: '11122233-3',
                    nombre: 'Fredy',
                    apellido: 'Teran',
                    materias: 'Matematica',
                    secciones: '2K'
                }],
                rowCount: 1
            };
        }
        if (sql.includes('SELECT matched.id_usuario, matched.identificador, matched.tipo')) {
            const digits = String(params[1]);
            const profile = restorableProfiles.find((item) =>
                item.tipo === 'alumno'
                    ? item.identificador === params[0]
                    : item.identificador.replace(/\D/g, '') === digits
            );
            return { rows: profile ? [profile] : [], rowCount: profile ? 1 : 0 };
        }
        if (sql.includes('SELECT contrasena FROM usuarios')) {
            const user = [...accounts.values()].find((account) => account.id_usuario === Number(params[0]));
            return { rows: user ? [{ contrasena: user.password_hash }] : [], rowCount: user ? 1 : 0 };
        }
        if (sql.includes('UPDATE usuarios') && sql.includes('debe_cambiar_contrasena = FALSE')) {
            const user = [...accounts.values()].find((account) => account.id_usuario === Number(params[1]));
            if (user) {
                user.password_hash = params[0];
                user.debe_cambiar_contrasena = false;
            }
            return { rows: [], rowCount: user ? 1 : 0 };
        }
        if (sql.includes('UPDATE usuarios') && sql.includes('debe_cambiar_contrasena = TRUE')) {
            const user = [...accounts.values()].find((account) => account.id_usuario === Number(params[1]));
            if (user) {
                user.password_hash = params[0];
                user.debe_cambiar_contrasena = true;
                user.login_identifier = params[3];
                if (params[2] !== 'alumno') {
                    user.correo = params[3];
                }
            }
            return { rows: [], rowCount: user ? 1 : 0 };
        }
        if (sql.includes('SELECT 1') || sql.includes('SELECT id_rol, nombre_rol')) {
            return { rows: sql.includes('SELECT 1') ? [{ '?column?': 1 }] : [] };
        }
        if (sql.includes('SELECT id_especialidad, nombre_especialidad')) {
            return { rows: [{ id_especialidad: 1, nombre_especialidad: 'Informática' }] };
        }
        if (sql.includes('UPDATE periodos SET estado = $1 WHERE id_periodo = $2')) {
            return {
                rows: [{ id_periodo: Number(params[1]), nombre_periodo: 'Período de prueba', estado: params[0] }],
                rowCount: 1
            };
        }
        if (sql.includes('SELECT s.id_seccion, s.nombre_seccion, s.id_especialidad')) {
            return {
                rows: [{
                    id_seccion: 44,
                    nombre_seccion: '1A',
                    id_especialidad: 1,
                    nombre_especialidad: 'Informática',
                    cantidad_alumnos: 0
                }]
            };
        }
        if (sql.includes('FROM solicitudes_matricula AS s')) {
            return { rows: [pendingApplication] };
        }
        if (sql.includes('FROM solicitud_documentos WHERE id_solicitud')) {
            return { rows: [{
                partida_nacimiento: Buffer.from([137, 80, 78, 71]),
                partida_nombre: 'partida.png',
                partida_mime: 'image/png'
            }] };
        }
        if (sql.includes('INSERT INTO solicitudes_matricula')) {
            return { rows: [{ id_solicitud: nextRequestId++, fecha_solicitud: '2026-10-28T12:00:00.000Z' }] };
        }
        if (sql.includes('INSERT INTO solicitud_documentos')) {
            return { rows: [] };
        }
        throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
        return {
            async query(sql, params = []) {
                calls.push({ sql, params });
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                    return { rows: [] };
                }
                if (sql.includes('SELECT * FROM solicitudes_matricula WHERE id_solicitud')) {
                    return { rows: [pendingApplication], rowCount: 1 };
                }
                if (sql.includes('FROM secciones') && sql.includes('id_especialidad = $2')) {
                    const section = Number(params[0]) === 44 && Number(params[1]) === 1;
                    return {
                        rows: section ? [{ id_seccion: 44 }] : [],
                        rowCount: section ? 1 : 0
                    };
                }
                if (sql.includes('SELECT 1 FROM alumnos')) {
                    return { rows: [], rowCount: 0 };
                }
                if (sql.includes('SELECT 1 FROM usuarios WHERE lower(correo)')) {
                    return { rows: [], rowCount: 0 };
                }
                if (sql.includes('SELECT dui_encargado, id_usuario FROM encargados')) {
                    return { rows: [], rowCount: 0 };
                }
                if (sql.includes('SELECT id_rol FROM roles')) {
                    return { rows: [{ id_rol: 4 }], rowCount: 1 };
                }
                if (sql.includes('INSERT INTO alumnos')) {
                    return { rows: [], rowCount: 1 };
                }
                if (sql.includes('INSERT INTO encargados')) {
                    return { rows: [], rowCount: 1 };
                }
                if (sql.includes('UPDATE solicitudes_matricula')) {
                    return { rows: [], rowCount: 1 };
                }
                if (sql.includes('SELECT 1 FROM docentes WHERE regexp_replace')) {
                    return { rows: [], rowCount: 0 };
                }
                if (sql.includes('SELECT id_rol FROM roles')) {
                    return { rows: [{ id_rol: 4 }], rowCount: 1 };
                }
                if (sql.includes('INSERT INTO usuarios')) {
                    return { rows: [{ id_usuario: nextUserId++ }], rowCount: 1 };
                }
                if (sql.includes('INSERT INTO docentes')) {
                    return { rows: [], rowCount: 1 };
                }
                if (sql.includes('INSERT INTO asignacion_docente')) {
                    return { rows: [], rowCount: 1 };
                }
                if (sql.includes('INSERT INTO solicitudes_matricula')) {
                    return { rows: [{ id_solicitud: nextRequestId++, fecha_solicitud: '2026-10-28T12:00:00.000Z' }] };
                }
                if (sql.includes('INSERT INTO solicitud_documentos')) {
                    return { rows: [] };
                }
                throw new Error(`Unexpected transaction query: ${sql}`);
            },
            release() {}
        };
    },
    async end() {}
};

// Inyecta el pool antes de cargar Express para mantener las pruebas aisladas de la BD real.
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: fakePool
};

const { app } = require('../server');
let server;
let baseUrl;

// Levanta el servidor en un puerto libre para hacer solicitudes HTTP reales durante la suite.
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
    );
});

// Inicia sesión con un usuario de prueba y devuelve la cookie firmada para las demás solicitudes.
async function login(email, password = 'correct-password') {
    const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identificador: email, contraseña: password })
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
}

// Comprueba que la ruta de salud puede consultar la base de datos.
test('health endpoint reaches the database', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
});

// Verifica que los paneles y la API administrativa exijan una sesión.
test('panel pages and administrative API reject anonymous users', async () => {
    const api = await fetch(`${baseUrl}/api/admin/solicitudes`);
    assert.equal(api.status, 401);
    const panel = await fetch(`${baseUrl}/panel_admin.html`, { redirect: 'manual' });
    assert.equal(panel.status, 302);
});

// Comprueba la emisión de sesión de secretaria y que un rol distinto no acceda a administración.
test('login signs a session and account role is verified on each request', async () => {
    const cookie = await login('admin@example.test');
    const response = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rol, 'Secretaria');

    const wrongRole = await fetch(`${baseUrl}/api/admin/solicitudes`, {
        headers: { Cookie: await login('student@example.test') }
    });
    assert.equal(wrongRole.status, 403);
});

// La sesión de Administrador tiene permiso para finalizar o reactivar un período.
test('admin can update an academic period state', async () => {
    const cookie = await login('admin@example.test');
    const response = await fetch(`${baseUrl}/api/admin/periodos/1/estado`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: false })
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).estado, false);
});

// El endpoint de perfil incluye el apellido que presenta el panel docente.
test('teacher profile returns the teacher surname', async () => {
    const cookie = await login('teacher-profile@example.test');
    const response = await fetch(`${baseUrl}/api/teacher/profile`, {
        headers: { Cookie: cookie }
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).apellido, 'Teran');
    const profileQuery = calls.findLast(({ sql }) =>
        sql.includes('FROM docentes AS d') && sql.includes('WHERE u.id_usuario = $1')
    );
    assert.match(profileQuery.sql, /d\.apellido/);
    assert.match(profileQuery.sql, /GROUP BY d\.dui_docente, d\.nombre, d\.apellido/);
});

// Una cuenta de alta debe cambiar su clave temporal antes de usar las rutas del portal.
test('new accounts must set a personal password before accessing their portal', async () => {
    const cookie = await login('newstudent@example.test', 'A123456');
    const profile = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.equal((await profile.json()).debe_cambiar_contrasena, true);

    const panel = await fetch(`${baseUrl}/panel_alumno.html`, {
        headers: { Cookie: cookie },
        redirect: 'manual'
    });
    assert.equal(panel.status, 302);
    assert.equal(panel.headers.get('location'), '/cambiar_contrasena.html');
    const changePage = await fetch(`${baseUrl}/cambiar_contrasena.html`, {
        headers: { Cookie: cookie }
    });
    assert.equal(changePage.status, 200);

    const blocked = await fetch(`${baseUrl}/api/alumno/perfil`, {
        headers: { Cookie: cookie }
    });
    assert.equal(blocked.status, 403);

    const reusedTemporary = await fetch(`${baseUrl}/api/cambiar-contrasena`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nueva_contrasena: 'A123456',
            confirmar_contrasena: 'A123456'
        })
    });
    assert.equal(reusedTemporary.status, 400);

    const changed = await fetch(`${baseUrl}/api/cambiar-contrasena`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nueva_contrasena: 'personal-password',
            confirmar_contrasena: 'personal-password'
        })
    });
    assert.equal(changed.status, 200);
    const updatedProfile = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.equal((await updatedProfile.json()).debe_cambiar_contrasena, false);
    const completedChangePage = await fetch(`${baseUrl}/cambiar_contrasena.html`, {
        headers: { Cookie: cookie },
        redirect: 'manual'
    });
    assert.equal(completedChangePage.status, 302);
    assert.equal(completedChangePage.headers.get('location'), 'panel_alumno.html');
    await login('newstudent@example.test', 'personal-password');
});

// Secretará restaura NIE/DUI como clave temporal y bloquea cada rol hasta crear una clave propia.
test('secretary resets student, guardian and teacher passwords to their NIE or DUI', async () => {
    const adminCookie = await login('admin@example.test');
    const resetTargets = [
        { identifier: 'NEWNIE123', role: 'alumno' },
        { identifier: '12345678-9', role: 'encargado' },
        { identifier: '87654321-0', role: 'docente' }
    ];

    for (const target of resetTargets) {
        const identifierWithoutHyphen = target.role === 'alumno'
            ? target.identifier
            : target.identifier.replace(/\D/g, '');
        const response = await fetch(`${baseUrl}/api/admin/cuentas/restablecer`, {
            method: 'POST',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ identificador: identifierWithoutHyphen })
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.identificador, identifierWithoutHyphen);
        const passwordWithoutHyphen = target.role === 'alumno'
            ? target.identifier
            : identifierWithoutHyphen;
        assert.equal(result.contraseña_temporal, passwordWithoutHyphen);
        if (target.role !== 'alumno') {
            assert.equal(
                accounts.get(target.role === 'encargado' ? 'guardian@example.test' : 'teacher@example.test').correo,
                identifierWithoutHyphen
            );
        }

        const cookie = await login(identifierWithoutHyphen, passwordWithoutHyphen);
        const profile = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
        assert.equal((await profile.json()).debe_cambiar_contrasena, true);
        if (target.role !== 'alumno') {
            await login(identifierWithoutHyphen, target.identifier);
            await login(target.identifier, passwordWithoutHyphen);
        }
    }
});

// El alta docente con sección y materia escribe el año lectivo usando el nombre ASCII normalizado.
test('admin can create an assigned teacher using the normalized school-year column', async () => {
    const cookie = await login('admin@example.test');
    const response = await fetch(`${baseUrl}/api/admin/docentes`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dui: '083230112',
            nombre: 'Fredy',
            apellido: 'Teran',
            telefono: '67766776',
            id_seccion: '2',
            id_asignatura: '3',
            año_lectivo: '2026-02-23'
        })
    });

    assert.equal(response.status, 201);
    const assignmentInsert = calls.findLast(({ sql }) =>
        sql.includes('INSERT INTO asignacion_docente')
    );
    assert.ok(assignmentInsert);
    assert.match(assignmentInsert.sql, /anio_lectivo/);
    assert.deepEqual(assignmentInsert.params, ['08323011-2', 2, 3, '2026-02-23']);
});

// Comprueba que una cuenta autorizada puede ver solicitudes y descargar un documento protegido.
test('admin can list admission requests and fetch a protected document', async () => {
    const cookie = await login('admin@example.test');
    const applications = await fetch(`${baseUrl}/api/admin/solicitudes?estado=pendiente`, {
        headers: { Cookie: cookie }
    });
    assert.equal(applications.status, 200);
    assert.equal((await applications.json())[0].id_solicitud, 12);

    const document = await fetch(`${baseUrl}/api/admin/solicitudes/12/documentos/partida`, {
        headers: { Cookie: cookie }
    });
    assert.equal(document.status, 200);
    assert.equal(document.headers.get('content-type'), 'image/png');
});

// La aprobación exige una sección de la misma especialidad y la guarda en el alumno.
test('admin must select a matching section when approving an enrollment', async () => {
    const cookie = await login('admin@example.test');
    const invalid = await fetch(`${baseUrl}/api/admin/solicitudes/12/aprobar`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nie_alumno: 'NIE123' })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /sección/i);

    const wrongSpecialty = await fetch(`${baseUrl}/api/admin/solicitudes/12/aprobar`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nie_alumno: 'NIE123', id_seccion: 45 })
    });
    assert.equal(wrongSpecialty.status, 400);
    assert.match((await wrongSpecialty.json()).error, /especialidad/i);
    assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO alumnos')), false);

    const approved = await fetch(`${baseUrl}/api/admin/solicitudes/12/aprobar`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nie_alumno: 'NIE123', id_seccion: 44 })
    });
    assert.equal(approved.status, 200);
    assert.match((await approved.json()).mensaje, /sección seleccionada/i);
    const studentInsert = calls.findLast(({ sql }) => sql.includes('INSERT INTO alumnos'));
    assert.ok(studentInsert);
    assert.match(studentInsert.sql, /\$8/);
    assert.equal(studentInsert.params[7], 44);
});

// Envía una matrícula multipart y verifica que sus adjuntos se guarden dentro de una transacción.
test('public enrollment requires all valid documents and saves files transactionally', async () => {
    const body = new FormData();
    const fields = {
        nombre_est: 'Ana',
        apellido_est: 'López',
        fecha_nac_est: '2010-03-20',
        correo_est: 'ana@example.test',
        telefono_est: '70000000',
        direccion_est: 'San Salvador',
        tipo_bachillerato: 'Técnico',
        id_especialidad: '1',
        nombre_rep: 'Luis',
        apellido_rep: 'López',
        dui_rep: '12345678-9',
        telefono_rep: '70000001'
    };
    Object.entries(fields).forEach(([name, value]) => body.set(name, value));
    const png = new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    body.set('partida_nacimiento', png, 'partida.png');
    body.set('notas_grado_anterior', png, 'notas.png');
    body.set('carta_conducta', png, 'conducta.png');

    const response = await fetch(`${baseUrl}/api/solicitudes-matricula`, {
        method: 'POST',
        body
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).solicitud.id_solicitud, 50);
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO solicitud_documentos')));
});
