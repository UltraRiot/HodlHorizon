import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

  return (
    <Html lang="en">
      <Head>
        {/* Not viewport - Next.js explicitly warns against a viewport
            meta tag here (https://nextjs.org/docs/messages/no-document-viewport-meta):
            _document.js only renders once for the initial SSR shell, so it
            can't be trusted for client-side navigation. That tag lives in
            pages/_app.js instead, which wraps every page (including
            Next's own auto-generated 404/500) on every navigation. */}
        <meta name="theme-color" content="#0b1220" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700&family=Work+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Cookieless analytics - only loads if you set NEXT_PUBLIC_PLAUSIBLE_DOMAIN.
            No cookie banner needed because it collects no personal data. */}
        {plausibleDomain && (
          <script defer data-domain={plausibleDomain} src="https://plausible.io/js/script.js" />
        )}
      </Head>
      <body>
        {/* Runs synchronously before Main/NextScript hydrate, so <html>
            already has the right data-theme by the time anything paints -
            the standard fix for a flash of the wrong theme on load.
            Can't import lib/theme.js here (this has to be a plain string
            that runs before any bundle loads) - keeps its own literal copy
            of the same key/fallback logic instead. If THEME_STORAGE_KEY in
            lib/theme.js ever changes, update the literal "hodlhorizon-theme"
            below to match. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function () {
              try {
                var stored = localStorage.getItem("hodlhorizon-theme");
                var theme = stored === "light" || stored === "dark"
                  ? stored
                  : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
                document.documentElement.setAttribute("data-theme", theme);
                var meta = document.querySelector('meta[name="theme-color"]');
                if (meta) meta.setAttribute("content", theme === "light" ? "#f6f7fa" : "#0b1220");
              } catch (e) {
                document.documentElement.setAttribute("data-theme", "dark");
              }
            })();`,
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
