---
plugin: supernala-public:supernala:meta-ads-token
revision: 1
---

# Set up Meta Ads

Meta Ads lets your Bots work with your Facebook and Instagram ads through Meta's own Ads MCP server: read performance and insights, look through campaigns, audiences, catalogs and pixels, and, when you approve, create campaigns, ad sets, creatives and ads or change them. Reading is allowed by default. Anything that creates, changes, activates or deletes asks you first, because it can spend money. Bots with access also get the **Meta Ads playbook** Skill, which teaches them Meta's rules, such as entering budgets in the right units and never going live without your approval.

You connect with a Meta access token. The steps below create one that does not expire, using a system user in your business. It takes about 15 minutes, and Meta's App Review is not needed for your own ad accounts.

## What you need

- A Meta Business portfolio (Business Manager) where you are an **admin**, with the ad accounts you want your Bots to use.
- A Facebook account that can open [Meta for Developers](https://developers.facebook.com/apps).

## 1. Create a Meta app

1. Open [Meta for Developers → My Apps](https://developers.facebook.com/apps) and click **Create App**.
2. Enter an app name, such as "Supernala Ads", and keep your contact email. Click **Next**.
3. Under **Ads and monetization**, choose **Create & manage ads with ads MCP server**, then click **Next**.
4. Connect the app to the business portfolio that owns your ad accounts, then click **Next**.
5. On **Publishing requirements** Meta should show that there are no requirements. Click **Next**, then **Create App**, and enter your Facebook password if asked.

Open the app's **Use cases → Customize**: `ads_mcp_management`, `ads_read`, `ads_management` and `business_management` should be listed as **Ready for testing**. That is all your own business needs; you do not publish the app.

## 2. Create a system user

1. Open [Business settings](https://business.facebook.com/settings) for the same business portfolio.
2. Go to **Users → System users** and click **Add**.
3. Name it, for example "Supernala Bots", and choose the role **Employee**. Meta's Ads MCP server refuses tokens from **Admin** system users.
4. Click **Assign assets**. Select the **ad accounts** your Bots may use and give **Manage ad account** (or **View performance** only, for reporting). Add your **Pages**, **Instagram accounts** and **catalogs** too if Bots should run ads with them or manage products.
5. Under **Users → System users**, select the system user, click **Add assets** if you skipped it, then make sure your new Meta app is listed under **Apps** (use **Assign assets → Apps** to add it with full control if it is not).

## 3. Generate the token

1. With the system user selected, click **Generate new token** (or **Generate token**).
2. Choose your new Meta app.
3. Set **Token expiration** to **Never**.
4. Select these permissions: `ads_mcp_management`, `ads_read` and `ads_management`. Add `business_management`, `pages_show_list`, `instagram_basic` and `catalog_management` if Bots should see your Pages and Instagram accounts or manage catalogs.
5. Click **Generate token** and copy it. Meta shows it only once. Keep it private: anyone with it can manage the ad accounts you assigned.

## In Supernala

1. Open **Marketplace → Apps → Meta Ads** and click **Install**.
2. Paste the token into **Meta access token** and click **Save API key**. It is encrypted in your Workspace; Bots never see it.
3. Choose which Bots can use Meta Ads and what each may do, then click **Save changes**. Leave creating, changing and activating on **Ask** unless you are sure.

Try asking a Bot: "List my ad accounts", or "Summarize my top-spending campaigns in the last 30 days".

## Keep spending under control

- New campaigns, ad sets and ads start **paused** (or as a draft in Ads Manager). They spend only after a Bot activates them, and activating always asks you unless you allowed it.
- In Business Suite you can add **Ads MCP server rules** for an ad account, for example deny budget increases above 20%, deny delivery status changes, or deny all agent actions. Meta enforces them for every AI agent, including your Bots.
- Assign the system user only the ad accounts Bots should touch. **View performance** access keeps a Bot to reporting.

## If something goes wrong

- **"Authentication Required" or the token is rejected**: copy the whole token again. Make sure it was generated for an **Employee** system user with `ads_mcp_management` and `ads_read` or `ads_management`.
- **A Bot finds no ad accounts**: the system user has no ad accounts assigned. Assign them under **Users → System users → Assign assets**.
- **A tool says a permission is missing**: generate a new token with the missing permission, for example `catalog_management` for catalogs or `pages_show_list` for Pages, and paste it in **Marketplace → Apps → Meta Ads**.
- **A change is refused by a rule**: an Ads MCP server rule in Business Suite blocked it. Change the rule there if the change should be allowed.
- **You want to stop access**: remove the Bot's access in Supernala, or revoke the token in Business settings under the system user.
