---
plugin: supernala-public:supernala:google-maps
revision: 1
---

# Set up Google Maps

Google Maps lets your Bots search for places and businesses, get distances and travel times between places, find stops along a route, turn place names and Google Maps links into places, and check weather, air quality and pollen. Bots only read from Google Maps; they cannot change anything in your Google account.

You connect with your own Google Maps API key from Google Cloud. It takes about 10 minutes.

## What you need

- A Google account that can open the [Google Cloud console](https://console.cloud.google.com).
- A way to pay Google, such as a card, for the billing account. Google needs billing turned on even if you stay within the free monthly allowance.

## 1. Pick a Google Cloud project

1. Open the [Google Cloud console](https://console.cloud.google.com).
2. Choose a project from the project picker at the top, or [create a new project](https://console.cloud.google.com/projectcreate), for example "Supernala Maps".

## 2. Turn on billing

1. Open [Billing](https://console.cloud.google.com/billing) with the same project selected.
2. Link the project to a billing account, or create one if you have none.

## 3. Enable the Maps Experience agent tools API

1. Open the [Maps Experience agent tools API](https://console.cloud.google.com/apis/library/mapstools.googleapis.com) page in the API Library, with the same project selected.
2. Click **Enable**.

## 4. Create and restrict an API key

1. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **Create credentials → API key**, and copy the key.
3. Open the new key (click its name or **Edit API key**).
4. Under **API restrictions**, choose **Restrict key** and select **Maps Experience agent tools API**. Leave **Application restrictions** set to **None**, because Supernala calls Google from its servers.
5. Click **Save**. Keep the key private: anyone with it can make requests that are billed to your project.

## In Supernala

1. Open **Marketplace → Apps → Google Maps** and click **Install**.
2. Paste the key into **Google Maps API key** and click **Save API key**. It is encrypted in your Workspace; Bots never see it.
3. Choose which Bots can use Google Maps and click **Save changes**.

Try asking a Bot: "Find three well-rated coffee shops near the Ferry Building in San Francisco", or "How long is the drive from Seattle to Portland tomorrow at 8am?"

## What it costs

Google bills your Cloud project directly at its list price. Supernala doesn't pay for these calls and never sees your Google billing.

- **Essentials** calls: 10,000 free requests a month, then $7 per 1,000.
- **Pro** calls: 5,000 free requests a month, then $14 per 1,000. Every search along a route is Pro. Other calls are Pro when they ask for extended place details, more than 5 places at once (6 to 10), traffic-aware routing, more than 10 stops on a route, pollen, or past air quality.

Bots use the cheaper options unless your request needs more. To cap spending, set quotas for the API under **APIs & Services** or a budget alert under **Billing** in Google Cloud. See [Google's documentation](https://developers.google.com/maps/ai/maps-experience-agent-tools) for current prices.

## If something goes wrong

- **The key is rejected or a call says permission denied**: check that the Maps Experience agent tools API is enabled on the key's project and is listed under the key's **API restrictions**, then paste the whole key again.
- **A call says billing is required**: link the project to a billing account in Google Cloud.
- **A call says a quota was exceeded**: raise the quota for the API in Google Cloud, or wait for it to reset.
- **You want to stop access**: remove the Bot's access in Supernala, or delete the key under **APIs & Services → Credentials** in Google Cloud.
