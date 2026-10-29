-- Ejecuta esta migración una sola vez después de 002_credenciales_iniciales.sql.
BEGIN;

-- Guarda como identificador de acceso los diez dígitos del DUI en docentes y encargados.
UPDATE usuarios AS u
SET correo = regexp_replace(d.dui_docente, '[^0-9]', '', 'g')
FROM docentes AS d
WHERE u.id_usuario = d.id_usuario
  AND u.correo IS DISTINCT FROM regexp_replace(d.dui_docente, '[^0-9]', '', 'g');

UPDATE usuarios AS u
SET correo = regexp_replace(e.dui_encargado, '[^0-9]', '', 'g')
FROM encargados AS e
WHERE u.id_usuario = e.id_usuario
  AND u.correo IS DISTINCT FROM regexp_replace(e.dui_encargado, '[^0-9]', '', 'g');

COMMIT;
