<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import { navigation } from "@/app/router/navigation";
import { AppService } from "@/services/native/app-service";
import type { AppInfo } from "@/shared/types/app-info";

const router = useRouter();
const { t } = useI18n();

const appInfo = ref<AppInfo | null>(null);
const appInfoError = ref<string | null>(null);

onMounted(async () => {
  try {
    // Vue → AppService → NativeService → Tauri invoke → Rust command
    appInfo.value = await AppService.getAppInfo();
  } catch (error: unknown) {
    appInfoError.value = error instanceof Error ? error.message : String(error);
  }
});

interface ToolEntry {
  labelKey: string;
  routeName: string;
}

interface ToolGroup {
  key: string;
  labelKey: string;
  tools: ToolEntry[];
}

// Build the tool grid from the same navigation tree as the sidebar.
const toolGroups: ToolGroup[] = navigation
  .filter((item) => item.key !== "home")
  .map((group) => ({
    key: group.key,
    labelKey: group.labelKey,
    tools: (group.children ?? [])
      .filter((child) => child.routeName !== undefined)
      .map((child) => ({ labelKey: child.labelKey, routeName: child.routeName as string })),
  }));

function openTool(routeName: string): void {
  void router.push({ name: routeName });
}
</script>

<template>
  <div class="home-view">
    <div class="home-header">
      <h1 class="home-title">Embedded Toolbox</h1>
      <p v-if="appInfo" class="app-info">
        {{ appInfo.name }} v{{ appInfo.version }} · {{ appInfo.platform }} /
        {{ appInfo.arch }}
      </p>
      <p v-else-if="appInfoError" class="app-info app-info--error">
        {{ t("app.appInfoError", { message: appInfoError }) }}
      </p>
    </div>

    <section v-for="group in toolGroups" :key="group.key" class="tool-group">
      <h2 class="group-title">{{ t(group.labelKey) }}</h2>
      <div class="tool-list">
        <button
          v-for="tool in group.tools"
          :key="tool.routeName"
          type="button"
          class="tool-item"
          @click="openTool(tool.routeName)"
        >
          {{ t(tool.labelKey) }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-view {
  max-width: 960px;
}

.home-header {
  margin-bottom: 24px;
}

.home-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
}

.app-info {
  margin: 0;
  font-size: 12px;
  opacity: 0.65;
}

.app-info--error {
  opacity: 1;
  color: #d03050;
}

.tool-group {
  margin-bottom: 20px;
}

.group-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  opacity: 0.75;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tool-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tool-item {
  padding: 8px 14px;
  font-size: 13px;
  font-family: inherit;
  color: inherit;
  background-color: var(--et-bg-surface);
  border: 1px solid var(--et-border-color);
  border-radius: 4px;
  cursor: pointer;
}

.tool-item:hover {
  border-color: #18a058;
}
</style>
