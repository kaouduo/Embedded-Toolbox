<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { NIcon, NMenu } from "naive-ui";
import type { MenuOption } from "naive-ui";
import {
  ColorPaletteOutline,
  ConstructOutline,
  FlashOutline,
  GitCompareOutline,
  HomeOutline,
  ImageOutline,
  LinkOutline,
  SwapHorizontalOutline,
} from "@vicons/ionicons5";
import type { Component } from "vue";

import { navigation } from "@/app/router/navigation";
import type { NavItem } from "@/app/router/navigation";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const iconMap: Record<string, Component> = {
  home: HomeOutline,
  protocol: LinkOutline,
  communication: SwapHorizontalOutline,
  converter: GitCompareOutline,
  calculator: ConstructOutline,
  image: ImageOutline,
  color: ColorPaletteOutline,
  device: FlashOutline,
};

function renderIcon(name?: string) {
  if (!name) return undefined;
  const component = iconMap[name];
  if (!component) return undefined;
  return () => h(NIcon, { size: 18 }, { default: () => h(component) });
}

function toMenuOption(item: NavItem): MenuOption {
  return {
    key: item.routeName ?? item.key,
    label: t(item.labelKey),
    icon: renderIcon(item.icon),
    children: item.children?.map(toMenuOption),
  };
}

const menuOptions = computed<MenuOption[]>(() => navigation.map(toMenuOption));

const activeKey = computed(() => (typeof route.name === "string" ? route.name : ""));

// Keys of groups containing the active route, so the group stays expanded.
const expandedKeys = ref<string[]>([]);
watch(
  activeKey,
  (key) => {
    for (const item of navigation) {
      if (item.children?.some((child) => child.routeName === key)) {
        if (!expandedKeys.value.includes(item.key)) {
          expandedKeys.value.push(item.key);
        }
      }
    }
  },
  { immediate: true },
);

function handleSelect(key: string): void {
  if (router.currentRoute.value.name !== key) {
    void router.push({ name: key });
  }
}
</script>

<template>
  <aside class="app-sidebar">
    <n-menu
      :options="menuOptions"
      :value="activeKey"
      :indent="18"
      :expanded-keys="expandedKeys"
      @update:expanded-keys="(keys: string[]) => (expandedKeys = keys)"
      @update:value="handleSelect"
    />
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--et-bg-surface);
  border-right: 1px solid var(--et-border-color);
  overflow: hidden;
}

.app-sidebar :deep(.n-menu) {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
</style>
