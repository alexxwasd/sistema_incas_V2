// Datos familiares y expediente del panel_encargado.html.
const guardianFields = document.querySelectorAll("[data-guardian-field]");
const studentList = document.querySelector("#students-list");
const selectedStudentFields = document.querySelectorAll("#selected-student-information [data-student-field]");
const guardianPeriodSelect = document.querySelector("#view-alumno-detalle #period-select");
const guardianGradesBody = document.querySelector("#view-alumno-detalle #grades-body");
let selectedNie = null;

function showGuardianGradeMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-cell";
    cell.colSpan = 2;
    cell.textContent = message;
    row.append(cell);
    guardianGradesBody.replaceChildren(row);
}

async function loadGuardianProfile() {
    try {
        const profile = await IncasPortal.api("/api/encargado/perfil");
        const values = {
            nombre: profile.nombre,
            apellido: profile.apellido,
            telefono: profile.telefono,
            correo: profile.correo,
            dui: profile.dui_encargado
        };
        guardianFields.forEach((field) => {
            field.textContent = values[field.dataset.guardianField] || "—";
        });
    } catch (error) {
        guardianFields.forEach((field) => { field.textContent = error.message; });
    }
}

async function loadGuardianStudents() {
    try {
        const students = await IncasPortal.api("/api/encargado/alumnos");
        if (!students.length) {
            const empty = document.createElement("p");
            empty.className = "empty-message";
            empty.textContent = "No hay alumnos vinculados a este encargado.";
            studentList.replaceChildren(empty);
            return;
        }
        studentList.replaceChildren(...students.map((student) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "student-card";
            const avatar = document.createElement("span");
            avatar.className = "student-avatar";
            avatar.textContent = student.nombre.slice(0, 1).toLocaleUpperCase("es");
            const name = document.createElement("span");
            name.className = "student-name";
            name.textContent = `${student.nombre} ${student.apellido} — ${student.nombre_seccion || "Sección pendiente"}`;
            button.append(avatar, name);
            button.addEventListener("click", () => loadStudentDetails(student.nie_alumno));
            return button;
        }));
    } catch (error) {
        const message = document.createElement("p");
        message.className = "empty-message";
        message.textContent = error.message;
        studentList.replaceChildren(message);
    }
}

async function loadStudentDetails(nie) {
    selectedNie = nie;
    IncasPortal.showView("alumno-detalle");
    try {
        const profile = await IncasPortal.api(`/api/encargado/alumnos/${encodeURIComponent(nie)}`);
        const values = {
            nombre: profile.nombre,
            apellido: profile.apellido,
            seccion: profile.nombre_seccion || "Pendiente de asignación",
            correo: profile.correo,
            fecha_nac: profile.fecha_nac.slice(0, 10)
        };
        selectedStudentFields.forEach((field) => {
            field.textContent = values[field.dataset.studentField] || "—";
        });
        await loadGuardianPeriods();
    } catch (error) {
        selectedStudentFields.forEach((field) => { field.textContent = error.message; });
    }
}

async function loadGuardianPeriods() {
    guardianPeriodSelect.disabled = true;
    try {
        const periods = await IncasPortal.api(
            `/api/encargado/alumnos/${encodeURIComponent(selectedNie)}/periodos`
        );
        guardianPeriodSelect.replaceChildren(new Option(
            periods.length ? "Seleccione un período" : "No hay notas publicadas",
            ""
        ));
        periods.forEach((period) =>
            guardianPeriodSelect.add(new Option(period.nombre_periodo, period.id_periodo))
        );
        guardianPeriodSelect.disabled = periods.length === 0;
        if (periods.length) {
            guardianPeriodSelect.value = String(periods[0].id_periodo);
            await loadGuardianGrades();
        } else {
            showGuardianGradeMessage("No hay calificaciones publicadas para este alumno.");
        }
    } catch (error) {
        showGuardianGradeMessage(error.message);
    }
}

async function loadGuardianGrades() {
    if (!selectedNie || !guardianPeriodSelect.value) {
        showGuardianGradeMessage("Selecciona un período para consultar las notas.");
        return;
    }
    try {
        const grades = await IncasPortal.api(
            `/api/encargado/alumnos/${encodeURIComponent(selectedNie)}/notas/${guardianPeriodSelect.value}`
        );
        if (!grades.length) {
            showGuardianGradeMessage("No hay calificaciones para este período.");
            return;
        }
        guardianGradesBody.replaceChildren(...grades.map((grade) => {
            const row = document.createElement("tr");
            const subject = document.createElement("td");
            const score = document.createElement("td");
            subject.textContent = grade.nombre_materia;
            score.textContent = Number(grade.calificacion).toFixed(2);
            row.append(subject, score);
            return row;
        }));
    } catch (error) {
        showGuardianGradeMessage(error.message);
    }
}

guardianPeriodSelect.addEventListener("change", loadGuardianGrades);
loadGuardianProfile();
loadGuardianStudents();
