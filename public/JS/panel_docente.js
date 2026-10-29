// Asignaciones, listas y calificaciones del panel_docente.html.
const teacherFields = document.querySelectorAll("[data-teacher-field]");
const assignmentSelect = document.querySelector("#grade-section-select");
const teacherPeriodSelect = document.querySelector("#grade-period-select");
const gradeRows = document.querySelector("#grade-rows");
const saveGradesButton = document.querySelector("#save-grades");
const gradeStatus = document.querySelector("#save-status");

function showGradeMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-cell";
    cell.colSpan = 5;
    cell.textContent = message;
    row.append(cell);
    gradeRows.replaceChildren(row);
}

async function loadTeacherProfile() {
    try {
        const profile = await IncasPortal.api("/api/teacher/profile");
        const values = {
            nombre: profile.nombre,
            apellido: profile.apellido || "Sin registrar",
            materia: profile.materias || "Sin asignaciones",
            secciones: profile.secciones || "Sin asignaciones"
        };
        teacherFields.forEach((field) => {
            field.textContent = values[field.dataset.teacherField] || "—";
        });
    } catch (error) {
        teacherFields.forEach((field) => { field.textContent = error.message; });
    }
}

async function loadTeacherCatalogs() {
    try {
        const [assignments, periods] = await Promise.all([
            IncasPortal.api("/api/teacher/assignments"),
            IncasPortal.api("/api/teacher/periodos")
        ]);
        assignmentSelect.replaceChildren(new Option(
            assignments.length ? "Seleccione materia y sección" : "No tiene materias asignadas",
            ""
        ));
        assignments.forEach((assignment) => assignmentSelect.add(new Option(
            `${assignment.nombre_materia} — ${assignment.nombre_seccion} (${assignment["año_lectivo"].slice(0, 4)})`,
            assignment.id_asignacion
        )));
        assignmentSelect.disabled = assignments.length === 0;

        teacherPeriodSelect.replaceChildren(new Option(
            periods.length ? "Seleccione un período activo" : "No hay períodos activos",
            ""
        ));
        periods.forEach((period) =>
            teacherPeriodSelect.add(new Option(period.nombre_periodo, period.id_periodo))
        );
        teacherPeriodSelect.disabled = periods.length === 0;

        const sections = new Map();
        assignments.forEach((assignment) => {
            if (!sections.has(assignment.id_seccion)) {
                sections.set(assignment.id_seccion, assignment);
            }
        });
        const sectionList = document.querySelector("#sections-list");
        if (!sections.size) {
            const empty = document.createElement("p");
            empty.className = "empty-message";
            empty.textContent = "La administración todavía no asigna secciones a esta cuenta.";
            sectionList.replaceChildren(empty);
        } else {
            sectionList.replaceChildren(...[...sections.values()].map((assignment) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "section-card";
                button.textContent = assignment.nombre_seccion;
                button.dataset.assignmentId = assignment.id_asignacion;
                button.addEventListener("click", async () => {
                    assignmentSelect.value = String(assignment.id_asignacion);
                    IncasPortal.showView("alumnos");
                    await loadSectionRoster(assignment);
                });
                return button;
            }));
        }

        if (assignments.length && periods.length) {
            assignmentSelect.value = String(assignments[0].id_asignacion);
            teacherPeriodSelect.value = String(periods[0].id_periodo);
            await loadRoster();
        } else {
            showGradeMessage("Se requieren una asignación docente y un período activo para ingresar notas.");
        }
    } catch (error) {
        showGradeMessage(error.message);
    }
}

