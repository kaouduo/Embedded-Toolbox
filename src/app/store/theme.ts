import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "embedded-toolbox.theme";

function resolveSystemDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function loadInitialMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

export const useThemeStore = defineStore("app-theme", () => {
  const mode = ref<ThemeMode>(loadInitialMode());

  const isDark = computed(() =>
    mode.value === "system" ? resolveSystemDark() : mode.value === "dark",
  );

  function setMode(next: ThemeMode): void {
    mode.value = next;
  }

  function toggle(): void {
    mode.value = isDark.value ? "light" : "dark";
  }

  // Keep <html> attributes and persistence in sync.
  watch(
    [mode, isDark],
    ([nextMode, dark]) => {
      localStorage.setItem(STORAGE_KEY, nextMode);
      document.documentElement.classList.toggle("dark", dark);
    },
    { immediate: true },
  );

  // Follow OS theme while in "system" mode.
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", () => {
      if (mode.value === "system") {
        // Re-trigger the watcher; `isDark` derives from the media query.
        document.documentElement.classList.toggle("dark", resolveSystemDark());
      }
    });
  }

  return { mode, isDark, setMode, toggle };
});
