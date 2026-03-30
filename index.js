const express = require("express");
const axios = require("axios");
const emailjs = require("@emailjs/nodejs"); // Nueva librería moderna
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN DE GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- FUNCIÓN PARA GUARDAR EN SHEETS ---
async function registrarEnSheets(datos) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({
            "ID_Consulta": `MAT-${Date.now().toString().slice(-4)}`,
            "Fecha": new Date().toLocaleString("es-MX", {timeZone: "America/Mexico_City"}),
            "Usuario": "Alumno",
            "Rama": datos.rama || "General",
            "Pregunta": datos.pregunta || "Asesoría",
            "Respuesta_Bot": datos.respuesta || "Correo Enviado",
            "Estado": datos.estado || "Completado",
            "Es_Asesoria": datos.es_asesoria || "No",
            "Email_Usuario": datos.email || "N/A"
        });
        console.log("✅ Sheets actualizado.");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Desconocido";
    const userQuery = queryResult.queryText;

    console.log(`--- Intent detectado: ${intentName} ---`);

    // 1. Lógica de cálculo matemático (API Newton)
    if (intentName === "Explicar_concepto") {
        try {
            const resAPI = await axios.get(`https://newton.now.sh/api/v2/simplify/${encodeURIComponent(userQuery)}`);
            const resultado = resAPI.data.result;
            const respuesta = `El resultado es: ${resultado}. ¿Agendamos una asesoría?`;
            await registrarEnSheets({ rama: queryResult.parameters.tema_mate, pregunta: userQuery, respuesta: respuesta });
            return res.json({ fulfillmentText: respuesta });
        } catch (e) {
            return res.json({ fulfillmentText: "Lo siento, tuve un error al calcular." });
        }
    }

    // 2. Lógica de Asesoría (API EMAILJS)
    if (intentName === "Recibir_datos_asesoria") {
        const emailUsuario = queryResult.parameters.email;
        let temaInteres = "Matemáticas";
        if (queryResult.outputContexts) {
            const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
            if (ctx && ctx.parameters.tema_mate) temaInteres = ctx.parameters.tema_mate;
        }

        // PARÁMETROS PARA TU PLANTILLA DE EMAILJS
        const templateParams = {
            user_email: emailUsuario, // Debe coincidir con {{user_email}} en tu plantilla
            tema_mate: temaInteres    // Debe coincidir con {{tema_mate}} en tu plantilla
        };

        try {
            console.log("--- 📧 Enviando correo via EmailJS...");
            await emailjs.send(
                process.env.EMAILJS_SERVICE_ID,
                process.env.EMAILJS_TEMPLATE_ID,
                templateParams,
                {
                    publicKey: process.env.EMAILJS_PUBLIC_KEY,
                    privateKey: process.env.EMAILJS_PRIVATE_KEY,
                }
            );
            console.log("✅ Email enviado.");

            await registrarEnSheets({ 
                rama: temaInteres, 
                pregunta: "Solicitud Asesoría", 
                respuesta: "EmailJS enviado", 
                estado: "Agendada",
                es_asesoria: "SÍ",
                email: emailUsuario
            });

            return res.json({ fulfillmentText: `¡Listo! He enviado la información a ${emailUsuario} usando EmailJS.` });

        } catch (error) {
            console.error("❌ Error EmailJS:", error);
            return res.json({ fulfillmentText: "Anoté tu correo, pero falló el envío de la confirmación." });
        }
    }

    return res.json({ fulfillmentText: queryResult.fulfillmentText });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot con EmailJS activo en puerto ${PORT}`));
