import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Favicon: use .ico for best cross-browser first-load support */}
        <link rel="icon" href="/favicon.ico" />
        {/* Apple touch icon (homescreen / iOS tabs) */}
        <link rel="apple-touch-icon" href="/logo.png" />
        {/* Basic meta */}
        <meta name="theme-color" content="#0f172a" />
        <meta name="description" content="CRM Cove – The Ultimate Life Insurance Sales CRM" />
        <meta charSet="utf-8" />
        {/* Note: viewport belongs in _app or page Head; leaving as-is since your pages set it */}
      </Head>
      <body className="bg-[#f8fafc] text-gray-800">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
