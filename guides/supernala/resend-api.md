---
plugin: supernala-public:supernala:resend-api
revision: 1
---

# Set up Resend with an API key

Resend API connects your Resend team with an API key, so Bots can send email after you approve each message.

## Create your API key

1. Make sure you have a [verified sending domain](https://resend.com/domains) in Resend.
2. Open [Resend API keys](https://resend.com/api-keys) and create a key. Choose **Sending access** unless Bots need more, and limit it to your domain if you like.
3. Copy the key. Resend shows it only once.

## In Supernala

1. Open **Marketplace → Apps → Resend API** and click **Install**.
2. Paste the key into **Resend API key** and click **Save API key**. It is encrypted; Bots never see it.
3. Choose which Bots can send and click **Save changes**.

## If something goes wrong

- **Connection failed**: the key was copied incompletely or deleted in Resend. Create a new one.
- **Sending is refused**: the from address must use a domain you verified, and a sending-access key limited to a domain only sends from that domain.
