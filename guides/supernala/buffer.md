---
plugin: supernala-public:supernala:buffer
revision: 1
---

# Set up Buffer

Buffer lets your Bots draft, schedule and review posts and ideas for the channels in your Buffer account, after you approve changes. It connects with your own Buffer API key.

## Create your API key

1. In Buffer, open **Settings → API** and create an API key. See [Buffer's authentication guide](https://developers.buffer.com/guides/authentication.html) if you cannot find it.
2. Copy the key. A key reaches every organization and channel in your Buffer account.

## In Supernala

1. Open **Marketplace → Apps → Buffer** and click **Install**.
2. Paste the key into **Buffer API key** and click **Save API key**. It is encrypted; Bots never see it.
3. Choose which Bots can use Buffer and click **Save changes**. Changes and deletions still ask for your approval.

## If something goes wrong

- **Connection failed**: the key is wrong or was revoked. Create a new one in Buffer.
- **Requests are limited**: Bots share your Buffer plan's API limits with your other keys and tools.
- **To stop access completely**: remove the account in Supernala and revoke the key in Buffer.
