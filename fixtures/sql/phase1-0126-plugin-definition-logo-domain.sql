-- Marketplace releases declare a provider logo domain; the application renders it only through
-- its fixed logo proxy, so the column holds a bare lowercase hostname, never a URL.
ALTER TABLE plugin_definitions ADD COLUMN logo_domain TEXT CHECK (
  logo_domain IS NULL OR (
    length(logo_domain) BETWEEN 4 AND 253
    AND logo_domain NOT GLOB '*[^a-z0-9.-]*'
    AND instr(logo_domain, '.') > 1
    AND logo_domain NOT LIKE '%.'
    AND logo_domain NOT LIKE '%..%'
  )
);

-- Backfill curated definitions published before releases could declare a logo; other slugs keep NULL.
UPDATE plugin_definitions
SET logo_domain = CASE plugin_slug
  WHEN 'atlassian' THEN 'atlassian.com'
  WHEN 'github' THEN 'github.com'
  WHEN 'gmail' THEN 'gmail.com'
  WHEN 'gmail-send' THEN 'gmail.com'
  WHEN 'linear' THEN 'linear.app'
  WHEN 'maple' THEN 'maple.dev'
  WHEN 'notion' THEN 'notion.so'
  WHEN 'resend' THEN 'resend.com'
  WHEN 'resend-api' THEN 'resend.com'
END
WHERE marketplace_id = 'supernala-public'
  AND publisher_namespace = 'supernala'
  AND logo_domain IS NULL;
