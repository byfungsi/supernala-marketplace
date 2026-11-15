---
name: wordpress
description: How to write, edit and publish on WordPress safely through the WordPress Self-Hosted or WordPress.com app — posts, pages, categories, tags, comments and media — drafting first, editing the current text, and never publishing, scheduling or removing anything the Owner did not approve. Load before any WordPress tool that creates, changes, publishes or trashes something.
license: LicenseRef-Supernala
---

# WordPress publishing playbook

The Owner's WordPress site is public. A post you publish reaches readers, search engines and email subscribers at once, and cannot be unsent. Work like a careful editor: draft, show, then publish only when the Owner says so.

There are two WordPress apps. Check which one the Owner connected:

- **WordPress Self-Hosted** (`plugins["wordpress-self-hosted"]`): the Owner's own WordPress site, reached through its REST API with named tools such as `wordpress.create_post`. Each connection is one site.
- **WordPress.com** (`plugins["wordpress-com"]`): WordPress.com's own MCP server, with four tools — `search`, `describe` and `docs` to look things up, and `execute` to run one *ability* (an operation such as creating a post). One connection reaches every site on the account and Jetpack-connected sites.

Reads run freely. Creating, changing, publishing and trashing ask the Owner first unless they allowed it; on WordPress.com every `execute` asks, including reads.

## Rules (never break these)

1. **Draft first.** Create posts and pages with `status: "draft"` unless the Owner asked, in so many words, to publish now or to schedule. Then share the draft's link (`link`, or the preview link for drafts) and a short summary, and ask whether to publish.
2. **Publishing is the Owner's decision.** Set `status` to `publish`, `future` or `private` only when the Owner asked for exactly that change, for exactly that item. "Write a post about our menu" means a draft, not a public post.
3. **Read before you edit.** Fetch the current item with `context: "edit"` (Self-Hosted) or the matching get ability (WordPress.com) and change only what was asked. Send only the fields you change; never resend the whole body when the Owner asked to fix a title.
4. **Never remove permanently.** Self-Hosted trash tools move items to the trash, where WordPress keeps them for 30 days. On WordPress.com, check an ability's description before running anything named delete: some are permanent (classic menus, menu items, media files). Ask the Owner first and name what disappears.
5. **Don't invent facts.** Prices, opening hours, quotes, statistics, people and links must come from the Owner or a source they gave you. Mark anything you are unsure of in the draft and say so.
6. **Keep the author honest.** Publish as the connected user unless the Owner names another author; never set `author` to someone who did not write or approve the piece.
7. **Credentials stay out of chat.** Never ask for or repeat a password, application password or token. Setup happens in the app's own screen in Supernala.

## Writing good WordPress content

- **Title** is plain text, without HTML. Keep it specific and under about 60 characters, so search results show it whole.
- **Content** may be classic HTML (`<p>`, `<h2>`, `<ul>`, `<a href>`, `<strong>`) or block markup, which the block editor keeps editable:
  - paragraph: `<!-- wp:paragraph --><p>Text</p><!-- /wp:paragraph -->`
  - heading: `<!-- wp:heading --><h2 class="wp-block-heading">Title</h2><!-- /wp:heading -->` (use `{"level":3}` and `<h3>` for subheadings)
  - list: `<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>Item</li><!-- /wp:list-item --></ul><!-- /wp:list -->`
  - image: `<!-- wp:image {"id":123} --><figure class="wp-block-image"><img src="URL" alt="What the image shows" class="wp-image-123"/></figure><!-- /wp:image -->`
  - quote: `<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>Quote</p><!-- /wp:paragraph --></blockquote><!-- /wp:quote -->`
  When you edit existing block content, keep its block comments; removing them turns blocks into one classic block.
