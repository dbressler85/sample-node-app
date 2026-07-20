// Display typeface — Oswald, a condensed "broadcast" face that gives the titles a real
// identity instead of the system fallback. Loaded defensively: the font packages are
// require()d in a try/catch and the load races a timeout, so a slow or missing font can
// never hang the splash or crash the app — it just falls back to the system face.
//
// `fonts.ready` flips true only once the face is actually loaded (checked via
// Font.isLoaded), and it's read at render time by the helpers below. Because App gates
// its first render on loadDisplayFont() finishing (or timing out), every screen sees the
// correct value from its first paint.

export const fonts = { ready: false };

export async function loadDisplayFont(timeoutMs = 2200) {
  let Font;
  let Oswald;
  try {
    // eslint-disable-next-line global-require
    Font = require('expo-font');
    // eslint-disable-next-line global-require
    Oswald = require('@expo-google-fonts/oswald');
  } catch (e) {
    return; // packages not installed → system font
  }
  if (!Font || !Font.loadAsync || !Oswald) return;
  try {
    await Promise.race([
      Font.loadAsync({
        Oswald_500Medium: Oswald.Oswald_500Medium,
        Oswald_600SemiBold: Oswald.Oswald_600SemiBold,
        Oswald_700Bold: Oswald.Oswald_700Bold,
      }),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    // Only claim readiness if the face genuinely loaded within the window; otherwise we've
    // already proceeded and it can apply on the next launch.
    if (Font.isLoaded && Font.isLoaded('Oswald_700Bold')) fonts.ready = true;
  } catch (e) {
    /* system font */
  }
}

// Style fragments — return {} when the display face isn't ready so callers can spread them
// unconditionally. Numbers deliberately keep the system face (for tabular alignment).
export const displayXL = () => (fonts.ready ? { fontFamily: 'Oswald_700Bold' } : null);
export const displayLabel = () => (fonts.ready ? { fontFamily: 'Oswald_600SemiBold' } : null);
