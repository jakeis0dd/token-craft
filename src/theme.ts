import OBR, { Theme } from "@owlbear-rodeo/sdk";

const INITIAL_THEME_TIMEOUT_MS = 1500;

// For common hex/rgb palette values, preserve Owlbear's text choice when it
// meets normal-text contrast; otherwise use the better contrasting neutral.
function readableText(background: string, preferred: string): string {
  function rgba(color: string): number[] | undefined {
    const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
    if (hex) {
      const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
      return [...full.match(/../g)!.map(c => parseInt(c, 16) / 255), 1];
    }
    const rgb = color.match(/^rgba?\(([\d.,\s]+)\)$/i)?.[1].split(",").map(Number);
    if (rgb && (rgb.length === 3 || rgb.length === 4)) {
      return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, rgb[3] ?? 1];
    }
  }
  const bg = rgba(background), fg = rgba(preferred);
  if (!bg || bg[3] !== 1 || !fg) return preferred;
  const luminance = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, channel, i) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][i];
  }, 0);
  const bgLum = luminance(bg);
  const fgLum = luminance(fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])));
  if ((Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05) >= 4.5) return preferred;
  return (bgLum + 0.05) / 0.05 >= 1.05 / (bgLum + 0.05) ? "#000000" : "#ffffff";
}

// Start on mount, including outside Owlbear. Theme updates only touch CSS;
// token settings, rendering and the responsive-height controller are separate.
export function startThemeSync(): () => void {
  const root = document.documentElement;
  let disposed = false;
  let connected = false;
  let receivedThemeEvent = false;
  let resolved = false;
  let unsubscribe: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function reveal() {
    resolved = true;
    root.dataset.themeReady = "true";
    if (timeout !== undefined) clearTimeout(timeout);
  }

  function apply(theme?: Theme) {
    if (disposed) return;
    if (theme) {
      const properties: Record<string, string> = {
        "--obr-background": theme.background.default,
        "--obr-paper": theme.background.paper,
        "--obr-text": theme.text.primary,
        "--obr-text-secondary": theme.text.secondary,
        "--obr-text-disabled": theme.text.disabled,
        "--obr-primary": theme.primary.main,
        "--obr-primary-dark": theme.primary.dark,
        "--obr-primary-text": readableText(theme.primary.main, theme.primary.contrastText),
        "--obr-primary-hover-text": readableText(theme.primary.dark, theme.primary.contrastText),
      };
      for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value);
    }
    const mode = theme?.mode === "LIGHT" ? "light" : "dark";
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    reveal();
  }

  function fail(error: unknown) {
    if (disposed) return;
    console.warn("Token Craft could not obtain Owlbear's theme.", error);
    // A failed initial query must not replace a theme received through events.
    if (!resolved) apply();
  }

  function connect() {
    if (disposed || connected) return;
    connected = true;
    try {
      unsubscribe = OBR.theme.onChange(theme => {
        if (disposed) return;
        receivedThemeEvent = true;
        apply(theme);
      });
      void OBR.theme.getTheme().then(theme => {
        if (!disposed && !receivedThemeEvent) apply(theme);
      }).catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  if (!OBR.isAvailable) {
    apply();
  } else {
    // The deadline includes SDK readiness, so neither a missing handshake nor
    // a stalled theme request can leave the mounted editor invisible forever.
    delete root.dataset.themeReady;
    timeout = setTimeout(() => {
      if (!disposed && !resolved) {
        fail(new Error("Theme initialization timed out; using the dark fallback."));
      }
    }, INITIAL_THEME_TIMEOUT_MS);
    try {
      OBR.onReady(connect);
    } catch (error) {
      fail(error);
    }
  }

  return () => {
    disposed = true;
    if (timeout !== undefined) clearTimeout(timeout);
    unsubscribe?.();
    // Also release the initialization surface if unmounted before resolution.
    root.dataset.themeReady = "true";
  };
}
