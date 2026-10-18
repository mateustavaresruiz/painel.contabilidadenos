import { useEffect, useState } from "react";

/** `true` enquanto a aba está visível (document.visibilityState === "visible"). */
export function useAbaVisivel(): boolean {
  const [visivel, setVisivel] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const aoMudar = () => setVisivel(document.visibilityState === "visible");
    aoMudar();
    document.addEventListener("visibilitychange", aoMudar);
    return () => document.removeEventListener("visibilitychange", aoMudar);
  }, []);
  return visivel;
}
