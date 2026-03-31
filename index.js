const express = require("express");
const axios = require("axios");
const emailjs = require("@emailjs/nodejs");
const Groq = require("groq-sdk");
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- 1. CONFIGURACIÓN DE APIS ---

// IA: Groq Cloud
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// BASE DE DATOS: Google Sheets (Service Account)
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- 2. FUNCIONES AUXILIARES ---

// Función para consultar a la IA (Groq Llama 3 70B)
async function obtenerRespuestaIA(preguntaUsuario, tema) {
    console.log(`--- 🧠 Consultando a Groq (Modelo 70B) sobre ${tema} ---`);
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Eres un profesor experto en matemáticas especializado en ${tema}. 
                    Tu tono es amable, profesional y didáctico. 
                    Explica los conceptos paso a paso. Si es un problema numérico, muestra el procedimiento.
                    Si el usuario pregunta algo que no es de matemáticas, dile amablemente que tu especialidad son los números.`
                },
                { role: "user", content: preguntaUsuario }
            ],
            model: "llama-3.1-8b-instant", // El modelo actual y más potente
            temperature: 0.6,
            max_tokens: 1024
        });
        return chatCompletion.choices[0]?.message?.content || "No pude generar una explicación.";
    } catch (error) {
        console.error("❌ ERROR EN GROQ:", error.message);
        return "Lo siento, mi cerebro de IA está saturado en este momento. ¿Te gustaría agendar una asesoría?";
    }
}

// Función para guardar en Google Sheets (Diferenciando por Hoja)
async function registrarDato(nombreHoja, fila) {
    console.log(`--- 📊 Intentando guardar en la hoja: ${nombreHoja} ---`);
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[nombreHoja];
        if (!sheet) throw new Error(`No se encontró la hoja con el título: ${nombreHoja}`);
        await sheet.addRow(fila);
        console.log(`✅ Registro guardado con éxito en ${nombreHoja}`);
    } catch (e) {
        console.error(`❌ ERROR EN SHEETS (${nombreHoja}):`, e.message);
    }
}

// --- 3. WEBHOOK PRINCIPAL (PROCESAMIENTO DE INTENTS) ---

app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Default Fallback Intent";
    const userQuery = queryResult.queryText;
    const respuestaOriginal = queryResult.fulfillmentText || "";
    
    const fechaActual = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
    const idGenerado = `MAT-${Date.now().toString().slice(-4)}`;

    console.log(`\n--- 🚀 NUEVA PETICIÓN: Intent [${intentName}] ---`);

    // --- Lógica para obtener el TEMA_MATE (de parámetro o contexto) ---
    let temaMate = queryResult.parameters.tema_mate;
    if (!temaMate && queryResult.outputContexts) {
        const ctx = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
        if (ctx && ctx.parameters.tema_mate) temaMate = ctx.parameters.tema_mate;
    }
    temaMate = temaMate || "Matemáticas";

    try {
        // 🟢 CASO A: Respuesta total por IA (Tus intents de prueba o preguntas complejas)
        if (intentName === "Pregunta_IA" || intentName === "10 Prueba IA" || intentName === "Explicar_concepto") {
            
            const respuestaIA = await obtenerRespuestaIA(userQuery, temaMate);

            // Guardar en la hoja "Consultas"
            await registrarDato("Consultas", {
                "ID_Consulta": idGenerado,
                "Fecha": fechaActual,
                "Usuario": "Alumno",
                "Rama": temaMate,
                "Pregunta": userQuery,
                "Respuesta_Bot": respuestaIA,
                "Estado": "Resuelto por Groq"
            });

            return res.json({ fulfillmentText: respuestaIA });
        }

        // 🟢 CASO B: Solicitud de Asesoría (Envío de EmailJS + Registro)
        if (intentName === "Recibir_datos_asesoria") {
            const emailUsuario = queryResult.parameters.email;
            console.log(`--- 📧 Enviando confirmación de asesoría a: ${emailUsuario} ---`);

            try {
                // Llamada a API de EmailJS
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
                console.log("✅ Email enviado correctamente.");

                // Guardar en la hoja "Asesorias"
                await registrarDato("Asesorias", {
                    "ID_Consulta": idGenerado,
                    "Fecha": fechaActual,
                    "Usuario": "Alumno",
                    "Tema": temaMate,
                    "Email_Usuario": emailUsuario,
                    "Estado": "Agendada vía EmailJS"
                });

                return res.json({ 
                    fulfillmentText: `¡Listo! He recibido tu correo ${emailUsuario}. Te acabo de enviar un template profesional con los detalles de tu asesoría de ${temaMate}. ¡Revisa tu bandeja de entrada! 📩` 
                });

            } catch (errorEmail) {
                console.error("❌ ERROR EN EMAILJS:", errorEmail);
                return res.json({ fulfillmentText: `Anoté tu correo ${emailUsuario}, pero tuve un problema al enviar el mensaje de confirmación. No te preocupes, un tutor te contactará pronto.` });
            }
        }

        // 🟢 CASO C: Intents simples (Bienvenida, Solicitar_asesoria, etc.)
        // Simplemente devolvemos lo que ya está escrito en Dialogflow
        console.log("--- ⏩ Intent informativo, usando respuesta de Dialogflow.");
        return res.json({ fulfillmentText: respuestaOriginal });

    } catch (errGlobal) {
        console.error("❌ ERROR GLOBAL EN WEBHOOK:", errGlobal.message);
        return res.json({ fulfillmentText: "Hubo un error en mi sistema de procesamiento. ¿Podrías intentar de nuevo?" });
    }
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`\n==========================================`);
    console.log(`🚀 SERVIDOR MATEMÁTICO ACTIVO EN PUERTO ${PORT}`);
    console.log(`==========================================\n`);
});
