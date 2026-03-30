const express = require("express");
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
            "Rama": d.tema_mate, 
            "Pregunta": d.pregunta, 
            "Respuesta_Bot": d.respuesta_bot, // Aquí guardaremos lo que diga Dialogflow
            "Estado": "Resuelta"
        });
        console.log("✅ Guardado en Sheets:", d.ID_Consulta);
    } catch (e) { 
        console.error("❌ Error Sheets:", e.message); 
    }
}

// --- 3. WEBHOOK PARA DIALOGFLOW (RAPIDEZ MÁXIMA) ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    
    // Extraemos los datos básicos de Dialogflow
    const intentName = queryResult.intent ? queryResult.intent.displayName : "Desconocido";
    const userQuery = queryResult.queryText;
    
    // ¡AQUÍ ESTÁ LA MAGIA! 
    // Atrapamos la respuesta que tú escribiste manualmente en la sección "Responses" de Dialogflow
    const respuestaDeDialogflow = queryResult.fulfillmentText || "No tengo una respuesta configurada para esto.";

    // Función para atrapar el parámetro (Álgebra, Aritmética, Geometría)
    const getDato = (nombre) => {
        let v = queryResult.parameters[nombre];
        if (v && typeof v === 'object' && v.name) v = v.name; 
        return v || null;
    };

    try {
        const usuario = "Alumno"; 
        const temaMate = getDato("tema_mate") || "General"; 

        // 🟢 SOLAMENTE guardamos en Excel si es el Intent "Explicar_concepto"
        if (intentName === "Explicar_concepto") {
            const idConsulta = generarID();

            // Guardamos en Google Sheets usando la respuesta nativa de Dialogflow
            await registrarEnSheets({ 
                ID_Consulta: idConsulta, 
                usuario: usuario, 
                tema_mate: temaMate, 
                pregunta: userQuery, 
                respuesta_bot: respuestaDeDialogflow // Mandamos el texto de Dialogflow al Excel
            });
        }

        // Finalmente, le decimos a Dialogflow que muestre la respuesta que él mismo generó
        return res.json({
            fulfillmentText: respuestaDeDialogflow
        });

    } catch (err) {
        console.error("Error en webhook:", err);
        return res.json({ fulfillmentText: "Hubo un pequeño error al guardar tus datos, pero sigo aquí para ayudarte." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Tutor matemático (Ultra Rápido) corriendo en puerto: ${PORT}`));
