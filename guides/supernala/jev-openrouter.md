---
plugin: supernala-public:supernala:jev-openrouter
revision: 2
---

# Set up Jev with an OpenRouter API key

Jev is TypeSafe's decision model, also served through OpenRouter's Decisions API. It answers typed questions about content (pick one option, score against levels, or how likely a yes/no statement is true) with calibrated probabilities, in about a tenth of a second. Bots and workflows use it to classify, route, triage and screen. It never writes text. This takes about 3 minutes.

## Get your API key

1. Sign in to [OpenRouter](https://openrouter.ai) and open **Keys**.
2. Create a key and copy it. Make sure the account has credits.

OpenRouter charges your account for each call (Jev input tokens are about $0.04 per million).

## In Supernala

1. Open **Marketplace → Apps → Jev**, choose **OpenRouter API key** under Ways to connect, and click **Install**.
2. Paste the key and click **Save API key**. Supernala checks it with OpenRouter before saving. The key is encrypted; Bots never see it.
3. Under **Bot access**, choose which Bots can ask Jev and click **Save changes**.

To use it in a workflow, add a **Jev** node and pick this connection. Use the model `typesafe/jev-1.14`; OpenRouter does not accept the `typesafe/jev-latest` alias.

## If something goes wrong

- **"The service didn't accept these details"**: the key is wrong or revoked. Create a new one and save it.
- **Calls fail with a payment error**: add credits to your OpenRouter account.
- **A question is refused or fails**: check that every Choice has at least one option and every Score has 1 to 10 levels.
