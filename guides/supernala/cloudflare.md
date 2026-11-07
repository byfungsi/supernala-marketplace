---
plugin: supernala-public:supernala:cloudflare
revision: 1
---

# Set up Cloudflare

Cloudflare lets your Bots read and change your Cloudflare account through the Cloudflare API, such as DNS, Workers and analytics. Running a change asks for your approval. You sign in with Cloudflare, so there are no keys to create.

## In Supernala

1. Open **Marketplace → Apps → Cloudflare** and click **Install**.
2. Click **Connect account**, sign in to Cloudflare, choose the account and allow the requested permissions.
3. Choose which Bots can use Cloudflare and click **Save changes**.

## If something goes wrong

- **Permission errors**: your Cloudflare user needs a role that allows the action, and the account must be the one you chose at sign-in.
- **Asked to reconnect**: Cloudflare ended the sign-in. Connect again.
