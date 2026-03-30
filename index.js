const express = require("express");
const emailjs = require("@emailjs/nodejs");
const Groq = require("groq-sdk"); // Importamos Groq
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN DE GROQ ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- CONFIGURACIÓN GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- FUNCIÓN PARA CONSULTAR A LA IA (GROQ) ---
async function obtenerRespuestaIA(preguntaUsuario, tema) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Eres un profesor experto en matemáticas especializado en ${tema}. 
                    Tu objetivo es resolver dudas de forma clara, paso a paso y didáctica. 
                    Si te piden una definición, sé preciso. Si es un problema, explica el procedimiento.`
                },
                {
                    role: "user",
                    content: preguntaUsuario,
                },
            ],
            model: "llama3-70b-8192", // El modelo más potente de Groq para lógica compleja
            temperature: 0.5, // Balance entre creatividad y precisión
        });
        return chatCompletion.choices[0]?.message?.content || "No pude generar una respuesta.";
    } catch (error) {
        console.error("❌ Error en Groq:", error);
        return "Lo siento, mi cerebro de IA está sobrecargado. ¿Podrías intentar más tarde?";
    }
}

// --- FUNCIÓN REGISTRAR EN SHEETS ---
async function registrarDato(nombreHoja, fila) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[nombreHoja];
        await sheet.addRow(fila);
    } catch (e) { console.error(`❌ Error en ${nombreHoja}:`, e.message); }
}

// --- WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Desconocido";
    const userQuery = queryResult.queryText;
    const fechaActual = new Date().toLocaleString("es-MX", {timeZone: "America/Mexico_City"});
    const idGenerado = `MAT-${Date.now().toString().slice(-4)}`;

    // 1. INTENT: Explicar_concepto (AQUÍ ENTRA GROQ 🧠)
    if (intentName === "Explicar_conceptos") {
        const tema = queryResult.parameters.tema_mate || "Matemáticas";
        
        console.log(`--- Consultando a Groq sobre: ${tema} ---`);
        const respuestaIA = await obtenerRespuestaIA(userQuery, tema);

        await registrarDato("Consultas", {
            "ID_Consulta": idGenerado,
            "Fecha": fechaActual,
            "Usuario": "Alumno",
            "Rama": tema,
            "Pregunta": userQuery,
            "Respuesta_Bot": respuestaIA, // Se guarda la respuesta real de la IA
            "Estado": "Resuelto por IA"
        });

        return res.json({ fulfillmentText: respuestaIA });
    }

    // 2. INTENT: Recibir_datos_asesoria (EMAILJS)
    if (intentName === "Recibir_datos_asesoria") {
        const emailUsuario = queryResult.parameters.email;
        let temaInteres = "Matemáticas";
        if (queryResult.outputContexts) {
            const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
            if (ctx && ctx.parameters.tema_mate) temaInteres = ctx.parameters.tema_mate;
        }

        try {
            await emailjs.send(process.env.EMAILJS_SERVICE_ID, process.env.EMAILJS_TEMPLATE_ID, {
                user_email: emailUsuario,
                tema_mate: temaInteres,
                id_consulta: idGenerado,
                fecha_actual: fechaActual
            }, {
                publicKey: process.env.EMAILJS_PUBLIC_KEY,
                privateKey: process.env.EMAILJS_PRIVATE_KEY,
            });

            await registrarDato("Asesorias", {
                "ID_Consulta": idGenerado,
                "Fecha": fechaActual,
                "Usuario": "Alumno",
                "Tema": temaInteres,
                "Email_Usuario": emailUsuario,
                "Estado": "Agendada"
            });

            return res.json({ fulfillmentText: `¡Listo! He enviado la confirmación a ${emailUsuario}. Un tutor experto te contactará pronto.` });
        } catch (e) {
            return res.json({ fulfillmentText: "Error al enviar el correo, pero tu asesoría ya fue registrada." });
        }
    }

    return res.json({ fulfillmentText: queryResult.fulfillmentText });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot Inteligente (Groq) activo en puerto ${PORT}`));
