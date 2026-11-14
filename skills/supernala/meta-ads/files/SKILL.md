---
name: meta-ads
description: How to run Meta (Facebook and Instagram) ads safely through the Meta Ads app — reporting, campaigns, ad sets, creatives, ads, audiences, catalogs, pixels and experiments — without spending money the Owner did not approve. Load before any Meta Ads tool that creates, edits, activates or deletes something.
license: LicenseRef-Supernala
---

# Meta Ads playbook

You reach Meta's Ads MCP server through the Owner's Meta Ads app (`plugins["meta-ads-token"]` in Code Mode). Reads run freely; every create, edit, activate and delete waits for the Owner's approval unless they allowed it. Meta's tools carry far more guidance than their short Supernala descriptions, so follow this playbook and use `ads_get_field_context` or `ads_get_help_article` whenever a field or rule is unclear.

## Money rules (never break these)

1. **Never invent a budget, bid or schedule.** Use only amounts and cadence the Owner stated in this conversation. A monthly figure ("$2,000/month") is neither daily nor lifetime: ask which they want. If unclear, ask and wait; do not stage an assumed value "for confirmation".
2. **Budgets and bids are in the ad account currency's smallest unit** (cents for USD, so $50.00 is `5000`). Read the account's currency with `ads_get_ad_accounts` first. If you are unsure how the account's currency is expressed, check `ads_get_field_context` before sending an amount.
3. **Create everything paused or as a draft, then activate only with explicit approval.** `ads_create_campaign`, `ads_create_ad_set` and `ads_create_ad` create PAUSED objects (or stage drafts). `ads_activate_entity` starts spending: call it only after the Owner said to go live and has seen what will run.
4. **Pausing is `ads_update_entity` with `status=PAUSED`.** Never call `ads_activate_entity` to "confirm" a pause.
5. **Budget increases are the riskiest edit.** State the old and new budget in plain currency before calling `ads_update_entity`, and verify after.
6. **Do not delete to undo.** Prefer pausing. Deleting campaigns, creatives, audiences, feeds or pixel events cannot be reversed.

## Standard workflow

1. **Find the account.** `ads_get_ad_accounts` → pick the ad account (`act_…`) with the Owner; note currency and timezone. `ads_get_ad_account_pages` and `ads_get_ig_accounts` give the Page and Instagram identities ads run as.
2. **Understand before changing.** Use `ads_get_ad_entities` (campaigns, ad sets, ads, with `fields` and `effective_status`), and the insights tools (`ads_insights_performance_trend`, `ads_insights_performance_vs_peers`, `ads_insights_anomaly_signal`, benchmarks) for reporting. `ads_get_opportunity_score` gives Meta's recommendations.
3. **Campaign.** `ads_create_campaign` with an ODAX objective (`OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_SALES`, `OUTCOME_APP_PROMOTION`). Default to campaign budget (CBO) unless the Owner asks to budget per ad set (ABO); never set budgets in both places.
4. **Ad set.** `ads_create_ad_set` under the campaign, using only an `optimization_goal` from the campaign response's `valid_optimization_goals`. Meta recommends Advantage+ Audience: omit `targeting_automation` unless the Owner gave a real reason to turn it off (see tool notes).
5. **Creative.** Upload media (`ads_creative_upload_media`, or `ads_create_upload_url` + `ads_finalize_upload` for large files), then `ads_create_creative` with the Page (and Instagram account) identity and the right call to action.
6. **Ad.** `ads_create_ad` under the ad set with the creative.
7. **Check, then ask.** Read back with `ads_get_ad_entities` (in draft mode use `object_state=draft`) and fix any `active_errors` with `ads_update_entity`. Summarise what will run — objective, audience, budget in plain currency, schedule, creative — and ask for approval.
8. **Go live only on approval.** `ads_activate_entity` (in draft mode on the campaign; live objects top-down). Activation returns ACTIVE or PUBLISHING; verify with a read, report the result, and mention that parents must be active for delivery.

## Draft mode

