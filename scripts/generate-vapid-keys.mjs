#!/usr/bin/env node
// Génère une paire de clés VAPID (notifications push) à coller dans .env.
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("Ajoutez ces lignes à votre .env :\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
