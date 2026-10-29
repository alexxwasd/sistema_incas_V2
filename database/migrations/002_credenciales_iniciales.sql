-- Ejecuta esta migración una sola vez después de 001_paneles.sql.
BEGIN;

-- Marca las cuentas nuevas/restablecidas para exigir una contraseña personal.
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE;

-- El acceso de docentes se identifica con DUI; no se requiere correo en su perfil.
ALTER TABLE docentes
    ALTER COLUMN correo DROP NOT NULL;

UPDATE docentes
SET correo = NULL
WHERE correo IS NOT NULL;

-- Actualiza el usuario de acceso de docentes y encargados existentes a su DUI.
UPDATE usuarios AS u
SET correo = d.dui_docente
FROM docentes AS d
WHERE u.id_usuario = d.id_usuario
  AND u.correo IS DISTINCT FROM d.dui_docente;

UPDATE usuarios AS u
SET correo = e.dui_encargado
FROM encargados AS e
WHERE u.id_usuario = e.id_usuario
  AND u.correo IS DISTINCT FROM e.dui_encargado;

-- También exige contraseña personal a perfiles existentes, sin alterar sus claves actuales.
UPDATE usuarios
SET debe_cambiar_contrasena = TRUE
WHERE id_usuario IN (
    SELECT id_usuario FROM alumnos
    UNION
    SELECT id_usuario FROM docentes
    UNION
    SELECT id_usuario FROM encargados
);

COMMIT;
