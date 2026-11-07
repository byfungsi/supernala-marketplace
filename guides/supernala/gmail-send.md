---
plugin: supernala-public:supernala:gmail-send
revision: 1
---

# Set up Gmail — Send

Gmail — Send lets your Bots send email from your Gmail account, after you approve each message. It cannot read your mailbox; install Gmail for that. Each Workspace uses its own Google OAuth app.

## Create your Google OAuth app

You can reuse the Google project and OAuth client you made for Gmail, or create new ones.

1. In the [Google Cloud console](https://console.cloud.google.com/), choose a project and enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. On the OAuth consent screen, choose **External**, and while the app is in **Testing**, add the Gmail address you will send from as a **test user**.
3. Add the scopes `openid`, `email` and `https://www.googleapis.com/auth/gmail.send`.
4. Use an OAuth client of type **Web application** whose **Authorized redirect URIs** include exactly `{{oauthCallbackUrl}}`.
5. Copy the **Client ID** and **Client secret**.

## In Supernala

1. Open **Marketplace → Apps → Gmail — Send** and click **Install**.
2. Under **OAuth app**, enter an app name, the client ID and the client secret, then click **Register app**. Each app keeps its own encrypted copy, even when you reuse the same Google client.
3. Click **Connect account** and sign in with the address you will send from.
4. Choose which Bots can send and click **Save changes**. Sending still asks for your approval.

## If something goes wrong

- **Access blocked or app not verified**: add the account as a test user, or choose Advanced and continue for your own app.
- **redirect_uri_mismatch**: the redirect URI must match `{{oauthCallbackUrl}}` exactly.
- **Asked to reconnect after about a week**: Google expires sign-ins for apps in Testing after 7 days. Reconnect, or move the app to production in Google Cloud.
