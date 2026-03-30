const express = require("express");
const axios = require("axios");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- 1. GENERADOR DE ID DE CONSULTA ---
const generarID = () => {
    const parte1 = Date.now().toString().slice(-5);
    const parte2 = Math.floor(1000 + Math.random() * 9000);
    return `MAT-${parte1}-${parte2}`; 
};

// --- 2. CONFIGURACIÓN GOOGLE SHEETS ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function registrarEnSheets(d) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0]; 
        await sheet.addRow({
            "ID_Consulta": d.ID_Consulta, 
            "Fecha": new Date().toLocaleString("es-MX", {timeZone: "America/Mexico_City"}), 
            "Usuario": d.usuario,
            "Rama": d.tema_mate, // <-- Aquí guardamos el parámetro de Dialogflow en la columna Rama
            "Pregunta": d.pregunta, 
            "Respuesta_Bot": d.respuesta_bot,
            "Estado": "Resuelta"
        });
        console.log("✅ Guardado en Sheets:", d.ID_Consulta);
    } catch (e) { 
        console.error("❌ Error Sheets:", e.message); 
    }
}

// --- 3. LÓGICA DE IA (PROFESOR DE MATEMÁTICAS) ---
async function generarRespuestaIA(query, modo, info = {}) {
    let systemPrompt = "";
    
    if (modo === "explicacion") {
        systemPrompt = `Eres un profesor de matemáticas experto. El alumno tiene una duda sobre: ${info.tema}. Resuelve la duda: "${query}". Usa un lenguaje claro, didáctico y paso a paso. No uses Markdown complejo.`;
    } else if (modo === "mas_facil") {
        systemPrompt = `Eres un profesor de matemáticas muy paciente. El alumno no entendió la explicación anterior sobre "${query}". Explícalo como si fuera para un niño de 10 años, usa analogías de la vida real.`;
    } else if (modo === "ejemplo") {
        systemPrompt = `Eres un profesor de matemáticas. El alumno pidió un ejemplo sobre "${query}". Dame un problema práctico de la vida real, resuélvelo paso a paso y pregúntale si lo entendió.`;
    } else if (modo === "despedida") {
        systemPrompt = `Eres un profesor de matemáticas. Despídete del alumno, anímalo a seguir estudiando y usa algún emoji.`;
    } else {
        systemPrompt = "Eres un tutor de matemáticas amable. Responde brevemente.";
    }

    try {
        const resp = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}`, {
            params: { system: systemPrompt, model: "openai", seed: Math.floor(Math.random() * 1000) },
            timeout: 20000 
        });
        return resp.data;
    } catch (e) { 
        console.error("⚠️ Timeout IA");
        return `Mi cerebro matemático está calculando lento 🧠. ¿Podrías repetirme tu duda?`; 
    }
}

// --- 4. WEBHOOK PARA DIALOGFLOW ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default Fallback Intent";
    const userQuery = queryResult.queryText;

    // Función para atrapar el parámetro "tema_mate" de tu Dialogflow
    const getDato = (nombre) => {
        let v = queryResult.parameters[nombre];
        if (v && typeof v === 'object' && v.name) v = v.name; 
        return v || null;
    };

    try {
        const usuario = "Alumno"; // Por ahora lo dejamos genérico
        const temaMate = getDato("tema_mate") || "Matemáticas"; // <-- Atrapa "álgebra", "fracciones", etc.

        // 🟢 INTENT: Bienvenida
        if (intentName === "Bienvenida") {
            return res.json({ fulfillmentText: "¡Hola! Soy tu tutor virtual de matemáticas 🧮. Puedo ayudarte con álgebra, aritmética o geometría. ¿Qué tema te está costando trabajo hoy?" });
        }

        // 🟢 INTENT: Explicar_concepto (¡EL MÁS IMPORTANTE!)
        if (intentName === "Explicar_concepto") {
            const idConsulta = generarID();

            // 1. La IA genera la explicación
            const explicacion = await generarRespuestaIA(userQuery, "explicacion", { tema: temaMate });

            // 2. Guardamos en Google Sheets
            await registrarEnSheets({ 
                ID_Consulta: idConsulta, 
                usuario: usuario, 
                tema_mate: temaMate, // Se guarda como "Álgebra", "Aritmética", etc.
                pregunta: userQuery, 
                respuesta_bot: explicacion 
            });

            // 3. Respondemos al usuario
            return res.json({
                fulfillmentText: `${explicacion}\n\n¿Te quedó claro o quieres que te dé un ejemplo?`
            });
        }

        // 🟢 INTENT: No_entiendo
        if (intentName === "No_entiendo") {
            const explicacionFacil = await generarRespuestaIA(userQuery, "mas_facil", {});
            return res.json({ fulfillmentText: `No te preocupes, vamos a verlo de otra forma:\n\n${explicacionFacil}` });
        }

        // 🟢 INTENT: Aceptar_ejemplo
        if (intentName === "Aceptar_ejemplo") {
            const ejemplo = await generarRespuestaIA(userQuery, "ejemplo", {});
            return res.json({ fulfillmentText: `¡Claro! Aquí tienes un ejemplo práctico:\n\n${ejemplo}` });
        }

        // 🟢 INTENT: Despedida
        if (intentName === "Despedida") {
            const despedida = await generarRespuestaIA(userQuery, "despedida", {});
            return res.json({ fulfillmentText: despedida });
        }

        // 🟡 FALLBACK (Si no entiende)
        const respuestaBase = await generarRespuestaIA(userQuery, "general", {});
        return res.json({ fulfillmentText: respuestaBase });

    } catch (err) {
        console.error(err);
        return res.json({ fulfillmentText: "Hubo un error en mis circuitos. ¿Podrías decírmelo de nuevo?" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Tutor matemático corriendo en puerto: ${PORT}`));