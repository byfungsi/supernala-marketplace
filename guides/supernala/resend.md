---
plugin: supernala-public:supernala:resend
revision: 1
---

# Set up Resend (sign in)

Resend lets your Bots send email through your Resend team after you approve each message. This method signs in with Resend; use **Resend API** if you prefer an API key.

## Before you start

- A Resend account with a [verified sending domain](https://resend.com/domains). Without one, Resend only sends test email to your own address.

## In Supernala

1. Open **Marketplace → Apps → Resend** and click **Install**.
2. Click **Connect account**, sign in to Resend and allow sending email.
3. Choose which Bots can send and click **Save changes**. Sending still asks for your approval.

## If something goes wrong

- **Sending is refused**: the from address must use a domain you verified in Resend.
- **Asked to reconnect**: Resend ended the sign-in. Connect again.