Some accounts stage new campaigns in the Ads Manager draft instead of creating them live (responses say `status=DRAFT`). Nothing spends until the campaign is published with `ads_activate_entity`. Fix blocking `active_errors` first; publishing refuses while any remain.

## Reporting tips

- Ask for exact date ranges in the account's timezone; say which timezone you used.
- Return only the fields the Owner needs; large reads can be narrowed with `fields`, levels and filters.
- `ads_get_async_result` collects results of long-running work by `job_id`; it waits up to about 25 seconds per call.

## Account guardrails the Owner can set

Meta lets business admins add Ads MCP rules in Business Suite (ads MCP server settings): for example deny budget increases above 20%, deny status changes, or deny all agent actions on an account. If a write is refused by such a rule, tell the Owner which rule blocked it; never try to work around it.

## Tool notes from Meta

The notes below are Meta's own guidance for the most involved tools, shortened. When in doubt, Meta's server enforces the full rules and `ads_get_field_context` explains a field.

### `ads_create_campaign`

Creates a single campaign (campaign group) in PAUSED state. Use this to create just a campaign without an ad set or ad. 

BUDGET PLACEMENT — DEFAULT TO CBO: Unless the advertiser explicitly requests ad-set-level budgeting (ABO), put their stated budget at campaign level (CBO). CBO controls where the budget is allocated; it does not determine the amount or cadence.

BUDGET AMOUNT AND CADENCE — DO NOT INFER: Set campaign_daily_budget only when the advertiser states a daily amount, and campaign_lifetime_budget only when they state a total campaign budget. Pass every budget value in the ad account currency's smallest unit (for example, cents for USD). A periodic amount such as "$2,000/month" is neither. If the amount or cadence is unclear, ask and wait before calling this tool; do not stage an assumed value for confirmation.

CBO (Campaign Budget Optimization): Pass campaign_daily_budget OR campaign_lifetime_budget here. campaign_bid_strategy defaults to LOWEST_COST_WITHOUT_CAP if omitted; pass it explicitly for COST_CAP, LOWEST_COST_WITH_BID_CAP, or LOWEST_COST_WITH_MIN_ROAS. Under LOWEST_COST_WITH_MIN_ROAS, pass bid_constraints with roas_average_floor on every ads_create_ad_set call for the campaign. ABO (Ad Set Budget Optimization): Leave campaign_daily_budget, campaign_lifetime_budget, AND campaign_bid_strategy unset on this call, then pass daily_budget / lifetime_budget on the subsequent ads_create_ad_set call. Only use ABO if the advertiser specifically asks to control budget per ad set. Setting any campaign-level budget field implicitly switches the campaign to CBO; if the advertiser asked for ABO, do NOT set them.

ENFORCED: ads_create_ad_set pre-validates this and will reject calls that pass daily_budget or lifetime_budget under a CBO parent campaign.

VERIFY THE RESULT: After a successful create, call `ads_get_ad_entities` with the returned campaign ID in `object_ids`, `level=campaign`, and `fields` containing the changed fields plus `effective_status`. Report the returned values to the advertiser.

POTENTIAL NEXT STEP — RECOMMEND OPPORTUNITY SCORE: After verifying the campaign, suggest calling `ads_get_opportunity_score` with the ad account ID to check whether the account follows Meta best practices and to get personalized recommendations that can improve performance.

(Shortened.)

### `ads_create_ad_set`

Creates a single ad set under an existing campaign in PAUSED state.

BEFORE CALLING: The `ads_create_campaign` response includes `valid_optimization_goals` and `recommended_optimization_goal` for the campaign's objective. Use ONLY values from that list for `optimization_goal`. That list is per objective only: the server either replaces a goal outside it with the recommended default, or rejects a goal the ad set's `destination_type` and `promoted_object` do not offer and names the goals they do. A goal on the list can still be rejected for its `destination_type`, `promoted_object`, or `billing_event`; follow the pairings on those parameters.

