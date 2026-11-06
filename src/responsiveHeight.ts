import OBR from "@owlbear-rodeo/sdk";

const POLL_INTERVAL_MS = 750;

// Call after OBR is ready. Owlbear owns the action's placement and size limits.
export function startResponsiveActionHeight(): () => void {
  let disposed = false;
  let open = false;
  let receivedOpenEvent = false;
  let generation = 0;
  let inFlight = false;
  let lastHeight: number | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;

  async function updateHeight() {
    if (disposed || !open || inFlight) return;
    inFlight = true;
    const currentGeneration = generation;
    try {
      // Measure the host scene viewport, never the action iframe or its content.
      const height = await OBR.viewport.getHeight();
      if (disposed || !open || currentGeneration !== generation) return;
      if (!Number.isFinite(height) || height <= 0 || height === lastHeight) return;
      await OBR.action.setHeight(height);
      if (!disposed && currentGeneration === generation) lastHeight = height;
    } catch (error) {
      // Keep the current/native fallback size; retry on the next polling tick.
      console.warn("Token Craft could not update the action height.", error);
    } finally {
      inFlight = false;
      // A close/reopen during an SDK request must refresh the new opening too.
      if (!disposed && open && currentGeneration !== generation) void updateHeight();
    }
  }

  function setOpen(isOpen: boolean) {
    if (disposed || open === isOpen) return;
    open = isOpen;
    generation++;
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
    if (open) {
      lastHeight = undefined;
      void updateHeight();
      interval = setInterval(() => void updateHeight(), POLL_INTERVAL_MS);
    }
  }

  const unsubscribe = OBR.action.onOpenChange((isOpen) => {
    receivedOpenEvent = true;
    setOpen(isOpen);
  });
  // Subscribe first so a delayed initial query cannot override a newer event.
  void OBR.action.isOpen().then((isOpen) => {
    if (!receivedOpenEvent) setOpen(isOpen);
  }).catch((error) => {
    console.warn("Token Craft could not read the action's open state.", error);
  });

  return () => {
    disposed = true;
    open = false;
    generation++;
    if (interval !== undefined) clearInterval(interval);
    unsubscribe();
  };
}
