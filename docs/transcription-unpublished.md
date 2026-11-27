# Transcription suite: temporarily unpublished

For the store drop, the suite page is temporarily redirected to the store and its
links are removed from the home, course, dashboard and store navigation. The
suite source, catalog, uploads, admin editor, sales records, webhook and
reconciliation code remain intact. The redirect is not an access-control or
privacy mechanism: static assets, the starter catalog and public APIs may still
be accessed directly. Sales remain separately disabled by configuration.

To release later, remove the three temporary transcription redirects from
`vercel.json` and the matching local dev redirect, restore the navigation links
(including the store generator and generated HTML), update the admin notice and
navigation tests, and deploy. Check product permissions, prices, sales setup and
end-to-end functionality separately before enabling PDF sales.
