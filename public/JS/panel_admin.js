// Operaciones y helpers de las vistas del panel_admin.html.
const adminStatus = (id, message, kind = "") => {
    const element = document.querySelector(`#${id}`);
    element.textContent = message;
    element.className = `teacher-create-status ${kind}`.trim();
};

async function adminApi(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: options.body instanceof FormData
            ? options.headers
            : { "Content-Type": "application/json", ...options.headers }
    });
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
        throw new Error(result.error || "No se pudo completar la operación.");
    }
    return result;
}

function showTemporaryCredentials(targetId, result) {
    const credentials = [
        result.docente,
        result.alumno,
        result.encargado && !result.encargado.cuenta_existente ? result.encargado : null
    ].filter(Boolean);
    const details = credentials.map((account) =>
        `Usuario ${account.identificador || account.correo || account.dui}; contraseña temporal: ${account.contraseña_temporal}`
    );
    const message = [result.mensaje, ...details].filter(Boolean).join(" | ");
    adminStatus(targetId, message, "success");
    return message;
}

function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value == null || value === "" ? "—" : String(value);
    row.append(cell);
    return cell;
}

function showTableMessage(body, colspan, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colspan;
    cell.textContent = message;
    row.append(cell);
    body.replaceChildren(row);
}

function addOption(select, value, label) {
    select.add(new Option(label, value));
}

async function loadSectionOptions(select, placeholder = "Seleccione una sección") {
    const sections = await adminApi("/api/admin/secciones");
    select.replaceChildren(new Option(placeholder, ""));
    sections.forEach((section) => addOption(select, section.id_seccion, section.nombre_seccion));
    return sections;
}

async function loadSpecialtyOptions(select, placeholder = "Seleccione una especialidad") {
    const specialties = await adminApi("/api/admin/especialidades");
    select.replaceChildren(new Option(placeholder, ""));
    specialties.forEach((item) => addOption(select, item.id_especialidad, item.nombre_especialidad));
}

function createApplicationSectionSelect(application, sections) {
    const select = document.createElement("select");
    select.dataset.applicationSection = "";
    select.setAttribute("aria-label", `Sección para ${application.nombre_est} ${application.apellido_est}`);
    select.required = true;
    const availableSections = sections.filter(
        (section) => Number(section.id_especialidad) === Number(application.id_especialidad)
    );
    select.add(new Option(
        availableSections.length ? "Seleccione una sección" : "No hay secciones para esta especialidad",
        ""
    ));
    availableSections.forEach((section) =>
        addOption(select, section.id_seccion, section.nombre_seccion)
    );
    return select;
}

// Las solicitudes incluyen enlaces protegidos a documentos almacenados en PostgreSQL.
async function loadApplications() {
    const body = document.querySelector("#solicitudes-body");
    const filter = document.querySelector("#solicitud-filter").value;
    const status = document.querySelector("#solicitudes-status");
    status.textContent = "Cargando solicitudes...";
    try {
        const query = filter ? `?estado=${encodeURIComponent(filter)}` : "";
        const [applications, sections] = await Promise.all([
            adminApi(`/api/admin/solicitudes${query}`),
            adminApi("/api/admin/secciones")
        ]);
        if (!applications.length) {
            showTableMessage(body, 6, "No hay solicitudes para este filtro.");
            status.textContent = "";
            return;
        }

        const rows = applications.map((application) => {
            const row = document.createElement("tr");
            const requestCell = addCell(row, `#${application.id_solicitud}\n${new Date(application.fecha_solicitud).toLocaleDateString("es-SV")}`);
            requestCell.style.whiteSpace = "pre-line";

            const studentCell = document.createElement("td");
            studentCell.append(
                document.createTextNode(`${application.nombre_est} ${application.apellido_est}`)
            );
            const studentDetails = document.createElement("small");
            studentDetails.textContent = `${application.correo_est} | ${application.fecha_nac_est.slice(0, 10)} | ${application.tipo_bachillerato} — ${application.nombre_especialidad}`;
            studentCell.append(document.createElement("br"), studentDetails);
            row.append(studentCell);

            const guardianCell = document.createElement("td");
            guardianCell.append(
                document.createTextNode(`${application.nombre_rep} ${application.apellido_rep}`)
            );
            const guardianDetails = document.createElement("small");
            guardianDetails.textContent = `${application.dui_rep} | ${application.telefono_rep}`;
            guardianCell.append(document.createElement("br"), guardianDetails);
            row.append(guardianCell);

            const documentsCell = document.createElement("td");
            if (application.tiene_documentos) {
                [
                    ["partida", "Partida"],
                    ["notas", "Notas"],
                    ["conducta", "Conducta"]
                ].forEach(([type, label]) => {
                    const link = document.createElement("a");
                    link.href = `/api/admin/solicitudes/${application.id_solicitud}/documentos/${type}`;
                    link.target = "_blank";
                    link.rel = "noopener";
                    link.textContent = label;
                    documentsCell.append(link, document.createElement("br"));
                });
            } else {
                documentsCell.textContent = "Sin documentos";
            }
            row.append(documentsCell);

            addCell(row, application.estado_solicitud);
            const actionCell = document.createElement("td");
            if (application.estado_solicitud === "pendiente") {
                const nie = document.createElement("input");
                nie.type = "text";
                nie.maxLength = 15;
                nie.placeholder = "NIE del alumno";
                nie.setAttribute("aria-label", `NIE para la solicitud ${application.id_solicitud}`);
                nie.required = true;
                const sectionSelect = createApplicationSectionSelect(application, sections);
                const approve = document.createElement("button");
                approve.type = "button";
                approve.dataset.applicationAction = "aprobar";
                approve.dataset.applicationId = application.id_solicitud;
                approve.textContent = "Aprobar";
                approve.disabled = sectionSelect.options.length < 2;
                const reject = document.createElement("button");
                reject.type = "button";
                reject.dataset.applicationAction = "rechazar";
                reject.dataset.applicationId = application.id_solicitud;
                reject.textContent = "Rechazar";
                actionCell.append(nie, sectionSelect, approve, reject);
            } else {
                actionCell.textContent = application.nie_alumno
                    ? `NIE creado: ${application.nie_alumno}`
                    : "Solicitud revisada";
            }
            row.append(actionCell);
            return row;
        });
        body.replaceChildren(...rows);
        status.textContent = "";
    } catch (error) {
        showTableMessage(body, 6, "No se pudieron cargar las solicitudes.");
        status.textContent = error.message;
    }
}

