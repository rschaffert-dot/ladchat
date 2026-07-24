import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/** Webbskal: 100dvh i stället för 100vh så att mobilwebbläsarens
 *  adressfält aldrig knuffar chattens inmatningsfält utanför skärmen. */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="sv">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html:
              "html,body{height:100%}@supports(height:100dvh){html,body{height:100dvh}}body{overflow:hidden;overscroll-behavior:none}#root{display:flex;height:100%;flex-direction:column}textarea:focus,input:focus,textarea,input,[contenteditable]{outline:none!important;box-shadow:none!important}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
