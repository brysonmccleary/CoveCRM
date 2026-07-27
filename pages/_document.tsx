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
          content="Cove CRM – The Ultimate Life Insurance Sales CRM"
        />{" "}
        {/* ✅ Updated brand name */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="utf-8" />
        <meta name="facebook-domain-verification" content="hwc2mtikjkyvgdmeja5be0vxjucafo" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function () {
  try {
    var saved = window.localStorage.getItem("cove-color-scheme");
    var dark = saved === "dark" || (saved !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (_) {
    document.documentElement.classList.toggle("dark", window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "wgv512ovel");`,
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
