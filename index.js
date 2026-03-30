const express = require("express");
const emailjs = require("@emailjs/nodejs");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- FUNCIÓN ÚNICA PARA REGISTRAR EN CUALQUIER HOJA ---
async function registrarDato(nombreHoja, fila) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[nombreHoja]; // Busca la hoja por su nombre (Consultas o Asesorias)
        await sheet.addRow(fila);
        console.log(`✅ Registro guardado en la hoja: ${nombreHoja}`);
    } catch (e) {
        console.error(`❌ Error al guardar en ${nombreHoja}:`, e.message);
    }
}

// --- WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Desconocido";
    const userQuery = queryResult.queryText;
    const respuestaDialogflow = queryResult.fulfillmentText || "Sin respuesta.";

    const fechaActual = new Date().toLocaleString("es-MX", {timeZone: "America/Mexico_City"});
    const idGenerado = `MAT-${Date.now().toString().slice(-4)}`;

    // 1. INTENT: Explicar_concepto -> VA A LA HOJA "Consultas"
    if (intentName === "Explicar_concepto") {
        const tema = queryResult.parameters.tema_mate || "Matemáticas";
        
        await registrarDato("Consultas", {
            "ID_Consulta": idGenerado,
            "Fecha": fechaActual,
            "Usuario": "Alumno",
            "Rama": tema,
            "Pregunta": userQuery,
            "Respuesta_Bot": respuestaDialogflow,
            "Estado": "Resuelto"
        });

        return res.json({ fulfillmentText: respuestaDialogflow });
    }

    // 2. INTENT: Recibir_datos_asesoria -> VA A LA HOJA "Asesorias"
    if (intentName === "Recibir_datos_asesoria") {
        const emailUsuario = queryResult.parameters.email;
        let temaInteres = "Matemáticas";
        
        if (queryResult.outputContexts) {
            const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
            if (ctx && ctx.parameters.tema_mate) temaInteres = ctx.parameters.tema_mate;
        }

        try {
            // Envío de EmailJS
            await emailjs.send(
                process.env.EMAILJS_SERVICE_ID,
                process.env.EMAILJS_TEMPLATE_ID,
                {
                    user_email: emailUsuario,
                    tema_mate: temaInteres,
                    id_consulta: idGenerado,
                    fecha_actual: fechaActual
                },
                {
                    publicKey: process.env.EMAILJS_PUBLIC_KEY,
                    privateKey: process.env.EMAILJS_PRIVATE_KEY,
                }
            );

            // REGISTRO EN LA HOJA DE ASESORÍAS
            await registrarDato("Asesorias", {
                "ID_Consulta": idGenerado,
                "Fecha": fechaActual,
                "Usuario": "Alumno",
                "Tema": temaInteres,
                "Email_Usuario": emailUsuario,
                "Estado": "Agendada"
            });

            return res.json({ fulfillmentText: respuestaDialogflow });

        } catch (error) {
            console.error("❌ Error EmailJS:", error);
            return res.json({ fulfillmentText: "Recibí tu correo, pero falló el envío de confirmación." });
        }
    }

    return res.json({ fulfillmentText: respuestaDialogflow });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot Multi-Hoja activo en puerto ${PORT}`));
