# Gmail MCP Server

Serveur MCP en lecture seule pour Gmail. Permet de lire et rechercher des emails via le protocole MCP, sans aucun accès en écriture (pas de création, envoi, ni suppression).

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `search_threads` | Rechercher des threads par requête Gmail (ex: `from:alice@example.com is:unread`) |
| `get_thread` | Lire un thread complet avec tous ses messages |
| `get_message` | Lire un message individuel |
| `list_messages` | Lister les messages d'un ou plusieurs labels (ex: INBOX) |
| `list_labels` | Lister tous les labels du compte Gmail |

## Prérequis

- [Bun](https://bun.sh) installé
- Un compte Google Cloud (gratuit)

## Installation et configuration

### 1. Installer les dépendances

```bash
bun install
```

### 2. Créer le projet Google Cloud et les credentials

Suivez ces étapes dans la [Google Cloud Console](https://console.cloud.google.com/) :

#### Créer un projet

1. Ouvrez [console.cloud.google.com](https://console.cloud.google.com/)
2. Cliquez sur le menu déroulant de sélection de projet dans la barre du haut (à côté du logo Google Cloud)
3. Cliquez sur **"New Project"**
4. Saisissez un nom (ex: `Gmail MCP Server`) → cliquez **"Create"**
5. Attendez la notification de création, puis sélectionnez le projet créé dans le même menu

#### Activer l'API Gmail

1. Menu latéral gauche → **"APIs & Services"** → **"Library"**
2. Dans la barre de recherche, tapez `Gmail API`
3. Cliquez sur **"Gmail API"** dans les résultats
4. Cliquez sur le bouton bleu **"Enable"**

#### Configurer l'écran de consentement OAuth

1. Menu latéral → **"APIs & Services"** → **"OAuth consent screen"**
2. Type d'utilisateur : sélectionnez **"External"** → cliquez **"Create"**
3. Remplissez les champs obligatoires :
   - **App name** : `Gmail MCP Server` (ou ce que vous voulez)
   - **User support email** : votre adresse email
   - **Developer contact information > Email addresses** : votre adresse email
4. Cliquez **"Save and Continue"**
5. Sur la page **"Scopes"** :
   - Cliquez **"Add or Remove Scopes"**
   - Dans le filtre de recherche, tapez `gmail.readonly`
   - Cochez **".../auth/gmail.readonly"** (libellé : "Read all resources and their metadata—no write operations")
   - Cliquez **"Update"** puis **"Save and Continue"**
6. Sur la page **"Test users"** :
   - Cliquez **"+ Add Users"**
   - Entrez votre adresse Gmail (celle que vous souhaitez lire)
   - Cliquez **"Add"** puis **"Save and Continue"**
7. Sur le récapitulatif, cliquez **"Back to Dashboard"**

#### Créer les identifiants OAuth 2.0

1. Menu latéral → **"APIs & Services"** → **"Credentials"**
2. Cliquez **"+ Create Credentials"** → **"OAuth client ID"**
3. **Application type** : sélectionnez **"Desktop app"**
4. **Name** : laissez la valeur par défaut ou saisissez `Gmail MCP`
5. Cliquez **"Create"**
6. Une fenêtre s'affiche avec vos credentials :
   - **Your Client ID** → c'est votre `GMAIL_CLIENT_ID`
   - **Your Client Secret** → c'est votre `GMAIL_CLIENT_SECRET`
7. Notez ces deux valeurs (ou téléchargez le JSON via **"Download JSON"**), puis cliquez **"OK"**

### 3. Lancer le script de configuration

```bash
bun run setup
```

Ce script interactif va :
- Vous demander de coller le Client ID et le Client Secret
- Ouvrir un serveur local sur le port 1975 pour recevoir le callback OAuth
- Vous afficher une URL à ouvrir dans votre navigateur
- Après autorisation, récupérer automatiquement le `refresh_token`
- Créer le fichier `.env` avec toutes les variables

> **Note** : Pendant l'autorisation Google, si vous voyez "Google hasn't verified this app", cliquez sur **"Advanced"** puis **"Go to [nom de l'app] (unsafe)"**. C'est normal pour une application en mode test.

## Démarrage

### Mode HTTP (pour clients web / frontend)

```bash
bun run start
```

Le serveur écoute sur `http://localhost:1976/mcp` avec CORS ouvert (toute origine autorisée).

### Mode STDIO (pour Claude Desktop et agents CLI)

```bash
bun run start:stdio
```

### Vérification

```bash
# Lister les outils disponibles
curl -X POST http://localhost:1976/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Health check
curl http://localhost:1976/health
```

## Configuration avancée

Toutes les variables sont dans `.env` :

```env
GMAIL_CLIENT_ID=votre-client-id
GMAIL_CLIENT_SECRET=votre-client-secret
GMAIL_REFRESH_TOKEN=votre-refresh-token
PORT=1976
```

Pour changer le port, modifiez la valeur `PORT` dans `.env`.

## Intégration avec Claude Desktop

Ajoutez dans votre `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "gmail": {
      "command": "bun",
      "args": ["run", "/chemin/vers/gmail-mcp-server/src/server.ts", "--stdio"],
      "env": {
        "GMAIL_CLIENT_ID": "votre-client-id",
        "GMAIL_CLIENT_SECRET": "votre-client-secret",
        "GMAIL_REFRESH_TOKEN": "votre-refresh-token"
      }
    }
  }
}
```

## Sécurité

- Le scope OAuth utilisé est `gmail.readonly` — le plus restrictif possible pour la lecture.
- Aucun outil d'écriture n'est exposé (pas de création, envoi, suppression, labellisation).
- Le fichier `.env` est exclu du git via `.gitignore` — ne le committez jamais.
- Le `refresh_token` donne un accès durable : stockez-le en lieu sûr.
