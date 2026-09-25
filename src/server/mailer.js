import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter = null;

function getTransporter() {
  if (!config.smtp.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

/**
 * Envoie un email d'alerte listant les nouvelles offres détectées pour une
 * recherche sauvegardée. Ne fait rien (silencieusement) si le SMTP n'est pas
 * configuré : l'alerting push reste possible sans email.
 */
export async function sendAlertEmail({ to, query, jobs }) {
  const t = getTransporter();
  if (!t || !to || !jobs.length) return false;

  const rows = jobs
    .slice(0, 15)
    .map(
      (j) =>
        `<li><a href="${j.url}">${j.title}</a>${j.company ? ` — <strong>${j.company}</strong>` : ""}${
          j.location ? ` (${j.location})` : ""
        }</li>`
    )
    .join("");

  const html = `
    <p>Bonjour,</p>
    <p><strong>${jobs.length}</strong> nouvelle(s) offre(s) pour votre alerte « ${query} » sur Sophia Jobs :</p>
    <ul>${rows}</ul>
    <p style="color:#6b7280;font-size:12px;">Sophia Jobs Crawler — vous recevez cet email car vous avez créé une alerte pour cette recherche.</p>
  `;

  try {
    await t.sendMail({
      from: config.smtp.from,
      to,
      subject: `Sophia Jobs — ${jobs.length} nouvelle(s) offre(s) pour « ${query} »`,
      html,
    });
    return true;
  } catch (err) {
    console.error("[mailer] échec envoi email :", err.message);
    return false;
  }
}
