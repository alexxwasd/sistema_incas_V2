// Carga las credenciales locales antes de crear el pool de conexiones.
require('dotenv').config();

const { Pool } = require('pg');

// Solo se habilita TLS cuando el proveedor lo exige; la validación del certificado sigue activa.
const ssl = process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: true }
    : false;

// DATABASE_URL permite usar servicios en la nube; si no existe, se usan variables separadas.
const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl
    };

// Falla al iniciar con un mensaje claro si la configuración local está incompleta.
if (!poolConfig.connectionString) {
    const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
        .filter((name) => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`Faltan variables de conexión PostgreSQL: ${missing.join(', ')}`);
    }
    if (!Number.isInteger(poolConfig.port) || poolConfig.port < 1 || poolConfig.port > 65535) {
        throw new Error('DB_PORT debe ser un puerto válido entre 1 y 65535.');
    }
}

// Pool reutilizable para que las peticiones compartan conexiones PostgreSQL.
const pool = new Pool(poolConfig);

// Reporta desconexiones inesperadas del pool en lugar de ocultarlas.
pool.on('error', (error) => {
    console.error('Error inesperado en el pool de PostgreSQL:', error);
});

module.exports = pool;
