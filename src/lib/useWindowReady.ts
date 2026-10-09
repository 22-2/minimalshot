import { useEffect } from "react";

import { api } from "./api";

/** DOM と画像が準備できてから表示する。非表示 WebView の rAF 待ちは挟まない。 */
export function useWindowReady(ready: boolean, generation = 0, regionSession?: number) {
  useEffect(() => {
    if (ready) void api.showWindow(regionSession).catch(console.error);
  }, [ready, generation, regionSession]);
}
