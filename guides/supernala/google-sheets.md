---
plugin: supernala-public:supernala:google-sheets
revision: 1
---

# Set up Google Sheets

Google Sheets lets your Bots find your spreadsheets, list their sheets and read cells. They can also write cells, add rows after a table, and create spreadsheets. Values are entered as you would type them, so numbers, dates and formulas such as `=SUM(B2:B10)` work. They cannot delete or share spreadsheets. Reading is allowed by default; writing asks you first unless you allow it for a Bot.

Each Workspace uses its own Google OAuth app, so you create one in Google Cloud first. This takes about 10 minutes, or about 3 if you already set up Gmail, Google Drive, Google Docs or Google Sheets: you can reuse that project and OAuth client.

## Create your Google OAuth app

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project, or choose the one you already use for Supernala.
2. Enable the [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) and the [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) for that project.
3. Set up the OAuth consent screen (Google Auth Platform, or APIs & Services → OAuth consent screen in older consoles). Choose **External**, and enter an app name and your support email. Skip this if the project already has one.
4. While the app is in **Testing**, add the Google account you will connect as a **test user**.
5. Under **Data access** (or **Scopes**), add `https://www.googleapis.com/auth/spreadsheets`, `https://www.googleapis.com/auth/drive.metadata.readonly`, `openid`, `email`. `spreadsheets` lets Bots read and edit your spreadsheets; `drive.metadata.readonly` lets them search for spreadsheets by name and content. The Drive API must be on for search to work.
6. Create an OAuth client of type **Web application**, or open the one you already have.
7. Under **Authorized redirect URIs**, add exactly `{{oauthCallbackUrl}}` if it is not there yet.
8. Copy the **Client ID** and **Client secret**.

## In Supernala

1. Open **Marketplace → Apps → Google Sheets** and click **Install**.
2. Under **OAuth app**, enter an app name, the client ID and the client secret, then click **Register app**. You can use the same client as your other Google apps. They are encrypted and stay in your Workspace; Bots never see them.
3. Click **Connect account**, sign in with the Google account you added as a test user, and allow every access Google lists. Leaving one unticked stops the related tools from working.
4. Choose what each Bot can do with Google Sheets and click **Save changes**.

## If something goes wrong

- **Access blocked or app not verified**: the account is not a test user yet. Add it under test users, or choose Advanced and continue, since this is your own app.
- **redirect_uri_mismatch**: the redirect URI in Google must match `{{oauthCallbackUrl}}` exactly, with no trailing slash.
- **"API is not enabled" from a Bot**: turn on the API the message names in the same Google Cloud project as your OAuth client, wait a minute, and try again.
- **"lacks permission" from a Bot**: an access was left unticked when connecting. Click **Connect account** again and allow everything Google lists.
- **Asked to reconnect after about a week**: Google expires sign-ins for apps in Testing after 7 days. Reconnect, or publish the app in Google Cloud. Reading your whole Drive is a restricted scope, so making the app available to many people needs Google's verification.
