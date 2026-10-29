-- Ejecuta esta migración una sola vez después de 003_dui_sin_guion.sql.
BEGIN;

-- Normaliza a ASCII el nombre de la columna para evitar diferencias de codificación.
DO $$
DECLARE
    columna_anterior TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'asignacion_docente'
          AND column_name = 'anio_lectivo'
    ) THEN
        SELECT column_name
        INTO columna_anterior
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'asignacion_docente'
          AND column_name IN (
              U&'a\00F1o_lectivo',
              U&'a\00C3\00B1o_lectivo',
              U&'a\00A4o_lectivo'
          )
        ORDER BY CASE column_name
            WHEN U&'a\00F1o_lectivo' THEN 1
            WHEN U&'a\00C3\00B1o_lectivo' THEN 2
            ELSE 3
        END
        LIMIT 1;

        IF columna_anterior IS NULL THEN
            RAISE EXCEPTION
                'No se encontró la columna del año lectivo en asignacion_docente. Revisa sus columnas antes de aplicar esta migración.';
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I RENAME COLUMN %I TO anio_lectivo',
            current_schema(),
            'asignacion_docente',
            columna_anterior
        );
    END IF;
END $$;

COMMIT;
