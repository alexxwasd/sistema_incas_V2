// Carga datos y calificaciones del panel_alumno.html según la sesión activa.
const studentFields = document.querySelectorAll("[data-student-field]");
const periodSelect = document.querySelector("#period-select");
const gradesBody = document.querySelector("#grades-body");

function setStudentTableMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.className = "empty-cell";
    cell.textContent = message;
    row.append(cell);
    gradesBody.replaceChildren(row);
}

async function loadStudentProfile() {
    try {
        const profile = await IncasPortal.api("/api/alumno/perfil");
        const values = {
            nombre: profile.nombre,
            apellido: profile.apellido,
            seccion: profile.nombre_seccion || "Pendiente de asignación",
            correo: profile.correo,
            fecha_nac: profile.fecha_nac.slice(0, 10)
        };
        studentFields.forEach((field) => {
            field.textContent = values[field.dataset.studentField] || "—";
        });
    } catch (error) {
        studentFields.forEach((field) => { field.textContent = error.message; });
    }
}

async function loadStudentPeriods() {
    try {
        const periods = await IncasPortal.api("/api/alumno/periodos");
        periodSelect.replaceChildren(new Option(
            periods.length ? "Seleccione un período" : "No hay notas de períodos finalizados",
            ""
        ));
        periods.forEach((period) =>
            periodSelect.add(new Option(period.nombre_periodo, period.id_periodo))
        );
        periodSelect.disabled = periods.length === 0;
        if (periods.length) {
            periodSelect.value = String(periods[0].id_periodo);
            await loadStudentGrades();
        } else {
            setStudentTableMessage("Todavía no hay notas publicadas de períodos finalizados.");
        }
    } catch (error) {
        periodSelect.disabled = true;
        setStudentTableMessage(error.message);
    }
}

async function loadStudentGrades() {
    if (!periodSelect.value) {
        setStudentTableMessage("Selecciona un período para consultar las notas.");
        return;
    }
    try {
        const grades = await IncasPortal.api(`/api/alumno/notas/${periodSelect.value}`);
        if (!grades.length) {
            setStudentTableMessage("No hay calificaciones para este período.");
            return;
        }
        gradesBody.replaceChildren(...grades.map((grade) => {
            const row = document.createElement("tr");
            const subject = document.createElement("td");
            const score = document.createElement("td");
            subject.textContent = grade.nombre_materia;
            score.textContent = Number(grade.calificacion).toFixed(2);
            row.append(subject, score);
            return row;
        }));
    } catch (error) {
        setStudentTableMessage(error.message);
    }
}

periodSelect.addEventListener("change", loadStudentGrades);
loadStudentProfile();
loadStudentPeriods();
