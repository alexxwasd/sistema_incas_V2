// Formulario que sustituye las claves temporales por una contraseña personal.
const changePasswordForm = document.querySelector("#change-password-form");
const passwordStatus = document.querySelector("#password-status");
const passwordUser = document.querySelector("#password-user");
const newPasswordInput = document.querySelector("#new-password");
const confirmPasswordInput = document.querySelector("#confirm-password");
const savePasswordButton = changePasswordForm.querySelector("button[type='submit']");

// Los destinos corresponden a los portales disponibles por tipo de cuenta.
const passwordRolePages = new Map([
    ["administrador", "panel_admin.html"],
    ["admin", "panel_admin.html"],
    ["secretaria", "panel_admin.html"],
    ["alumno", "panel_alumno.html"],
    ["estudiante", "panel_alumno.html"],
    ["docente", "panel_docente.html"],
    ["encargado", "panel_encargado.html"]
]);

let authenticatedRole = "";

// Confirma la sesión y presenta el identificador de acceso de la cuenta.
async function loadPasswordAccount() {
    try {
        const response = await fetch("/api/me");
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "La sesión ya no está activa.");
        }
        if (!result.debe_cambiar_contrasena) {
            window.location.replace(passwordRolePages.get(result.rol.toLocaleLowerCase("es")) || "/");
            return;
        }
        authenticatedRole = result.rol;
        passwordUser.textContent = `Cuenta: ${result.correo || result.rol}`;
    } catch (error) {
        passwordStatus.textContent = error.message;
        window.setTimeout(() => window.location.replace("/"), 1500);
    }
}

// Envía ambas entradas para que el servidor valide y guarde el hash nuevo.
changePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    passwordStatus.textContent = "";
    if (newPasswordInput.value !== confirmPasswordInput.value) {
        passwordStatus.textContent = "Las contraseñas no coinciden.";
        confirmPasswordInput.focus();
        return;
    }

    savePasswordButton.disabled = true;
    try {
        const response = await fetch("/api/cambiar-contrasena", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nueva_contrasena: newPasswordInput.value,
                confirmar_contrasena: confirmPasswordInput.value
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "No se pudo actualizar la contraseña.");
        }
        passwordStatus.textContent = result.mensaje;
        const destination = passwordRolePages.get(authenticatedRole.toLocaleLowerCase("es")) || "/";
        window.setTimeout(() => window.location.assign(destination), 600);
    } catch (error) {
        passwordStatus.textContent = error.message;
        savePasswordButton.disabled = false;
    }
});

// Permite salir sin cambiar la contraseña y revoca la cookie de sesión.
document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
        const response = await fetch("/api/logout", { method: "POST" });
        if (!response.ok) {
            throw new Error("No se pudo cerrar la sesión.");
        }
        window.location.assign("/");
    } catch (error) {
        passwordStatus.textContent = error.message;
    }
});

loadPasswordAccount();
