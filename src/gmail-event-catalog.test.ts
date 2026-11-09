import { expect, it } from "@effect/vitest";
import { gmailEventCatalog } from "./gmail-event-catalog.js";

it("matches the catalog bytes and digest the application stores for Gmail", async () => {
  // Retained by the application's registerReviewedGmailVersion for gmail@0.2.1 in production.
  expect(await gmailEventCatalog("supernala-public:supernala:gmail@0.2.1")).toEqual({
    canonicalJson:
      '{"pluginVersionId":"supernala-public:supernala:gmail@0.2.1","events":[{"version":1,"event":"gmail.message.added","adapter":"gmail-history-v1","payload":"gmail-message-metadata-v1"}]}',
    digest: "2609ada9e66131e236e843df97362bb77d633cdab501a23e87b70e2c6c61df2a",
  });
});
