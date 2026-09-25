import { ref, watch } from "vue";
import { defineStore } from "pinia";

import { i18n } from "@/app/i18n";
import type { AppLocale } from "@/app/i18n/messages";

const STORAGE_KEY = "embedded-toolbox.locale";

function getInitialLocale(): AppLocale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh-CN") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export const useLocaleStore = defineStore("app-locale", () => {
  const locale = ref<AppLocale>(getInitialLocale());

  function setLocale(nextLocale: AppLocale): void {
    locale.value = nextLocale;
  }

  function toggle(): void {
    locale.value = locale.value === "en" ? "zh-CN" : "en";
  }

  watch(
    locale,
    (nextLocale) => {
      i18n.global.locale.value = nextLocale;
      localStorage.setItem(STORAGE_KEY, nextLocale);
      document.documentElement.lang = nextLocale;
    },
    { immediate: true },
  );

  return { locale, setLocale, toggle };
});
