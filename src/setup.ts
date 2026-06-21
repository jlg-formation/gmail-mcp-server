/**
 * Interactive setup script — creates the .env file with Gmail OAuth2 credentials.
 *
 * Run once:  bun run setup
 */

import { google } from "googleapis";
import * as fs from "fs";
import * as readline from "readline";

const REDIRECT_PORT = 1975;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
const ENV_FILE = ".env";

// ── Helpers ───────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function waitForCode(server: ReturnType<typeof Bun.serve>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new Error("Timeout: no callback received after 5 minutes."));
    }, 5 * 60 * 1000);

    // Monkey-patch the server's fetch to capture the code
    (server as unknown as { _resolveCode: (code: string) => void })._resolveCode = (code: string) => {
      clearTimeout(timeout);
      resolve(code);
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════╗
║         Gmail MCP Server — Configuration initiale        ║
╚══════════════════════════════════════════════════════════╝

Ce script va créer votre fichier .env avec les credentials OAuth2 Gmail.

┌─ Étape 1 : Créer un projet Google Cloud ──────────────────
│
│  1. Ouvrez : https://console.cloud.google.com/
│  2. Cliquez sur le menu déroulant de projet (en haut à gauche)
│  3. Cliquez sur "Nouveau projet"
│  4. Donnez un nom (ex: "Gmail MCP") → cliquez "Créer"
│  5. Attendez la création et assurez-vous que le projet est sélectionné
│
└───────────────────────────────────────────────────────────

┌─ Étape 2 : Activer l'API Gmail ───────────────────────────
│
│  1. Dans le menu latéral gauche → "API et services" → "Bibliothèque"
│  2. Dans la barre de recherche, tapez "Gmail API"
│  3. Cliquez sur "Gmail API" dans les résultats
│  4. Cliquez sur le bouton bleu "Activer"
│
└───────────────────────────────────────────────────────────

┌─ Étape 3 : Configurer l'écran de consentement OAuth ──────
│
│  1. Menu latéral → "API et services" → "Écran de consentement OAuth"
│  2. Sélectionnez "Externe" → cliquez "Créer"
│  3. Remplissez :
│     - Nom de l'application : Gmail MCP Server (ou autre)
│     - Email d'assistance utilisateur : votre adresse email
│     - Adresse e-mail du développeur : votre adresse email
│  4. Cliquez "Enregistrer et continuer"
│  5. Section "Champs d'application" :
│     - Cliquez "Ajouter ou supprimer des champs d'application"
│     - Dans le filtre, cherchez "gmail.readonly"
│     - Cochez ".../auth/gmail.readonly"
│     - Cliquez "Mettre à jour" puis "Enregistrer et continuer"
│  6. Section "Utilisateurs test" :
│     - Cliquez "+ Add users"
│     - Entrez votre adresse Gmail
│     - Cliquez "Ajouter" puis "Enregistrer et continuer"
│  7. Cliquez "Retour au tableau de bord"
│
└───────────────────────────────────────────────────────────

┌─ Étape 4 : Créer des identifiants OAuth ──────────────────
│
│  1. Menu latéral → "API et services" → "Identifiants"
│  2. Cliquez "+ Créer des identifiants" → "ID client OAuth"
│  3. Type d'application : sélectionnez "Application de bureau"
│  4. Nom : laissez la valeur par défaut ou nommez-le "Gmail MCP"
│  5. Cliquez "Créer"
│  6. Une fenêtre apparaît avec votre ID client et Secret client
│     → Copiez ces deux valeurs, vous en aurez besoin ci-dessous
│  7. Cliquez "OK"
│
└───────────────────────────────────────────────────────────
`);

const clientId = await prompt("Collez votre ID client (GMAIL_CLIENT_ID) : ");
if (!clientId) {
  console.error("❌ ID client vide. Abandon.");
  process.exit(1);
}

const clientSecret = await prompt("Collez votre Secret client (GMAIL_CLIENT_SECRET) : ");
if (!clientSecret) {
  console.error("❌ Secret client vide. Abandon.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log(`
┌─ Étape 5 : Autoriser l'accès Gmail ───────────────────────
│
│  Un serveur local démarre sur le port ${REDIRECT_PORT} pour recevoir
│  le callback OAuth de Google.
│
│  Ouvrez cette URL dans votre navigateur :
│
│  ${authUrl}
│
│  Connectez-vous avec le compte Gmail à lire,
│  acceptez l'accès "Voir vos e-mails".
│  La page affichera "Autorisation réussie !" quand c'est bon.
│
└───────────────────────────────────────────────────────────
`);

// Resolve/reject functions shared between the server fetch and the waiter
let resolveCode!: (code: string) => void;
let rejectCode!: (err: Error) => void;
const codePromise = new Promise<string>((res, rej) => {
  resolveCode = res;
  rejectCode = rej;
});

const callbackServer = Bun.serve({
  port: REDIRECT_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) {
        rejectCode(new Error(`Google a refusé l'accès : ${error}`));
        return new Response(
          "<h2>❌ Autorisation refusée.</h2><p>Relancez le script et réessayez.</p>",
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
      if (code) {
        resolveCode(code);
        return new Response(
          "<h2>✅ Autorisation réussie !</h2><p>Vous pouvez fermer cet onglet.</p>",
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
    }
    return new Response("Not found", { status: 404 });
  },
});

const timeoutHandle = setTimeout(() => {
  callbackServer.stop();
  rejectCode(new Error("Timeout : aucun callback reçu après 5 minutes."));
}, 5 * 60 * 1000);

let code: string;
try {
  code = await codePromise;
} catch (err) {
  clearTimeout(timeoutHandle);
  console.error(`\n❌ Erreur : ${(err as Error).message}`);
  process.exit(1);
}

clearTimeout(timeoutHandle);
callbackServer.stop();

console.log("\n⏳ Échange du code d'autorisation contre un refresh token...");

let refreshToken: string;
try {
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error("❌ Pas de refresh_token retourné. Assurez-vous d'avoir passé prompt=consent.");
    process.exit(1);
  }
  refreshToken = tokens.refresh_token;
} catch (err) {
  console.error(`❌ Erreur lors de l'échange du token : ${(err as Error).message}`);
  process.exit(1);
}

const portStr = process.env.PORT ?? "1976";
const envContent = [
  `GMAIL_CLIENT_ID=${clientId}`,
  `GMAIL_CLIENT_SECRET=${clientSecret}`,
  `GMAIL_REFRESH_TOKEN=${refreshToken}`,
  `PORT=${portStr}`,
  `ENABLE_WRITE=false`,
].join("\n") + "\n";

fs.writeFileSync(ENV_FILE, envContent, "utf-8");

console.log(`
✅ Fichier .env créé avec succès !

   GMAIL_CLIENT_ID      = ${clientId.slice(0, 8)}...
   GMAIL_CLIENT_SECRET  = ${clientSecret.slice(0, 4)}...
   GMAIL_REFRESH_TOKEN  = ${refreshToken.slice(0, 8)}...
   PORT                 = ${portStr}

Vous pouvez maintenant démarrer le serveur :

   bun run start          # mode HTTP  → http://localhost:${portStr}/mcp
   bun run start:stdio    # mode STDIO → pour Claude Desktop / agents CLI
`);
