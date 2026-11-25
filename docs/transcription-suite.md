# Transcription Suite content guide

The suite is at `/transcription/`. Use the **Transcription Suite** tab in Armonía Admin to edit images, products, the featured piece, videos, and the performance journal. Save all changes to publish. The authenticated API stores the configuration in the existing `site_content` table, with stale-write protection. `public/transcription/catalog.json` supplies the example starter collection only until the first save. If the database is unavailable, the collection shows an error instead of silently reverting to examples.

## Compositions

Expand each example in the admin editor to replace it, or remove it and add your actual entries. Give each a unique, stable `id`, `title`, `artist`, `instrument`, `description`, and `cover` URL. Set `sample` to `false` only for real pieces. `featuredId` should match the ID of the piece to feature. Available filter categories are `Vihuela`, `Guitarra`, `Guitarrón`, and `Ensemble` (additional instruments still appear under All). Put cover images you have permission to use in `public/transcription/images/` and reference them as `/transcription/images/filename.jpg`, or use an HTTPS URL.

Optional `previewUrl` opens a public preview in a new tab; use only material you have permission to share. Optional `priceLabel` is descriptive text. Optional `checkoutUrl` must be an HTTPS link to an independently configured checkout; the suite does not create a checkout, process payments, deliver files, validate links, or verify that a purchase is fulfilled. Do not add a checkout link until its pricing, licensing, payment, and delivery have been independently configured and tested. A public file placed in `public/` is accessible to everyone and must not be used as a protected paid download.

## Performance journal

Add entries through the Performance journal section in admin. The underlying format is:

```json
{"title": "Performance title", "label": "GROUP NAME", "url": "https://example.com/your-video"}
```

The suite links out to HTTPS video URLs; it does not host videos. Only add real videos you are authorized to share. An empty array shows the placeholder message.

## Contact and saved pieces

The request form opens a pre-addressed email in the visitor's email app; it does not transmit a message itself. Visitors must send it in their email app. A direct email address is shown as a fallback. Saved pieces are stored locally in the visitor's browser and are not an account, shopping cart, or order. The site cannot guarantee email delivery.

The editorial instrument image is AI-generated and is illustrative, not an actual album cover or recording. Replace the sample images and entries with approved real assets before presenting the catalog as real inventory.

## Motion and embedded videos

The site includes an illustrated screening-room placeholder and background imagery. The stage and instrument editorial images are AI-generated illustrations, not actual venues or performances. The motion control pauses decorative animations and background video; the site also respects the device's reduced-motion preference.

In the admin image and video sections (stored in the `media` object):

- `screeningYoutubeUrl` accepts a YouTube HTTPS URL (watch, youtu.be, shorts, live, or embed) or an 11-character YouTube video ID. Add `screeningTitle` and `screeningDescription` for the main screening room. The YouTube player is loaded only after the visitor presses play.
- `heroBackgroundImage` and `screeningBackgroundImage` accept site-relative or HTTPS image URLs to replace the illustrative backgrounds.
- `heroBackgroundVideo` accepts an HTTPS URL or a site-relative URL to a video file (such as an MP4). It is decorative, muted, and looping; autoplay may be blocked by the browser and reduced-motion visitors see the image fallback. Do not put a YouTube page URL here. Keep video sizes reasonable and use media you are authorized to publish.

For real pieces, optional `level`, `key`, `duration`, and `parts` text fields appear in the piece details. Optional `scorePreviewImage` displays an image of a score excerpt, and `youtubeUrl` adds a play-on-click YouTube performance inside the piece preview. The existing `previewUrl` remains available for a separate score or file link. Never publish a complete paid score in the public folder unless it is intended to be freely accessible. News entries with YouTube URLs also get an inline, click-to-load player; other HTTPS video links open in a new tab. YouTube embedding can be disabled by a video's owner, so verify each actual video in a deployed site. No example videos or scores are included.


Images uploaded through admin use the existing public `site-images` bucket and are limited to 3 MB per image in this editor. Uploading alone does not publish a change: click Save all changes. Uploaded files remain in storage after replacing/removing them. The editor supports URLs for videos and public preview files; it does not upload video files or protect paid downloads. Concurrent admin saves are checked against the last loaded version, so reload if you receive a conflict. The public catalog is only available when the configured database is reachable.