- Start body headings at `h2` (the title is the page's `h1`) and don't skip levels.
- Every image needs `alt` text that says what it shows. Decorative images get `alt=""`.
- Write an **excerpt** of one or two sentences for lists, feeds and social previews, and a short lowercase **slug** with hyphens.
- Link text names its destination ("our spring menu"), never "click here".
- Match the site's language and voice: read two or three recent posts first.

## Categories, tags and images

- List categories and tags first and reuse what exists; WordPress refuses a duplicate name. Create a new one only when nothing fits and the Owner agrees.
- Posts take category and tag **IDs**, not names. Sending `categories` replaces the post's whole list, so include the ones it already has.
- **Images on WordPress Self-Hosted:** uploading is not available. Use an image already in the media library (`wordpress.list_media` → its `id` for `featured_media`, its `source_url` in content), or ask the Owner to upload it in WordPress first. You can improve alt text and captions with `wordpress.update_media_details`.
- **Images on WordPress.com:** media abilities can upload from a URL or generate an image; search for them (`search` query "media upload").

## Scheduling

Use `status: "future"` with `date` in the site's own time zone (`YYYY-MM-DDTHH:MM:SS`). On Self-Hosted, read the time zone from `wordpress.get_settings` (Administrators only) or the dates of recent posts, and confirm the time with the Owner in their words ("Tuesday 9:00 Jakarta time"). A date in the past publishes immediately.

## WordPress Self-Hosted tools

| Task | Tools |
| --- | --- |
| Who am I, what may I do | `wordpress.get_current_user` with `context: "edit"` (roles, capabilities) |
| Find content | `wordpress.search`, `wordpress.list_posts`, `wordpress.list_pages` (add `status: ["draft"]` for drafts) |
| Read one item for editing | `wordpress.get_post` / `wordpress.get_page` with `context: "edit"` |
| Write | `wordpress.create_post`, `wordpress.create_page`, `wordpress.update_post`, `wordpress.update_page` |
| Organize | `wordpress.list_categories`, `wordpress.list_tags`, `wordpress.create_category`, `wordpress.create_tag` |
| Comments | `wordpress.list_comments` (`status: "hold"` for the moderation queue), `wordpress.reply_to_comment`, `wordpress.moderate_comment` |
| Media | `wordpress.list_media`, `wordpress.get_media`, `wordpress.update_media_details` |
| Remove | `wordpress.trash_post`, `wordpress.trash_page`, `wordpress.trash_comment` (all reversible) |
| Site settings | `wordpress.get_settings` (Administrators only; a 403 for other roles is normal) |

Use `_fields` to keep answers small, for example `id,title,status,date,link` for lists; full content and rendered HTML can be very large.

## WordPress.com tools

1. **Pick the site.** Run `execute` with `name: "wpcom/user-sites"` and `input: {}` to list the Owner's sites, then pass `wpcom_site` (domain or ID) on every call. Confirm the site with the Owner when they have more than one.
2. **Find the ability.** `search` with words such as "posts create" or "comments moderate". Use `readonly: true` for reading abilities and the default `readonly: false` for abilities that change something. `detailed: true` returns input schemas for up to five.
3. **Read its contract.** `describe` with the exact `names` before the first use, and follow its input schema exactly. `docs` holds WordPress.com's own step-by-step guides (call it without `topics` for the index).
4. **Run it.** `execute` with `name`, `input` (always an object for WordPress.com abilities, `{}` when empty), `wpcom_site`, and a one-line `summary` that names the action, target and consequence ("Publish the draft 'Spring menu' on cafe.example.com").
5. **Confirmation.** WordPress.com runs read-only abilities freely and refuses every other ability unless the call carries `user_confirmed: true`. In Supernala the Owner's approval of your `execute` call is that confirmation, so include `user_confirmed: true` on a change only when:
   - this call will wait for the Owner's approval, so they see the exact action, input and summary before it runs; or
   - the Owner asked for exactly this change, in these words, in the conversation.
   Otherwise ask the Owner first and wait. Never add `user_confirmed` to slip past a refusal.
6. An ability listed under `disabled_matches` is turned off in the Owner's WordPress.com **AI and MCP** settings. Tell the Owner which setting to enable instead of looking for a workaround.

Domains, DNS, nameservers, plans, checkout links, plugins, themes, invitations and account settings can cost money or take a site offline. Do them only when the Owner explicitly asks, and say what will change first.

## When something fails

- **401 or "incorrect password"** (Self-Hosted): the application password is wrong, revoked, or the host strips the Authorization header. Ask the Owner to check the app's setup guide; never retry with guessed credentials.
- **403 / `rest_forbidden` / `rest_cannot_create` / `rest_cannot_edit`**: the connected user's role can't do this (for example an Author editing someone else's post, or anyone but an Administrator reading settings). Say which role is needed.
- **404 `rest_no_route`**: the site's REST API or pretty permalinks are off, or a security plugin blocks it.
- **`rest_post_invalid_id`**: the item does not exist or is in the trash; search again.
- **`term_exists`**: the category or tag already exists; use its ID from the error or the list.
- **400 `rest_invalid_param`**: a field has the wrong type or value; read the message, fix that field, try once more.
- **WordPress.com "Approval required"**: the call lacked confirmation; follow step 5 above.
- **A plan or feature error on WordPress.com**: the site's plan lacks it. Tell the Owner; don't create checkout links unless asked.

## Report back

After any change, tell the Owner what changed, its status (draft, scheduled, published, trashed), its title and its link. After a draft, end with a clear question such as "Publish it now, schedule it, or change something first?".
