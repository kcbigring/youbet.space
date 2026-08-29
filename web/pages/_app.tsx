import type { AppProps } from "next/app";
import Head from "next/head";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "../lib/wagmi";
import "../styles/globals.css";

const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>youbet.space</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1"
        />
        <meta name="description" content="Private wagers between friends. Challenge, fund, resolve, settle." />
        <meta name="theme-color" content="#0b0d12" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-maskable.svg" />

        {/* Invites travel as links, so the unfurl in a text message is the
            first thing most people ever see of this. */}
        <meta property="og:site_name" content="youbet.space" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Private wagers between friends" />
        <meta
          property="og:description"
          content="Put money on it and let it settle itself. No chasing anyone down."
        />
        <meta property="og:image" content="https://youbet.space/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Private wagers between friends" />
        <meta
          name="twitter:description"
          content="Put money on it and let it settle itself. No chasing anyone down."
        />
        <meta name="twitter:image" content="https://youbet.space/og.png" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <Component {...pageProps} />
        </QueryClientProvider>
      </WagmiProvider>
    </>
  );
}