async function loadTeachers() {
    const body = document.querySelector("#docentes-body");
    try {
        const teachers = await adminApi("/api/admin/docentes");
        if (!teachers.length) {
            showTableMessage(body, 5, "Todavía no hay docentes registrados.");
            return;
        }
        body.replaceChildren(...teachers.map((teacher) => {
            const row = document.createElement("tr");
            addCell(row, teacher.dui_docente);
            addCell(row, teacher.nombre);
            addCell(row, teacher.apellido);
            addCell(row, teacher.usuario);
            addCell(row, teacher.materias || "Sin asignación");
            return row;
        }));
    } catch (error) {
        showTableMessage(body, 5, error.message);
    }
}

async function loadSections() {
    const body = document.querySelector("#secciones-body");
    try {
        const sections = await adminApi("/api/admin/secciones");
        if (!sections.length) {
            showTableMessage(body, 4, "Todavía no hay secciones registradas.");
            return;
        }
        body.replaceChildren(...sections.map((section) => {
            const row = document.createElement("tr");
            addCell(row, section.id_seccion);
            addCell(row, section.nombre_seccion);
            addCell(row, section.nombre_especialidad);
            addCell(row, section.cantidad_alumnos);
            return row;
        }));
    } catch (error) {
        showTableMessage(body, 4, error.message);
    }
}

async function loadPeriods() {
    const body = document.querySelector("#periodos-body");
    try {
        const periods = await adminApi("/api/admin/periodos");
        if (!periods.length) {
            showTableMessage(body, 5, "Todavía no hay períodos registrados.");
            return;
        }
        body.replaceChildren(...periods.map((period) => {
            const row = document.createElement("tr");
            addCell(row, period.nombre_periodo);
            addCell(row, period.fecha_inicio.slice(0, 10));
            addCell(row, period.fecha_fin.slice(0, 10));
            addCell(row, period.estado ? "Activo" : "Finalizado");
            const actionCell = document.createElement("td");
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.periodId = period.id_periodo;
            button.dataset.periodState = String(!period.estado);
            button.textContent = period.estado ? "Finalizar" : "Reactivar";
            actionCell.append(button);
            row.append(actionCell);
            return row;
        }));
    } catch (error) {
        showTableMessage(body, 5, error.message);
    }
}

// Carga los catálogos que permiten crear secciones y asignar docentes.
async function loadAdminCatalogs() {
    try {
        await Promise.all([
            loadSpecialtyOptions(document.querySelector("#select-especialidad-seccion")),
            loadSectionOptions(document.querySelector("#select-seccion-docente"), "Sin asignación por ahora")
        ]);
        const catalog = await adminApi("/api/admin/catalogos-docente");
        const subjectSelect = document.querySelector("#select-asignatura-docente");
        subjectSelect.replaceChildren(new Option("Sin asignación por ahora", ""));
        catalog.asignaturas.forEach((item) =>
            addOption(subjectSelect, item.id_asignatura, item.nombre_materia)
        );
    } catch (error) {
        adminStatus("teacher-create-status", error.message);
        adminStatus("section-create-status", error.message);
    }
}

document.querySelector("#teacher-create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    adminStatus("teacher-create-status", "Creando cuenta docente...");
    try {
        const result = await adminApi("/api/admin/docentes", {
            method: "POST",
            body: JSON.stringify(data)
        });
        showTemporaryCredentials("teacher-create-status", result);
        form.reset();
        await loadTeachers();
    } catch (error) {
        adminStatus("teacher-create-status", error.message, "error");
    }
});

