const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN DE APIS (GMAIL Y GOOGLE SHEETS) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS // Tu contraseña de aplicación de 16 letras
    }
});

const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- FUNCIÓN PARA GUARDAR EN GOOGLE SHEETS ---
async function registrarEnSheets(datos) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({
            "ID_Consulta": `MAT-${Date.now().toString().slice(-4)}`,
            "Fecha": new Date().toLocaleString("es-MX"),
            "Usuario": "Alumno",
            "Rama": datos.tema || "General",
            "Pregunta": datos.pregunta || "Solicitud de Asesoría",
            "Respuesta_Bot": datos.respuesta || "Correo Enviado",
            "Estado": datos.estado || "Completado"
        });
    } catch (e) { console.error("❌ Error Sheets:", e.message); }
}

// --- WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent.displayName;
    const userQuery = queryResult.queryText;

    // 1. INTENT: Explicar_concepto (Usa API de Newton + Sheets)
    if (intentName === "Explicar_concepto") {
        try {
            const resAPI = await axios.get(`https://newton.now.sh/api/v2/simplify/${encodeURIComponent(userQuery)}`);
            const resultado = resAPI.data.result;
            const respuesta = `El resultado de tu duda es: ${resultado}. ¿Te gustaría agendar una asesoría personalizada para este tema?`;
            
            await registrarEnSheets({ tema: queryResult.parameters.tema_mate, pregunta: userQuery, respuesta: respuesta, estado: "Duda Resuelta" });
            return res.json({ fulfillmentText: respuesta });
        } catch (e) {
            return res.json({ fulfillmentText: "Entiendo tu duda, pero mi sistema de cálculo está en mantenimiento. ¿Te ayudo con algo más?" });
        }
    }

    // 2. INTENT: Recibir_datos_asesoria (Usa API de Gmail + Sheets)
    if (intentName === "Recibir_datos_asesoria") {
        const emailUsuario = queryResult.parameters.email;
        let temaInteres = "Matemáticas";

        // Intentamos sacar el tema del contexto anterior
        if (queryResult.outputContexts) {
            const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
            if (ctx && ctx.parameters.tema_mate) temaInteres = ctx.parameters.tema_mate;
        }

        // Enviar Gmail
        const mailOptions = {
            from: process.env.GMAIL_USER,
            to: emailUsuario,
            subject: `Confirmación de Asesoría: ${temaInteres}`,
            html: `<h2>¡Hola Alumno!</h2><p>Has solicitado una asesoría de <b>${temaInteres}</b>. Pronto un tutor te contactará.</p>`
        };

        try {
            await transporter.sendMail(mailOptions);
            await registrarEnSheets({ tema: temaInteres, pregunta: `Email: ${emailUsuario}`, respuesta: "Correo de asesoría enviado", estado: "Asesoría Agendada" });
            return res.json({ fulfillmentText: `¡Listo! He enviado los detalles a ${emailUsuario}. Revisa tu bandeja de entrada.` });
        } catch (e) {
            return res.json({ fulfillmentText: "Anoté tu correo, pero tuve un error al enviar el Gmail. No te preocupes, un tutor te contactará." });
        }
    }

    // 3. OTROS INTENTS (Bienvenida, Despedida, etc.)
    return res.json({ fulfillmentText: queryResult.fulfillmentText || "Sigo aquí para ayudarte." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot Maestro activo en puerto ${PORT}`));
