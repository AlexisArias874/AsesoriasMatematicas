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

// --- FUNCIÓN REGISTRAR EN SHEETS ---
async function registrarEnSheets(datos) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({
            "ID_Consulta": `MAT-${Date.now().toString().slice(-4)}`,
            "Fecha": new Date().toLocaleString("es-MX", {timeZone: "America/Mexico_City"}),
            "Usuario": "Alumno",
            "Rama": datos.rama || "General",
            "Pregunta": datos.pregunta || "Consulta",
            "Respuesta_Bot": datos.respuesta || "Respuesta enviada",
            "Estado": datos.estado || "Completado",
            "Es_Asesoria": datos.es_asesoria || "No",
            "Email_Usuario": datos.email || "N/A"
        });
        console.log("✅ Fila agregada a Sheets");
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Desconocido";
    const userQuery = queryResult.queryText;

    // IMPORTANTE: Atrapamos la respuesta que TÚ escribiste en Dialogflow
    const respuestaDialogflow = queryResult.fulfillmentText || "No hay respuesta configurada.";

    console.log(`--- Procesando Intent: ${intentName} ---`);

    // 1. INTENT: Explicar_concepto (Sin Newton para evitar errores de texto)
    if (intentName === "Explicar_concepto") {
        const tema = queryResult.parameters.tema_mate || "Matemáticas";
        
        // Guardamos en Sheets lo que el bot respondió realmente
        await registrarEnSheets({ 
            rama: tema, 
            pregunta: userQuery, 
            respuesta: respuestaDialogflow, 
            estado: "Resuelto",
            es_asesoria: "No"
        });

        return res.json({ fulfillmentText: respuestaDialogflow });
    }

    // 2. INTENT: Recibir_datos_asesoria (EmailJS + Sheets)
    if (intentName === "Recibir_datos_asesoria") {
        const emailUsuario = queryResult.parameters.email;
        let temaInteres = "Matemáticas";
        
        if (queryResult.outputContexts) {
            const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
            if (ctx && ctx.parameters.tema_mate) temaInteres = ctx.parameters.tema_mate;
        }

        try {
            // Enviar Correo con EmailJS
            await emailjs.send(
                process.env.EMAILJS_SERVICE_ID,
                process.env.EMAILJS_TEMPLATE_ID,
                {
                    user_email: emailUsuario,
                    tema_mate: temaInteres,
                    id_consulta: Date.now().toString().slice(-4),
                    fecha_actual: new Date().toLocaleString("es-MX")
                },
                {
                    publicKey: process.env.EMAILJS_PUBLIC_KEY,
                    privateKey: process.env.EMAILJS_PRIVATE_KEY,
                }
            );

            await registrarEnSheets({ 
                rama: temaInteres, 
                pregunta: "Solicitó Asesoría", 
                respuesta: "Correo enviado via EmailJS", 
                estado: "Agendada",
                es_asesoria: "SÍ",
                email: emailUsuario
            });

            return res.json({ fulfillmentText: respuestaDialogflow });

        } catch (error) {
            console.error("❌ Error EmailJS:", error);
            return res.json({ fulfillmentText: "Recibí tu correo, pero falló el envío de confirmación." });
        }
    }

    // Para cualquier otro intent (Bienvenida, etc.)
    return res.json({ fulfillmentText: respuestaDialogflow });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot listo en puerto ${PORT}`));