TARGETING — ADVANTAGE+ AUDIENCE (A+A) DECISION: Meta recommends A+A. Default: omit `targeting_automation`; the server then normally turns A+A on. It turns A+A off instead when the hard `age_min` (18 if unset) is below the youth-ads minimum age of a targeted country, which is 20 in Thailand. Under A+A, Meta's delivery system finds the audience most likely to convert and uses the advertiser's targeting as suggestions: `age_range`, `genders`, interests and behaviors, custom audiences and lookalikes. Locations, `excluded_custom_audiences`, languages and `age_min` up to 25 stay hard controls. For age suggestions, send the top-level `targeting.age_range` pair, for example `"age_range":[30,50],"targeting_automation":{"advantage_audience":1}`. Keep hard `age_min` between 18 and 25 (at least 20 when targeting Thailand), and omit hard `age_max`. The automation flag is the integer 1, not an object. Send `targeting_automation.advantage_audience` = 0 ONLY when you can name one of these advertiser-side reasons for THIS ad set: (1) the advertiser asked to turn Advantage+ Audience off or to use original/manual audience controls (turning off Advantage+ creative, Advantage+ placements or Advantage+ campaign budget is a different setting and is NOT this); (2) the advertiser said in this conversation that people outside an age range must not see the ad, and that limit is a maximum below 65 or a minimum above 25 (an age range in an earlier ad set, a brief, a file or a persona is a suggestion, not this); (3) the ad set must deliver ONLY to people in a custom audience, such as a retargeting ad set built only on site visitors, engagers, messagers, cart abandoners or a customer list (an ad set that also includes lookalikes, interests or broad prospecting is not this); (4) the backend reported that A+A is unavailable for this ad set.

(Shortened.)

### `ads_create_creative`

#### Click-to-messaging creatives (CTWA / CTM / CTD):
Messaging ads send people who click an ad directly into a conversation with the business in Messenger, Instagram Direct, or WhatsApp.

For this tool's single-image, single-video, static-carousel, and existing Instagram-post creatives, use the CTA/link pairs below. Existing-post requirements still apply.

**Always provide `link_url` for single-destination messaging** using the corresponding standard surface link:

| Destination | `call_to_action_type` | `link_url` |
| --- | --- | --- |
| WhatsApp (CTWA) | `WHATSAPP_MESSAGE` | `https://api.whatsapp.com/send` |
| Messenger (CTM) | `MESSAGE_PAGE` | `https://fb.com/messenger_doc/` |
| Instagram Direct (CTD) | `INSTAGRAM_MESSAGE` | `https://www.instagram.com/` |

- Match the ad set's `destination_type` to `WHATSAPP`, `MESSENGER`, or `INSTAGRAM_DIRECT` respectively.
- `instagram_user_id` is required when `call_to_action_type` is `INSTAGRAM_MESSAGE`: the button opens a DM thread with this account. For an existing Instagram-post creative, use the account that owns the post.
- For a single-destination messaging carousel, use the same messaging CTA at the top level and on every card. Set `link_url` and each card's `link` to that app's standard surface URL, matching the ad set's `destination_type`.
- WhatsApp setup belongs to the Page or linked Instagram account, not to `link_url`. A verified WhatsApp Business number must be linked before the ad can run. If activation reports that the number must be reconnected, guide the advertiser to link and verify it, then retry activation rather than recreating the creative.
- When returned, `click_to_messaging_destination` reports the destination explicitly applied by the tool. Compare it with the ad set's destination. Its absence does not establish that messaging is unavailable.


Creates an ad creative on the specified ad account. Supports these formats: single-image, single-video, Placement Asset Customization (PAC), multi-media optimization (MMU), Advantage+ catalog carousel, static carousel (manually specified cards), boosted post (an existing organic Page post), Instagram post (an existing organic Instagram post), Facebook Partnership Ads from existing posts, and Instagram Partnership Ads built from new media. This tool does not set a creative-level welcome message, so the Page's default greeting applies.

#### Required fields by format:

**Image ads:**
- `ad_account_id`, `page_id`, `link_url` (`link_url` is not required with `lead_gen_form_id` — see below)
- One of `image_hash` or `image_url` (the ad image; never both)

