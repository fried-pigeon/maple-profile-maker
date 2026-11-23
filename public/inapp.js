// In-app browsers (KakaoTalk, LINE, Instagram, ...) often can't save images that the page
// generates itself (blob:/data: downloads). KakaoTalk shows "지원하지 않는 이미지 파일".
// The fix is to reopen the page in the phone's default browser.

/** @returns {"kakao" | "line" | "other" | null} */
export function detectInApp(ua = navigator.userAgent) {
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  if (/\bLine\//i.test(ua)) return "line";
  if (/Instagram|FBAN|FBAV|NAVER\(inapp|DaumApps|BAND\/|everytimeApp|whale\/[\d.]+.*inapp/i.test(ua)) return "other";
  return null;
}

/** URL that makes the in-app browser hand `url` to the default browser, or null if there is none. */
export function externalOpenUrl(kind, url) {
  if (kind === "kakao") {
    // Official KakaoTalk scheme: opens the URL in the device's default browser (iOS and Android).
    return "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
  }
  if (kind === "line") {
    const u = new URL(url);
    u.searchParams.set("openExternalBrowser", "1");
    return u.toString();
  }
  return null;
}
