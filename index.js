const express = require("express");
const emailjs = require("@emailjs/nodejs");
const Groq = require("groq-sdk");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- 1. CONFIGURACIÓN DE CLIENTES (APIS) ---

// IA: Groq Cloud con el modelo vigente más potente
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// BASE DE DATOS: Google Sheets (Service Account)
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- 2. FUNCIONES DE LÓGICA ---

/**
 * Consulta a la IA Groq con optimización de tokens y brevedad.
 */
async function obtenerRespuestaIA(preguntaUsuario, tema) {
    console.log(`--- 🧠 Consultando a Groq (Modelo 70B Versatile) sobre ${tema} ---`);
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Eres un profesor de matemáticas experto en ${tema}. 
                    INSTRUCCIONES DE BREVEDAD: 
                    1. Responde de forma muy directa y técnica. 
                    2. Máximo 2 o 3 párrafos cortos. 
                    3. No saludes ni uses introducciones largas.
                    4. Explica el procedimiento solo si es necesario.`
                },
                { role: "user", content: preguntaUsuario }
            ],
            model: "llama-3.3-70b-versatile", // Modelo vigente de alta calidad
            temperature: 0.5, // Menor creatividad = más precisión y brevedad
            max_tokens: 350   // Límite estricto de tokens para ahorrar presupuesto
        });
        return chatCompletion.choices[0]?.message?.content || "No pude generar una explicación breve.";
    } catch (error) {
        console.error("❌ ERROR EN GROQ:", error.message);
        return "Lo siento, mi servicio de IA está saturado. ¿Te ayudo con una asesoría personalizada?";
    }
}

/**
 * Registra datos en la hoja especificada de Google Sheets.
 */
async function registrarDato(nombreHoja, fila) {
    console.log(`--- 📊 Registrando en hoja: [${nombreHoja}] ---`);
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[nombreHoja];
        if (!sheet) {
            console.error(`⚠️ No se encontró la pestaña: ${nombreHoja}`);
            return;
        }
        await sheet.addRow(fila);
        console.log(`✅ Guardado exitoso en ${nombreHoja}`);
    } catch (e) {
        console.error(`❌ ERROR EN SHEETS:`, e.message);
    }
}

// --- 3. WEBHOOK PRINCIPAL (DIALOGFLOW) ---

app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default Fallback Intent";
    const userQuery = queryResult.queryText;
    
    const fechaActual = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
    const idGenerado = `MAT-${Date.now().toString().slice(-4)}`;

    console.log(`\n--- 🚀 PROCESANDO: Intent [${intentName}] ---`);

    // --- Extracción de Tema (Parámetro o Contexto) ---
    let temaMate = queryResult.parameters.tema_mate;
    if (!temaMate && queryResult.outputContexts) {
        const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
        if (ctx && ctx.parameters.tema_mate) temaMate = ctx.parameters.tema_mate;
    }
    temaMate = temaMate || "Matemáticas";

    try {
        // 🟢 CASO 1: Explicaciones con IA (Intents de consulta)
        if (intentName === "Explicar_concepto" || intentName === "Pregunta_IA" || intentName === "10 Prueba IA") {
            
            const respuestaIA = await obtenerRespuestaIA(userQuery, temaMate);

            // Guardar solo en la hoja de "Consultas"
            await registrarDato("Consultas", {
                "ID_Consulta": idGenerado,
                "Fecha": fechaActual,
                "Usuario": "Alumno",
                "Rama": temaMate,
                "Pregunta": userQuery,
                "Respuesta_Bot": respuestaIA,
                "Estado": "Resuelto con IA"
            });

            return res.json({ fulfillmentText: respuestaIA });
        }

        // 🟢 CASO 2: Registro de Asesorías (EmailJS + Hoja Asesorias)
        if (intentName === "Recibir_datos_asesoria") {
            const emailUsuario = queryResult.parameters.email;
            
            try {
                // Envío de correo vía EmailJS
                await emailjs.send(
                    process.env.EMAILJS_SERVICE_ID,
                    process.env.EMAILJS_TEMPLATE_ID,
                    {
                        user_email: emailUsuario,
                        tema_mate: temaMate,
                        id_consulta: idGenerado,
                        fecha_actual: fechaActual
                    },
                    {
                        publicKey: process.env.EMAILJS_PUBLIC_KEY,
                        privateKey: process.env.EMAILJS_PRIVATE_KEY,
                    }
                );

                // Guardar solo en la hoja de "Asesorias"
                await registrarDato("Asesorias", {
                    "ID_Consulta": idGenerado,
                    "Fecha": fechaActual,
                    "Usuario": "Alumno",
                    "Tema": temaMate,
                    "Email_Usuario": emailUsuario,
                    "Estado": "Email Enviado"
                });

                return res.json({ 
                    fulfillmentText: `¡Excelente! He enviado la confirmación a ${emailUsuario}. Revisa tu bandeja de entrada para ver el resumen de tu asesoría de ${temaMate}.` 
                });

            } catch (errEmail) {
                console.error("❌ ERROR EMAILJS:", errEmail);
                return res.json({ fulfillmentText: "Recibí tu correo, pero falló el envío del mensaje. Un tutor te contactará manualmente." });
            }
        }

        // 🟢 CASO 3: Otros intents (Bienvenida, Solicitar_asesoria, etc.)
        return res.json({ fulfillmentText: queryResult.fulfillmentText || "Sigo aquí para ayudarte con matemáticas." });

    } catch (errGlobal) {
        console.error("❌ ERROR GLOBAL:", errGlobal.message);
        return res.json({ fulfillmentText: "Lo siento, tuve un error interno. ¿Podemos intentarlo de nuevo?" });
    }
});

// --- INICIO ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor Matemático Optimizado Activo (Puerto ${PORT})\n`);
});
