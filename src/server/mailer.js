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

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Seules les URLs http(s) deviennent des liens (les titres/URLs viennent de sites tiers). */
const safeUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : null);

/**
 * Envoie un email d'alerte listant les nouvelles offres détectées pour une
 * recherche sauvegardée. Ne fait rien (silencieusement) si le SMTP n'est pas
 * configuré : les alertes restent visibles dans l'application (cloche) et en push.
 */
export async function sendAlertEmail({ alert, label, jobs }) {
  const t = getTransporter();
  const to = alert?.email;
  if (!t || !to || !jobs.length) return false;

  const rows = jobs
    .slice(0, 15)
    .map((j) => {
      const url = safeUrl(j.url);
      const title = escapeHtml(j.title);
      const meta = [j.company, j.location].filter(Boolean).map(escapeHtml).join(" · ");
      return `<li style="margin:0 0 10px">${url ? `<a href="${escapeHtml(url)}" style="color:#2563eb;font-weight:600">${title}</a>` : `<strong>${title}</strong>`}${
        meta ? `<br><span style="color:#64748b">${meta}</span>` : ""
      }</li>`;
    })
    .join("");
  const more = jobs.length > 15 ? `<p>… et ${jobs.length - 15} autre(s).</p>` : "";

  const base = config.publicUrl;
  const id = encodeURIComponent(alert.id);
  const appLink = base
    ? `<p><a href="${escapeHtml(`${base}/?alert=${id}`)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Voir dans Sophia Jobs</a></p>`
    : "";
  const unsubscribe = base
    ? ` <a href="${escapeHtml(`${base}/api/alerts/${id}/unsubscribe`)}" style="color:#64748b">Se désabonner</a>`
    : "";

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:620px">
      <p>Bonjour,</p>
      <p><strong>${jobs.length}</strong> nouvelle(s) offre(s) pour votre alerte ${escapeHtml(label)} :</p>
      <ul style="padding-left:18px">${rows}</ul>
      ${more}
      ${appLink}
      <p style="color:#64748b;font-size:12px">Sophia Jobs — vous recevez cet email car vous avez créé cette alerte.${unsubscribe}</p>
    </div>
  `;

  try {
    await t.sendMail({
      from: config.smtp.from,
      to,
      subject: `Sophia Jobs — ${jobs.length} nouvelle(s) offre(s) : ${label}`,
      html,
    });
    return true;
  } catch (err) {
    console.error("[mailer] échec envoi email :", err.message);
    return false;
  }
}
