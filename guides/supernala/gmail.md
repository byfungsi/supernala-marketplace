---
plugin: supernala-public:supernala:gmail
revision: 2
---

# Set up Gmail

Gmail lets your Bots search your mailbox, read messages and drafts, and send plain-text email, all from one connected account. It cannot delete or change mail. You choose for each Bot whether it may read, send, or ask you first. Each Workspace uses its own Google OAuth app, so you create one in Google Cloud first. This takes about 10 minutes.

## Create your Google OAuth app

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project, or choose one you already use.
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) for that project.
3. Set up the OAuth consent screen (Google Auth Platform, or APIs & Services → OAuth consent screen in older consoles). Choose **External**, enter an app name and your support email.
4. While the app is in **Testing**, add the Gmail address you will connect as a **test user**.
5. Add the scopes `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`.
6. Create an OAuth client of type **Web application**.
7. Under **Authorized redirect URIs**, add exactly `{{oauthCallbackUrl}}`.
8. Copy the **Client ID** and **Client secret**.

## In Supernala

1. Open **Marketplace → Apps → Gmail** and click **Install**.
2. Under **OAuth app**, enter an app name, the client ID and the client secret, then click **Register app**. They are encrypted and stay in your Workspace; Bots never see them.
3. Click **Connect account** and sign in with the Gmail address you added as a test user.
4. Choose what each Bot can do with Gmail (read, send, or ask you first) and click **Save changes**.

## If something goes wrong

- **Access blocked or app not verified**: the account is not a test user yet. Add it under test users, or choose Advanced and continue for your own app.
- **redirect_uri_mismatch**: the redirect URI in Google must match `{{oauthCallbackUrl}}` exactly, with no trailing slash.
- **Asked to reconnect after about a week**: Google expires sign-ins for apps in Testing after 7 days. Reconnect, or move the app to production in Google Cloud. Reading Gmail is a restricted scope and sending is a sensitive one, so production use for many people needs Google's verification.
