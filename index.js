const express = require("express");
const nodemailer = require("nodemailer"); // Librería para el envío de correos
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// --- 1. CONFIGURACIÓN DE GMAIL (SMTP API) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER, // Tu correo de Gmail
        pass: process.env.GMAIL_PASS  // Tu CONTRASEÑA DE APLICACIÓN de 16 letras
    }
});

// --- 2. FUNCIÓN PARA ENVIAR EL CORREO ---
async function enviarCorreoConfirmacion(destinatario, tema) {
    const mailOptions = {
        from: `"Asesorías Matemáticas" <${process.env.GMAIL_USER}>`,
        to: destinatario,
        subject: 'Confirmación de tu Asesoría Matemática 📚',
        html: `
            <h1>¡Hola! 👋</h1>
            <p>Hemos recibido tu solicitud para una asesoría personalizada.</p>
            <p><strong>Tema solicitado:</strong> ${tema}</p>
            <p>En breve, uno de nuestros tutores se pondrá en contacto contigo para agendar la fecha y hora.</p>
            <br>
            <p><i>Atentamente, El Equipo de Tutorías.</i></p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log("📧 Correo enviado a:", destinatario);
        return true;
    } catch (error) {
        console.error("❌ Error enviando correo:", error);
        return false;
    }
}

// --- 3. WEBHOOK PRINCIPAL ---
app.post("/webhook", async (req, res) => {
    const { queryResult } = req.body;
    const intentName = queryResult.intent.displayName;
    
    // Extraer parámetros
    const emailUsuario = queryResult.parameters.email;
    
    // Para obtener el tema, lo buscamos en los contextos (como tienes en tu imagen de Dialogflow)
    let temaMate = "Matemáticas General";
    if (queryResult.outputContexts) {
        const contextoTema = queryResult.outputContexts.find(c => c.name.includes("tema_en_curso"));
        if (contextoTema && contextoTema.parameters.tema_mate) {
            temaMate = contextoTema.parameters.tema_mate;
        }
    }

    // 🟢 LÓGICA PARA EL INTENT: Recibir_datos_asesoria
    if (intentName === "Recibir_datos_asesoria") {
        
        // 1. Enviar el correo de confirmación
        const correoEnviado = await enviarCorreoConfirmacion(emailUsuario, temaMate);

        // 2. Opcional: Guardar en Google Sheets (usando tu lógica anterior)
        // (Aquí llamarías a tu función registrarEnSheets pasándole el email y el tema)

        // 3. Responder a Dialogflow
        if (correoEnviado) {
            return res.json({
                fulfillmentText: `¡Excelente! He recibido tu correo ${emailUsuario}. Te acabo de enviar los detalles de tu asesoría de ${temaMate}. ¡Revisa tu bandeja de entrada! 📩`
            });
        } else {
            return res.json({
                fulfillmentText: `Recibí tu correo ${emailUsuario}, pero tuve un problema técnico al enviar el mensaje. No te preocupes, ya agendé tu asesoría de ${temaMate}.`
            });
        }
    }

    return res.json({ fulfillmentText: "Continuemos con tu asesoría." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor de correos activo en puerto ${PORT}`));