(Shortened.)

### `ads_create_ad`

Creates a single ad under an existing ad set in PAUSED state. There is no status input: to make the ad live, create it, then call ads_activate_entity on it. Read the ad set's status and effective_status with ads_get_ad_entities first: the ad set must not be DELETED or ARCHIVED; otherwise use another ad set.

DRAFT MODE: Draft mode applies only when the target ad account is eligible for it, and you cannot tell which mode applies before the call. When copying an ad with source_ad_id: if the source ad exists only in the Ads Manager draft (status=DRAFT), pass source_ad_id alone; the tool copies its creative. Otherwise, also pass the source ad's creative as {"creative_id":"<CREATIVE_ID>"}: non-draft mode requires it, and draft mode accepts it. After the call, status=DRAFT means the ad was staged, not created live. In draft mode this tool stages the ad in the account's Ads Manager draft under the given ad set and returns status=DRAFT with the allocated ad_id; nothing is created until you publish that campaign with ads_activate_entity on the campaign, and published objects go live ACTIVE. Any validation errors are surfaced in active_errors; after each create or edit, check active_errors (or read them with ads_get_ad_entities object_state=draft) and fix any blocking errors with ads_update_entity before calling ads_activate_entity, which refuses to publish while any object still has a blocking validation error. In non-draft mode the ad is created live and PAUSED.

### `ads_activate_entity`

Activates a live campaign, ad set or ad, or publishes staged edits when draft publishing is enabled. Live activation sets ACTIVE and can start spending; draft publication preserves staged status unless publish_as_active requests activation.

#### When to use:
- Only after explicit approval to activate/publish and review of the changes.
- Activate live entities individually, top-down; parents do not activate children.

#### When NOT to use:
- Never call without explicit approval.
- To pause, use ads_update_entity with status=PAUSED. If it returns is_draft=false, do not call this tool to commit/verify the pause: it can undo it or publish unrelated edits. Verify with ads_get_ad_entities.

#### What it returns:
Returns JSON in result with account/entity IDs, type and status. Report the entity ID, type and new status. When activating a child, remind the user its parents must also be ACTIVE for delivery.
Live activation returns ACTIVE; draft publication returns PUBLISHING, an asynchronous handoff, not proof of publication or delivery. Follow verification_hint when present; confirm only live read-back changes, not draft disappearance or configured ACTIVE alone. If unverified, report pending/unavailable and offer Ads Manager. For validation errors, relay the object errors, fix with ads_update_entity and retry; ignore_validation_errors needs user approval to skip broken objects.
After verified activation, suggest ads_get_opportunity_score for recommendations.

#### Draft mode:
Read ads_get_ad_entities with object_state=draft for ad_object_id and active_errors; fix any blocking errors before publishing. Use object_ids for exact staged objects, including unpublished parents and their staged descendants; allow_partial_publish=true needs subset approval. Without object_ids, a staged campaign publishes its subtree and a live child its staged edit; a new child whose parents are all live publishes its subtree. Use publish_as_active only for approved activation. Verify live read-back; never retry solely for delays.

### `ads_update_entity`

Updates fields on an existing campaign, ad set, or ad.
Use one complete numeric entity_id from ads_get_ad_entities, not a name, placeholder, combined IDs, or a suffixed ID.
Send fields as a JSON-encoded object, not null, a scalar, or a non-empty array. Correct invalid input instead of retrying it unchanged.

#### When to use:
- Call this tool when the user wants to modify an existing ad entity.
- Use for changing name, budget, targeting, schedule, or other fields.

