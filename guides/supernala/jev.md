---
plugin: supernala-public:supernala:jev
revision: 1
---

# Set up Jev with a TypeSafe API key

Jev is TypeSafe's decision model. It answers typed questions about content (pick one option, score against levels, or how likely a yes/no statement is true) with calibrated probabilities, in about a tenth of a second. Bots and workflows use it to classify, route, triage and screen. It never writes text. This takes about 3 minutes.

## Get your API key

1. Sign in to the [TypeSafe API console](https://console.typesafe.ai).
2. Create an API key and copy it.

TypeSafe charges your account per input token; output is free.

## In Supernala

1. Open **Marketplace → Apps → Jev**, choose **TypeSafe API key** under Ways to connect, and click **Install**.
2. Paste the key and click **Save API key**. Supernala checks it with TypeSafe before saving. The key is encrypted; Bots never see it.
3. Under **Bot access**, choose which Bots can ask Jev and click **Save changes**.

To use it in a workflow, add a **Jev** node and pick this connection.

## If something goes wrong

- **"The service didn't accept these details"**: the key is wrong, revoked, or from another organization. Create a new one and save it.
- **A question is refused or fails**: check that every Choice has at least one option, every Score has 1 to 10 levels, and the content isn't longer than about 64,000 tokens.
