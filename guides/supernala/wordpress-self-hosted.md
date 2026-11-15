---
plugin: supernala-public:supernala:wordpress-self-hosted
revision: 1
---

# Set up WordPress Self-Hosted

WordPress Self-Hosted connects your Bots to your own WordPress site, the kind you install on your own hosting (WordPress.org software). Bots can read your posts, pages, categories, tags, comments and media library, and, when you approve, write drafts, publish or schedule posts and pages, organize categories and tags, answer and moderate comments, and improve image alt text. Reading is allowed by default. Anything that creates, changes, publishes or trashes asks you first. Nothing is ever deleted permanently: removing a post, page or comment moves it to the WordPress trash, where you can restore it for 30 days.

Bots with access also get the **WordPress publishing playbook** Skill, which teaches them to draft first, edit your current text, and publish only when you say so.

If your site is hosted on WordPress.com, use the **WordPress.com** app instead.

You connect with your site address, your WordPress username and an **application password**: a separate password just for Supernala, which you can revoke at any time without changing your normal login. It takes about 5 minutes and needs no plugin.

## What you need

- A self-hosted WordPress site, version **5.6 or newer**, served over **HTTPS** (`https://`). WordPress only offers application passwords on secure sites.
- A WordPress user for your Bots. We recommend a separate user, such as `supernala-bot`, with the **Editor** role:
  - **Editor** can write, publish and edit any post or page and moderate comments.
  - **Author** can write and publish only their own posts.
  - **Contributor** can write drafts but not publish.
  - **Administrator** can also read site settings such as the time zone; give it only if Bots need that.
- **Pretty permalinks**: in WordPress go to **Settings → Permalinks** and choose anything except **Plain**. The REST API address `/wp-json/` needs it.

## 1. Create an application password

1. Sign in to your WordPress admin (`https://your-site.com/wp-admin`) as the user Bots will use.
2. Go to **Users → Profile** (or **Users → All Users**, then open the user).
3. Scroll to **Application Passwords**.
4. Under **New Application Password Name**, enter `Supernala` and click **Add New Application Password**.
5. Copy the password WordPress shows, such as `abcd EFGH 1234 ijkl MNOP 5678`. It appears only once; the spaces are fine to keep.

Don't see **Application Passwords**? See **If something goes wrong** below.

## 2. Find your site address

Use the address in **Settings → General → Site Address (URL)**, for example `https://example.com`. If WordPress is in a folder, include it, such as `https://example.com/blog`. Use the exact address, including `www.` if your site uses it: Supernala doesn't follow redirects.

## In Supernala

1. Open **Marketplace → Apps → WordPress Self-Hosted** and click **Install**.
2. Enter your **Site address**, your **WordPress username** (the user from step 1) and the **Application password**, then click **Save API key**. Supernala checks them on your site right away. The password is encrypted in your Workspace; Bots never see it.
3. Under **Bot access**, choose which Bots can use WordPress and click **Save changes**. Leave creating, changing and trashing on **Ask** unless you are sure.

Try asking a Bot: "List my last 5 posts with their status", or "Draft a post about our weekend opening hours and show me before publishing".

## What Bots can and can't do

- **Read:** posts and pages (including drafts and scheduled ones), search, categories, tags, comments, media, users who publish, the connected user's role, and site settings (Administrators only).
- **With your approval:** create and edit posts and pages, publish or schedule them, create categories and tags, post comments and replies, approve, hold or mark comments as spam, edit media titles, alt text and captions, and move posts, pages and comments to the trash.
- **Not available:** uploading new images or files, permanent deletion, plugins, themes, menus, users and settings changes. Upload images in WordPress first; Bots can then use them from the media library.

## Keep your site safe

- Give the Bot user the lowest role that does the job. A **Contributor** user can only submit drafts for review, so nothing goes public without an editor in WordPress.
- Keep **Ask** on for creating, changing and trashing. Each request shows you exactly what will change before it happens.
- Revoke access any time in WordPress under **Users → Profile → Application Passwords → Revoke**, or remove the Bot's access in Supernala.

## If something goes wrong

- **"Application Passwords" is missing from your profile:**
  - The site isn't on HTTPS. Turn on SSL with your host first.
  - A security plugin turned it off. In Wordfence go to **Login Security → Settings** and untick **Disable WordPress application passwords**; Solid Security (iThemes) and other security plugins have a similar setting.
  - Your host or a code snippet disabled it (`wp_is_application_passwords_available` filter). Ask your host.
- **The username or password is rejected (401):**
  - Copy the application password again, and use the username, not the display name. Your email address also works.
  - Some hosts drop the login header, so WordPress never sees it. Add this line near the top of the `.htaccess` file in your WordPress folder, or ask your host to pass the `Authorization` header:

    ```
    SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
    ```

  - Cloudflare or a firewall rule may block `/wp-json/`. Allow it for your site.
- **"Site not found" or 404:** check the site address (including `www.` and any folder) and that **Settings → Permalinks** isn't set to **Plain**. Opening `https://your-site.com/wp-json/` in a browser should show text, not an error page.
- **A Bot says it isn't allowed (403):** the user's role is too low for that action, for example an Author editing someone else's post. Give the user a higher role in WordPress, or leave that task to a person.
- **A post published by mistake:** in WordPress, open it and switch it back to **Draft**, or ask the Bot to move it to the trash.
- **You want to stop access:** revoke the **Supernala** application password in WordPress, and uninstall the app or remove the Bot's access in Supernala.
