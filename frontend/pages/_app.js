import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return (
    <>
      {/* The one sitewide viewport tag - see pages/_document.js's comment
          for why it lives here and not there. _app.js wraps every page,
          including Next's own auto-generated 404/500, so this is the
          only location that actually guarantees universal coverage
          (individual pages' <Seo> component, components/Seo.js, doesn't
          run for those auto-generated pages). */}
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
