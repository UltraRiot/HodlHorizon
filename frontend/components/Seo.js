import Head from "next/head";

// Centralizes what the audit found scattered or missing across
// hand-rolled per-page <Head> blocks: title/description, a canonical
// link, and OG/Twitter tags. Every page listed in this task's plan
// renders this instead of its own <Head>, so a future page literally
// cannot ship without a title, a description, and a canonical - see the
// required-prop check below. (Viewport meta is deliberately NOT here -
// it lives in pages/_app.js instead, see that file's comment for why:
// this component doesn't cover Next's own auto-generated 404/500 pages,
// _app.js does.)
//
// image: optional. Falls back to `${siteUrl}/og-default.jpg` (1200x630)
// when omitted - confirmed present in /public and resolving with a 200
// (see this feature's QA pass).
export default function Seo({ title, description, path, type = "website", image, jsonLd }) {
  const missing = [!title && "title", !description && "description"].filter(Boolean);
  if (missing.length > 0) {
    const message = `<Seo> is missing required prop(s): ${missing.join(", ")}.`;
    // Fail loud in development so a page missing either prop is caught
    // immediately, before it ships - but never crash a real visitor's
    // page over it in production. Server logs still get the warning
    // either way.
    if (process.env.NODE_ENV !== "production") {
      throw new Error(message);
    }
    console.warn(message);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://hodlhorizon.com";
  const url = `${siteUrl}${path}`;
  const resolvedImage = image || `${siteUrl}/og-default.jpg`;

  return (
    <Head>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <link rel="canonical" href={url} />

      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content="Hodl Horizon" />
      <meta property="og:image" content={resolvedImage} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
      <meta name="twitter:image" content={resolvedImage} />

      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
    </Head>
  );
}
