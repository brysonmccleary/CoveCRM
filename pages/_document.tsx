import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* ✅ Favicon from /public/logo.png */}
        <link rel="icon" href="/logo.png" type="image/png" />
        {/* ✅ Optional tab styling + SEO support */}
        <meta name="theme-color" content="#0f172a" />
        <meta
          name="description"
          content="CRM Cove – The Ultimate Life Insurance Sales CRM"
        />{" "}
        {/* ✅ Updated brand name */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
      </Head>
      <body className="bg-[#f8fafc] text-gray-800">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
