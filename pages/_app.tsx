import '../styles/globals.css';
import type { AppProps } from 'next/app';
import ChatAssistantWidget from "@/components/ChatAssistantWidget";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <ChatAssistantWidget />
    </>
  );
}
