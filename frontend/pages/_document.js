import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

  return (
    <Html lang="en">
      <Head>
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
        {plausibleDomain && (
          <script defer data-domain={plausibleDomain} src="https://plausible.io/js/script.js" />
        )}
      </Head>
      <body>
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
