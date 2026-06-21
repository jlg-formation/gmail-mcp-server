# Gmail MCP Server

Serveur MCP pour Gmail. En lecture seule par défaut ; l'envoi de mails peut être activé explicitement via `ENABLE_WRITE=true`. La suppression de messages n'est jamais exposée.

## Outils disponibles

| Outil | Description | Requis |
|-------|-------------|--------|
| `search_threads` | Rechercher des threads par requête Gmail (ex: `from:alice@example.com is:unread`) | toujours |
| `get_thread` | Lire un thread complet avec tous ses messages | toujours |
| `get_message` | Lire un message individuel | toujours |
| `list_messages` | Lister les messages d'un ou plusieurs labels (ex: INBOX) | toujours |
| `list_labels` | Lister tous les labels du compte Gmail | toujours |
| `send_message` | Envoyer un email (supporte les réponses dans un thread) | `ENABLE_WRITE=true` |

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
   - Tapez ensuite `gmail.send` dans le filtre
   - Cochez **".../auth/gmail.send"** (libellé : "Send email on your behalf")
   - Cliquez **"Update"** puis **"Save and Continue"**
6. Sur la page **"Test users"** :
   - Cliquez **"+ Add Users"**
   - Entrez votre adresse Gmail (celle que vous souhaitez utiliser)
   - Cliquez **"Add"** puis **"Save and Continue"**
7. Sur le récapitulatif, cliquez **"Back to Dashboard"**

> **Pourquoi `gmail.send` dès le départ ?** Le script de setup demande les deux scopes en une seule autorisation. Cela évite de relancer toute la procédure si vous activez `ENABLE_WRITE=true` plus tard. Le scope `gmail.send` ne sera exploité que si `ENABLE_WRITE=true` est présent dans `.env`.

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
- Créer le fichier `.env` avec toutes les variables (dont `ENABLE_WRITE=false` par défaut)

> **Note** : Pendant l'autorisation Google, si vous voyez "Google hasn't verified this app", cliquez sur **"Advanced"** puis **"Go to [nom de l'app] (unsafe)"**. C'est normal pour une application en mode test.

## Activer l'envoi de mails

Par défaut, le serveur est en lecture seule. Pour activer l'outil `send_message` :

1. Ouvrez le fichier `.env` à la racine du projet
2. Changez la ligne `ENABLE_WRITE=false` en :

```env
ENABLE_WRITE=true
```

3. Redémarrez le serveur — l'outil `send_message` apparaîtra dans `tools/list`

> **Important** : si votre refresh token existant date d'avant l'ajout du scope `gmail.send` dans votre écran de consentement OAuth, vous devrez relancer `bun run setup` pour obtenir un nouveau token avec ce scope.

### Ajouter `gmail.send` à un projet Google Cloud existant

Si vous avez déjà configuré le projet Google Cloud sans cocher `gmail.send` lors de l'étape "Scopes" :

1. Menu latéral → **"APIs & Services"** → **"OAuth consent screen"**
2. Cliquez sur **"Edit App"**
3. Avancez jusqu'à l'étape **"Scopes"** → cliquez **"Add or Remove Scopes"**
4. Dans le filtre, tapez `gmail.send`
5. Cochez **".../auth/gmail.send"**
6. Cliquez **"Update"** → **"Save and Continue"** jusqu'au bout
7. Relancez `bun run setup` pour générer un nouveau refresh token incluant ce scope

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
ENABLE_WRITE=false
```

| Variable | Description | Défaut |
|----------|-------------|--------|
| `GMAIL_CLIENT_ID` | OAuth 2.0 Client ID (Google Cloud) | — |
| `GMAIL_CLIENT_SECRET` | OAuth 2.0 Client Secret | — |
| `GMAIL_REFRESH_TOKEN` | Refresh token OAuth (généré par `bun run setup`) | — |
| `PORT` | Port d'écoute HTTP | `1976` |
| `ENABLE_WRITE` | Active l'outil `send_message` si `true` | `false` |

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
        "GMAIL_REFRESH_TOKEN": "votre-refresh-token",
        "ENABLE_WRITE": "false"
      }
    }
  }
}
```

## Sécurité

- Le scope OAuth `gmail.readonly` est toujours demandé — aucune écriture sans `ENABLE_WRITE=true`.
- Le scope `gmail.send` est inclus dans le token mais l'outil `send_message` n'est enregistré que si `ENABLE_WRITE=true` est explicitement défini dans `.env`.
- La suppression de messages n'est jamais exposée, quelle que soit la valeur de `ENABLE_WRITE`.
- Le fichier `.env` est exclu du git via `.gitignore` — ne le committez jamais.
- Le `refresh_token` donne un accès durable : stockez-le en lieu sûr.
