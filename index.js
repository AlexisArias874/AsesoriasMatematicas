const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN DE GMAIL (SMTP) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS // Tu clave de aplicación de 16 letras
    }
});

// --- CONFIGURACIÓN DE GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- FUNCIÓN PARA GUARDAR EN GOOGLE SHEETS (Columnas actualizadas) ---
async function registrarEnSheets(datos) {
    console.log("--- 📊 Iniciando guardado en Google Sheets ---");
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        
        const nuevaFila = {
            "ID_Consulta": `MAT-${Date.now().toString().slice(-4)}`,
            "Fecha": new Date().toLocaleString("es-MX", {timeZone: "America/Mexico_City"}),
            "Usuario": "Alumno",
            "Rama": datos.rama || "General",
            "Pregunta": datos.pregunta || "Sin pregunta",
            "Respuesta_Bot": datos.respuesta || "Sin respuesta",
            "Estado": datos.estado || "Completado",
            "Es_Asesoria": datos.es_asesoria || "No", // Nueva sección
            "Email_Usuario": datos.email || "No proporcionado" // Nueva sección
        };

        await sheet.addRow(nuevaFila);
        console.log("✅ Fila agregada con éxito a Sheets:", nuevaFila.ID_Consulta);
    } catch (e) { 
        console.error("❌ ERROR CRÍTICO EN SHEETS:", e.message); 
        throw e; // Lanza el error para que el webhook lo detecte
    }
}

// --- WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Desconocido";
    const userQuery = queryResult.queryText;

    console.log(`\n--- 🚀 NUEVA PETICIÓN: Intent [${intentName}] ---`);
    console.log(`💬 Usuario dice: "${userQuery}"`);

    // 1. INTENT: Explicar_concepto (API Newton + Sheets)
    if (intentName === "Explicar_concepto") {
        const ramaDeteccion = queryResult.parameters.tema_mate || "Matemáticas";
        
        try {
            console.log("--- 🧮 Llamando a API Newton...");
            const resAPI = await axios.get(`https://newton.now.sh/api/v2/simplify/${encodeURIComponent(userQuery)}`, { timeout: 4000 });
            const resultado = resAPI.data.result;
            const respuesta = `El resultado de tu duda es: ${resultado}. ¿Deseas agendar una asesoría personalizada?`;

            await registrarEnSheets({ 
                rama: ramaDeteccion, 
                pregunta: userQuery, 
                respuesta: respuesta, 
                estado: "Resuelto", 
                es_asesoria: "No" 
            });

            return res.json({ fulfillmentText: respuesta });
        } catch (e) {
            console.error("❌ ERROR EN EXPLICAR_CONCEPTO:", e.message);
            return res.json({ fulfillmentText: "Entiendo tu duda, pero mi sistema de cálculo tardó en responder. ¿Te gustaría agendar una asesoría directamente?" });
        }
    }

    // 2. INTENT: Recibir_datos_asesoria (Gmail + Sheets)
    if (intentName === "Recibir_datos_asesoria") {
        const emailUsuario = queryResult.parameters.email;
        console.log(`--- 📩 Procesando asesoría para: ${emailUsuario}`);

        let temaInteres = "Matemáticas";
        if (queryResult.outputContexts) {
            const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
            if (ctx && ctx.parameters.tema_mate) temaInteres = ctx.parameters.tema_mate;
        }

        try {
            // A. Enviar Correo
            console.log("--- 📧 Enviando Gmail...");
            await transporter.sendMail({
                from: `"Tutoría de Matemáticas" <${process.env.GMAIL_USER}>`,
                to: emailUsuario,
                subject: `Confirmación de Asesoría: ${temaInteres}`,
                html: `<h2>¡Hola! 📚</h2><p>Hemos recibido tu solicitud de asesoría en <b>${temaInteres}</b>. Un tutor te contactará pronto.</p>`
            });
            console.log("✅ Gmail enviado con éxito.");

            // B. Guardar en Sheets
            await registrarEnSheets({ 
                rama: temaInteres, 
                pregunta: "Solicitó Asesoría", 
                respuesta: "Correo enviado", 
                estado: "Pendiente Contactar",
                es_asesoria: "SÍ",
                email: emailUsuario
            });

            return res.json({ fulfillmentText: `¡Excelente! He enviado la confirmación a ${emailUsuario}. ¡Revisa tu bandeja de entrada!` });

        } catch (e) {
            console.error("❌ ERROR EN RECIBIR_DATOS_ASESORIA:", e.message);
            return res.json({ fulfillmentText: "Recibí tu correo, pero tuve un problema técnico al enviar el Gmail. No te preocupes, ya agendamos tu solicitud." });
        }
    }

    // Respuesta por defecto para otros intents
    console.log("--- ⏩ Intent sin lógica de Webhook, usando respuesta de Dialogflow.");
    return res.json({ fulfillmentText: queryResult.fulfillmentText });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor monitoreado activo en puerto ${PORT}`));
