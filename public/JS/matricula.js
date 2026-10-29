// Elementos que controlan los pasos, sus botones y los mensajes accesibles.
const steps = document.querySelectorAll(".form-step");
const nextButtons = document.querySelectorAll(".btn-next");
const previousButtons = document.querySelectorAll(".btn-prev");
const progressSteps = document.querySelectorAll(".step");
const form = document.querySelector(".form");
const bachelorType = document.querySelector("#tipo-bachillerato");
const specialty = document.querySelector("#especialidad");
const specialtyStatus = document.querySelector("#specialty-status");
const reviewSummary = document.querySelector("#review-summary");
const submitStatus = document.querySelector("#submit-status");
const birthDate = form.elements.namedItem("fecha_nac_est");

let currentStep = 0;
let especialidades = [];

// Evita que el formulario permita fechas de nacimiento posteriores a hoy.
birthDate.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

// Activa la lista solo cuando la API cargó opciones que existen en PostgreSQL.
function updateSpecialtyField() {
    specialty.disabled = especialidades.length === 0;
    specialty.required = true;
    specialtyStatus.textContent = especialidades.length === 0
        ? "No se pudieron cargar especialidades. La solicitud requiere una especialidad registrada."
        : "Selecciona la especialidad aplicable; el registro de matrícula la requiere.";
}

// Obtiene especialidades del servidor para enviar el ID relacionado, no el nombre.
async function loadSpecialties() {
    try {
        const response = await fetch("/api/especialidades");
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "No se pudieron cargar las especialidades.");
        }

        especialidades = result;
        specialty.replaceChildren(new Option("Seleccione una especialidad", ""));
        especialidades.forEach((item) => {
            specialty.add(new Option(item.nombre_especialidad, item.id_especialidad));
        });
    } catch (error) {
        specialtyStatus.textContent = error.message || "No se pudieron cargar las especialidades.";
    }

    updateSpecialtyField();
}

// Muestra un resumen seguro usando textContent para no interpretar datos como HTML.
function updateReview() {
    const reviewFields = [
        ["nombre_est", "Nombre del alumno"],
        ["apellido_est", "Apellido del alumno"],
        ["fecha_nac_est", "Fecha de nacimiento"],
        ["correo_est", "Correo institucional"],
        ["telefono_est", "Teléfono del alumno"],
        ["direccion_est", "Dirección del alumno"],
        ["tipo_bachillerato", "Tipo de bachillerato"],
        ["id_especialidad", "Especialidad"],
        ["nombre_rep", "Nombre del encargado"],
        ["apellido_rep", "Apellido del encargado"],
        ["dui_rep", "DUI del encargado"],
        ["telefono_rep", "Teléfono del encargado"],
        ["partida_nacimiento", "Partida de nacimiento"],
        ["notas_grado_anterior", "Notas del grado anterior"],
        ["carta_conducta", "Carta de buena conducta"]
    ];

    reviewSummary.replaceChildren();

    reviewFields.forEach(([fieldName, label]) => {
        const field = form.elements.namedItem(fieldName);
        let value;

        if (field instanceof HTMLInputElement && field.type === "file") {
            value = field.files[0]?.name || "No se seleccionó archivo";
        } else if (field instanceof HTMLSelectElement) {
            value = field.selectedOptions[0]?.textContent.trim() || "No aplica";
        } else {
            value = field.value.trim();
        }

        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        reviewSummary.append(term, description);
    });
}

// Mantiene sincronizado el paso visible con la barra de progreso.
function showStep(index) {
    steps.forEach((step) => step.classList.remove("active"));
    progressSteps.forEach((step) => {
        step.classList.remove("active");
        step.removeAttribute("aria-current");
    });

    steps[index].classList.add("active");
    progressSteps[index].setAttribute("aria-current", "step");

    for (let step = 0; step <= index; step++) {
        progressSteps[step].classList.add("active");
    }
}

nextButtons.forEach((button) => {
    button.addEventListener("click", () => {
        if (currentStep >= steps.length - 1) {
            return;
        }

        // Valida el paso actual antes de permitir que el usuario avance.
        const fields = steps[currentStep].querySelectorAll("input, select, textarea");
        for (const field of fields) {
            if (!field.checkValidity()) {
                field.reportValidity();
                return;
            }
        }

        if (currentStep === 1) {
            updateReview();
        }

        currentStep++;
        showStep(currentStep);
        submitStatus.textContent = "";
    });
});

previousButtons.forEach((button) => {
    button.addEventListener("click", () => {
        if (currentStep > 0) {
            currentStep--;
            showStep(currentStep);
        }
    });
});

bachelorType.addEventListener("change", updateSpecialtyField);

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Vuelve a validar todos los pasos porque los campos anteriores pueden cambiar.
    for (let index = 0; index < steps.length; index++) {
        const fields = steps[index].querySelectorAll("input, select, textarea");
        for (const field of fields) {
            if (!field.checkValidity()) {
                currentStep = index;
                showStep(currentStep);
                field.reportValidity();
                return;
            }
        }
    }

    submitStatus.className = "submit-status full-width";
    submitStatus.textContent = "Enviando solicitud...";
    const formData = new FormData(form);
    // Solo se envían campos que existen en solicitudes_matricula; el DDL no guarda archivos.
    const solicitud = Object.fromEntries([
        "nombre_est",
        "apellido_est",
        "fecha_nac_est",
        "correo_est",
        "telefono_est",
        "direccion_est",
        "tipo_bachillerato",
        "id_especialidad",
        "nombre_rep",
        "apellido_rep",
        "dui_rep",
        "telefono_rep"
    ].map((name) => [name, formData.get(name)]));
    const submitButton = form.querySelector(".btn-submit");
    submitButton.disabled = true;

    // Deshabilita el envío durante la petición para evitar solicitudes duplicadas.
    try {
        const response = await fetch("/api/solicitudes-matricula", {
            method: "POST",
            body: (() => {
                const multipart = new FormData(form);
                Object.entries(solicitud).forEach(([name, value]) => multipart.set(name, value));
                return multipart;
            })()
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "No se pudo enviar la solicitud.");
        }

        submitStatus.textContent = `${result.mensaje} Número de solicitud: ${result.solicitud.id_solicitud}.`;
    } catch (error) {
        submitStatus.textContent = error.message || "No se pudo conectar con el servidor.";
        submitButton.disabled = false;
    }
});

// Carga los catálogos y deja visible el primer paso al abrir la página.
loadSpecialties();
showStep(currentStep);
