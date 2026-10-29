// Referencias al formulario de acceso y al espacio donde se muestran errores.
const loginForm = document.querySelector("#admin-login-form");
const loginStatus = document.querySelector("#login-status");

// Relaciona los nombres de rol almacenados en PostgreSQL con los paneles existentes.
const rolePages = new Map([
    ["administrador", "panel_admin.html"],
    ["admin", "panel_admin.html"],
    ["secretaria", "panel_admin.html"],
    ["alumno", "panel_alumno.html"],
    ["estudiante", "panel_alumno.html"],
    ["docente", "panel_docente.html"],
    ["encargado", "panel_encargado.html"]
]);

// Envía el identificador de acceso y deriva a cambio de clave si es una cuenta inicial.
loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const identificador = formData.get("identifier");
    const contraseña = formData.get("pin");

    loginStatus.textContent = "Verificando credenciales...";

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identificador, contraseña })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "No se pudo iniciar sesión.");
        }

        // Normaliza el nombre para que mayúsculas y espacios no afecten la redirección.
        const page = rolePages.get(result.rol.trim().toLocaleLowerCase("es"));
        if (!page) {
            throw new Error("El rol de esta cuenta todavía no tiene un portal asignado.");
        }

        window.location.assign(result.debe_cambiar_contrasena
            ? "cambiar_contrasena.html"
            : page);
    } catch (error) {
        loginStatus.textContent = error.message || "No se pudo conectar con el servidor.";
    }
});