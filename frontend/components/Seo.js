import Head from "next/head";

export default function Seo({ title, description, path, type = "website", image, jsonLd }) {
  const missing = [!title && "title", !description && "description"].filter(Boolean);
  if (missing.length > 0) {
    const message = `<Seo> is missing required prop(s): ${missing.join(", ")}.`;
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
