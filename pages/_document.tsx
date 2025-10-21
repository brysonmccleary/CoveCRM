import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Cache-busted favicon so browsers fetch the new one */}
        <link rel="icon" href="/favicon.ico?v=3" />
        {/* iOS / Home screen icon */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* Basic meta */}
        <meta name="theme-color" content="#0f172a" />
        <meta name="description" content="CRM Cove – The Ultimate Life Insurance Sales CRM" />
        <meta charSet="utf-8" />
      </Head>
      <body className="bg-[#f8fafc] text-gray-800">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
