-- Esquema completo actual del sistema INCAS para una base de datos nueva.
-- Incluye los cambios de las migraciones 001_paneles a 004_anio_lectivo.
-- Ejecuta este archivo una sola vez. No lo ejecutes sobre una base existente.

BEGIN;

CREATE TABLE roles (
    id_rol SERIAL PRIMARY KEY,
    nombre_rol VARCHAR(50) NOT NULL
);

CREATE TABLE especialidades (
    id_especialidad SERIAL PRIMARY KEY,
    nombre_especialidad VARCHAR(100) NOT NULL
);

CREATE TABLE asignaturas (
    id_asignatura SERIAL PRIMARY KEY,
    nombre_materia VARCHAR(100) NOT NULL
);

CREATE TABLE periodos (
    id_periodo SERIAL PRIMARY KEY,
    nombre_periodo VARCHAR(50) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    estado BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE usuarios (
    id_usuario SERIAL PRIMARY KEY,
    correo VARCHAR(100) NOT NULL UNIQUE,
    contrasena VARCHAR(255) NOT NULL,
    id_rol INTEGER NOT NULL REFERENCES roles (id_rol),
    estado BOOLEAN NOT NULL DEFAULT TRUE,
    debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE secretaria (
    dui_secretaria VARCHAR(10) PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    apellido VARCHAR(50) NOT NULL,
    correo VARCHAR(100) NOT NULL,
    id_usuario INTEGER NOT NULL REFERENCES usuarios (id_usuario),
    telefono VARCHAR(20)
);

CREATE TABLE docentes (
    dui_docente VARCHAR(10) PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    apellido VARCHAR(50),
    correo VARCHAR(100),
    id_usuario INTEGER NOT NULL REFERENCES usuarios (id_usuario),
    telefono VARCHAR(20)
);

CREATE TABLE encargados (
    dui_encargado VARCHAR(10) PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    apellido VARCHAR(50) NOT NULL,
    id_usuario INTEGER NOT NULL REFERENCES usuarios (id_usuario),
    telefono VARCHAR(20) NOT NULL,
    fecha_nac DATE
);

CREATE TABLE secciones (
    id_seccion SERIAL PRIMARY KEY,
    nombre_seccion VARCHAR(100) NOT NULL,
    id_especialidad INTEGER NOT NULL REFERENCES especialidades (id_especialidad)
);

CREATE TABLE alumnos (
    nie_alumno VARCHAR(15) PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    apellido VARCHAR(50) NOT NULL,
    correo VARCHAR(100) NOT NULL,
    id_usuario INTEGER NOT NULL REFERENCES usuarios (id_usuario),
    fecha_nac DATE NOT NULL,
    dui_encargado VARCHAR(10) NOT NULL REFERENCES encargados (dui_encargado),
    id_seccion INTEGER REFERENCES secciones (id_seccion)
);

CREATE TABLE asignacion_docente (
    id_asignacion SERIAL PRIMARY KEY,
    dui_docente VARCHAR(10) NOT NULL REFERENCES docentes (dui_docente),
    id_seccion INTEGER NOT NULL REFERENCES secciones (id_seccion),
    id_asignatura INTEGER NOT NULL REFERENCES asignaturas (id_asignatura),
    anio_lectivo DATE NOT NULL
);

CREATE TABLE evaluaciones (
    id_evaluacion SERIAL PRIMARY KEY,
    id_asignacion INTEGER NOT NULL REFERENCES asignacion_docente (id_asignacion),
    id_periodo INTEGER NOT NULL REFERENCES periodos (id_periodo),
    nombre_evaluacion VARCHAR(100) NOT NULL,
    porcentaje DECIMAL(5,2) NOT NULL
);

CREATE TABLE detalle_notas (
    id_nota SERIAL PRIMARY KEY,
    id_evaluacion INTEGER NOT NULL REFERENCES evaluaciones (id_evaluacion),
    nie_alumno VARCHAR(15) NOT NULL REFERENCES alumnos (nie_alumno),
    calificacion DECIMAL(5,2) NOT NULL
);

CREATE TABLE solicitudes_matricula (
    id_solicitud SERIAL PRIMARY KEY,
    nombre_est VARCHAR(50) NOT NULL,
    apellido_est VARCHAR(50) NOT NULL,
    fecha_nac_est DATE NOT NULL,
    correo_est VARCHAR(100) NOT NULL,
    telefono_est VARCHAR(20) NOT NULL,
    direccion_est TEXT NOT NULL,
    tipo_bachillerato VARCHAR(50) NOT NULL,
    id_especialidad INTEGER NOT NULL REFERENCES especialidades (id_especialidad),
    nombre_rep VARCHAR(50) NOT NULL,
    apellido_rep VARCHAR(50) NOT NULL,
    dui_rep VARCHAR(10) NOT NULL,
    telefono_rep VARCHAR(20) NOT NULL,
    estado BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_solicitud TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nie_alumno VARCHAR(15),
    estado_solicitud VARCHAR(12) NOT NULL DEFAULT 'pendiente'
        CHECK (estado_solicitud IN ('pendiente', 'aprobada', 'rechazada'))
);

CREATE TABLE solicitud_documentos (
    id_solicitud INTEGER PRIMARY KEY
        REFERENCES solicitudes_matricula (id_solicitud) ON DELETE CASCADE,
    partida_nacimiento BYTEA NOT NULL,
    partida_nombre VARCHAR(255) NOT NULL,
    partida_mime VARCHAR(50) NOT NULL,
    notas_grado_anterior BYTEA NOT NULL,
    notas_nombre VARCHAR(255) NOT NULL,
    notas_mime VARCHAR(50) NOT NULL,
    carta_conducta BYTEA NOT NULL,
    carta_nombre VARCHAR(255) NOT NULL,
    carta_mime VARCHAR(50) NOT NULL
);

-- Roles que reconoce el sistema. Se insertan solo si aún no existen.
INSERT INTO roles (nombre_rol)
SELECT catalog.nombre_rol
FROM (VALUES
    ('Administrador'),
    ('Secretaria'),
    ('Docente'),
    ('Alumno'),
    ('Encargado')
) AS catalog(nombre_rol)
WHERE NOT EXISTS (
    SELECT 1
    FROM roles AS existing
    WHERE lower(existing.nombre_rol) = lower(catalog.nombre_rol)
);

-- Catálogo de especialidades usado actualmente en la matrícula.
INSERT INTO especialidades (nombre_especialidad)
SELECT catalog.nombre_especialidad
FROM (VALUES
    ('Agropecuario'),
    ('Desarrollo de Software'),
    ('Electrotecnia'),
    ('Contabilidad'),
    ('Turismo'),
    ('General')
) AS catalog(nombre_especialidad)
WHERE NOT EXISTS (
    SELECT 1
    FROM especialidades AS existing
    WHERE lower(existing.nombre_especialidad) = lower(catalog.nombre_especialidad)
);

-- Catálogo de materias actual, sin duplicar Módulo Turismo.
INSERT INTO asignaturas (nombre_materia)
SELECT catalog.nombre_materia
FROM (VALUES
    ('Lenguaje y Literatura'),
    ('Ciudadania y Valores'),
    ('Matematica'),
    ('Ingles'),
    ('Ciencias Naturales'),
    ('Modulo Software'),
    ('Modulo Turismo'),
    ('Modulo Agropecuario'),
    ('Modulo Contabilidad'),
    ('Modulo Electrotecnia')
) AS catalog(nombre_materia)
WHERE NOT EXISTS (
    SELECT 1
    FROM asignaturas AS existing
    WHERE lower(existing.nombre_materia) = lower(catalog.nombre_materia)
);

COMMIT;
