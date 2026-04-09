/** Minimal toast shim until a full Sonner/Radix stack is added. */
type ToastInput = { title: string; description?: string };

export function toast({ title, description }: ToastInput) {
  const msg = description ? `${title}\n${description}` : title;
  window.alert(msg);
}