document.querySelector("#section-create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    adminStatus("section-create-status", "Creando sección...");
    try {
        const result = await adminApi("/api/admin/secciones", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        adminStatus("section-create-status", `Se creó la sección ${result.nombre_seccion}.`, "success");
        form.reset();
        await Promise.all([
            loadSections(),
            loadSectionOptions(document.querySelector("#select-seccion-docente"), "Sin asignación por ahora")
        ]);
    } catch (error) {
        adminStatus("section-create-status", error.message, "error");
    }
});

document.querySelector("#period-create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    adminStatus("period-status", "Creando período...");
    try {
        const result = await adminApi("/api/admin/periodos", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        adminStatus("period-status", `Período ${result.nombre_periodo} creado y activo.`, "success");
        form.reset();
        await loadPeriods();
    } catch (error) {
        adminStatus("period-status", error.message, "error");
    }
});

document.querySelector("#solicitud-filter").addEventListener("change", loadApplications);

document.querySelector("#tabla-solicitudes").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-application-action]");
    if (!button) {
        return;
    }
    const id = button.dataset.applicationId;
    const status = document.querySelector("#solicitudes-status");
    button.disabled = true;
    let credentialsMessage = "";
    try {
        if (button.dataset.applicationAction === "aprobar") {
            const row = button.closest("tr");
            const nie = row.querySelector("input").value.trim();
            const idSeccion = row.querySelector("[data-application-section]").value;
            if (!nie || !idSeccion) {
                status.textContent = "Ingrese el NIE y seleccione la sección antes de aprobar.";
                button.disabled = false;
                return;
            }
            const result = await adminApi(`/api/admin/solicitudes/${id}/aprobar`, {
                method: "POST",
                body: JSON.stringify({ nie_alumno: nie, id_seccion: idSeccion })
            });
            credentialsMessage = showTemporaryCredentials("solicitudes-status", result);
        } else {
            if (!window.confirm("¿Rechazar esta solicitud de matrícula?")) {
                button.disabled = false;
                return;
            }
            const result = await adminApi(`/api/admin/solicitudes/${id}/rechazar`, {
                method: "POST",
                body: JSON.stringify({})
            });
            status.textContent = result.mensaje;
        }
        await loadApplications();
        if (credentialsMessage) {
            adminStatus("solicitudes-status", credentialsMessage, "success");
        }
    } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
    }
});

document.querySelector("#account-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#account-search-status");
    const resultCard = document.querySelector("#account-search-result");
    const identifier = new FormData(event.currentTarget).get("identificador").trim();
    status.textContent = "Buscando...";
    resultCard.hidden = true;
    try {
        const person = await adminApi(`/api/admin/busqueda?identificador=${encodeURIComponent(identifier)}`);
        const details = document.querySelector("#account-search-details");
        details.replaceChildren();
        [
            ["Tipo", person.tipo],
            ["Identificador", person.identificador],
            ["Nombre", `${person.nombre} ${person.apellido}`],
            ["Usuario", person.identificador || person.correo],
            ...(person.tipo === "alumno"
                ? [["Sección", person.nombre_seccion || "Sin asignar"], ["DUI encargado", person.dui_encargado]]
                : [["Teléfono", person.telefono]])
        ].forEach(([label, value]) => {
            const term = document.createElement("dt");
            const description = document.createElement("dd");
            term.textContent = label;
            description.textContent = value || "—";
            details.append(term, description);
        });

        resultCard.dataset.identifier = person.identificador;
        const reset = resultCard.querySelector(".account-reset-button");
        reset.disabled = false;
        status.textContent = "Registro encontrado.";
        resultCard.hidden = false;
    } catch (error) {
        status.textContent = error.message;
    }
});

document.querySelector(".account-reset-button").addEventListener("click", async () => {
    const resultCard = document.querySelector("#account-search-result");
    const resetButton = document.querySelector(".account-reset-button");
    const note = document.querySelector("#account-reset-note");
    resetButton.disabled = true;
    try {
        const result = await adminApi("/api/admin/cuentas/restablecer", {
            method: "POST",
            body: JSON.stringify({ identificador: resultCard.dataset.identifier })
        });
        note.textContent = `${result.mensaje} Usuario: ${result.identificador}. Contraseña temporal: ${result.contraseña_temporal}`;
    } catch (error) {
        note.textContent = error.message;
        resetButton.disabled = false;
    }
});

document.querySelector("#periodos-body").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-period-id]");
    if (!button) {
        return;
    }
    button.disabled = true;
    try {
        await adminApi(`/api/admin/periodos/${button.dataset.periodId}/estado`, {
            method: "PATCH",
            body: JSON.stringify({ estado: button.dataset.periodState === "true" })
        });
        await loadPeriods();
    } catch (error) {
        adminStatus("period-status", error.message, "error");
        button.disabled = false;
    }
});

// Solicita solo las vistas existentes en el panel para mostrar errores en su sección.
loadAdminCatalogs();
loadApplications();
loadTeachers();
loadSections();
loadPeriods();
