// Botones y paneles que se coordinan dentro de cada portal.
const navigationButtons = document.querySelectorAll(".nav-link");
const contentViews = document.querySelectorAll(".content-view");
const portalPages = new Map([
    ["administrador", "panel_admin.html"],
    ["admin", "panel_admin.html"],
    ["secretaria", "panel_admin.html"],
    ["alumno", "panel_alumno.html"],
    ["estudiante", "panel_alumno.html"],
    ["docente", "panel_docente.html"],
    ["encargado", "panel_encargado.html"]
]);

// Activa una sección y oculta las demás sin recargar la página.
function showView(viewName) {
    navigationButtons.forEach((button) => {
        const active = button.dataset.view === viewName
            || (viewName === "alumno-detalle" && button.dataset.view === "alumnos");
        button.classList.toggle("active", active);

        if (active) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    contentViews.forEach((view) => {
        view.hidden = view.id !== `view-${viewName}`;
        view.classList.toggle("active", !view.hidden);
    });
}

navigationButtons.forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
});

// Algunos accesos dentro del contenido también llevan a una vista del panel.
document.querySelectorAll("[data-view]:not(.nav-link)").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
        try {
            const response = await fetch("/api/logout", { method: "POST" });
            if (!response.ok) {
                throw new Error("No se pudo cerrar la sesión.");
            }
            window.location.assign("index.html");
        } catch (error) {
            window.alert(error.message);
        }
    });
});

// El perfil del servidor confirma que la cookie sigue válida al abrir el panel.
fetch("/api/me")
    .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "La sesión ya no está activa.");
        }
        return result;
    })
    .then((user) => {
        if (user.debe_cambiar_contrasena) {
            window.location.replace("cambiar_contrasena.html");
            return;
        }
        const currentPage = window.location.pathname.split("/").pop();
        const expectedPage = portalPages.get(user.rol.trim().toLocaleLowerCase("es"));
        if (expectedPage !== currentPage) {
            window.location.replace(expectedPage || "index.html");
            return;
        }
        const display = document.querySelector("#usuario-login");
        if (display) {
            display.textContent = user.correo || user.rol;
        }
    })
    .catch(() => window.location.replace("index.html"));

// Expone una función común para las peticiones de los portales.
window.IncasPortal = {
    async api(url, options = {}) {
        const bodyIsForm = options.body instanceof FormData;
        const response = await fetch(url, {
            ...options,
            headers: bodyIsForm
                ? options.headers
                : { "Content-Type": "application/json", ...options.headers }
        });
        const result = response.status === 204 ? {} : await response.json();
        if (!response.ok) {
            throw new Error(result.error || "No se pudo completar la solicitud.");
        }
        return result;
    },
    showView
};