#### When NOT to use:
- Do NOT use for creating new entities. Use ads_create_campaign, ads_create_ad_set, or ads_create_ad instead.
- Do NOT use for activating/publishing. Use ads_activate_entity instead.
- Do NOT edit before checking state: first read the entity and its parent with ads_get_ad_entities, requesting status and effective_status.
- Do NOT edit an ARCHIVED or DELETED campaign, ad set or ad, including name, budget, status or delete. Archived and deleted campaigns, ad sets and ads are read-only. Archiving or deleting can't be undone. Duplicate the archived or deleted object or create a new one.
- Do NOT use to change an ad's creative (media, primary text, headline, call to action, or which creative it uses) outside draft mode: there `creative` and `creative_id` are rejected with error_category=VALIDATION. Ad creatives themselves are immutable; to show different creative on a live ad, create a new ad with ads_create_ad that references the creative_id (create the creative first with ads_create_creative if it doesn't exist), then pause the old ad. Draft mode may allow replacing a staged ad's creative; see the draft mode section when present. Turning Advantage+ creative enhancements on or off is also done here, on the ad (see below).
- Do NOT change a campaign's objective to a legacy value. Objective is chosen at creation; if you set it here it must be an ODAX outcome (OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_APP_PROMOTION). Legacy objectives (LINK_CLICKS, APP_INSTALLS, CONVERSIONS, REACH, etc.) are rejected with error_category=VALIDATION.

#### Field names:
`fields` takes Ads API field names, which are NOT the argument names the ads_create_* tools take. Never carry a create-tool argument name over into an update:
- campaign: use `name`, `daily_budget`, `lifetime_budget`, `bid_strategy`, `spend_cap`, `start_time`, `stop_time` — NOT campaign_name, campaign_daily_budget, campaign_lifetime_budget, campaign_bid_strategy, campaign_spend_cap, campaign_start_time, campaign_stop_time.
- ad set: use `name` — NOT ad_set_name.
- ad: use `name` — NOT ad_name.
Unrecognized field names are rejected with error_category=VALIDATION, as is any attempt to reparent (campaign_id on an ad set, adset_id on an ad).

(Shortened.)

### `ads_create_custom_audience`

Creates a custom audience under an ad account. Supported subtypes are CUSTOM
(customer list), WEBSITE, ENGAGEMENT, MOBILE_APP, and LOOKALIKE.

#### When to use

Use this tool only to create a new custom audience.

- Customer-list membership changes are not supported by Ads MCP. Use Ads
Manager > Audiences.
- Use ads_update_custom_audience to modify an existing audience.
- Use ads_delete_custom_audience to delete an audience.

#### Ads Manager guidance

To add users to an existing customer-list custom audience:

1. Go to Audiences in Ads Manager.
2. Select the customer-list audience, select Edit, then choose Add customers.
Replace customers and Remove customers are also available.
3. Upload a file or paste the updated list. Include identifiers such as email
or phone number and, for a value-based list, the customer-value column.
4. Select Next and map the identifiers. Fix incorrectly mapped identifier
formatting before continuing.
5. Select Import and Create, then select Done or a suggested next step after
the upload confirmation appears.

The update may take a few hours, but ads using the audience continue to run.
Check its status in Audiences; if it has not updated after a few hours, check
the file and try again. Replace customers replaces the entire existing list;
use Add customers to keep existing users. Membership changes flow through to
ad sets and lookalike audiences that use the audience. Website custom audiences
add people automatically from matching Meta Pixel activity and need no manual
upload.

#### Subtype requirements

### CUSTOM

- Requires customer_file_source.
- Creates an empty audience. Guide the user to populate its customer list in
Ads Manager > Audiences.
- Set is_value_based=true only when uploaded rows will include customer values.
- retention_days must be between 1 and 180.

### WEBSITE

- Requires rule with a "pixel" event source and pixel ID. If the pixel ID is
unknown, use ads_get_datasets.
- The audience populates automatically from pixel events.
- Supported templates include ALL_VISITORS for all website visitors,
VISITORS_BY_URL for URL or event filters, and TOP_TIME_SPENDERS for
percentile-based time-spent audiences.
- For all visitors, use a URL "i_contains" filter with an empty value. Do not
use a PageView event filter.

### ENGAGEMENT

(Shortened.)

### `ads_boost_ig_post`

Creates an Instagram ad from an existing IG post. Supports a plan/confirm two-step flow.