async function loadRoster() {
    const assignmentId = assignmentSelect.value;
    const periodId = teacherPeriodSelect.value;
    if (!assignmentId || !periodId) {
        showGradeMessage("Selecciona materia, sección y período para cargar las notas.");
        saveGradesButton.disabled = true;
        return;
    }
    gradeStatus.textContent = "Cargando lista...";
    saveGradesButton.disabled = true;
    try {
        const result = await IncasPortal.api(
            `/api/teacher/assignments/${assignmentId}/roster?periodo=${periodId}`
        );
        const selectedAssignment = assignmentSelect.selectedOptions[0];
        document.querySelector("#roster-heading").textContent =
            `${selectedAssignment?.textContent || "Alumnos de la sección"}`;
        renderSectionRoster(result.alumnos);
        const gradeMap = new Map(result.notas.map((grade) =>
            [`${grade.nie_alumno}:${grade.id_evaluacion}`, grade.calificacion]
        ));
        if (!result.alumnos.length) {
            showGradeMessage("No hay alumnos asignados a esta sección.");
            gradeStatus.textContent = "";
            return;
        }
        gradeRows.replaceChildren(...result.alumnos.map((student) => {
            const row = document.createElement("tr");
            row.dataset.nie = student.nie_alumno;
            const name = document.createElement("td");
            name.textContent = `${student.nombre} ${student.apellido}`;
            row.append(name);
            result.evaluaciones.forEach((evaluation) => {
                const cell = document.createElement("td");
                const input = document.createElement("input");
                input.className = "grade-input";
                input.type = "number";
                input.min = "0";
                input.max = "10";
                input.step = "0.01";
                input.dataset.evaluationId = evaluation.id_evaluacion;
                input.setAttribute("aria-label", `${evaluation.nombre_evaluacion} de ${student.nombre}`);
                const current = gradeMap.get(`${student.nie_alumno}:${evaluation.id_evaluacion}`);
                input.value = current == null ? "" : Number(current).toString();
                cell.append(input);
                row.append(cell);
            });
            return row;
        }));
        gradeStatus.textContent = "Cada componente vale 25% de la nota del período.";
        saveGradesButton.disabled = false;
    } catch (error) {
        showGradeMessage(error.message);
        gradeStatus.textContent = "";
    }
}

function renderSectionRoster(students) {
    const roster = document.querySelector("#roster-list");
    if (!students.length) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "No hay alumnos asignados a esta sección.";
        roster.replaceChildren(empty);
        return;
    }
    roster.replaceChildren(...students.map((student) => {
        const card = document.createElement("div");
        card.className = "student-card";
        const avatar = document.createElement("span");
        avatar.className = "student-avatar";
        avatar.textContent = student.nombre.slice(0, 1).toLocaleUpperCase("es");
        const name = document.createElement("span");
        name.className = "student-name";
        name.textContent = `${student.nombre} ${student.apellido}`;
        card.append(avatar, name);
        return card;
    }));
}

async function loadSectionRoster(assignment) {
    const roster = document.querySelector("#roster-list");
    const heading = document.querySelector("#roster-heading");
    heading.textContent = assignment.nombre_seccion;
    const loading = document.createElement("p");
    loading.className = "empty-message";
    loading.textContent = "Cargando alumnos...";
    roster.replaceChildren(loading);
    try {
        const students = await IncasPortal.api(
            `/api/teacher/assignments/${assignment.id_asignacion}/alumnos`
        );
        renderSectionRoster(students);
    } catch (error) {
        const message = document.createElement("p");
        message.className = "empty-message";
        message.textContent = error.message;
        roster.replaceChildren(message);
    }
}

async function saveTeacherGrades() {
    saveGradesButton.disabled = true;
    gradeStatus.textContent = "Guardando calificaciones...";
    const notas = [...gradeRows.querySelectorAll("tr[data-nie]")].map((row) => ({
        nie_alumno: row.dataset.nie,
        calificaciones: [...row.querySelectorAll(".grade-input")].map((input) =>
            input.value === "" ? null : Number(input.value)
        )
    }));
    try {
        const result = await IncasPortal.api(
            `/api/teacher/assignments/${assignmentSelect.value}/notas`,
            {
                method: "PUT",
                body: JSON.stringify({
                    id_periodo: Number(teacherPeriodSelect.value),
                    notas
                })
            }
        );
        gradeStatus.textContent = `${result.mensaje} La nota final se calcula con cuatro componentes de 25%.`;
    } catch (error) {
        gradeStatus.textContent = error.message;
    } finally {
        saveGradesButton.disabled = false;
    }
}

assignmentSelect.addEventListener("change", loadRoster);
teacherPeriodSelect.addEventListener("change", loadRoster);
saveGradesButton.addEventListener("click", saveTeacherGrades);
loadTeacherProfile();
loadTeacherCatalogs();
