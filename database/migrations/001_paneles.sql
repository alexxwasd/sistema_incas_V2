-- Corre esta migración una sola vez en la base de datos INCAS antes de iniciar el servidor.
BEGIN;

-- Usa un identificador ASCII estable para la contraseña en el backend.
DO $$
DECLARE
    columna_anterior TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'usuarios'
          AND column_name = 'contrasena'
    ) THEN
        SELECT column_name
        INTO columna_anterior
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'usuarios'
          AND column_name IN (U&'contrase\00F1a', U&'contrase\00A4a')
        LIMIT 1;

        IF columna_anterior IS NULL THEN
            RAISE EXCEPTION 'No se encontró la columna de contraseña en usuarios';
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I RENAME COLUMN %I TO contrasena',
            current_schema(),
            'usuarios',
            columna_anterior
        );
    END IF;
END $$;

-- Conserva compatibilidad con alumnos existentes que todavía no tienen sección.
ALTER TABLE alumnos
    ALTER COLUMN id_seccion DROP NOT NULL;

-- El esquema original no tenía apellido para docentes, aunque el portal lo muestra.
ALTER TABLE docentes
    ADD COLUMN IF NOT EXISTS apellido VARCHAR(50);

-- El NIE se captura al aprobar; el estado textual distingue pendientes y rechazadas.
ALTER TABLE solicitudes_matricula
    ADD COLUMN IF NOT EXISTS nie_alumno VARCHAR(15),
    ADD COLUMN IF NOT EXISTS estado_solicitud VARCHAR(12);

UPDATE solicitudes_matricula
SET estado_solicitud = CASE WHEN estado THEN 'aprobada' ELSE 'pendiente' END
WHERE estado_solicitud IS NULL;

ALTER TABLE solicitudes_matricula
    ALTER COLUMN estado_solicitud SET DEFAULT 'pendiente',
    ALTER COLUMN estado_solicitud SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'solicitudes_matricula_estado_solicitud_check'
          AND conrelid = 'solicitudes_matricula'::regclass
    ) THEN
        ALTER TABLE solicitudes_matricula
            ADD CONSTRAINT solicitudes_matricula_estado_solicitud_check
            CHECK (estado_solicitud IN ('pendiente', 'aprobada', 'rechazada'));
    END IF;
END $$;

-- Los binarios se guardan en una tabla separada para no cargar el listado administrativo.
CREATE TABLE IF NOT EXISTS solicitud_documentos (
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

COMMIT;