Required: ad_account_id, ig_account_id, and ig_media_id unless another field already identifies the post. That is enough for a simple profile boost; other goals can require a promoted_object naming a page, pixel, conversion, or application. For full control, override campaign (L3), ad set (L2), or ad (L1) fields using compatible combinations.

#### When to use:
- Call with confirmed=false FIRST to get a plan showing all resolved settings.
- Call with confirmed=true ONLY after the user has reviewed and approved the plan.
- For an ordinary boost, use after ads_get_ig_accounts and ads_get_ig_media to get the required IDs.

#### When NOT to use:
- Do NOT call with confirmed=true without first showing the user the plan.
- Do NOT use for creating regular (non-IG-boost) ad campaigns — use ads_create_campaign instead.

#### Response Guidelines:
1. In plan mode: Show all resolved settings across L3/L2/L1, including defaults.
2. In creation mode: Return all created entity IDs and confirm PAUSED state.
3. Remind user they can activate with ads_activate_entity when ready.

#### Call to action:
- Use call_to_action_type plus the optional call_to_action_value object. Don't use call_to_action field; it's deprecated.
- Website CTAs (LEARN_MORE, SHOP_NOW, WATCH_MORE, CONTACT_US, BOOK_NOW, SIGN_UP, SEE_DETAILS) need call_to_action_value.link.
- VIEW_INSTAGRAM_PROFILE links to the boosting account's profile automatically.
- Messaging CTAs build their destination automatically and need the matching destination_type: INSTAGRAM_MESSAGE with INSTAGRAM_DIRECT, WHATSAPP_MESSAGE with WHATSAPP (the account must have a linked WhatsApp Business number), MESSAGE_PAGE with MESSENGER.
- Without call_to_action_type the ad uses VIEW_INSTAGRAM_PROFILE, even when destination_type is a messaging destination. Pass the matching messaging CTA to get a message button.
- To learn more about Instagram ad goals and their CTAs, see https://www.facebook.com/business/help/1058474831011088.
- For every call to action type Meta supports, see https://www.facebook.com/business/help/410873986524407. This tool accepts only the call_to_action_type enum values.

(Shortened.)

### `ads_pixel_event_create`

Creates Meta Pixel conversion event rules. Batch-capable.

AUTH: requires either the `ads_management` or `business_management` granular OAuth scope on the caller's token (and the server-level 1P capability gate).

INPUT: `items=[{pixel_id, event_type, rule_type, match_value, operator?, domain_uri, parameters?: [{parameter_type, extractor_type, extractor_config_json}]}]`. Pair events with parameters to capture conversion data (Purchase: value+currency; AddToCart: content_ids; Lead: content_name) — embed inline here for atomic event+param create, or add later via ads_pixel_parameter_create. An event without parameters fires but captures no data. `event_type` must be a Meta standard event (see STANDARD EVENTS below). `rule_type=TOKENIZED_BUTTON_TEXT` for button-click events; `rule_type=URL` for page-load events. For embedded `parameters[]`, the selector primer lives in the ads_pixel_parameter_create description — apply the same rules here.

WHEN TO CALL DIRECTLY: if the caller's request already includes `pixel_id`, `event_type`, and `match_value` (or all required event-creation fields), call this tool DIRECTLY — do NOT call ads_pixel_event_read or ads_pixel_parameter_read first to inspect existing state. The user's explicit creation request IS their intent; do not ask for confirmation before creating.

MULTI-STEP REQUESTS: when the user's prompt chains operations ("create event X then activate it", "set up event X then add a CSS extractor for Y", "create then activate immediately"), call all required tools in the SAME turn without pausing for confirmation between steps. After ads_pixel_event_create, immediately call ads_pixel_event_update with `status=ACTIVE` if the user asked to activate, and/or ads_pixel_parameter_create if the user asked to add an extractor. The chained request IS the user's complete intent.

BEHAVIOR: created events default to `status=INACTIVE` — call ads_pixel_event_update to activate. Default fail-fast on first item error; pass `partial:true` to collect per-item errors. Returns `results[]` with success/error/event per input item.

(Shortened.)
